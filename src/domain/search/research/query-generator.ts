/**
 * query-generator.ts — P1-3: LLM 驱动的查询生成器
 *
 * 替代 builtin.ts 中基于模板的查询生成 (Phase 1)，
 * 使用 LLM 生成多样化、高质量的搜索查询。
 *
 * 查询策略：
 *   1. 广度查询 — 概述类，覆盖主题全貌
 *   2. 深度查询 — 针对每个 aspect 的细化查询
 *   3. 交叉查询 — 不同 aspects 之间的关联
 *   4. 反面查询 — 挑战性/反对观点的查询
 *   5. 数据查询 — 定量信息 (统计、排名、趋势)
 *   6. 时效查询 — 最新进展和动态
 *   7. 补充查询 — 基于已有发现的缺口填补 (精炼轮次用)
 */

import type { AICallFn } from './research-synthesizer';

// ─── Types ────────────────────────────────────────────────

/** 生成的查询及其元数据 */
export interface GeneratedQuery {
  /** 搜索查询文本 */
  query: string;
  /** 查询策略类型 */
  strategy: 'breadth' | 'depth' | 'cross' | 'contrarian' | 'data' | 'recency' | 'supplement';
  /** 目标 aspect (如适用) */
  targetAspect?: string;
  /** 期望的来源类型 */
  expectedSourceType?: 'academic' | 'news' | 'official' | 'community' | 'any';
  /** 查询语言 */
  language: 'zh' | 'en';
}

/** 查询生成配置 */
export interface QueryGeneratorConfig {
  /** LLM 模型 */
  model: string;
  /** temperature (高值增加多样性) */
  temperature: number;
  /** 是否生成双语查询 */
  bilingual: boolean;
  /** 自动检测话题语言 */
  autoDetectLanguage: boolean;
}

// ─── Constants ────────────────────────────────────────────

export const DEFAULT_QUERY_GENERATOR_CONFIG: Readonly<QueryGeneratorConfig> = {
  model: 'gpt-4o-mini',
  temperature: 0.7,
  bilingual: true,
  autoDetectLanguage: true,
};

/** 深度 → 各策略查询数配置 */
const QUERY_ALLOCATION: Record<string, Record<string, number>> = {
  quick: {
    breadth: 2, depth: 2, cross: 0, contrarian: 0, data: 1, recency: 0,
  },
  standard: {
    breadth: 2, depth: 4, cross: 1, contrarian: 1, data: 2, recency: 2,
  },
  comprehensive: {
    breadth: 3, depth: 8, cross: 2, contrarian: 2, data: 3, recency: 3,
  },
};

// ─── Core Generator Class ────────────────────────────────

export class QueryGenerator {
  private config: QueryGeneratorConfig;
  private callAI: AICallFn;

  constructor(callAI: AICallFn, config?: Partial<QueryGeneratorConfig>) {
    this.callAI = callAI;
    this.config = { ...DEFAULT_QUERY_GENERATOR_CONFIG, ...config };
  }

  // ── Public API ──

  /**
   * 为研究主题生成多样化搜索查询。
   *
   * @param topic    研究主题
   * @param aspects  研究方面
   * @param depth    研究深度
   * @param maxQueries 最大查询数 (优先保证策略多样性)
   * @returns        带元数据的查询列表
   */
  async generateInitialQueries(
    topic: string,
    aspects: string[],
    depth: 'quick' | 'standard' | 'comprehensive' = 'standard',
    maxQueries?: number,
  ): Promise<GeneratedQuery[]> {
    const allocation = QUERY_ALLOCATION[depth] || QUERY_ALLOCATION.standard;
    const totalTarget = maxQueries ?? Object.values(allocation).reduce((s, n) => s + n, 0);
    const topicLang = this.detectLanguage(topic);

    const prompt = this.buildInitialQueryPrompt(topic, aspects, allocation, topicLang);

    const response = await this.callAI({
      model: this.config.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: this.config.temperature,
      response_format: { type: 'json_object' },
    });

    const queries = this.parseQueryResponse(response.content, topicLang);

    // 如果启用双语且主语言是中文，追加英文查询
    if (this.config.bilingual && topicLang === 'zh') {
      const enQueries = await this.generateTranslatedQueries(topic, aspects, Math.ceil(totalTarget * 0.3));
      queries.push(...enQueries);
    }

    // 去重并截断到 maxQueries
    return this.deduplicateQueries(queries).slice(0, totalTarget);
  }

