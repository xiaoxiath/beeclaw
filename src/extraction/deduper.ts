/**
 * 知识去重器
 *
 * 检测重复、合并更新、处理冲突
 */

import type { ExtractedKnowledge, KnowledgeCategory } from './types';

// ============================================================================
// Synonym Normalization — maps semantically equivalent terms to canonical forms
// ============================================================================

const SYNONYM_MAP: Record<string, string> = {
  // Color/Theme
  '深色': '暗色', '暗黑': '暗色', 'dark': '暗色', '夜间': '暗色',
  '浅色': '亮色', '明亮': '亮色', 'light': '亮色',
  // Preference
  '喜欢': '偏好', '偏爱': '偏好', '倾向': '偏好', 'prefer': '偏好', 'like': '偏好',
  '不喜欢': '不偏好', '不爱': '不偏好', '讨厌': '不偏好', 'dislike': '不偏好',
  // Lang
  '中文': '汉语', 'chinese': '汉语', 'mandarin': '汉语',
  '英文': '英语', 'english': '英语',
  // Common tech
  'js': 'javascript', 'ts': 'typescript', 'py': 'python',
  'react': 'react', 'vue': 'vue',
  // Time
  '当前': '现在', '目前': '现在', 'current': '现在', 'now': '现在',
  // Personality
  '主题': '话题', 'topic': '话题',
  '模式': '模式', 'mode': '模式',
};

/** Normalize a text by replacing synonyms with canonical forms + lowercasing */
function normalizeText(text: string): string {
  let normalized = text.toLowerCase().trim();
  for (const [synonym, canonical] of Object.entries(SYNONYM_MAP)) {
    // Use word boundary-safe replacement
    normalized = normalized.replace(new RegExp(synonym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), canonical);
  }
  return normalized;
}

/** Stop words to exclude from similarity computation */
const STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一',
  '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my', 'your',
]);

/**
 * Character-level bigram similarity (works well for short CJK + English text)
 *
 * Advantages over pure Jaccard:
 *   - Captures partial word overlaps ("深色主题" vs "暗色模式" after normalization)
 *   - Works for Chinese where word segmentation is unreliable
 *   - Order-sensitive to some degree via bigrams
 */
function bigramSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length < 2 || b.length < 2) return a === b ? 1.0 : 0.0;

  function getBigrams(str: string): Map<string, number> {
    const bigrams = new Map<string, number>();
    for (let i = 0; i < str.length - 1; i++) {
      const bigram = str.substring(i, i + 2);
      bigrams.set(bigram, (bigrams.get(bigram) || 0) + 1);
    }
    return bigrams;
  }

  const bigramsA = getBigrams(a);
  const bigramsB = getBigrams(b);

  let intersection = 0;
  let union = 0;

  const allKeys = new Set([...bigramsA.keys(), ...bigramsB.keys()]);
  for (const key of allKeys) {
    const countA = bigramsA.get(key) || 0;
    const countB = bigramsB.get(key) || 0;
    intersection += Math.min(countA, countB);
    union += Math.max(countA, countB);
  }

  return union === 0 ? 0 : intersection / union;
}


export interface DeduplicationResult {
  toAdd: ExtractedKnowledge[];       // 新增
  toUpdate: UpdateAction[];           // 更新
  duplicates: ExtractedKnowledge[];   // 完全重复（跳过）
  conflicts: ConflictAction[];        // 冲突（需处理）
}

export interface UpdateAction {
  existing: ExtractedKnowledge;
  incoming: ExtractedKnowledge;
  merged: ExtractedKnowledge;
}

export interface ConflictAction {
  existing: ExtractedKnowledge;
  incoming: ExtractedKnowledge;
  conflictType: 'contradiction' | 'different_source';
  recommendation: 'keep_old' | 'keep_new' | 'merge' | 'ask_user';
}

// 相似度阈值
const SIMILARITY_THRESHOLDS = {
  exact: 1.0,       // 完全相同
  high: 0.9,         // 高度相似
  medium: 0.7,       // 中等相似
  low: 0.5,          // 低相似度
};

