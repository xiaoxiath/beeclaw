/**
 * Configurable Hybrid Search  (P2-#8)
 *
 * 原始实现问题：
 *  - 混合搜索权重固定硬编码（keyword vs vector 比例不可调）
 *  - 不同查询场景（事实查询 vs 模糊回忆）最优权重完全不同
 *  - 缺少搜索结果的排序融合策略
 *
 * 优化方案：
 *  1. 可配置的搜索权重 profile（预设 + 自定义）
 *  2. 查询意图自动检测（自动选择最佳 profile）
 *  3. Reciprocal Rank Fusion (RRF) 排序融合
 *  4. 搜索结果元信息（来源、得分、匹配原因）
 *
 * ⚡ 新增文件 — 增强 memory/store.ts 中的搜索能力
 */

import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// 1. 搜索配置
// ---------------------------------------------------------------------------

/** 搜索权重 Profile */
export interface SearchWeightProfile {
  /** Profile 名称 */
  name: string;
  /** 关键词搜索权重 (0-1) */
  keywordWeight: number;
  /** 向量搜索权重 (0-1) */
  vectorWeight: number;
  /** 时间衰减因子 (0=不衰减, 1=强衰减) */
  recencyDecay: number;
  /** 最小相关性分数阈值 (0-1) */
  minRelevanceScore: number;
  /** 最大返回结果数 */
  maxResults: number;
}

// 预设 Profile
export const SEARCH_PROFILES: Record<string, SearchWeightProfile> = {
  // 精确查找（事实、偏好、设置）
  precise: {
    name: 'precise',
    keywordWeight: 0.7,
    vectorWeight: 0.3,
    recencyDecay: 0.1,
    minRelevanceScore: 0.3,
    maxResults: 10,
  },
  // 语义搜索（模糊回忆、相似话题）
  semantic: {
    name: 'semantic',
    keywordWeight: 0.2,
    vectorWeight: 0.8,
    recencyDecay: 0.2,
    minRelevanceScore: 0.2,
    maxResults: 15,
  },
  // 近期记忆（最近讨论过什么）
  recent: {
    name: 'recent',
    keywordWeight: 0.4,
    vectorWeight: 0.3,
    recencyDecay: 0.8,
    minRelevanceScore: 0.1,
    maxResults: 20,
  },
  // 均衡模式（默认）
  balanced: {
    name: 'balanced',
    keywordWeight: 0.5,
    vectorWeight: 0.5,
    recencyDecay: 0.3,
    minRelevanceScore: 0.2,
    maxResults: 15,
  },
};

// 当前活跃 profile
let activeProfile: SearchWeightProfile = SEARCH_PROFILES.balanced;

// 自定义 profile 注册
const customProfiles = new Map<string, SearchWeightProfile>();

/**
 * 获取当前搜索配置。
 */
export function getSearchProfile(): SearchWeightProfile {
  return { ...activeProfile };
}

/**
 * 设置搜索配置。
 * @param nameOrProfile 预设名或自定义 Profile
 */
export function setSearchProfile(nameOrProfile: string | SearchWeightProfile): void {
  if (typeof nameOrProfile === 'string') {
    const profile = SEARCH_PROFILES[nameOrProfile] || customProfiles.get(nameOrProfile);
    if (!profile) throw new Error(`Unknown search profile: ${nameOrProfile}`);
    activeProfile = { ...profile };
  } else {
    activeProfile = { ...nameOrProfile };
  }
}

/**
 * 注册自定义搜索 Profile。
 */
export function registerSearchProfile(profile: SearchWeightProfile): void {
  customProfiles.set(profile.name, profile);
}

// ---------------------------------------------------------------------------
// 2. 查询意图检测（自动选择 Profile）
// ---------------------------------------------------------------------------

export type QueryIntent = 'precise' | 'semantic' | 'recent' | 'balanced';

/**
 * 自动检测查询意图。
 */