  /**
   * 基于精炼评估生成补充查询 (用于迭代精炼轮次)。
   *
   * @param topic      研究主题
   * @param aspects    研究方面
   * @param gaps       覆盖度缺口/建议方向
   * @param maxQueries 最大查询数
   */
  async generateFollowUpQueries(
    topic: string,
    aspects: string[],
    gaps: string[],
    maxQueries: number = 5,
  ): Promise<string[]> {
    if (gaps.length === 0) return [];

    const topicLang = this.detectLanguage(topic);
    const isZh = topicLang === 'zh';

    const prompt = isZh
      ? `你是搜索查询专家。基于以下研究缺口，生成 ${maxQueries} 条针对性的补充搜索查询。

主题: ${topic}
研究方面: ${aspects.join('、')}

已识别的覆盖缺口:
${gaps.map((g, i) => `${i + 1}. ${g}`).join('\n')}

要求:
1. 查询要精准针对缺口，不要重复已有方向
2. 包含具体关键词，避免过于宽泛
3. 尝试从学术、新闻、官方等不同角度补充

返回 JSON: {"queries": ["查询1", "查询2", ...]}`
      : `You are a search query expert. Generate ${maxQueries} targeted follow-up queries based on these research gaps.

Topic: ${topic}
Aspects: ${aspects.join(', ')}

Coverage gaps:
${gaps.map((g, i) => `${i + 1}. ${g}`).join('\n')}

Requirements:
1. Queries must precisely target gaps
2. Include specific keywords, avoid overly broad queries
3. Try different angles (academic, news, official)

Return JSON: {"queries": ["query1", "query2", ...]}`;

    const response = await this.callAI({
      model: this.config.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: this.config.temperature,
      response_format: { type: 'json_object' },
    });

    try {
      let cleaned = response.content.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      const parsed = JSON.parse(cleaned);
      return (Array.isArray(parsed.queries) ? parsed.queries : [])
        .map(String)
        .filter((q: string) => q.length > 2)
        .slice(0, maxQueries);
    } catch {
      return [];
    }
  }

  // ── Private ──

