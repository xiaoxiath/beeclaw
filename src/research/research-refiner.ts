/**
 * research-refiner.ts — P0-2: 迭代精炼引擎
 *
 * 在初始综合报告生成后，自动评估覆盖度缺口，
 * 生成补充查询，获取新来源，并将新发现融入报告。
 *
 * 精炼循环：
 *   评估覆盖度 → 识别缺口 → 生成补充查询 → 搜索+获取 → 融合综合 → 再次评估
 *   直到：覆盖度满足 / 达到最大迭代次数 / 无新有效来源
 *
 * 与 research-synthesizer.ts、query-generator.ts、research-progress.ts 协作。
 */

import type {
  FetchedSource,
  SynthesisReport,
  ResearchSynthesizer,
  AICallFn,
} from './research-synthesizer';

import type { ResearchProgressEmitter, ResearchPhase } from './research-progress';
import type { QueryGenerator } from './query-generator';

// ─── Types ────────────────────────────────────────────────

/** 覆盖度评估结果 */
export interface CoverageEvaluation {
  /** 整体覆盖度分数 (0-100) */
  overallScore: number;
  /** 各方面覆盖度 */
  aspectCoverage: Array<{
    aspect: string;
    score: number;
    /** 缺失的具体信息 */
    missingInfo: string[];
  }>;
  /** 建议的补充研究方向 */
  suggestedDirections: string[];
  /** 是否建议继续精炼 */
  shouldRefine: boolean;
  /** 评估理由 */
  rationale: string;
}

/** 精炼引擎配置 */
export interface RefinerConfig {
  /** 最大精炼迭代次数 */
  maxIterations: number;
  /** 覆盖度满足阈值 (0-100)，达到此分数停止精炼 */
  coverageThreshold: number;
  /** 每轮精炼最大补充查询数 */
  maxQueriesPerRound: number;
  /** 每轮精炼最大新来源数 */
  maxNewSourcesPerRound: number;
  /** 单次内容获取最大字符数 */
  maxContentPerSource: number;
  /** 精炼 LLM 模型 */
  evaluationModel: string;
  /** 评估 temperature */
  evaluationTemperature: number;
  /** 连续无改善轮数阈值 (超过则提前停止) */
  noImprovementLimit: number;
}

/** 精炼轮次的结果 */
export interface RefinementRound {
  /** 轮次编号 (1-based) */
  round: number;
  /** 本轮覆盖度评估 */
  evaluation: CoverageEvaluation;
  /** 本轮生成的补充查询 */
  queries: string[];
  /** 本轮获取的新来源数 */
  newSourceCount: number;
  /** 本轮后的报告版本 */
  report: SynthesisReport;
  /** 本轮耗时 (ms) */
  durationMs: number;
  /** 停止原因 (如果本轮是最后一轮) */
  stopReason?: 'coverage_met' | 'max_iterations' | 'no_new_sources' | 'no_improvement';
}

/** 精炼的完整结果 */
export interface RefinementResult {
  /** 最终报告 */
  finalReport: SynthesisReport;
  /** 各轮次记录 */
  rounds: RefinementRound[];
  /** 总迭代次数 */
  totalIterations: number;
  /** 总新增来源数 */
  totalNewSources: number;
  /** 初始覆盖度 → 最终覆盖度 */
  coverageImprovement: { initial: number; final: number };
  /** 总耗时 (ms) */
  totalDurationMs: number;
}

/** 搜索函数接口 (与 BeeClaw SearchOrchestrator 对齐) */
export interface SearchFn {
  (query: string, maxResults?: number): Promise<Array<{
    title: string;
    url: string;
    snippet: string;
  }>>;
}

/** 内容获取函数接口 */
export interface FetchFn {
  (url: string, maxLength?: number): Promise<{
    title: string;
    content: string;
  }>;
}

// ─── Constants ────────────────────────────────────────────

