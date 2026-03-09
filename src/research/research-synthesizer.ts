/**
 * research-synthesizer.ts — P0-1: LLM 驱动的研究综合引擎
 *
 * 替代 builtin.ts 中基于关键词匹配的 Phase 5-6，
 * 使用大上下文 LLM 对采集到的多来源内容进行推理级综合。
 *
 * 核心能力：
 *   1. 来源可信度评估 — 域名权威性 + 内容一致性评分
 *   2. 矛盾检测 — 识别来源间的冲突信息并标注
 *   3. 主题聚类 — 自动发现跨来源的共同主题
 *   4. 内联引用 — 生成 [Source N] 格式的学术级引用
 *   5. 置信度标注 — 对每个结论标注证据强度
 *   6. 增量综合 — 支持分批来源注入（适配上下文限制）
 */

// ─── Types ────────────────────────────────────────────────

/** 获取到的来源数据 */
export interface FetchedSource {
  /** 来源唯一 ID (1-based number) */
  id: number;
  url: string;
  title: string;
  /** 提取后的正文内容 */
  content: string;
  /** 内容获取时间 */
  fetchedAt: Date;
  /** 来源提供商 (bocha/tavily/google 等) */
  provider?: string;
  /** 搜索排名得分 */
  searchScore?: number;
  /** 内容长度 */
  contentLength?: number;
  /** 是否被截断 */
  truncated?: boolean;
}

/** 可信度评估结果 */
export interface CredibilityAssessment {
  sourceId: number;
  /** 0-100 可信度分数 */
  score: number;
  /** 评分因素 */
  factors: {
    domainAuthority: number;     // 域名权威性 0-30
    contentQuality: number;      // 内容质量 0-30
    recency: number;             // 时效性 0-20
    crossCorroboration: number;  // 交叉印证 0-20
  };
  /** 人类可读的评估说明 */
  rationale: string;
}

/** 矛盾信息 */
export interface Contradiction {
  /** 矛盾描述 */
  description: string;
  /** 涉及的来源 ID 列表 */
  sourceIds: number[];
  /** 矛盾严重程度 */
  severity: 'minor' | 'moderate' | 'major';
  /** 建议的解读 */
  resolution?: string;
}

/** 综合报告结构 */
export interface SynthesisReport {
  /** 报告标题 */
  title: string;
  /** 执行摘要 (150-300 字) */
  executiveSummary: string;
  /** 按主题/方面组织的正文章节 */
  sections: ReportSection[];
  /** 矛盾与争议 */
  contradictions: Contradiction[];
  /** 来源可信度评估 */
  credibilityAssessments: CredibilityAssessment[];
  /** 研究覆盖度评估 */
  coverageGaps: string[];
  /** 参考来源列表 */
  references: ReferenceEntry[];
  /** 综合用时 (ms) */
  synthesisTimeMs: number;
}

/** 报告章节 */
export interface ReportSection {
  heading: string;
  content: string;
  /** 本节引用的来源 ID 列表 */
  citedSources: number[];
  /** 本节关键结论的置信度 */
  confidence: 'high' | 'medium' | 'low';
}

/** 参考文献条目 */
export interface ReferenceEntry {
  id: number;
  url: string;
  title: string;
  credibilityScore: number;
  accessedAt: string;
}

/** 综合引擎配置 */
export interface SynthesizerConfig {
  /** 用于综合的模型名称 (需 128K+ 上下文) */
  synthesisModel: string;
  /** 综合 temperature (低温度保证忠实性) */
  temperature: number;
  /** 单批最大来源数 (受模型上下文限制) */
  maxSourcesPerBatch: number;
  /** 单源最大 token 数 */
  maxTokensPerSource: number;
  /** 是否启用可信度评估 */
  enableCredibility: boolean;
  /** 是否启用矛盾检测 */
  enableContradictions: boolean;
  /** 报告语言 */
  language: 'zh' | 'en' | 'auto';
}

/** AI 调用接口 (与 BeeClaw 的 callAI 对齐) */
export interface AICallFn {
  (params: {
    model?: string;
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    response_format?: { type: string };
  }): Promise<{ content: string }>;
}

// ─── Constants ────────────────────────────────────────────

