/**
import { cosineSimilarity } from '../../infra/utils';
 * P2-#13: 去重阈值可配置
 * 
 * 原始问题：scoring.ts 中 findDuplicates() 使用硬编码的相似度阈值 0.8，
 * 无法根据不同场景（事实类记忆 vs 对话摘要 vs 技能文件）灵活调整。
 * 
 * 优化方案：
 * 1. 引入 DedupProfile 配置体系，支持按内容类型分别设定阈值
 * 2. 支持多维度去重策略（精确匹配 / 模糊匹配 / 语义匹配）
 * 3. 合并策略可配置（保留最新 / 保留最长 / 合并内容）
 * 4. 去重日志与统计，便于调优
 * 
 * 使用方式：
 *   import { configureDedupProfile, findDuplicatesEnhanced, DedupDecision } from './dedup-config';
 *   
 *   // 使用预设配置
 *   configureDedupProfile('strict');
 *   
 *   // 或自定义
 *   configureDedupProfile({
 *     name: 'custom',
 *     exactMatchEnabled: true,
 *     fuzzyThreshold: 0.85,
 *     semanticThreshold: 0.92,
 *     mergeStrategy: 'keep-longest',
 *   });
 *   
 *   const decisions = findDuplicatesEnhanced(entries, { contentType: 'fact' });
 */

// ─── 类型定义 ─────────────────────────────────────────────

/** 去重合并策略 */
export type MergeStrategy =
  | 'keep-newest'    // 保留最新条目
  | 'keep-oldest'    // 保留最早条目
  | 'keep-longest'   // 保留内容最长的
  | 'keep-shortest'  // 保留内容最短的
  | 'merge-append'   // 合并内容（追加）
  | 'manual';        // 不自动合并，仅标记

/** 内容类型 */
export type ContentType = 'fact' | 'conversation' | 'skill' | 'summary' | 'general';

/** 去重阈值配置 */
export interface DedupThresholds {
  /** 精确匹配（归一化后完全相同）是否启用 */
  exactMatchEnabled: boolean;
  /** 模糊匹配阈值 (0-1)，基于编辑距离或 Jaccard */
  fuzzyThreshold: number;
  /** 语义匹配阈值 (0-1)，基于向量余弦相似度（如有） */
  semanticThreshold: number;
  /** 最小内容长度，低于此长度的条目跳过去重 */
  minContentLength: number;
}

/** 按内容类型的阈值覆盖 */
export type ContentTypeOverrides = Partial<Record<ContentType, Partial<DedupThresholds>>>;

/** 去重配置文件 */
export interface DedupProfile {
  name: string;
  /** 默认阈值 */
  defaults: DedupThresholds;
  /** 按内容类型覆盖 */
  overrides: ContentTypeOverrides;
  /** 合并策略 */
  mergeStrategy: MergeStrategy;
  /** 是否记录去重日志 */
  enableLogging: boolean;
  /** 最大比较对数上限，防止 O(n²) 爆炸 */
  maxComparisons: number;
}

/** 去重决定 */
export interface DedupDecision {
  /** 原始条目 ID */
  entryId: string;
  /** 重复条目 ID */
  duplicateOf: string;
  /** 匹配方式 */
  matchType: 'exact' | 'fuzzy' | 'semantic';
  /** 相似度分数 */
  similarity: number;
  /** 建议动作 */
  action: MergeStrategy;
  /** 适用的阈值 */
  thresholdUsed: number;
}

/** 去重统计 */
export interface DedupStats {
  totalEntries: number;
  comparisons: number;
  exactMatches: number;
  fuzzyMatches: number;
  semanticMatches: number;
  skippedShort: number;
  skippedMaxComparisons: boolean;
  durationMs: number;
}

/** 去重结果 */
export interface DedupResult {
  decisions: DedupDecision[];
  stats: DedupStats;
  log: string[];
}