  private buildInitialQueryPrompt(
    topic: string,
    aspects: string[],
    allocation: Record<string, number>,
    language: 'zh' | 'en',
  ): string {
    const isZh = language === 'zh';
    const aspectStr = aspects.length > 0 ? aspects.join(isZh ? '、' : ', ') : (isZh ? '(自动识别)' : '(auto-detect)');

    if (isZh) {
      return `你是一位专业的搜索查询生成专家。请为以下研究主题生成多样化的搜索查询。

## 研究主题
${topic}

## 研究方面
${aspectStr}

## 查询策略分配
- breadth (广度/概述): ${allocation.breadth} 条 — 覆盖主题全貌的宽泛查询
- depth (深度/专项): ${allocation.depth} 条 — 针对每个方面的细化查询
- cross (交叉/关联): ${allocation.cross} 条 — 不同方面之间的关联查询
- contrarian (反面/挑战): ${allocation.contrarian} 条 — 反对观点、风险、争议
- data (数据/定量): ${allocation.data} 条 — 统计数据、排名、趋势
- recency (时效/最新): ${allocation.recency} 条 — 最新进展、近期变化

## 输出 JSON 格式
{
  "queries": [
    {
      "query": "搜索查询文本",
      "strategy": "breadth|depth|cross|contrarian|data|recency",
      "targetAspect": "目标方面(如适用)",
      "expectedSourceType": "academic|news|official|community|any"
    }
  ]
}

## 查询质量要求
1. 避免重复或过度相似的查询
2. 深度查询应包含具体术语，而非只是重复主题
3. 数据查询使用"数据"、"统计"、"排名"、"对比"等关键词
4. 时效查询使用"2025"、"最新"、"近期"等时间限定
5. 反面查询包含"风险"、"缺点"、"争议"、"质疑"等词
6. 每条查询 5-20 个字为宜`;
    }

    return `You are a professional search query generation expert. Generate diverse queries for the following research topic.

## Topic
${topic}

## Aspects
${aspectStr}

## Query Strategy Allocation
- breadth: ${allocation.breadth} — broad overview queries
- depth: ${allocation.depth} — detailed per-aspect queries
- cross: ${allocation.cross} — cross-aspect relationship queries
- contrarian: ${allocation.contrarian} — opposing views, risks, controversies
- data: ${allocation.data} — statistics, rankings, trends
- recency: ${allocation.recency} — latest developments

## Output JSON
{
  "queries": [
    {
      "query": "search query text",
      "strategy": "breadth|depth|cross|contrarian|data|recency",
      "targetAspect": "target aspect if applicable",
      "expectedSourceType": "academic|news|official|community|any"
    }
  ]
}

## Quality Requirements
1. No duplicate or overly similar queries
2. Depth queries use specific terminology
3. Data queries include "statistics", "ranking", "comparison"
4. Recency queries include year or "latest"
5. Contrarian queries include "risk", "limitation", "controversy"
6. 5-15 words per query`;
  }

  private async generateTranslatedQueries(
    topic: string,
    aspects: string[],
    count: number,
  ): Promise<GeneratedQuery[]> {
    const prompt = `将以下中文研究主题翻译为 ${count} 条英文搜索查询，保持语义但适配英文搜索习惯。

主题: ${topic}
方面: ${aspects.join('、')}

返回 JSON: {"queries": ["english query 1", "english query 2", ...]}`;

    try {
      const response = await this.callAI({
        model: this.config.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: this.config.temperature,
        response_format: { type: 'json_object' },
      });

      let cleaned = response.content.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      const parsed = JSON.parse(cleaned);
      return (Array.isArray(parsed.queries) ? parsed.queries : [])
        .map((q: string) => ({
          query: String(q),
          strategy: 'breadth' as const,
          language: 'en' as const,
        }));
    } catch {
      return [];
    }
  }

  private parseQueryResponse(content: string, defaultLang: 'zh' | 'en'): GeneratedQuery[] {
    try {
      let cleaned = content.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      const parsed = JSON.parse(cleaned);

      if (!Array.isArray(parsed.queries)) return [];

      return parsed.queries.map((q: Record<string, unknown>) => ({
        query: String(q.query || ''),
        strategy: (typeof q.strategy === 'string' &&
          ['breadth', 'depth', 'cross', 'contrarian', 'data', 'recency'].includes(q.strategy))
          ? q.strategy as GeneratedQuery['strategy']
          : 'breadth',
        targetAspect: q.targetAspect ? String(q.targetAspect) : undefined,
        expectedSourceType: q.expectedSourceType ? String(q.expectedSourceType) as GeneratedQuery['expectedSourceType'] : 'any',
        language: defaultLang,
      })).filter((q: GeneratedQuery) => q.query.length > 2);
    } catch {
      return [];
    }
  }

  private deduplicateQueries(queries: GeneratedQuery[]): GeneratedQuery[] {
    const seen = new Set<string>();
    return queries.filter(q => {
      const normalized = q.query.toLowerCase().trim();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  }

  private detectLanguage(text: string): 'zh' | 'en' {
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    return chineseChars / Math.max(text.length, 1) > 0.3 ? 'zh' : 'en';
  }
}