export const DEFAULT_SYNTHESIZER_CONFIG: Readonly<SynthesizerConfig> = {
  synthesisModel: 'gpt-4o',
  temperature: 0.3,
  maxSourcesPerBatch: 20,
  maxTokensPerSource: 8000,
  enableCredibility: true,
  enableContradictions: true,
  language: 'auto',
};

/** 域名权威性基准分 (0-30) */
const DOMAIN_AUTHORITY: Record<string, number> = {
  // 学术/权威
  'arxiv.org': 28, 'scholar.google.com': 28, 'nature.com': 29, 'science.org': 29,
  'ieee.org': 27, 'acm.org': 27, 'ncbi.nlm.nih.gov': 28, 'pubmed.ncbi.nlm.nih.gov': 28,
  // 官方
  'gov.cn': 25, '.gov': 26, '.edu': 24, '.edu.cn': 24, '.ac.cn': 25,
  // 高质量媒体
  'reuters.com': 24, 'bloomberg.com': 23, 'nytimes.com': 22,
  'bbc.com': 22, 'bbc.co.uk': 22, 'economist.com': 23,
  // 技术
  'github.com': 20, 'stackoverflow.com': 19, 'docs.python.org': 22,
  'developer.mozilla.org': 23, 'kubernetes.io': 21,
  // 中文权威
  'people.com.cn': 23, 'xinhuanet.com': 23, 'cas.cn': 25,
  'pku.edu.cn': 24, 'tsinghua.edu.cn': 24,
  // 百科
  'wikipedia.org': 18, 'baike.baidu.com': 15,
  // 社区/博客 (基线较低)
  'medium.com': 12, 'zhihu.com': 14, 'csdn.net': 11,
  'juejin.cn': 11, 'blog.': 10,
};

// ─── Core Synthesizer Class ──────────────────────────────

export class ResearchSynthesizer {
  private config: SynthesizerConfig;
  private callAI: AICallFn;

  constructor(callAI: AICallFn, config?: Partial<SynthesizerConfig>) {
    this.callAI = callAI;
    this.config = { ...DEFAULT_SYNTHESIZER_CONFIG, ...config };
  }

  // ── Public API ──

  /**
   * 综合多来源内容为结构化研究报告。
   *
   * @param topic   研究主题
   * @param aspects 研究方面/角度
   * @param sources 获取到的来源数据
   * @returns       结构化综合报告
   */
  async synthesize(
    topic: string,
    aspects: string[],
    sources: FetchedSource[],
  ): Promise<SynthesisReport> {
    const startTime = Date.now();

    // Step 1: 可信度评估 (可选)
    let credibilityAssessments: CredibilityAssessment[] = [];
    if (this.config.enableCredibility) {
      credibilityAssessments = this.assessCredibility(sources);
    }

    // Step 2: 按可信度排序来源 (高可信度优先)
    const sortedSources = this.rankSourcesByCredibility(sources, credibilityAssessments);

    // Step 3: 分批综合 (如来源超过单批上限)
    let report: SynthesisReport;
    if (sortedSources.length <= this.config.maxSourcesPerBatch) {
      report = await this.synthesizeBatch(topic, aspects, sortedSources);
    } else {
      report = await this.synthesizeIncremental(topic, aspects, sortedSources);
    }

    // Step 4: 填充元数据
    report.credibilityAssessments = credibilityAssessments;
    report.references = this.buildReferences(sources, credibilityAssessments);
    report.synthesisTimeMs = Date.now() - startTime;

    return report;
  }