/** 可去重条目接口 */
export interface DedupEntry {
  id: string;
  content: string;
  contentType?: ContentType;
  timestamp?: number;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

/** 语义相似度提供器（可选注入） */
export interface SemanticSimilarityProvider {
  computeSimilarity(embeddingA: number[], embeddingB: number[]): number;
}

// ─── 预设配置 ─────────────────────────────────────────────

const PRESET_PROFILES: Record<string, DedupProfile> = {
  /** 严格去重：阈值低，更激进地合并 */
  strict: {
    name: 'strict',
    defaults: {
      exactMatchEnabled: true,
      fuzzyThreshold: 0.70,
      semanticThreshold: 0.85,
      minContentLength: 10,
    },
    overrides: {
      fact: { fuzzyThreshold: 0.65 },
      skill: { fuzzyThreshold: 0.75 },
    },
    mergeStrategy: 'keep-newest',
    enableLogging: true,
    maxComparisons: 50000,
  },

  /** 宽松去重：阈值高，仅去除明显重复 */
  relaxed: {
    name: 'relaxed',
    defaults: {
      exactMatchEnabled: true,
      fuzzyThreshold: 0.90,
      semanticThreshold: 0.95,
      minContentLength: 20,
    },
    overrides: {},
    mergeStrategy: 'keep-longest',
    enableLogging: false,
    maxComparisons: 100000,
  },

  /** 平衡模式：兼顾去重率和误判 */
  balanced: {
    name: 'balanced',
    defaults: {
      exactMatchEnabled: true,
      fuzzyThreshold: 0.80,
      semanticThreshold: 0.90,
      minContentLength: 15,
    },
    overrides: {
      fact: { fuzzyThreshold: 0.75, semanticThreshold: 0.88 },
      conversation: { fuzzyThreshold: 0.85 },
      summary: { fuzzyThreshold: 0.82 },
    },
    mergeStrategy: 'keep-newest',
    enableLogging: true,
    maxComparisons: 80000,
  },

  /** 兼容模式：模拟原始 scoring.ts 的硬编码行为 */
  legacy: {
    name: 'legacy',
    defaults: {
      exactMatchEnabled: true,
      fuzzyThreshold: 0.80,
      semanticThreshold: 1.0, // 禁用语义匹配
      minContentLength: 0,
    },
    overrides: {},
    mergeStrategy: 'keep-newest',
    enableLogging: false,
    maxComparisons: 100000,
  },
};

// ─── 全局状态 ─────────────────────────────────────────────

let activeProfile: DedupProfile = { ...PRESET_PROFILES.balanced };
let semanticProvider: SemanticSimilarityProvider | null = null;

// ─── 配置 API ─────────────────────────────────────────────

/**
 * 设置去重配置
 * @param profileOrName 预设名称 ('strict' | 'relaxed' | 'balanced' | 'legacy') 或自定义配置
 */
export function configureDedupProfile(
  profileOrName: string | Partial<DedupProfile>
): void {
  if (typeof profileOrName === 'string') {
    const preset = PRESET_PROFILES[profileOrName];
    if (!preset) {
      throw new Error(
        `Unknown dedup profile: "${profileOrName}". Available: ${Object.keys(PRESET_PROFILES).join(', ')}`
      );
    }
    activeProfile = JSON.parse(JSON.stringify(preset));
  } else {
    // 合并自定义配置到当前激活配置
    activeProfile = mergeProfile(activeProfile, profileOrName);
  }
}

/**
 * 获取当前激活的去重配置（只读副本）
 */
export function getActiveDedupProfile(): Readonly<DedupProfile> {
  return JSON.parse(JSON.stringify(activeProfile));
}

/**
 * 注册语义相似度提供器
 */
export function setSemanticSimilarityProvider(
  provider: SemanticSimilarityProvider
): void {
  semanticProvider = provider;
}

/**
 * 获取指定内容类型的有效阈值
 */
export function getEffectiveThresholds(contentType?: ContentType): DedupThresholds {
  const base = { ...activeProfile.defaults };
  if (contentType && activeProfile.overrides[contentType]) {
    Object.assign(base, activeProfile.overrides[contentType]);
  }
  return base;
}

// ─── 相似度计算 ─────────────────────────────────────────────

/**
 * 文本归一化：去除多余空白、统一标点、转小写
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[，。！？；：、""''（）【】《》]/g, (ch) => {
      const map: Record<string, string> = {
        '，': ',', '。': '.', '！': '!', '？': '?',
        '；': ';', '：': ':', '、': ',',
        '\u201c': '"', '\u201d': '"', '\u2018': "'", '\u2019': "'",
        '（': '(', '）': ')', '【': '[', '】': ']',
        '《': '<', '》': '>',
      };
      return map[ch] || ch;
    })
    .trim();
}

/**
 * 基于字符级 bigram 的 Jaccard 相似度
 * 比单字符更抗噪，比词级更通用（不依赖分词）
 */
function bigramJaccardSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length < 2 || b.length < 2) {
    // 短文本退化为字符级
    return charJaccardSimilarity(a, b);
  }

  const bigramsA = new Set<string>();
  const bigramsB = new Set<string>();

  for (let i = 0; i < a.length - 1; i++) {
    bigramsA.add(a.substring(i, i + 2));
  }
  for (let i = 0; i < b.length - 1; i++) {
    bigramsB.add(b.substring(i, i + 2));
  }

  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }

  const union = bigramsA.size + bigramsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * 字符级 Jaccard（短文本 fallback）
 */
function charJaccardSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const ch of setA) {
    if (setB.has(ch)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
// ─── 核心去重逻辑 ─────────────────────────────────────────

/**
 * 增强版去重检测
 * 
 * 替代原始 scoring.ts 中的 findDuplicates()。
 * 支持多维度匹配、按内容类型分级阈值、可配置合并策略。
 * 
 * @param entries 待去重条目
 * @param options 可选参数
 * @returns 去重结果（决定列表 + 统计 + 日志）
 */
export function findDuplicatesEnhanced(
  entries: DedupEntry[],
  options: {
    contentType?: ContentType;
    profileOverride?: Partial<DedupProfile>;
  } = {}
): DedupResult {
  const startTime = Date.now();
  const log: string[] = [];
  const stats: DedupStats = {
    totalEntries: entries.length,
    comparisons: 0,
    exactMatches: 0,
    fuzzyMatches: 0,
    semanticMatches: 0,
    skippedShort: 0,
    skippedMaxComparisons: false,
    durationMs: 0,
  };

  const profile = options.profileOverride
    ? mergeProfile(activeProfile, options.profileOverride)
    : activeProfile;

  const decisions: DedupDecision[] = [];
  const duplicateIds = new Set<string>();

  // 预处理：归一化 + 过滤短内容
  const processed: Array<{
    entry: DedupEntry;
    normalized: string;
    thresholds: DedupThresholds;
  }> = [];

  for (const entry of entries) {
    const ct = entry.contentType || options.contentType || 'general';
    const thresholds = resolveThresholds(profile, ct);

    if (entry.content.length < thresholds.minContentLength) {
      stats.skippedShort++;
      if (profile.enableLogging) {
        log.push(`[SKIP] ${entry.id}: content too short (${entry.content.length} < ${thresholds.minContentLength})`);
      }
      continue;
    }

    processed.push({
      entry,
      normalized: normalizeText(entry.content),
      thresholds,
    });
  }

  // 两两比较
  const maxComp = profile.maxComparisons;
  let compCount = 0;

  for (let i = 0; i < processed.length; i++) {
    if (duplicateIds.has(processed[i].entry.id)) continue;

    for (let j = i + 1; j < processed.length; j++) {
      if (duplicateIds.has(processed[j].entry.id)) continue;

      if (++compCount > maxComp) {
        stats.skippedMaxComparisons = true;
        if (profile.enableLogging) {
          log.push(`[WARN] Max comparisons reached (${maxComp}), stopping early`);
        }
        break;
      }
      stats.comparisons++;

      const a = processed[i];
      const b = processed[j];

      // 使用两者中更严格（更高）的阈值
      const thresholds: DedupThresholds = {
        exactMatchEnabled: a.thresholds.exactMatchEnabled && b.thresholds.exactMatchEnabled,
        fuzzyThreshold: Math.max(a.thresholds.fuzzyThreshold, b.thresholds.fuzzyThreshold),
        semanticThreshold: Math.max(a.thresholds.semanticThreshold, b.thresholds.semanticThreshold),
        minContentLength: Math.min(a.thresholds.minContentLength, b.thresholds.minContentLength),
      };

      const decision = compareEntries(a, b, thresholds, profile);

      if (decision) {
        decisions.push(decision);
        duplicateIds.add(decision.duplicateOf);

        switch (decision.matchType) {
          case 'exact': stats.exactMatches++; break;
          case 'fuzzy': stats.fuzzyMatches++; break;
          case 'semantic': stats.semanticMatches++; break;
        }

        if (profile.enableLogging) {
          log.push(
            `[DUP] ${decision.entryId} ≈ ${decision.duplicateOf} ` +
            `(${decision.matchType}, sim=${decision.similarity.toFixed(3)}, ` +
            `threshold=${decision.thresholdUsed.toFixed(3)})`
          );
        }
      }
    }

    if (stats.skippedMaxComparisons) break;
  }

  stats.durationMs = Date.now() - startTime;

  if (profile.enableLogging) {
    log.push(
      `[DONE] ${stats.comparisons} comparisons in ${stats.durationMs}ms, ` +
      `found ${decisions.length} duplicates ` +
      `(exact=${stats.exactMatches}, fuzzy=${stats.fuzzyMatches}, semantic=${stats.semanticMatches})`
    );
  }

  return { decisions, stats, log };
}

/**
 * 比较两个条目，返回去重决定（如果是重复），否则 null
 */
function compareEntries(
  a: { entry: DedupEntry; normalized: string },
  b: { entry: DedupEntry; normalized: string },
  thresholds: DedupThresholds,
  profile: DedupProfile
): DedupDecision | null {
  // 确定哪个是"主"条目（保留的），哪个是"副"条目（被去重的）
  const [primary, duplicate] = resolvePrimaryEntry(a.entry, b.entry, profile.mergeStrategy);

  // 第 1 层：精确匹配
  if (thresholds.exactMatchEnabled && a.normalized === b.normalized) {
    return {
      entryId: primary.id,
      duplicateOf: duplicate.id,
      matchType: 'exact',
      similarity: 1.0,
      action: profile.mergeStrategy,
      thresholdUsed: 1.0,
    };
  }

  // 第 2 层：模糊匹配（bigram Jaccard）
  const fuzzySim = bigramJaccardSimilarity(a.normalized, b.normalized);
  if (fuzzySim >= thresholds.fuzzyThreshold) {
    return {
      entryId: primary.id,
      duplicateOf: duplicate.id,
      matchType: 'fuzzy',
      similarity: fuzzySim,
      action: profile.mergeStrategy,
      thresholdUsed: thresholds.fuzzyThreshold,
    };
  }

  // 第 3 层：语义匹配（需要 embedding）
  if (
    thresholds.semanticThreshold < 1.0 &&
    a.entry.embedding &&
    b.entry.embedding
  ) {
    const semSim = semanticProvider
      ? semanticProvider.computeSimilarity(a.entry.embedding, b.entry.embedding)
      : cosineSimilarity(a.entry.embedding, b.entry.embedding);

    if (semSim >= thresholds.semanticThreshold) {
      return {
        entryId: primary.id,
        duplicateOf: duplicate.id,
        matchType: 'semantic',
        similarity: semSim,
        action: profile.mergeStrategy,
        thresholdUsed: thresholds.semanticThreshold,
      };
    }
  }

  return null;
}

/**
 * 根据合并策略确定主/副条目
 */
function resolvePrimaryEntry(
  a: DedupEntry,
  b: DedupEntry,
  strategy: MergeStrategy
): [DedupEntry, DedupEntry] {
  switch (strategy) {
    case 'keep-newest':
      return (a.timestamp ?? 0) >= (b.timestamp ?? 0) ? [a, b] : [b, a];
    case 'keep-oldest':
      return (a.timestamp ?? Infinity) <= (b.timestamp ?? Infinity) ? [a, b] : [b, a];
    case 'keep-longest':
      return a.content.length >= b.content.length ? [a, b] : [b, a];
    case 'keep-shortest':
      return a.content.length <= b.content.length ? [a, b] : [b, a];
    default:
      return [a, b]; // merge-append, manual: 保持原始顺序
  }
}

// ─── 自动合并执行 ──────────────────────────────────────────

/**
 * 根据去重决定执行合并操作
 * 返回合并后的条目列表（不含被去重的条目）
 */
export function applyDedupDecisions(
  entries: DedupEntry[],
  decisions: DedupDecision[]
): DedupEntry[] {
  const duplicateIds = new Set(decisions.map(d => d.duplicateOf));
  const mergeAppendTargets = new Map<string, string[]>();

  // 收集 merge-append 的内容
  for (const decision of decisions) {
    if (decision.action === 'merge-append') {
      const dupEntry = entries.find(e => e.id === decision.duplicateOf);
      if (dupEntry) {
        const existing = mergeAppendTargets.get(decision.entryId) || [];
        existing.push(dupEntry.content);
        mergeAppendTargets.set(decision.entryId, existing);
      }
    }
  }

  // 构建结果
  const result: DedupEntry[] = [];
  for (const entry of entries) {
    if (duplicateIds.has(entry.id)) continue;

    // 如果有需要追加合并的内容
    const appendContents = mergeAppendTargets.get(entry.id);
    if (appendContents && appendContents.length > 0) {
      result.push({
        ...entry,
        content: [entry.content, ...appendContents].join('\n---\n'),
        metadata: {
          ...entry.metadata,
          mergedFrom: appendContents.length,
          mergedAt: Date.now(),
        },
      });
    } else {
      result.push(entry);
    }
  }

  return result;
}

// ─── 工具函数 ──────────────────────────────────────────────

function resolveThresholds(profile: DedupProfile, contentType: ContentType): DedupThresholds {
  const base = { ...profile.defaults };
  if (profile.overrides[contentType]) {
    Object.assign(base, profile.overrides[contentType]);
  }
  return base;
}

function mergeProfile(base: DedupProfile, partial: Partial<DedupProfile>): DedupProfile {
  const result = JSON.parse(JSON.stringify(base)) as DedupProfile;

  if (partial.name) result.name = partial.name;
  if (partial.mergeStrategy) result.mergeStrategy = partial.mergeStrategy;
  if (partial.enableLogging !== undefined) result.enableLogging = partial.enableLogging;
  if (partial.maxComparisons !== undefined) result.maxComparisons = partial.maxComparisons;

  if (partial.defaults) {
    Object.assign(result.defaults, partial.defaults);
  }
  if (partial.overrides) {
    result.overrides = { ...result.overrides, ...partial.overrides };
  }

  return result;
}
