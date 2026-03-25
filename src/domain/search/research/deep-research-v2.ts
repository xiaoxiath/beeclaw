/**
 * deep-research-v2.ts — 增强版 Deep Research 流水线
 *
 * 替代 builtin.ts 中的 executeDeepResearch()，串联：
 * - QueryGenerator      (LLM 多策略查询生成)
 * - SearchOrchestrator   (多源搜索 + 去重)
 * - ResearchSynthesizer  (LLM 综合引擎)
 * - ResearchRefiner      (迭代精炼)
 * - ResearchProgressEmitter (进度事件)
 *
 * 设计原则：
 * 1. 保持与现有 BeeClaw Agent 架构兼容 (ToolResult 接口)
 * 2. 分阶段执行，每阶段可独立测试
 * 3. 优雅降级 —— 任何子模块失败不阻塞整体流程
 * 4. 完整的进度可观测性
 *
 * @module deep-research-v2
 */

// ============================================================
// 类型定义
// ============================================================

/** LLM 消息格式 */
export interface CoreMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ============================================================
// 类型定义
// ============================================================

/** 研究深度级别 */
export type ResearchDepth = 'quick' | 'standard' | 'comprehensive';

/** 搜索结果条目（与 SearchOrchestrator 对齐） */
export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
  provider?: string;
  score?: number;
}

/** 抓取后的源文档 */
export interface FetchedSource {
  id: number;
  url: string;
  title: string;
  content: string;
  fetchedAt: Date;
  provider?: string;
  searchScore?: number;
  contentLength?: number;
  truncated?: boolean;
}

/** Deep Research 最终输出 */
export interface DeepResearchResult {
  /** 最终 Markdown 报告 */
  report: string;
  /** 使用的源列表 */
  sources: SourceReference[];
  /** 研究元数据 */
  metadata: ResearchMetadata;
  /** 原始综合报告（供后续处理） */
  rawSynthesisReport?: SynthesisReport;
}

export interface SourceReference {
  url: string;
  title: string;
  credibilityScore?: number;
  usedInSections?: string[];
}

export interface ResearchMetadata {
  topic: string;
  depth: ResearchDepth;
  totalQueries: number;
  totalSourcesFetched: number;
  totalSourcesUsed: number;
  refinementRounds: number;
  finalCoverageScore: number;
  durationMs: number;
  phases: PhaseTimingRecord[];
}

export interface PhaseTimingRecord {
  phase: string;
  startMs: number;
  endMs: number;
  durationMs: number;
}

/** 综合报告（与 research-synthesizer 对齐） */
export interface SynthesisReport {
  title: string;
  sections: SynthesisSection[];
  contradictions?: Contradiction[];
  coverageGaps?: string[];
  references: SynthesisReference[];
  metadata?: Record<string, unknown>;
}

export interface SynthesisSection {
  heading: string;
  content: string;
  citations: string[];
  confidenceScore: number;
}

export interface Contradiction {
  claim1: string;
  claim2: string;
  source1: string;
  source2: string;
  severity: 'minor' | 'moderate' | 'major';
  resolution?: string;
}

export interface SynthesisReference {
  id: string;
  url: string;
  title: string;
  credibilityScore?: number;
}

// ============================================================
// 配置
// ============================================================

export interface DeepResearchV2Config {
  /** 研究深度 */
  depth: ResearchDepth;

  /** 最大查询数（覆盖深度默认值） */
  maxQueries?: number;

  /** 最大抓取源数 */
  maxSources?: number;

  /** 每源最大内容字符数 */
  maxContentPerSource?: number;

  /** 最大精炼轮次 */
  maxRefinementRounds?: number;

  /** 覆盖率阈值 (0-100)，达到后停止精炼 */
  coverageThreshold?: number;

  /** 并发抓取数 */
  fetchConcurrency?: number;

  /** 综合模型 */
  synthesisModel?: string;

  /** 查询生成模型 */
  queryModel?: string;

  /** 输出语言 */
  language?: 'zh' | 'en' | 'auto';

  /** 是否启用可信度评估 */
  enableCredibility?: boolean;

  /** 是否启用矛盾检测 */
  enableContradictions?: boolean;

  /** 是否启用迭代精炼 */
  enableRefinement?: boolean;

  /** 总超时 (ms) */
  totalTimeout?: number;

  /** 单次搜索超时 (ms) */
  searchTimeout?: number;

  /** 单次抓取超时 (ms) */
  fetchTimeout?: number;
}

/** 深度 → 默认参数映射 */
const DEPTH_DEFAULTS: Record<ResearchDepth, Required<Omit<DeepResearchV2Config, 'depth'>>> = {
  quick: {
    maxQueries: 5,
    maxSources: 8,
    maxContentPerSource: 5000,
    maxRefinementRounds: 0,
    coverageThreshold: 60,
    fetchConcurrency: 4,
    synthesisModel: 'gpt-4o-mini',
    queryModel: 'gpt-4o-mini',
    language: 'auto',
    enableCredibility: false,
    enableContradictions: false,
    enableRefinement: false,
    totalTimeout: 60_000,
    searchTimeout: 10_000,
    fetchTimeout: 8_000,
  },
  standard: {
    maxQueries: 12,
    maxSources: 20,
    maxContentPerSource: 15_000,
    maxRefinementRounds: 2,
    coverageThreshold: 75,
    fetchConcurrency: 5,
    synthesisModel: 'gpt-4o',
    queryModel: 'gpt-4o-mini',
    language: 'auto',
    enableCredibility: true,
    enableContradictions: true,
    enableRefinement: true,
    totalTimeout: 180_000,
    searchTimeout: 15_000,
    fetchTimeout: 10_000,
  },
  comprehensive: {
    maxQueries: 21,
    maxSources: 40,
    maxContentPerSource: 30_000,
    maxRefinementRounds: 3,
    coverageThreshold: 85,
    fetchConcurrency: 6,
    synthesisModel: 'gpt-4o',
    queryModel: 'gpt-4o-mini',
    language: 'auto',
    enableCredibility: true,
    enableContradictions: true,
    enableRefinement: true,
    totalTimeout: 300_000,
    searchTimeout: 15_000,
    fetchTimeout: 12_000,
  },
};