  /**
   * 将结构化报告渲染为 Markdown 字符串。
   */
  renderMarkdown(report: SynthesisReport): string {
    const lines: string[] = [];
    const lang = this.config.language;
    const isZh = lang === 'zh' || (lang === 'auto' && this.detectLanguage(report.title) === 'zh');

    // 标题
    lines.push(`# ${report.title}`);
    lines.push('');

    // 摘要
    lines.push(`## ${isZh ? '执行摘要' : 'Executive Summary'}`);
    lines.push('');
    lines.push(report.executiveSummary);
    lines.push('');

    // 正文章节
    for (const section of report.sections) {
      const confidenceBadge = this.getConfidenceBadge(section.confidence, isZh);
      lines.push(`## ${section.heading} ${confidenceBadge}`);
      lines.push('');
      lines.push(section.content);
      lines.push('');
    }

    // 矛盾与争议
    if (report.contradictions.length > 0) {
      lines.push(`## ${isZh ? '⚠️ 矛盾与争议' : '⚠️ Contradictions & Controversies'}`);
      lines.push('');
      for (const c of report.contradictions) {
        const severityLabel = isZh
          ? { minor: '轻微', moderate: '中等', major: '重大' }[c.severity]
          : c.severity;
        lines.push(`### [${severityLabel}] ${c.description}`);
        lines.push('');
        lines.push(`${isZh ? '涉及来源' : 'Sources'}: ${c.sourceIds.map(id => `[${id}]`).join(', ')}`);
        if (c.resolution) {
          lines.push('');
          lines.push(`> ${isZh ? '分析' : 'Analysis'}: ${c.resolution}`);
        }
        lines.push('');
      }
    }

    // 覆盖度缺口
    if (report.coverageGaps.length > 0) {
      lines.push(`## ${isZh ? '📋 待深入研究' : '📋 Further Research Needed'}`);
      lines.push('');
      for (const gap of report.coverageGaps) {
        lines.push(`- ${gap}`);
      }
      lines.push('');
    }

    // 参考来源
    lines.push(`## ${isZh ? '参考来源' : 'References'}`);
    lines.push('');
    for (const ref of report.references) {
      const credBadge = ref.credibilityScore >= 70 ? '🟢' : ref.credibilityScore >= 40 ? '🟡' : '🔴';
      lines.push(`${credBadge} **[${ref.id}]** [${ref.title}](${ref.url}) — ${isZh ? '可信度' : 'Credibility'}: ${ref.credibilityScore}/100`);
    }
    lines.push('');

    // 元信息
    lines.push('---');
    lines.push(`*${isZh ? '综合引擎耗时' : 'Synthesis time'}: ${(report.synthesisTimeMs / 1000).toFixed(1)}s | ${isZh ? '来源数量' : 'Sources'}: ${report.references.length} | ${isZh ? '生成时间' : 'Generated'}: ${new Date().toISOString()}*`);

    return lines.join('\n');
  }

  // ── Private: Credibility ──

  private assessCredibility(sources: FetchedSource[]): CredibilityAssessment[] {
    return sources.map(source => {
      const domainAuthority = this.getDomainAuthority(source.url);
      const contentQuality = this.estimateContentQuality(source.content);
      const recency = this.estimateRecency(source);
      // 交叉印证暂时基于搜索分数 (后续可用 LLM 评估)
      const crossCorroboration = Math.min(20, Math.round((source.searchScore ?? 0.5) * 20));

      const score = domainAuthority + contentQuality + recency + crossCorroboration;

      return {
        sourceId: source.id,
        score: Math.min(100, score),
        factors: { domainAuthority, contentQuality, recency, crossCorroboration },
        rationale: this.buildCredibilityRationale(source, { domainAuthority, contentQuality, recency, crossCorroboration }),
      };
    });
  }