export class KnowledgeDeduper {
  /**
   * 去重和分类
   */
  deduplicate(
    incoming: ExtractedKnowledge[],
    existing: ExtractedKnowledge[]
  ): DeduplicationResult {
    const result: DeduplicationResult = {
      toAdd: [],
      toUpdate: [],
      duplicates: [],
      conflicts: [],
    };

    for (const item of incoming) {
      const matchResult = this.findBestMatch(item, existing);

      if (!matchResult.match) {
        // 没有匹配，新增
        result.toAdd.push(item);
        continue;
      }

      const { match, similarity } = matchResult;

      if (similarity >= SIMILARITY_THRESHOLDS.exact) {
        // 完全重复
        result.duplicates.push(item);
        continue;
      }

      if (similarity >= SIMILARITY_THRESHOLDS.high) {
        // 高度相似，可能是更新
        const updateAction = this.mergeKnowledge(match, item);
        if (updateAction) {
          result.toUpdate.push(updateAction);
        } else {
          result.duplicates.push(item);
        }
        continue;
      }

      if (similarity >= SIMILARITY_THRESHOLDS.medium) {
        // 中等相似，检查是否冲突
        if (this.isConflict(match, item)) {
          result.conflicts.push({
            existing: match,
            incoming: item,
            conflictType: 'contradiction',
            recommendation: this.getConflictRecommendation(match, item),
          });
        } else {
          // 不同信息，新增
          result.toAdd.push(item);
        }
        continue;
      }

      // 低相似度，作为新条目
      result.toAdd.push(item);
    }

    return result;
  }

  /**
   * 查找最佳匹配
   */
  private findBestMatch(
    item: ExtractedKnowledge,
    existing: ExtractedKnowledge[]
  ): { match: ExtractedKnowledge | null; similarity: number } {
    let bestMatch: ExtractedKnowledge | null = null;
    let bestSimilarity = 0;

    for (const existingItem of existing) {
      // 同类别才比较
      if (existingItem.category !== item.category) {
        continue;
      }

      const similarity = this.calculateSimilarity(item, existingItem);

      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = existingItem;
      }
    }