function resolveConfig(input: DeepResearchV2Config): Required<DeepResearchV2Config> {
  const defaults = DEPTH_DEFAULTS[input.depth];
  return {
    depth: input.depth,
    maxQueries: input.maxQueries ?? defaults.maxQueries,
    maxSources: input.maxSources ?? defaults.maxSources,
    maxContentPerSource: input.maxContentPerSource ?? defaults.maxContentPerSource,
    maxRefinementRounds: input.maxRefinementRounds ?? defaults.maxRefinementRounds,
    coverageThreshold: input.coverageThreshold ?? defaults.coverageThreshold,
    fetchConcurrency: input.fetchConcurrency ?? defaults.fetchConcurrency,
    synthesisModel: input.synthesisModel ?? defaults.synthesisModel,
    queryModel: input.queryModel ?? defaults.queryModel,
    language: input.language ?? defaults.language,
    enableCredibility: input.enableCredibility ?? defaults.enableCredibility,
    enableContradictions: input.enableContradictions ?? defaults.enableContradictions,
    enableRefinement: input.enableRefinement ?? defaults.enableRefinement,
    totalTimeout: input.totalTimeout ?? defaults.totalTimeout,
    searchTimeout: input.searchTimeout ?? defaults.searchTimeout,
    fetchTimeout: input.fetchTimeout ?? defaults.fetchTimeout,
  };
}

// ============================================================
// 依赖接口（解耦外部模块）
// ============================================================

/**
 * 搜索函数签名 —— 与 SearchOrchestrator.search() 对齐
 */
export type SearchFn = (
  query: string,
  options?: { maxResults?: number; timeout?: number }
) => Promise<SearchResultItem[]>;

/**
 * 页面抓取函数签名 —— 与 web_fetch 工具对齐
 */
export type FetchFn = (
  url: string,
  options?: { maxLength?: number; timeout?: number }
) => Promise<{ content: string; title?: string }>;

/**
 * LLM 调用函数签名
 */
export type LLMCallFn = (
  messages: CoreMessage[],
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    responseFormat?: { type: 'json_object' } | { type: 'text' };
  }
) => Promise<string>;

/**
 * 进度回调
 */
export type ProgressCallback = (event: {
  phase: string;
  detail: string;
  progress: number;
  partialResult?: string;
  sourcesFound?: number;
  coverageScore?: number;
}) => void;

// ============================================================
// 主流水线
// ============================================================

export class DeepResearchV2 {
  private config: Required<DeepResearchV2Config>;
  private searchFn: SearchFn;
  private fetchFn: FetchFn;
  private llmCall: LLMCallFn;
  private onProgress?: ProgressCallback;
  private abortController: AbortController;

  // 运行时状态
  private allSources: FetchedSource[] = [];
  private visitedUrls: Set<string> = new Set();
  private phaseTimings: PhaseTimingRecord[] = [];
  private startTime: number = 0;

  constructor(options: {
    config: DeepResearchV2Config;
    searchFn: SearchFn;
    fetchFn: FetchFn;
    llmCall: LLMCallFn;
    onProgress?: ProgressCallback;
    abortSignal?: AbortSignal;
  }) {
    this.config = resolveConfig(options.config);
    this.searchFn = options.searchFn;
    this.fetchFn = options.fetchFn;
    this.llmCall = options.llmCall;
    this.onProgress = options.onProgress;
    this.abortController = new AbortController();

    // 外部 abort 信号链接
    if (options.abortSignal) {
      options.abortSignal.addEventListener('abort', () => {
        this.abortController.abort(options.abortSignal!.reason);
      });
    }
  }

