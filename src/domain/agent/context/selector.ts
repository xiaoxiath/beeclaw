/**
 * Context Selector — RRI 三维评分 + Lost-in-the-Middle 重排
 *
 * 从海量候选信息中精准提取关键内容，综合考虑三个维度：
 * - Relevance（相关性）：与当前查询的语义相似度
 * - Recency（时效性）：信息的新鲜程度（时间衰减）
 * - Importance（重要性）：信息的固有价值（人工标注或启发式推断）
 *
 * 核心算法：
 * 1. RRI 评分：weighted_score = w_r * relevance + w_c * recency + w_i * importance
 * 2. 去重：基于 embedding 余弦相似度（阈值 0.92）
 * 3. Lost-in-the-Middle 重排：高分项交替放置在首尾位置
 *
 * 参考：Liu et al. (2024) "Lost in the Middle" — LLM 对中间位置信息利用率低
 */

import { logger } from '../../../infra/observability/logger';
import { cosineSimilarity } from '../../../infra/utils';

/**
 * 上下文候选项
 */
export interface ContextItem {
  id: string;
  content: string;
  embedding?: number[];        // 语义向量（可选，用于相似度计算）
  timestamp: number;           // Unix 时间戳（毫秒）
  importance: number;          // 重要性评分 [0, 1]
  metadata?: Record<string, any>; // 额外元数据
}

/**
 * RRI 评分权重配置
 */
export interface RRIWeights {
  relevance: number;  // 相关性权重（默认 0.5）
  recency: number;    // 时效性权重（默认 0.3）
  importance: number; // 重要性权重（默认 0.2）
}

/**
 * 选择器配置
 */
export interface SelectorConfig {
  weights: RRIWeights;
  maxItems: number;           // 最大返回项数
  dedupThreshold: number;     // 去重阈值（余弦相似度，默认 0.92）
  enableReorder: boolean;     // 是否启用 Lost-in-the-Middle 重排
}

/**
 * 默认配置
 */
export const DEFAULT_SELECTOR_CONFIG: SelectorConfig = {
  weights: {
    relevance: 0.5,
    recency: 0.3,
    importance: 0.2,
  },
  maxItems: 20,
  dedupThreshold: 0.92,
  enableReorder: true,
};

/**
 * 上下文选择器
 */
export class ContextSelector {
  constructor(private config: SelectorConfig = DEFAULT_SELECTOR_CONFIG) {}

  /**
   * 从候选列表中选择最相关的上下文项
   *
   * @param candidates 候选项列表
   * @param queryEmbedding 查询的 embedding 向量（用于相关性计算）
   * @param now 当前时间戳（用于时效性计算）
   * @returns 选中的上下文项（已排序和重排）
   */
  select(
    candidates: ContextItem[],
    queryEmbedding?: number[],
    now: number = Date.now()
  ): ContextItem[] {
    if (candidates.length === 0) {
      return [];
    }

    // 1. RRI 评分
    const scored = candidates.map(item => ({
      item,
      score: this.calculateRRIScore(item, queryEmbedding, now),
    }));

    // 2. 按分数降序排序
    scored.sort((a, b) => b.score - a.score);

    // 3. 去重（基于 embedding 相似度）
    const deduped = this.deduplicate(scored);

    // 4. 取前 maxItems 项
    const selected = deduped.slice(0, this.config.maxItems);

    // 5. Lost-in-the-Middle 重排
    const reordered = this.config.enableReorder
      ? this.reorderForMiddle(selected)
      : selected;

    logger.info(
      `[ContextSelector] Selected ${reordered.length}/${candidates.length} items ` +
      `(avg score: ${(reordered.reduce((s, r) => s + r.score, 0) / reordered.length).toFixed(3)})`
    );

    return reordered.map(r => r.item);
  }

  /**
   * 计算 RRI 综合评分
   *
   * score = w_r * relevance + w_c * recency + w_i * importance
   */
  private calculateRRIScore(
    item: ContextItem,
    queryEmbedding?: number[],
    now: number
  ): number {
    const { relevance, recency, importance } = this.config.weights;

    // 相关性：embedding 余弦相似度
    const relevanceScore = queryEmbedding && item.embedding
      ? cosineSimilarity(queryEmbedding, item.embedding)
      : 0.5; // 默认中等相关性

    // 时效性：时间衰减（对数衰减）
    const ageHours = (now - item.timestamp) / 3600000;
    const recencyScore = 1 / (1 + Math.log1p(ageHours));

    // 重要性：直接使用
    const importanceScore = item.importance;

    const totalScore =
      relevance * relevanceScore +
      recency * recencyScore +
      importance * importanceScore;

    return totalScore;
  }