export const DEFAULT_REFINER_CONFIG: Readonly<RefinerConfig> = {
  maxIterations: 3,
  coverageThreshold: 75,
  maxQueriesPerRound: 5,
  maxNewSourcesPerRound: 8,
  maxContentPerSource: 15_000,
  evaluationModel: 'gpt-4o-mini',
  evaluationTemperature: 0.2,
  noImprovementLimit: 2,
};

// ─── Core Refiner Class ──────────────────────────────────

export class ResearchRefiner {
  private config: RefinerConfig;
  private callAI: AICallFn;
  private synthesizer: ResearchSynthesizer;
  private queryGenerator: QueryGenerator;
  private searchFn: SearchFn;
  private fetchFn: FetchFn;
  private progressEmitter?: ResearchProgressEmitter;

  constructor(
    callAI: AICallFn,
    synthesizer: ResearchSynthesizer,
    queryGenerator: QueryGenerator,
    searchFn: SearchFn,
    fetchFn: FetchFn,
    config?: Partial<RefinerConfig>,
    progressEmitter?: ResearchProgressEmitter,
  ) {
    this.callAI = callAI;
    this.synthesizer = synthesizer;
    this.queryGenerator = queryGenerator;
    this.searchFn = searchFn;
    this.fetchFn = fetchFn;
    this.config = { ...DEFAULT_REFINER_CONFIG, ...config };
    this.progressEmitter = progressEmitter;
  }

  // ── Public API ──

  /**
   * 对初始报告进行迭代精炼。
   *
   * @param initialReport  初始综合报告
   * @param topic          研究主题
   * @param aspects        研究方面
   * @param existingSources 已有来源 (避免重复获取)
   * @returns              精炼后的完整结果
   */
  async refine(
    initialReport: SynthesisReport,
    topic: string,
    aspects: string[],
    existingSources: FetchedSource[],
  ): Promise<RefinementResult> {
    const startTime = Date.now();
    const rounds: RefinementRound[] = [];
    let currentReport = initialReport;
    let allSources = [...existingSources];
    const visitedUrls = new Set(existingSources.map(s => s.url));
    let noImprovementCount = 0;
    let previousScore = 0;

    for (let round = 1; round <= this.config.maxIterations; round++) {
      const roundStart = Date.now();

      this.emitProgress('refining', `精炼迭代 ${round}/${this.config.maxIterations}`, round / this.config.maxIterations);

      // Step 1: 评估覆盖度
      const evaluation = await this.evaluateCoverage(currentReport, topic, aspects);

      // 检查停止条件: 覆盖度满足
      if (evaluation.overallScore >= this.config.coverageThreshold) {
        rounds.push({
          round, evaluation, queries: [], newSourceCount: 0,
          report: currentReport, durationMs: Date.now() - roundStart,
          stopReason: 'coverage_met',
        });
        break;
      }

      // 检查停止条件: 无改善
      if (round > 1 && evaluation.overallScore <= previousScore) {
        noImprovementCount++;
        if (noImprovementCount >= this.config.noImprovementLimit) {
          rounds.push({
            round, evaluation, queries: [], newSourceCount: 0,
            report: currentReport, durationMs: Date.now() - roundStart,
            stopReason: 'no_improvement',
          });
          break;
        }
      } else {
        noImprovementCount = 0;
      }
      previousScore = evaluation.overallScore;

      // Step 2: 生成补充查询
      const supplementQueries = await this.generateSupplementQueries(
        evaluation, topic, aspects,
      );

      if (supplementQueries.length === 0) {
        rounds.push({
          round, evaluation, queries: [], newSourceCount: 0,
          report: currentReport, durationMs: Date.now() - roundStart,
          stopReason: 'no_new_sources',
        });
        break;
      }

      this.emitProgress('searching', `补充搜索 ${supplementQueries.length} 条查询`, 0.3);

      // Step 3: 执行补充搜索
      const searchResults = await this.executeSupplementSearch(supplementQueries);

      // Step 4: 过滤已访问 URL 并获取新内容
      const newUrls = searchResults
        .filter(r => !visitedUrls.has(r.url))
        .slice(0, this.config.maxNewSourcesPerRound);

      if (newUrls.length === 0) {
        rounds.push({
          round, evaluation, queries: supplementQueries, newSourceCount: 0,
          report: currentReport, durationMs: Date.now() - roundStart,
          stopReason: 'no_new_sources',
        });
        break;
      }

      this.emitProgress('fetching', `获取 ${newUrls.length} 个新来源`, 0.5);

      const newSources = await this.fetchNewSources(newUrls, allSources.length);

      // 更新 visited URLs
      for (const s of newSources) {
        visitedUrls.add(s.url);
      }
      allSources = [...allSources, ...newSources];

      this.emitProgress('synthesizing', `融合 ${newSources.length} 个新来源到报告`, 0.7);

      // Step 5: 重新综合 (全部来源)
      currentReport = await this.synthesizer.synthesize(topic, aspects, allSources);

      rounds.push({
        round, evaluation, queries: supplementQueries,
        newSourceCount: newSources.length,
        report: currentReport, durationMs: Date.now() - roundStart,
      });
    }

    const finalEvaluation = rounds.length > 0 ? rounds[rounds.length - 1].evaluation : { overallScore: 0 };
    const initialEvaluation = rounds.length > 0 ? rounds[0].evaluation : { overallScore: 0 };

    return {
      finalReport: currentReport,
      rounds,
      totalIterations: rounds.length,
      totalNewSources: rounds.reduce((sum, r) => sum + r.newSourceCount, 0),
      coverageImprovement: {
        initial: initialEvaluation.overallScore,
        final: finalEvaluation.overallScore,
      },
      totalDurationMs: Date.now() - startTime,
    };
  }