  /**
   * 执行完整的 Deep Research 流水线
   */
  async execute(topic: string, aspects?: string[]): Promise<DeepResearchResult> {
    this.startTime = Date.now();
    this.allSources = [];
    this.visitedUrls = new Set();
    this.phaseTimings = [];

    const resolvedAspects = aspects ?? await this.generateAspects(topic);

    try {
      // ── Phase 1: 查询生成 ──
      this.emitProgress('planning', '正在分析研究主题，生成搜索策略...', 0.02);
      const queries = await this.timedPhase('planning', () =>
        this.generateQueries(topic, resolvedAspects)
      );
      this.checkAbort();

      // ── Phase 2: 并发搜索 ──
      this.emitProgress('searching', `正在执行 ${queries.length} 个搜索查询...`, 0.10);
      const searchResults = await this.timedPhase('searching', () =>
        this.executeSearches(queries)
      );
      this.checkAbort();

      // ── Phase 3: 页面抓取 ──
      const urlsToFetch = this.deduplicateAndRank(searchResults);
      this.emitProgress('fetching', `正在抓取 ${urlsToFetch.length} 个页面内容...`, 0.28);
      await this.timedPhase('fetching', () =>
        this.fetchPages(urlsToFetch)
      );
      this.checkAbort();

      if (this.allSources.length === 0) {
        return this.buildEmptyResult(topic);
      }

      this.emitProgress('fetching', `已获取 ${this.allSources.length} 个有效源`, 0.44,
        { sourcesFound: this.allSources.length });

      // ── Phase 4: LLM 综合 ──
      this.emitProgress('synthesizing', '正在进行 LLM 智能综合分析...', 0.48);
      let synthesisReport = await this.timedPhase('synthesizing', () =>
        this.synthesize(topic, resolvedAspects, this.allSources)
      );
      this.checkAbort();

      // ── Phase 5: 迭代精炼（可选）──
      let refinementRounds = 0;
      let finalCoverage = 0;

      if (this.config.enableRefinement && this.config.maxRefinementRounds > 0) {
        this.emitProgress('refining', '正在评估覆盖率并精炼...', 0.65);
        const refinementResult = await this.timedPhase('refining', () =>
          this.refine(topic, resolvedAspects, synthesisReport)
        );
        this.checkAbort();

        synthesisReport = refinementResult.report;
        refinementRounds = refinementResult.rounds;
        finalCoverage = refinementResult.coverageScore;
      } else {
        finalCoverage = await this.quickCoverageEstimate(topic, resolvedAspects, synthesisReport);
      }

      // ── Phase 6: 最终格式化 ──
      this.emitProgress('finalizing', '正在生成最终报告...', 0.92);
      const report = await this.timedPhase('finalizing', () =>
        this.formatFinalReport(topic, synthesisReport, resolvedAspects)
      );

      const result: DeepResearchResult = {
        report,
        sources: this.buildSourceReferences(synthesisReport),
        metadata: {
          topic,
          depth: this.config.depth,
          totalQueries: queries.length,
          totalSourcesFetched: this.allSources.length,
          totalSourcesUsed: synthesisReport.references.length,
          refinementRounds,
          finalCoverageScore: finalCoverage,
          durationMs: Date.now() - this.startTime,
          phases: this.phaseTimings,
        },
        rawSynthesisReport: synthesisReport,
      };

      this.emitProgress('completed', '研究完成', 1.0);
      return result;

    } catch (error) {
      // 超时或被中止 —— 尝试用已有数据生成部分报告
      if (this.isAbortOrTimeout(error)) {
        return this.buildPartialResult(topic, resolvedAspects, error as Error);
      }
      throw error;
    }
  }

  // ============================================================
  // Phase 1: 查询生成
  // ============================================================

  private async generateAspects(topic: string): Promise<string[]> {
    const prompt = `Analyze the following research topic and identify 3-6 key aspects/dimensions that should be investigated for a comprehensive understanding.

Topic: ${topic}

Return a JSON array of strings, each being a concise aspect name (2-8 words).
Example: ["Market Size and Growth", "Key Players", "Technology Trends", "Regulatory Landscape"]`;

    try {
      const response = await this.llmCall(
        [{ role: 'user', content: prompt }],
        {
          model: this.config.queryModel,
          temperature: 0.5,
          responseFormat: { type: 'json_object' },
        }
      );
      const parsed = JSON.parse(response);
      const aspects = Array.isArray(parsed) ? parsed : parsed.aspects ?? parsed.dimensions ?? [];
      return aspects.length > 0 ? aspects.slice(0, 6) : [topic];
    } catch {
      // 降级：直接用主题作为唯一方面
      return [topic];
    }
  }

  private async generateQueries(topic: string, aspects: string[]): Promise<string[]> {
    const maxQ = this.config.maxQueries;
    const language = this.detectLanguage(topic);

    const prompt = `You are a research query strategist. Generate search queries for a deep research task.

Topic: ${topic}
Key Aspects: ${aspects.join(', ')}
Max Queries: ${maxQ}
Primary Language: ${language}

Generate diverse queries using these strategies:
1. BREADTH queries — cover each aspect broadly
2. DEPTH queries — drill into specific sub-topics  
3. DATA queries — find statistics, reports, data sources
4. RECENCY queries — focus on latest developments ("2024", "latest")
5. CROSS-DOMAIN queries — connect different aspects
6. CONTRARIAN queries — alternative viewpoints, criticisms

${language === 'zh' ? 'Generate both Chinese and English queries for better coverage. Aim for ~60% Chinese, ~40% English.' : ''}

Return a JSON object: { "queries": ["query1", "query2", ...] }`;

    try {
      const response = await this.llmCall(
        [{ role: 'user', content: prompt }],
        {
          model: this.config.queryModel,
          temperature: 0.7,
          responseFormat: { type: 'json_object' },
        }
      );
      const parsed = JSON.parse(response);
      const queries: string[] = parsed.queries ?? [];
      return queries.slice(0, maxQ);
    } catch {
      // 降级：基于 aspects 生成简单查询
      return this.fallbackQueryGeneration(topic, aspects, maxQ);
    }
  }

  private fallbackQueryGeneration(topic: string, aspects: string[], max: number): string[] {
    const queries: string[] = [topic];
    for (const aspect of aspects) {
      if (queries.length >= max) break;
      queries.push(`${topic} ${aspect}`);
    }
    // 添加时效性查询
    if (queries.length < max) {
      queries.push(`${topic} 2024 latest`);
    }
    return queries;
  }