export function detectQueryIntent(query: string): QueryIntent {
  const lower = query.toLowerCase();

  // 精确查找模式
  const precisePatterns = [
    /(?:什么是|叫什么|多少|哪个|几号|地址|电话|密码|账号|配置|设置|参数|版本)/,
    /(?:whose|what is|how many|which|password|account|config|setting|version)/i,
  ];
  if (precisePatterns.some(p => p.test(lower))) return 'precise';

  // 近期记忆模式
  const recentPatterns = [
    /(?:最近|昨天|今天|上次|刚才|前几天|这周|上周|今天|刚刚)/,
    /(?:recently|yesterday|today|last time|just now|this week|last week)/i,
  ];
  if (recentPatterns.some(p => p.test(lower))) return 'recent';

  // 语义搜索模式
  const semanticPatterns = [
    /(?:类似|相关|关于|有关|像|类比|类似于|涉及)/,
    /(?:similar|related|about|regarding|like|involving)/i,
  ];
  if (semanticPatterns.some(p => p.test(lower))) return 'semantic';

  return 'balanced';
}

/**
 * 根据查询自动选择最佳 Profile。
 */
export function autoSelectProfile(query: string): SearchWeightProfile {
  const intent = detectQueryIntent(query);
  return SEARCH_PROFILES[intent] || SEARCH_PROFILES.balanced;
}

// ---------------------------------------------------------------------------
// 3. 搜索结果结构
// ---------------------------------------------------------------------------

/** 单条搜索结果 */
export interface SearchResultItem {
  /** 文件路径 */
  path: string;
  /** 内容片段 */
  snippet: string;
  /** 综合得分 (0-1) */
  score: number;
  /** 来源信息 */
  sources: {
    keyword?: { score: number; matchedTerms: string[] };
    vector?: { score: number };
    recency?: { score: number; timestamp?: string };
  };
  /** 匹配原因（人类可读） */
  matchReason: string;
}

/** 搜索结果 */
export interface HybridSearchResult {
  items: SearchResultItem[];
  query: string;
  profile: string;
  totalCandidates: number;
  searchTimeMs: number;
}

// ---------------------------------------------------------------------------
// 4. Reciprocal Rank Fusion (RRF)
// ---------------------------------------------------------------------------

/**
 * RRF 融合算法。
 * 将多路搜索结果按排名融合，生成统一排序。
 *
 * @param rankedLists 多路排名列表，每路是 [docId, score][]
 * @param k           RRF 常数 (default: 60)
 */
export function reciprocalRankFusion(
  rankedLists: Array<Array<{ id: string; score: number }>>,
  k = 60,
): Array<{ id: string; fusedScore: number; ranks: number[] }> {
  const fusionScores = new Map<string, { score: number; ranks: number[] }>();

  for (let listIdx = 0; listIdx < rankedLists.length; listIdx++) {
    const list = rankedLists[listIdx];
    for (let rank = 0; rank < list.length; rank++) {
      const { id } = list[rank];
      const existing = fusionScores.get(id) || { score: 0, ranks: new Array(rankedLists.length).fill(-1) };
      existing.score += 1 / (k + rank + 1);
      existing.ranks[listIdx] = rank;
      fusionScores.set(id, existing);
    }
  }

  return Array.from(fusionScores.entries())
    .map(([id, { score, ranks }]) => ({ id, fusedScore: score, ranks }))
    .sort((a, b) => b.fusedScore - a.fusedScore);
}

// ---------------------------------------------------------------------------
// 5. 时间衰减函数
// ---------------------------------------------------------------------------

/**
 * 指数时间衰减。
 *
 * @param timestamp  内容的时间戳
 * @param decayRate  衰减速率 (0-1)
 * @param halfLifeDays  半衰期（天）
 */
export function calculateTimeDecay(
  timestamp: string | Date,
  decayRate = 0.3,
  halfLifeDays = 30,
): number {
  const age = (Date.now() - new Date(timestamp).getTime()) / (1000 * 60 * 60 * 24);
  if (age <= 0) return 1;
  return Math.exp(-decayRate * age / halfLifeDays);
}

// ---------------------------------------------------------------------------
// 6. 混合搜索引擎
// ---------------------------------------------------------------------------

/** 关键词搜索回调 */
export type KeywordSearchFn = (query: string, maxResults: number) => Array<{
  path: string;
  snippet: string;
  matchedTerms: string[];
  score: number;
}>;