  // ── Private: Coverage Evaluation ──

  private async evaluateCoverage(
    report: SynthesisReport,
    topic: string,
    aspects: string[],
  ): Promise<CoverageEvaluation> {
    const reportSummary = this.buildReportSummary(report);
    const isZh = this.detectLanguage(topic) === 'zh';

    const prompt = isZh
      ? `你是研究覆盖度评估专家。请评估以下研究报告对主题「${topic}」的覆盖情况。

研究方面：${aspects.join('、')}

报告摘要：
${reportSummary}

请以 JSON 格式输出评估结果：
{
  "overallScore": 0-100,
  "aspectCoverage": [
    {"aspect": "方面名", "score": 0-100, "missingInfo": ["缺失信息1"]}
  ],
  "suggestedDirections": ["建议补充研究的方向1"],
  "shouldRefine": true/false,
  "rationale": "评估理由"
}

评分标准：
- 90-100: 覆盖全面，论据充分，来源多样
- 70-89: 主要方面已覆盖，少数细节缺失
- 50-69: 部分方面覆盖不足，需要补充
- 0-49: 覆盖严重不足`
      : `You are a research coverage evaluator. Assess the following report on "${topic}".

Aspects: ${aspects.join(', ')}

Report summary:
${reportSummary}

Output JSON:
{
  "overallScore": 0-100,
  "aspectCoverage": [
    {"aspect": "name", "score": 0-100, "missingInfo": ["missing info 1"]}
  ],
  "suggestedDirections": ["suggested direction 1"],
  "shouldRefine": true/false,
  "rationale": "evaluation rationale"
}`;

    const response = await this.callAI({
      model: this.config.evaluationModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: this.config.evaluationTemperature,
      response_format: { type: 'json_object' },
    });

    return this.parseCoverageEvaluation(response.content);
  }

  private buildReportSummary(report: SynthesisReport): string {
    const parts: string[] = [
      `标题: ${report.title}`,
      `摘要: ${report.executiveSummary}`,
      `章节数: ${report.sections.length}`,
    ];
    for (const section of report.sections) {
      parts.push(`- [${section.confidence}] ${section.heading}: ${section.content.substring(0, 300)}...`);
    }
    if (report.coverageGaps.length > 0) {
      parts.push(`已识别缺口: ${report.coverageGaps.join('、')}`);
    }
    parts.push(`来源数: ${report.references.length}`);
    return parts.join('\n');
  }