  /**
   * 去重：移除与前面项过于相似的项
   *
   * 阈值：余弦相似度 > 0.92 视为重复
   */
  private deduplicate(
    scored: Array<{ item: ContextItem; score: number }>
  ): Array<{ item: ContextItem; score: number }> {
    if (!scored[0]?.item.embedding) {
      // 如果没有 embedding，跳过去重
      return scored;
    }

    const result: Array<{ item: ContextItem; score: number }> = [];

    for (const entry of scored) {
      if (!entry.item.embedding) {
        // 没有 embedding 的项直接保留
        result.push(entry);
        continue;
      }

      // 检查是否与已选中的项重复
      const isDuplicate = result.some(selected => {
        if (!selected.item.embedding) return false;

        const similarity = cosineSimilarity(
          entry.item.embedding,
          selected.item.embedding
        );

        return similarity > this.config.dedupThreshold;
      });

      if (!isDuplicate) {
        result.push(entry);
      }
    }

    const duplicatesRemoved = scored.length - result.length;
    if (duplicatesRemoved > 0) {
      logger.info(`[ContextSelector] Removed ${duplicatesRemoved} duplicate items`);
    }

    return result;
  }

  /**
   * Lost-in-the-Middle 重排
   *
   * 将高分项交替放置在首尾位置，低分项放在中间
   * 原因：LLM 对中间位置的信息利用率低（Liu et al., 2024）
   *
   * 示例：输入 [1, 2, 3, 4, 5, 6]（按分数降序）
   *      输出 [1, 3, 5, 6, 4, 2]（1 最重要放首位，2 次重要放末位）
   */
  private reorderForMiddle(
    items: Array<{ item: ContextItem; score: number }>
  ): Array<{ item: ContextItem; score: number }> {
    if (items.length <= 2) {
      return items; // 2 项及以下无需重排
    }

    const n = items.length;
    const result: Array<{ item: ContextItem; score: number }> = new Array(n);

    // 交替填充首尾：偶数索引从前往后，奇数索引从后往前
    let frontIdx = 0;
    let backIdx = n - 1;

    for (let i = 0; i < n; i++) {
      if (i % 2 === 0) {
        // 偶数位置（0, 2, 4...）：放高分项
        result[frontIdx] = items[i];
        frontIdx++;
      } else {
        // 奇数位置（1, 3, 5...）：放低分项（从末尾开始）
        result[backIdx] = items[i];
        backIdx--;
      }
    }

    logger.debug(
      `[ContextSelector] Reordered items for Lost-in-the-Middle: ` +
      `top scores [${items.slice(0, 3).map(s => s.score.toFixed(3)).join(', ')}] → ` +
      `positions [${result.slice(0, 3).map((_, i) => i).join(', ')}]`
    );

    return result;
  }

  /**
   * 更新权重配置
   */
  updateWeights(newWeights: Partial<RRIWeights>): void {
    this.config.weights = { ...this.config.weights, ...newWeights };
    logger.info(
      `[ContextSelector] Updated weights: ` +
      `relevance=${this.config.weights.relevance}, ` +
      `recency=${this.config.weights.recency}, ` +
      `importance=${this.config.weights.importance}`
    );
  }

  /**
   * 获取当前配置
   */
  getConfig(): SelectorConfig {
    return { ...this.config };
  }
}

/**
 * 全局单例
 */
let globalSelector: ContextSelector | null = null;

/**
 * 获取全局上下文选择器
 */
export function getContextSelector(): ContextSelector {
  if (!globalSelector) {
    globalSelector = new ContextSelector();
  }
  return globalSelector;
}

/**
 * 重置全局选择器（用于测试）
 */
export function resetContextSelector(): void {
  globalSelector = null;
}

/**
 * 辅助函数：计算两个文本的相似度（如果都有 embedding）
 */
export function calculateSimilarity(
  item1: ContextItem,
  item2: ContextItem
): number {
  if (!item1.embedding || !item2.embedding) {
    return 0;
  }

  return cosineSimilarity(item1.embedding, item2.embedding);
}