  private getDomainAuthority(url: string): number {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      // 精确匹配
      for (const [domain, score] of Object.entries(DOMAIN_AUTHORITY)) {
        if (hostname === domain || hostname.endsWith(`.${domain}`) || hostname.endsWith(domain)) {
          return score;
        }
      }
      // TLD 匹配
      if (hostname.endsWith('.gov') || hostname.endsWith('.gov.cn')) return 25;
      if (hostname.endsWith('.edu') || hostname.endsWith('.edu.cn')) return 22;
      if (hostname.endsWith('.org')) return 16;
      // 默认
      return 10;
    } catch {
      return 5;
    }
  }

  private estimateContentQuality(content: string): number {
    let score = 10; // 基线

    // 内容长度 (长内容通常更深入)
    if (content.length > 5000) score += 5;
    else if (content.length > 2000) score += 3;
    else if (content.length < 500) score -= 3;

    // 结构化标记 (有标题、列表等)
    if (/#{1,6}\s/.test(content)) score += 3;
    if (/\d+\.\s/.test(content)) score += 2;
    if (/\|.*\|.*\|/.test(content)) score += 2; // 表格

    // 数据/引用标记
    if (/\d+%|\d+\.\d+/.test(content)) score += 3; // 含数据
    if (/\[\d+\]|\[.*?\]\(.*?\)/.test(content)) score += 3; // 含引用

    // 专业术语密度 (粗略估计)
    const wordCount = content.split(/\s+/).length;
    const longWordCount = content.split(/\s+/).filter(w => w.length > 8).length;
    if (wordCount > 0 && longWordCount / wordCount > 0.1) score += 2;

    return Math.min(30, Math.max(0, score));
  }

  private estimateRecency(source: FetchedSource): number {
    // 从内容中提取年份
    const currentYear = new Date().getFullYear();
    const yearMatches = source.content.match(/20[12]\d/g);
    if (yearMatches && yearMatches.length > 0) {
      const years = yearMatches.map(Number);
      const maxYear = Math.max(...years);
      const age = currentYear - maxYear;
      if (age === 0) return 20;
      if (age === 1) return 16;
      if (age <= 3) return 12;
      if (age <= 5) return 8;
      return 4;
    }
    return 10; // 无法判断时给中间分
  }

  private buildCredibilityRationale(
    source: FetchedSource,
    factors: { domainAuthority: number; contentQuality: number; recency: number; crossCorroboration: number },
  ): string {
    const parts: string[] = [];
    if (factors.domainAuthority >= 22) parts.push('权威域名');
    else if (factors.domainAuthority <= 12) parts.push('低权威来源');
    if (factors.contentQuality >= 20) parts.push('高质量内容');
    if (factors.recency >= 16) parts.push('时效性强');
    else if (factors.recency <= 6) parts.push('内容较陈旧');
    return parts.join('、') || '一般来源';
  }

  private rankSourcesByCredibility(
    sources: FetchedSource[],
    assessments: CredibilityAssessment[],
  ): FetchedSource[] {
    const scoreMap = new Map(assessments.map(a => [a.sourceId, a.score]));
    return [...sources].sort((a, b) => (scoreMap.get(b.id) ?? 50) - (scoreMap.get(a.id) ?? 50));
  }

  // ── Private: Synthesis ──

  /**
   * 单批综合 — 所有来源一次投喂 LLM。
   */
  private async synthesizeBatch(
    topic: string,
    aspects: string[],
    sources: FetchedSource[],
  ): Promise<SynthesisReport> {
    const sourceContext = this.buildSourceContext(sources);
    const lang = this.config.language;
    const isZh = lang === 'zh' || (lang === 'auto' && this.detectLanguage(topic) === 'zh');

    const systemPrompt = isZh
      ? this.buildChineseSynthesisPrompt(topic, aspects, sources.length)
      : this.buildEnglishSynthesisPrompt(topic, aspects, sources.length);

    const response = await this.callAI({
      model: this.config.synthesisModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: sourceContext },
      ],
      temperature: this.config.temperature,
      response_format: { type: 'json_object' },
    });

    return this.parseReport(response.content, topic, sources);
  }

  /**
   * 增量综合 — 分批注入来源，逐步构建报告。
   * 适用于来源数量超过单批上限的场景。
   */
  private async synthesizeIncremental(
    topic: string,
    aspects: string[],
    sources: FetchedSource[],
  ): Promise<SynthesisReport> {
    const batchSize = this.config.maxSourcesPerBatch;
    const batches: FetchedSource[][] = [];
    for (let i = 0; i < sources.length; i += batchSize) {
      batches.push(sources.slice(i, i + batchSize));
    }

    // 第一批: 初始综合
    let report = await this.synthesizeBatch(topic, aspects, batches[0]);

    // 后续批: 增量融合
    for (let i = 1; i < batches.length; i++) {
      const prevSummary = this.renderMarkdown(report);
      const newSourceContext = this.buildSourceContext(batches[i]);
      const isZh = this.config.language === 'zh' || (this.config.language === 'auto' && this.detectLanguage(topic) === 'zh');

      const mergePrompt = isZh
        ? `你是一位研究分析师。以下是已有的研究报告和新发现的来源。请将新来源的信息融入已有报告中：
1. 保留已有报告的结构和结论
2. 补充新来源带来的新信息
3. 标注任何与已有结论矛盾的发现
4. 更新引用列表

已有报告：
${prevSummary}

新来源：
${newSourceContext}

以 JSON 格式返回更新后的报告。`
        : `You are a research analyst. Below is an existing report and newly discovered sources. Merge the new findings into the existing report:
1. Preserve existing structure and conclusions
2. Add new information from new sources
3. Flag contradictions with existing conclusions
4. Update reference list

Existing report:
${prevSummary}

New sources:
${newSourceContext}

Return the updated report in JSON format.`;

      const response = await this.callAI({
        model: this.config.synthesisModel,
        messages: [{ role: 'user', content: mergePrompt }],
        temperature: this.config.temperature,
        response_format: { type: 'json_object' },
      });

      report = this.parseReport(response.content, topic, sources);
    }

    return report;
  }

  // ── Private: Prompt Building ──

  private buildChineseSynthesisPrompt(topic: string, aspects: string[], sourceCount: number): string {
    const aspectList = aspects.length > 0
      ? `\n重点研究方面：${aspects.map((a, i) => `\n${i + 1}. ${a}`).join('')}`
      : '';

    return `你是一位资深研究分析师，擅长多来源信息综合与学术级报告撰写。

## 任务
基于用户提供的 ${sourceCount} 个来源，撰写关于「${topic}」的深度研究报告。${aspectList}

## 输出要求 (JSON 格式)
{
  "title": "报告标题",
  "executiveSummary": "150-300字的执行摘要，概述关键发现",
  "sections": [
    {
      "heading": "章节标题",
      "content": "详细内容，必须包含 [Source N] 格式的内联引用",
      "citedSources": [1, 3, 5],
      "confidence": "high|medium|low"
    }
  ],
  "contradictions": [
    {
      "description": "矛盾描述",
      "sourceIds": [2, 4],
      "severity": "minor|moderate|major",
      "resolution": "分析与建议解读"
    }
  ],
  "coverageGaps": ["未覆盖的重要方面1", "待深入研究的问题2"]
}

## 综合原则
1. **忠实引用**: 每个关键事实都必须标注来源 [Source N]，不得编造信息
2. **矛盾识别**: 当来源间存在冲突时，必须在 contradictions 中列出并分析
3. **置信度评估**: 
   - high: 多个可信来源一致支持
   - medium: 部分来源支持或来源可信度一般
   - low: 仅单一来源或来源可信度低
4. **覆盖度评估**: 在 coverageGaps 中列出研究未充分覆盖的方面
5. **结构化分析**: 不要简单罗列来源内容，要做交叉比较和逻辑推理
6. **客观中立**: 对争议性话题呈现多方观点

## 内容质量
- 每个章节至少 200 字深度分析
- 摘要需要概括全部关键发现，而非仅覆盖部分
- 避免重复内容，各章节应有独立的分析角度`;
  }

  private buildEnglishSynthesisPrompt(topic: string, aspects: string[], sourceCount: number): string {
    const aspectList = aspects.length > 0
      ? `\nFocus aspects:\n${aspects.map((a, i) => `${i + 1}. ${a}`).join('\n')}`
      : '';

    return `You are a senior research analyst specialized in multi-source synthesis and academic-grade reporting.

## Task
Synthesize ${sourceCount} sources into a comprehensive research report on "${topic}".${aspectList}

## Output Format (JSON)
{
  "title": "Report Title",
  "executiveSummary": "150-300 word executive summary of key findings",
  "sections": [
    {
      "heading": "Section Title",
      "content": "Detailed content with inline citations [Source N]",
      "citedSources": [1, 3, 5],
      "confidence": "high|medium|low"
    }
  ],
  "contradictions": [
    {
      "description": "Description of contradiction",
      "sourceIds": [2, 4],
      "severity": "minor|moderate|major",
      "resolution": "Analysis and suggested interpretation"
    }
  ],
  "coverageGaps": ["Uncovered aspect 1", "Question needing further research 2"]
}

## Synthesis Principles
1. **Faithful citation**: Every key fact MUST cite [Source N]. Never fabricate.
2. **Contradiction detection**: List and analyze conflicting information.
3. **Confidence assessment**: high (multiple credible sources agree), medium (partial support), low (single/low-credibility source).
4. **Coverage assessment**: Identify gaps in coverageGaps.
5. **Analytical synthesis**: Cross-compare sources, don't just list them.
6. **Objectivity**: Present multiple viewpoints on controversial topics.

## Quality
- Each section: minimum 200 words of deep analysis.
- Summary covers ALL key findings.
- No duplication across sections.`;
  }

  private buildSourceContext(sources: FetchedSource[]): string {
    const maxChars = this.config.maxTokensPerSource * 4; // 粗略 token→char

    return sources.map(s => {
      const truncated = s.content.length > maxChars
        ? s.content.substring(0, maxChars) + '\n[... content truncated ...]'
        : s.content;

      return `═══ [Source ${s.id}] ═══
Title: ${s.title}
URL: ${s.url}
${s.provider ? `Provider: ${s.provider}` : ''}
───
${truncated}`;
    }).join('\n\n');
  }

  // ── Private: Report Parsing ──

  private parseReport(
    jsonContent: string,
    topic: string,
    sources: FetchedSource[],
  ): SynthesisReport {
    try {
      // 提取 JSON (处理可能的 markdown code block 包裹)
      let cleaned = jsonContent.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      const parsed = JSON.parse(cleaned);

      return {
        title: parsed.title || topic,
        executiveSummary: parsed.executiveSummary || '',
        sections: (parsed.sections || []).map((s: Record<string, unknown>) => ({
          heading: String(s.heading || ''),
          content: String(s.content || ''),
          citedSources: Array.isArray(s.citedSources) ? s.citedSources : [],
          confidence: (['high', 'medium', 'low'].includes(String(s.confidence)) ? s.confidence : 'medium') as 'high' | 'medium' | 'low',
        })),
        contradictions: (parsed.contradictions || []).map((c: Record<string, unknown>) => ({
          description: String(c.description || ''),
          sourceIds: Array.isArray(c.sourceIds) ? c.sourceIds : [],
          severity: (['minor', 'moderate', 'major'].includes(String(c.severity)) ? c.severity : 'moderate') as 'minor' | 'moderate' | 'major',
          resolution: c.resolution ? String(c.resolution) : undefined,
        })),
        credibilityAssessments: [],
        coverageGaps: Array.isArray(parsed.coverageGaps) ? parsed.coverageGaps.map(String) : [],
        references: [],
        synthesisTimeMs: 0,
      };
    } catch (error) {
      // 降级: 将原始内容作为单章节报告
      return {
        title: topic,
        executiveSummary: 'LLM 输出解析失败，以下为原始综合内容。',
        sections: [{
          heading: '综合分析',
          content: jsonContent,
          citedSources: sources.map(s => s.id),
          confidence: 'low',
        }],
        contradictions: [],
        credibilityAssessments: [],
        coverageGaps: ['LLM 输出格式异常，覆盖度评估不可用'],
        references: [],
        synthesisTimeMs: 0,
      };
    }
  }

  private buildReferences(
    sources: FetchedSource[],
    assessments: CredibilityAssessment[],
  ): ReferenceEntry[] {
    const scoreMap = new Map(assessments.map(a => [a.sourceId, a.score]));
    return sources.map(s => ({
      id: s.id,
      url: s.url,
      title: s.title,
      credibilityScore: scoreMap.get(s.id) ?? 50,
      accessedAt: s.fetchedAt.toISOString(),
    }));
  }

  // ── Private: Utilities ──

  private detectLanguage(text: string): 'zh' | 'en' {
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    return chineseChars / text.length > 0.3 ? 'zh' : 'en';
  }

  private getConfidenceBadge(confidence: string, isZh: boolean): string {
    switch (confidence) {
      case 'high': return isZh ? '`🟢 高置信`' : '`🟢 High Confidence`';
      case 'medium': return isZh ? '`🟡 中置信`' : '`🟡 Medium Confidence`';
      case 'low': return isZh ? '`🔴 低置信`' : '`🔴 Low Confidence`';
      default: return '';
    }
  }
}