  private parseCoverageEvaluation(content: string): CoverageEvaluation {
    try {
      let cleaned = content.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      const parsed = JSON.parse(cleaned);

      return {
        overallScore: Math.max(0, Math.min(100, Number(parsed.overallScore) || 0)),
        aspectCoverage: Array.isArray(parsed.aspectCoverage)
          ? parsed.aspectCoverage.map((ac: Record<string, unknown>) => ({
              aspect: String(ac.aspect || ''),
              score: Math.max(0, Math.min(100, Number(ac.score) || 0)),
              missingInfo: Array.isArray(ac.missingInfo) ? ac.missingInfo.map(String) : [],
            }))
          : [],
        suggestedDirections: Array.isArray(parsed.suggestedDirections)
          ? parsed.suggestedDirections.map(String)
          : [],
        shouldRefine: Boolean(parsed.shouldRefine),
        rationale: String(parsed.rationale || ''),
      };
    } catch {
      return {
        overallScore: 30,
        aspectCoverage: [],
        suggestedDirections: [],
        shouldRefine: true,
        rationale: '覆盖度评估解析失败，默认为低覆盖度',
      };
    }
  }

  // ── Private: Supplement Query Generation ──

  private async generateSupplementQueries(
    evaluation: CoverageEvaluation,
    topic: string,
    aspects: string[],
  ): Promise<string[]> {
    // 收集低覆盖度方面的缺失信息
    const lowCoverageAspects = evaluation.aspectCoverage
      .filter(ac => ac.score < 60)
      .map(ac => ({ aspect: ac.aspect, missing: ac.missingInfo }));

    const directions = [
      ...evaluation.suggestedDirections,
      ...lowCoverageAspects.flatMap(a => a.missing),
    ];

    if (directions.length === 0) return [];

    return this.queryGenerator.generateFollowUpQueries(
      topic,
      aspects,
      directions,
      this.config.maxQueriesPerRound,
    );
  }

  // ── Private: Search & Fetch ──

  private async executeSupplementSearch(
    queries: string[],
  ): Promise<Array<{ title: string; url: string; snippet: string }>> {
    const allResults: Array<{ title: string; url: string; snippet: string }> = [];
    const searchPromises = queries.map(q => this.searchFn(q, 5).catch(() => []));
    const results = await Promise.allSettled(searchPromises);

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allResults.push(...result.value);
      }
    }

    // URL 去重
    const seen = new Set<string>();
    return allResults.filter(r => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });
  }

  private async fetchNewSources(
    searchResults: Array<{ title: string; url: string; snippet: string }>,
    existingCount: number,
  ): Promise<FetchedSource[]> {
    const fetchPromises = searchResults.map(async (r, index) => {
      try {
        const fetched = await this.fetchFn(r.url, this.config.maxContentPerSource);
        return {
          id: existingCount + index + 1,
          url: r.url,
          title: fetched.title || r.title,
          content: fetched.content,
          fetchedAt: new Date(),
        } as FetchedSource;
      } catch {
        return null;
      }
    });

    const results = await Promise.allSettled(fetchPromises);
    return results
      .filter((r): r is PromiseFulfilledResult<FetchedSource | null> => r.status === 'fulfilled')
      .map(r => r.value)
      .filter((s): s is FetchedSource => s !== null && s.content.length > 100);
  }

  // ── Private: Utilities ──

  private emitProgress(phase: ResearchPhase, detail: string, progress: number): void {
    this.progressEmitter?.emit({
      phase,
      detail,
      progress: Math.max(0, Math.min(1, progress)),
      timestamp: Date.now(),
    });
  }

  private detectLanguage(text: string): 'zh' | 'en' {
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    return chineseChars / text.length > 0.3 ? 'zh' : 'en';
  }
}