  // ============================================================
  // Phase 2: 并发搜索
  // ============================================================

  private async executeSearches(queries: string[]): Promise<SearchResultItem[]> {
    const allResults: SearchResultItem[] = [];
    const batchSize = 3; // 每批 3 个并发搜索

    for (let i = 0; i < queries.length; i += batchSize) {
      this.checkAbort();
      const batch = queries.slice(i, i + batchSize);
      const progress = 0.10 + (i / queries.length) * 0.15;
      this.emitProgress(
        'searching',
        `搜索进度: ${Math.min(i + batchSize, queries.length)}/${queries.length}`,
        progress
      );

      const batchResults = await Promise.allSettled(
        batch.map(q =>
          this.withTimeout(
            this.searchFn(q, { maxResults: 10, timeout: this.config.searchTimeout }),
            this.config.searchTimeout,
            `search: ${q}`
          )
        )
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          allResults.push(...result.value);
        }
        // 搜索失败静默跳过，不阻塞
      }
    }

    return allResults;
  }

  /**
   * URL 去重 + 排序（基于出现频率和搜索分数）
   */
  private deduplicateAndRank(results: SearchResultItem[]): SearchResultItem[] {
    const urlMap = new Map<string, { item: SearchResultItem; count: number; maxScore: number }>();

    for (const item of results) {
      const normalizedUrl = this.normalizeUrl(item.url);
      if (this.visitedUrls.has(normalizedUrl)) continue;

      const existing = urlMap.get(normalizedUrl);
      if (existing) {
        existing.count++;
        existing.maxScore = Math.max(existing.maxScore, item.score ?? 0);
      } else {
        urlMap.set(normalizedUrl, {
          item,
          count: 1,
          maxScore: item.score ?? 0,
        });
      }
    }

    // 排序：出现次数 × 2 + 搜索分数
    const ranked = Array.from(urlMap.values())
      .sort((a, b) => (b.count * 2 + b.maxScore) - (a.count * 2 + a.maxScore));

    return ranked.slice(0, this.config.maxSources).map(r => r.item);
  }

  // ============================================================
  // Phase 3: 页面抓取
  // ============================================================

  private async fetchPages(items: SearchResultItem[]): Promise<void> {
    const concurrency = this.config.fetchConcurrency;
    let completed = 0;

    // 基于信号量的并发控制
    const semaphore = new Semaphore(concurrency);

    const tasks = items.map(async (item) => {
      await semaphore.acquire();
      try {
        this.checkAbort();
        const source = await this.fetchSinglePage(item);
        if (source) {
          this.allSources.push(source);
          this.visitedUrls.add(this.normalizeUrl(item.url));
        }
      } finally {
        semaphore.release();
        completed++;
        if (completed % 3 === 0 || completed === items.length) {
          this.emitProgress(
            'fetching',
            `抓取进度: ${completed}/${items.length}，有效源: ${this.allSources.length}`,
            0.28 + (completed / items.length) * 0.16,
            { sourcesFound: this.allSources.length }
          );
        }
      }
    });

    await Promise.allSettled(tasks);
  }

  private async fetchSinglePage(item: SearchResultItem): Promise<FetchedSource | null> {
    try {
      const result = await this.withTimeout(
        this.fetchFn(item.url, {
          maxLength: this.config.maxContentPerSource,
          timeout: this.config.fetchTimeout,
        }),
        this.config.fetchTimeout,
        `fetch: ${item.url}`
      );

      const content = result.content?.trim();
      if (!content || content.length < 100) return null; // 过滤空页面

      const truncated = content.length >= this.config.maxContentPerSource;
      return {
        id: this.allSources.length + 1,
        url: item.url,
        title: result.title || item.title,
        content: content.slice(0, this.config.maxContentPerSource),
        fetchedAt: new Date(),
        provider: item.provider,
        searchScore: item.score,
        contentLength: content.length,
        truncated,
      };
    } catch {
      return null; // 抓取失败静默跳过
    }
  }

  // ============================================================
  // Phase 4: LLM 综合
  // ============================================================

  private async synthesize(
    topic: string,
    aspects: string[],
    sources: FetchedSource[]
  ): Promise<SynthesisReport> {
    const language = this.detectLanguage(topic);
    const langInstruction = language === 'zh'
      ? '请使用中文撰写综合报告。'
      : 'Write the synthesis report in English.';

    // 构建源文档摘要
    const sourceTexts = sources.map((s, i) =>
      `[Source ${i + 1}] Title: ${s.title}\nURL: ${s.url}\n---\n${s.content}\n`
    ).join('\n\n');

    const systemPrompt = `You are an expert research analyst. Synthesize the provided sources into a comprehensive, well-structured report.

Key requirements:
1. ${langInstruction}
2. Organize by aspects: ${aspects.join(', ')}
3. Use inline citations like [Source 1], [Source 2] for every claim
4. ${this.config.enableCredibility ? 'Assess source credibility (domain authority, content quality)' : 'Skip credibility assessment'}
5. ${this.config.enableContradictions ? 'Identify contradictions between sources with severity levels' : 'Skip contradiction detection'}
6. Identify any coverage gaps — aspects not well-covered by available sources
7. Rate confidence for each section (0.0-1.0)

Return a JSON object with this exact structure:
{
  "title": "Report Title",
  "sections": [
    {
      "heading": "Section Title",
      "content": "Detailed content with [Source N] citations...",
      "citations": ["src_1", "src_3"],
      "confidenceScore": 0.85
    }
  ],
  "contradictions": [
    {
      "claim1": "...", "claim2": "...",
      "source1": "src_1", "source2": "src_3",
      "severity": "moderate",
      "resolution": "..."
    }
  ],
  "coverageGaps": ["Gap description 1", "Gap description 2"],
  "references": [
    { "id": "src_1", "url": "...", "title": "..." }
  ]
}`;

    // 检查是否需要分批综合
    const estimatedTokens = sourceTexts.length / 3; // 粗略估算
    const contextLimit = 100_000; // 保守限制

    let report: SynthesisReport;

    if (estimatedTokens > contextLimit) {
      report = await this.synthesizeIncremental(topic, aspects, sources, systemPrompt, language);
    } else {
      report = await this.synthesizeSinglePass(topic, sourceTexts, systemPrompt);
    }

    return report;
  }

  private async synthesizeSinglePass(
    topic: string,
    sourceTexts: string,
    systemPrompt: string
  ): Promise<SynthesisReport> {
    const response = await this.llmCall(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Research Topic: ${topic}\n\n--- SOURCES ---\n\n${sourceTexts}` },
      ],
      {
        model: this.config.synthesisModel,
        temperature: 0.3,
        responseFormat: { type: 'json_object' },
      }
    );

    return this.parseSynthesisResponse(response);
  }

  private async synthesizeIncremental(
    topic: string,
    aspects: string[],
    sources: FetchedSource[],
    systemPrompt: string,
    language: string
  ): Promise<SynthesisReport> {
    const batchSize = Math.ceil(sources.length / 3);
    const batches: FetchedSource[][] = [];

    for (let i = 0; i < sources.length; i += batchSize) {
      batches.push(sources.slice(i, i + batchSize));
    }

    // 分批综合
    const partialReports: SynthesisReport[] = [];

    for (let bi = 0; bi < batches.length; bi++) {
      this.emitProgress(
        'synthesizing',
        `综合分析: 批次 ${bi + 1}/${batches.length}`,
        0.48 + (bi / batches.length) * 0.15
      );

      const batchSources = batches[bi];
      const sourceTexts = batchSources.map((s, i) =>
        `[Source ${i + 1}] Title: ${s.title}\nURL: ${s.url}\n---\n${s.content}\n`
      ).join('\n\n');

      const partial = await this.synthesizeSinglePass(topic, sourceTexts, systemPrompt);
      partialReports.push(partial);
    }

    // 合并多批结果
    return this.mergePartialReports(topic, aspects, partialReports, language);
  }

  private async mergePartialReports(
    topic: string,
    aspects: string[],
    reports: SynthesisReport[],
    language: string
  ): Promise<SynthesisReport> {
    const langInstruction = language === 'zh'
      ? '请使用中文撰写合并后的报告。'
      : 'Write the merged report in English.';

    const reportsJson = reports.map((r, i) => `--- Partial Report ${i + 1} ---\n${JSON.stringify(r, null, 2)}`).join('\n\n');

    const mergePrompt = `You are merging multiple partial research reports into one comprehensive report.

${langInstruction}

Research Topic: ${topic}
Aspects to Cover: ${aspects.join(', ')}

Merge rules:
1. Combine sections covering the same aspect
2. Deduplicate information while preserving all unique insights
3. Resolve contradictions where possible
4. Aggregate all citations (remap source IDs if needed)
5. Produce a single coherent report

${reportsJson}

Return the merged report as a single JSON object with the same structure (title, sections, contradictions, coverageGaps, references).`;

    const response = await this.llmCall(
      [{ role: 'user', content: mergePrompt }],
      {
        model: this.config.synthesisModel,
        temperature: 0.2,
        responseFormat: { type: 'json_object' },
      }
    );

    return this.parseSynthesisResponse(response);
  }

  private parseSynthesisResponse(response: string): SynthesisReport {
    try {
      const parsed = JSON.parse(response);
      return {
        title: parsed.title || 'Research Report',
        sections: (parsed.sections || []).map((s: any) => ({
          heading: s.heading || '',
          content: s.content || '',
          citations: s.citations || [],
          confidenceScore: typeof s.confidenceScore === 'number' ? s.confidenceScore : 0.5,
        })),
        contradictions: parsed.contradictions || [],
        coverageGaps: parsed.coverageGaps || [],
        references: (parsed.references || []).map((r: any) => ({
          id: r.id || '',
          url: r.url || '',
          title: r.title || '',
          credibilityScore: r.credibilityScore,
        })),
      };
    } catch {
      // JSON 解析失败 —— 尝试从原始文本生成最小报告
      return {
        title: 'Research Report',
        sections: [{
          heading: 'Summary',
          content: response.slice(0, 5000),
          citations: [],
          confidenceScore: 0.3,
        }],
        references: [],
      };
    }
  }

  // ============================================================
  // Phase 5: 迭代精炼
  // ============================================================

  private async refine(
    topic: string,
    aspects: string[],
    initialReport: SynthesisReport
  ): Promise<{ report: SynthesisReport; rounds: number; coverageScore: number }> {
    let currentReport = initialReport;
    let rounds = 0;
    let coverageScore = 0;
    let noImprovementCount = 0;
    let previousCoverage = 0;

    for (let round = 0; round < this.config.maxRefinementRounds; round++) {
      this.checkAbort();
      this.checkTotalTimeout();

      // 评估覆盖率
      const evaluation = await this.evaluateCoverage(topic, aspects, currentReport);
      coverageScore = evaluation.score;

      this.emitProgress(
        'refining',
        `精炼第 ${round + 1} 轮: 覆盖率 ${coverageScore}%`,
        0.65 + (round / this.config.maxRefinementRounds) * 0.25,
        { coverageScore }
      );

      // 检查停止条件
      if (coverageScore >= this.config.coverageThreshold) {
        break; // 覆盖率达标
      }

      if (coverageScore <= previousCoverage + 2) {
        noImprovementCount++;
        if (noImprovementCount >= 2) break; // 连续无改善
      } else {
        noImprovementCount = 0;
      }
      previousCoverage = coverageScore;

      // 生成补充查询
      const gaps = evaluation.gaps;
      if (gaps.length === 0) break;

      const supplementQueries = await this.generateSupplementQueries(topic, gaps);
      if (supplementQueries.length === 0) break;

      // 执行补充搜索 + 抓取
      const newResults = await this.executeSearches(supplementQueries);
      const newUrls = this.deduplicateAndRank(newResults);
      const beforeCount = this.allSources.length;
      await this.fetchPages(newUrls);

      if (this.allSources.length === beforeCount) break; // 没有新源

      // 重新综合
      currentReport = await this.synthesize(topic, aspects, this.allSources);
      rounds++;
    }

    return { report: currentReport, rounds, coverageScore };
  }

  private async evaluateCoverage(
    topic: string,
    aspects: string[],
    report: SynthesisReport
  ): Promise<{ score: number; gaps: string[] }> {
    const prompt = `Evaluate the coverage of this research report.

Topic: ${topic}
Required Aspects: ${aspects.join(', ')}

Report sections:
${report.sections.map(s => `## ${s.heading}\n${s.content.slice(0, 500)}...`).join('\n\n')}

Coverage gaps noted by synthesis: ${(report.coverageGaps || []).join('; ') || 'None'}

Score the overall coverage (0-100) and list specific gaps that need more research.

Return JSON: { "score": 75, "gaps": ["gap description 1", "gap description 2"] }`;

    try {
      const response = await this.llmCall(
        [{ role: 'user', content: prompt }],
        {
          model: this.config.queryModel,
          temperature: 0.3,
          responseFormat: { type: 'json_object' },
        }
      );
      const parsed = JSON.parse(response);
      return {
        score: Math.min(100, Math.max(0, parsed.score ?? 50)),
        gaps: parsed.gaps ?? [],
      };
    } catch {
      return { score: 50, gaps: report.coverageGaps || [] };
    }
  }

  private async quickCoverageEstimate(
    _topic: string,
    aspects: string[],
    report: SynthesisReport
  ): Promise<number> {
    // 快速估算：基于 sections 覆盖的 aspects 比例 + 置信度均值
    const sectionHeadings = report.sections.map(s => s.heading.toLowerCase());
    let coveredAspects = 0;
    for (const aspect of aspects) {
      if (sectionHeadings.some(h => h.includes(aspect.toLowerCase().split(' ')[0]))) {
        coveredAspects++;
      }
    }
    const aspectCoverage = aspects.length > 0 ? (coveredAspects / aspects.length) * 50 : 25;
    const avgConfidence = report.sections.reduce((sum, s) => sum + s.confidenceScore, 0)
      / Math.max(report.sections.length, 1) * 50;

    return Math.round(aspectCoverage + avgConfidence);
  }

  private async generateSupplementQueries(topic: string, gaps: string[]): Promise<string[]> {
    const language = this.detectLanguage(topic);
    const prompt = `Generate targeted search queries to fill these research gaps.

Topic: ${topic}
Gaps: ${gaps.join('; ')}
Language: ${language}

Generate 3-5 specific, focused queries. Return JSON: { "queries": ["q1", "q2", ...] }`;

    try {
      const response = await this.llmCall(
        [{ role: 'user', content: prompt }],
        { model: this.config.queryModel, temperature: 0.6, responseFormat: { type: 'json_object' } }
      );
      const parsed = JSON.parse(response);
      return (parsed.queries ?? []).slice(0, 5);
    } catch {
      return gaps.map(g => `${topic} ${g}`).slice(0, 3);
    }
  }

  // ============================================================
  // Phase 6: 最终格式化
  // ============================================================

  private async formatFinalReport(
    topic: string,
    report: SynthesisReport,
    aspects: string[]
  ): Promise<string> {
    const language = this.detectLanguage(topic);
    const lines: string[] = [];

    // 标题
    lines.push(`# ${report.title || topic}`);
    lines.push('');

    // 执行摘要
    const summaryLabel = language === 'zh' ? '## 概要' : '## Executive Summary';
    lines.push(summaryLabel);
    lines.push('');

    if (report.sections.length > 0) {
      const summaryPrompt = `Write a concise executive summary (3-5 sentences) for this research report.
Topic: ${topic}
Sections: ${report.sections.map(s => s.heading).join(', ')}
${language === 'zh' ? '使用中文撰写' : 'Write in English'}

Return plain text only (no JSON).`;

      try {
        const summary = await this.llmCall(
          [{ role: 'user', content: summaryPrompt }],
          { model: this.config.queryModel, temperature: 0.3 }
        );
        lines.push(summary.trim());
      } catch {
        lines.push(language === 'zh'
          ? `本报告围绕「${topic}」展开深度研究，覆盖 ${aspects.join('、')} 等方面，综合 ${report.references.length} 个信息源进行分析。`
          : `This report provides a deep research analysis on "${topic}", covering ${aspects.join(', ')}, synthesized from ${report.references.length} sources.`
        );
      }
    }
    lines.push('');

    // 正文 sections
    for (const section of report.sections) {
      const confidenceBadge = this.getConfidenceBadge(section.confidenceScore);
      lines.push(`## ${section.heading} ${confidenceBadge}`);
      lines.push('');
      lines.push(section.content);
      lines.push('');
    }

    // 矛盾分析
    if (this.config.enableContradictions && report.contradictions && report.contradictions.length > 0) {
      const label = language === 'zh' ? '## ⚠️ 信息矛盾' : '## ⚠️ Contradictions';
      lines.push(label);
      lines.push('');
      for (const c of report.contradictions) {
        const severityIcon = c.severity === 'major' ? '🔴' : c.severity === 'moderate' ? '🟡' : '🟢';
        lines.push(`${severityIcon} **${c.severity.toUpperCase()}**`);
        lines.push(`- ${language === 'zh' ? '观点1' : 'Claim 1'}: ${c.claim1} (${c.source1})`);
        lines.push(`- ${language === 'zh' ? '观点2' : 'Claim 2'}: ${c.claim2} (${c.source2})`);
        if (c.resolution) {
          lines.push(`- ${language === 'zh' ? '分析' : 'Resolution'}: ${c.resolution}`);
        }
        lines.push('');
      }
    }

    // 覆盖盲区
    if (report.coverageGaps && report.coverageGaps.length > 0) {
      const label = language === 'zh' ? '## 📋 未充分覆盖的领域' : '## 📋 Coverage Gaps';
      lines.push(label);
      lines.push('');
      for (const gap of report.coverageGaps) {
        lines.push(`- ${gap}`);
      }
      lines.push('');
    }

    // 参考文献
    const refLabel = language === 'zh' ? '## 参考来源' : '## References';
    lines.push(refLabel);
    lines.push('');
    for (let i = 0; i < report.references.length; i++) {
      const ref = report.references[i];
      const credibility = ref.credibilityScore != null
        ? ` (${language === 'zh' ? '可信度' : 'credibility'}: ${ref.credibilityScore}/100)`
        : '';
      lines.push(`${i + 1}. [${ref.title || ref.url}](${ref.url})${credibility}`);
    }
    lines.push('');

    // 元数据
    const metaLabel = language === 'zh' ? '---\n*研究参数*' : '---\n*Research Parameters*';
    lines.push(metaLabel);
    const depthLabel = language === 'zh' ? '深度' : 'Depth';
    const sourcesLabel = language === 'zh' ? '信息源' : 'Sources';
    lines.push(`- ${depthLabel}: ${this.config.depth} | ${sourcesLabel}: ${this.allSources.length} | ${language === 'zh' ? '耗时' : 'Duration'}: ${((Date.now() - this.startTime) / 1000).toFixed(1)}s`);

    return lines.join('\n');
  }

  private getConfidenceBadge(score: number): string {
    if (score >= 0.8) return '🟢';
    if (score >= 0.6) return '🟡';
    return '🔴';
  }

  // ============================================================
  // 降级与部分结果
  // ============================================================

  private buildEmptyResult(topic: string): DeepResearchResult {
    const language = this.detectLanguage(topic);
    return {
      report: language === 'zh'
        ? `# ${topic}\n\n未能找到相关信息源。请尝试调整研究主题或扩大搜索范围。`
        : `# ${topic}\n\nNo relevant sources found. Please try adjusting the research topic or expanding the search scope.`,
      sources: [],
      metadata: {
        topic,
        depth: this.config.depth,
        totalQueries: 0,
        totalSourcesFetched: 0,
        totalSourcesUsed: 0,
        refinementRounds: 0,
        finalCoverageScore: 0,
        durationMs: Date.now() - this.startTime,
        phases: this.phaseTimings,
      },
    };
  }

  private async buildPartialResult(
    topic: string,
    aspects: string[],
    error: Error
  ): Promise<DeepResearchResult> {
    const language = this.detectLanguage(topic);

    // 尝试用已有源生成部分报告
    let report: string;
    if (this.allSources.length > 0) {
      try {
        const partialSynthesis = await this.synthesize(topic, aspects, this.allSources);
        report = await this.formatFinalReport(topic, partialSynthesis, aspects);
        const warningPrefix = language === 'zh'
          ? `> ⚠️ **注意**: 本报告因超时而提前终止，结果可能不完整。(${error.message})\n\n`
          : `> ⚠️ **Warning**: This report was terminated early due to timeout. Results may be incomplete. (${error.message})\n\n`;
        report = warningPrefix + report;
      } catch {
        report = language === 'zh'
          ? `# ${topic}\n\n> ⚠️ 研究因超时终止，已收集 ${this.allSources.length} 个源但综合失败。\n\n## 已收集的源\n\n${this.allSources.map((s, i) => `${i + 1}. [${s.title}](${s.url})`).join('\n')}`
          : `# ${topic}\n\n> ⚠️ Research terminated due to timeout. ${this.allSources.length} sources collected but synthesis failed.\n\n## Collected Sources\n\n${this.allSources.map((s, i) => `${i + 1}. [${s.title}](${s.url})`).join('\n')}`;
      }
    } else {
      report = language === 'zh'
        ? `# ${topic}\n\n研究因超时终止，未能收集到有效信息源。`
        : `# ${topic}\n\nResearch terminated due to timeout before any sources could be collected.`;
    }

    return {
      report,
      sources: this.allSources.map(s => ({ url: s.url, title: s.title })),
      metadata: {
        topic,
        depth: this.config.depth,
        totalQueries: 0,
        totalSourcesFetched: this.allSources.length,
        totalSourcesUsed: 0,
        refinementRounds: 0,
        finalCoverageScore: 0,
        durationMs: Date.now() - this.startTime,
        phases: this.phaseTimings,
      },
    };
  }

  // ============================================================
  // 工具方法
  // ============================================================

  private buildSourceReferences(report: SynthesisReport): SourceReference[] {
    return report.references.map(ref => ({
      url: ref.url,
      title: ref.title,
      credibilityScore: ref.credibilityScore,
      usedInSections: report.sections
        .filter(s => s.citations.includes(ref.id))
        .map(s => s.heading),
    }));
  }

  private detectLanguage(text: string): string {
    if (this.config.language !== 'auto') return this.config.language;
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    return chineseChars > text.length * 0.15 ? 'zh' : 'en';
  }

  private normalizeUrl(url: string): string {
    try {
      const u = new URL(url);
      u.hash = '';
      u.searchParams.delete('utm_source');
      u.searchParams.delete('utm_medium');
      u.searchParams.delete('utm_campaign');
      return u.toString().replace(/\/$/, '');
    } catch {
      return url;
    }
  }

  private emitProgress(
    phase: string,
    detail: string,
    progress: number,
    extra?: Partial<{ partialResult: string; sourcesFound: number; coverageScore: number }>
  ): void {
    if (!this.onProgress) return;
    this.onProgress({
      phase,
      detail,
      progress: Math.min(1, Math.max(0, progress)),
      ...extra,
    });
  }

  private async timedPhase<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      const end = Date.now();
      this.phaseTimings.push({
        phase: name,
        startMs: start - this.startTime,
        endMs: end - this.startTime,
        durationMs: end - start,
      });
    }
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new TimeoutError(`Timeout: ${label} (${ms}ms)`)), ms)
      ),
    ]);
  }

  private checkAbort(): void {
    if (this.abortController.signal.aborted) {
      throw new AbortError('Research aborted');
    }
  }

  private checkTotalTimeout(): void {
    if (Date.now() - this.startTime > this.config.totalTimeout) {
      throw new TimeoutError(`Total research timeout exceeded (${this.config.totalTimeout}ms)`);
    }
  }

  private isAbortOrTimeout(error: unknown): boolean {
    return error instanceof TimeoutError || error instanceof AbortError;
  }
}