/** 向量搜索回调 */
export type VectorSearchFn = (query: string, maxResults: number) => Promise<Array<{
  path: string;
  snippet: string;
  score: number;
}>>;

/** 文件时间戳获取回调 */
export type GetTimestampFn = (path: string) => string | null;

/**
 * 执行混合搜索。
 *
 * @param query          用户查询
 * @param keywordSearch  关键词搜索实现
 * @param vectorSearch   向量搜索实现（可选，无则退化为纯关键词）
 * @param getTimestamp   获取文件时间戳（可选，用于时间衰减）
 * @param profile        搜索配置（不传则自动检测）
 */
export async function hybridSearch(
  query: string,
  keywordSearch: KeywordSearchFn,
  vectorSearch?: VectorSearchFn,
  getTimestamp?: GetTimestampFn,
  profile?: SearchWeightProfile,
): Promise<HybridSearchResult> {
  const startTime = Date.now();
  const selectedProfile = profile || autoSelectProfile(query);

  // 1. 执行关键词搜索
  const keywordResults = keywordSearch(
    query,
    Math.ceil(selectedProfile.maxResults * 1.5),
  );

  // 2. 执行向量搜索（如果有）
  let vectorResults: Array<{ path: string; snippet: string; score: number }> = [];
  if (vectorSearch && selectedProfile.vectorWeight > 0) {
    try {
      vectorResults = await vectorSearch(
        query,
        Math.ceil(selectedProfile.maxResults * 1.5),
      );
    } catch (error) {
      logger.warn('[HybridSearch] Vector search failed, falling back to keyword-only:', error);
      // 退化：keyword 权重提升
    }
  }

  // 3. 融合排序
  const allPaths = new Set([
    ...keywordResults.map(r => r.path),
    ...vectorResults.map(r => r.path),
  ]);

  const fusedItems: SearchResultItem[] = [];

  for (const path of allPaths) {
    const kwResult = keywordResults.find(r => r.path === path);
    const vecResult = vectorResults.find(r => r.path === path);

    // 计算各维度得分
    const kwScore = kwResult ? kwResult.score : 0;
    const vecScore = vecResult ? vecResult.score : 0;

    // 时间衰减
    let timeDecay = 1;
    if (getTimestamp && selectedProfile.recencyDecay > 0) {
      const ts = getTimestamp(path);
      if (ts) {
        timeDecay = calculateTimeDecay(ts, selectedProfile.recencyDecay);
      }
    }

    // 综合得分
    const effectiveKwWeight = vectorResults.length > 0
      ? selectedProfile.keywordWeight
      : 1; // 无向量搜索时 keyword 独占
    const effectiveVecWeight = vectorResults.length > 0
      ? selectedProfile.vectorWeight
      : 0;

    const rawScore = kwScore * effectiveKwWeight + vecScore * effectiveVecWeight;
    const finalScore = rawScore * (0.3 + 0.7 * timeDecay); // 时间衰减影响 70%

    if (finalScore < selectedProfile.minRelevanceScore) continue;

    // 生成匹配原因
    const reasons: string[] = [];
    if (kwResult) reasons.push(`关键词匹配: ${kwResult.matchedTerms.join(', ')}`);
    if (vecResult) reasons.push(`语义相似度: ${(vecScore * 100).toFixed(0)}%`);
    if (timeDecay < 0.8) reasons.push(`时间衰减: ${(timeDecay * 100).toFixed(0)}%`);

    fusedItems.push({
      path,
      snippet: kwResult?.snippet || vecResult?.snippet || '',
      score: Math.round(finalScore * 1000) / 1000,
      sources: {
        ...(kwResult && { keyword: { score: kwScore, matchedTerms: kwResult.matchedTerms } }),
        ...(vecResult && { vector: { score: vecScore } }),
        ...(timeDecay < 1 && { recency: { score: timeDecay } }),
      },
      matchReason: reasons.join(' | '),
    });
  }

  // 排序并截取
  fusedItems.sort((a, b) => b.score - a.score);
  const items = fusedItems.slice(0, selectedProfile.maxResults);

  return {
    items,
    query,
    profile: selectedProfile.name,
    totalCandidates: allPaths.size,
    searchTimeMs: Date.now() - startTime,
  };
}