    return { match: bestMatch, similarity: bestSimilarity };
  }

  /**
   * 计算相似度（含同义词归一化）
   */
  private calculateSimilarity(a: ExtractedKnowledge, b: ExtractedKnowledge): number {
    // 1. Key 完全匹配（原始 or 归一化后）
    if (a.key === b.key) {
      return SIMILARITY_THRESHOLDS.exact;
    }
    const normKeyA = normalizeText(a.key);
    const normKeyB = normalizeText(b.key);
    if (normKeyA === normKeyB) {
      return SIMILARITY_THRESHOLDS.exact;
    }

    // 2. Key 包含关系（归一化后）
    if (normKeyA.includes(normKeyB) || normKeyB.includes(normKeyA)) {
      return SIMILARITY_THRESHOLDS.high;
    }

    // 3. Value 相似度 (synonym-aware + bigram)
    const valueSimilarity = this.textSimilarity(a.value, b.value);

    // 4. Key 相似度 (synonym-aware + bigram)
    const keySimilarity = this.textSimilarity(a.key, b.key);

    // 综合评分
    const combined = keySimilarity * 0.6 + valueSimilarity * 0.4;

    return combined;
  }

  /**
   * 文本相似度 — 混合策略
   *
   * 1. Synonym normalization (maps equivalent terms to canonical forms)
   * 2. Stop word removal
   * 3. Weighted combination: bigram similarity (0.6) + Jaccard on tokens (0.4)
   *
   * This handles both Chinese (where bigrams capture character-level overlap)
   * and English (where Jaccard on tokens handles word-level matching).
   */
  private textSimilarity(a: string, b: string): number {
    // Normalize with synonyms
    const normA = normalizeText(a);
    const normB = normalizeText(b);

    // Exact match after normalization
    if (normA === normB) return 1.0;

    // Bigram similarity on full normalized text
    const bigramSim = bigramSimilarity(normA, normB);

    // Token-level Jaccard (with stop word removal)
    const tokensA = normA.split(/\s+/).filter(w => w.length > 0 && !STOP_WORDS.has(w));
    const tokensB = normB.split(/\s+/).filter(w => w.length > 0 && !STOP_WORDS.has(w));

    const setA = new Set(tokensA);
    const setB = new Set(tokensB);
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    const jaccardSim = union.size === 0 ? 0 : intersection.size / union.size;

    // Weighted combination
    return bigramSim * 0.6 + jaccardSim * 0.4;
  }

  /**
   * 检测是否冲突
   */
  private isConflict(existing: ExtractedKnowledge, incoming: ExtractedKnowledge): boolean {
    // Key 相同但 value 不同
    if (existing.key === incoming.key && existing.value !== incoming.value) {
      return true;
    }

    // 语义相反
    const contradictions = [
      [/是$/, /不是$/],
      [/有$/, /没有$/],
      [/在/, /不在/],
      [/can\s/i, /can't\s/i],
      [/will\s/i, /won't\s/i],
    ];

    for (const [pattern1, pattern2] of contradictions) {
      const existingMatch1 = pattern1.test(existing.value);
      const existingMatch2 = pattern2.test(existing.value);
      const incomingMatch1 = pattern1.test(incoming.value);
      const incomingMatch2 = pattern2.test(incoming.value);

      if ((existingMatch1 && incomingMatch2) || (existingMatch2 && incomingMatch1)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 获取冲突处理建议
   */
  private getConflictRecommendation(
    existing: ExtractedKnowledge,
    incoming: ExtractedKnowledge
  ): 'keep_old' | 'keep_new' | 'merge' | 'ask_user' {
    // 新的置信度明显高于旧的
    if (incoming.confidence > existing.confidence + 0.2) {
      return 'keep_new';
    }

    // 旧的置信度明显高于新的
    if (existing.confidence > incoming.confidence + 0.2) {
      return 'keep_old';
    }

    // 时间差异大
    const timeDiff = Date.now() - existing.timestamp.getTime();
    const oneDay = 24 * 60 * 60 * 1000;

    if (timeDiff > oneDay * 7) {
      // 旧信息超过一周，可能是更新
      return 'keep_new';
    }

    // 默认询问用户
    return 'ask_user';
  }

  /**
   * 合并知识
   */
  mergeKnowledge(
    existing: ExtractedKnowledge,
    incoming: ExtractedKnowledge
  ): UpdateAction | null {
    // 完全相同
    if (existing.value === incoming.value) {
      return null;
    }

    // 合并策略
    let mergedValue: string;
    let mergedConfidence: number;

    if (this.isValueUpdate(existing.value, incoming.value)) {
      // 是更新（新信息更详细或更新）
      mergedValue = incoming.value;
      mergedConfidence = Math.max(existing.confidence, incoming.confidence);
    } else if (this.isValueExpansion(existing.value, incoming.value)) {
      // 是扩展（可以合并）
      mergedValue = this.mergeValues(existing.value, incoming.value);
      mergedConfidence = (existing.confidence + incoming.confidence) / 2;
    } else {
      // 无法自动合并
      return null;
    }

    const merged: ExtractedKnowledge = {
      ...existing,
      value: mergedValue,
      confidence: mergedConfidence,
      timestamp: new Date(),
      status: 'confirmed',
    };

    return {
      existing,
      incoming,
      merged,
    };
  }

  /**
   * 判断是否是更新
   */
  private isValueUpdate(oldValue: string, newValue: string): boolean {
    // 新值包含旧值
    if (newValue.includes(oldValue) && newValue.length > oldValue.length) {
      return true;
    }

    // 时间相关词汇
    if (/现在|当前|最新|目前|已|刚/.test(newValue)) {
      return true;
    }

    return false;
  }

  /**
   * 判断是否是扩展
   */
  private isValueExpansion(oldValue: string, newValue: string): boolean {
    // 两者互补
    const oldWords = new Set(oldValue.split(/\s+/));
    const newWords = new Set(newValue.split(/\s+/));

    const uniqueNew = [...newWords].filter(w => !oldWords.has(w));

    // 新信息有独特内容，但不是完全不同
    return uniqueNew.length > 0 && uniqueNew.length < newWords.size * 0.5;
  }

  /**
   * 合并值
   */
  private mergeValues(oldValue: string, newValue: string): string {
    // 简单合并：保留更详细的
    if (newValue.length > oldValue.length) {
      return newValue;
    }
    return oldValue;
  }

  /**
   * 批量去重（内存优化版）
   */
  deduplicateBatch(
    incoming: ExtractedKnowledge[],
    existing: ExtractedKnowledge[],
    batchSize: number = 100
  ): DeduplicationResult {
    const result: DeduplicationResult = {
      toAdd: [],
      toUpdate: [],
      duplicates: [],
      conflicts: [],
    };

    // 分批处理
    for (let i = 0; i < incoming.length; i += batchSize) {
      const batch = incoming.slice(i, i + batchSize);
      const batchResult = this.deduplicate(batch, existing);

      result.toAdd.push(...batchResult.toAdd);
      result.toUpdate.push(...batchResult.toUpdate);
      result.duplicates.push(...batchResult.duplicates);
      result.conflicts.push(...batchResult.conflicts);

      // 将已处理的加入 existing，用于后续批次匹配
      existing.push(...batchResult.toAdd);
    }

    return result;
  }
}

// 单例
let deduperInstance: KnowledgeDeduper | null = null;

export function getKnowledgeDeduper(): KnowledgeDeduper {
  if (!deduperInstance) {
    deduperInstance = new KnowledgeDeduper();
  }
  return deduperInstance;
}