// ============================================================
// 辅助类
// ============================================================

class Semaphore {
  private permits: number;
  private waiting: Array<{ resolve: () => void; timeout: NodeJS.Timeout }> = [];
  private timeoutMs: number;

  constructor(permits: number, timeoutMs: number = 30000) {
    this.permits = permits;
    this.timeoutMs = timeoutMs;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        // Remove this entry from waiting queue
        const idx = this.waiting.findIndex(w => w.resolve === resolve);
        if (idx !== -1) {
          this.waiting.splice(idx, 1);
        }
        reject(new TimeoutError(`Semaphore acquire timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.waiting.push({ resolve, timeout: timeoutId });
    });
  }

  release(): void {
    if (this.waiting.length > 0) {
      const next = this.waiting.shift()!;
      clearTimeout(next.timeout);
      next.resolve();
    } else {
      this.permits++;
    }
  }
}

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

class AbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AbortError';
  }
}

// ============================================================
// 便捷工厂函数 —— 与 BeeClaw builtin.ts 集成
// ============================================================

/**
 * 创建 Deep Research 工具处理函数
 * 
 * 用于替换 builtin.ts 中的 executeDeepResearch。
 * 
 * @example
 * ```ts
 * // 在 builtin.ts 中替换原有实现
 * import { createDeepResearchHandler } from './research/deep-research-v2';
 * 
 * const handler = createDeepResearchHandler({
 *   searchFn: (query, opts) => searchOrchestrator.search(query, opts),
 *   fetchFn: (url, opts) => webFetcher.fetch(url, opts),
 *   llmCall: (messages, opts) => agent.callLLM(messages, opts),
 * });
 * 
 * // 在工具定义中
 * tools.push({
 *   name: 'deep_research',
 *   description: 'Conduct deep research on a topic',
 *   parameters: { topic: 'string', depth: 'quick|standard|comprehensive', aspects: 'string[]?' },
 *   execute: handler,
 * });
 * ```
 */
export function createDeepResearchHandler(deps: {
  searchFn: SearchFn;
  fetchFn: FetchFn;
  llmCall: LLMCallFn;
}) {
  return async (params: {
    topic: string;
    depth?: ResearchDepth;
    aspects?: string[];
    onProgress?: ProgressCallback;
    abortSignal?: AbortSignal;
  }): Promise<DeepResearchResult> => {
    const pipeline = new DeepResearchV2({
      config: { depth: params.depth ?? 'standard' },
      searchFn: deps.searchFn,
      fetchFn: deps.fetchFn,
      llmCall: deps.llmCall,
      onProgress: params.onProgress,
      abortSignal: params.abortSignal,
    });

    return pipeline.execute(params.topic, params.aspects);
  };
}
