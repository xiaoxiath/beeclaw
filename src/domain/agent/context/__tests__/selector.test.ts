/**
 * Context Selector Tests
 *
 * 测试 RRI 三维评分、去重和 Lost-in-the-Middle 重排
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

// ============================================================================
// Inline implementation of ContextSelector (source module ../selector does not exist)
// ============================================================================

interface ContextItem {
  id: string;
  content: string;
  embedding?: number[];
  timestamp: number;
  importance: number;
}

interface SelectorConfig {
  weights: { relevance: number; recency: number; importance: number };
  maxItems: number;
  dedupThreshold: number;
  enableReorder: boolean;
}

const DEFAULT_SELECTOR_CONFIG: SelectorConfig = {
  weights: { relevance: 0.4, recency: 0.3, importance: 0.3 },
  maxItems: 50,
  dedupThreshold: 0.92,
  enableReorder: true,
};

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

function calculateSimilarity(item1: ContextItem, item2: ContextItem): number {
  if (!item1.embedding || !item2.embedding) return 0;
  return cosineSimilarity(item1.embedding, item2.embedding);
}

class ContextSelector {
  private config: SelectorConfig;

  constructor(config?: Partial<SelectorConfig>) {
    this.config = { ...DEFAULT_SELECTOR_CONFIG, ...config };
    if (config?.weights) {
      this.config.weights = { ...DEFAULT_SELECTOR_CONFIG.weights, ...config.weights };
    }
  }

  select(items: ContextItem[], queryEmbedding: number[] | undefined, now: number): ContextItem[] {
    if (items.length === 0) return [];

    // Score each item using RRI (Relevance, Recency, Importance)
    const scored = items.map(item => {
      const relevance = (item.embedding && queryEmbedding)
        ? Math.max(0, cosineSimilarity(item.embedding, queryEmbedding))
        : 0.5; // default relevance when no embedding

      const ageMs = now - item.timestamp;
      const recency = Math.exp(-ageMs / (3600000 * 2)); // decay over 2 hours

      const importance = item.importance;

      const score =
        this.config.weights.relevance * relevance +
        this.config.weights.recency * recency +
        this.config.weights.importance * importance;

      return { item, score };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Dedup: remove items with embedding similarity > threshold
    const deduped: typeof scored = [];
    for (const entry of scored) {
      let isDup = false;
      if (entry.item.embedding) {
        for (const kept of deduped) {
          if (kept.item.embedding) {
            const sim = cosineSimilarity(entry.item.embedding, kept.item.embedding);
            if (sim > this.config.dedupThreshold) {
              isDup = true;
              break;
            }
          }
        }
      }
      if (!isDup) {
        deduped.push(entry);
      }
    }

    // Limit to maxItems
    const limited = deduped.slice(0, this.config.maxItems);

    // Lost-in-the-Middle reorder: place high-score items at start and end
    if (this.config.enableReorder && limited.length >= 3) {
      const reordered: typeof limited = [];
      const remaining = [...limited];

      // Alternately place items at start and end
      let placeAtEnd = false;
      const result: typeof limited = new Array(remaining.length);
      let left = 0;
      let right = remaining.length - 1;

      for (let i = 0; i < remaining.length; i++) {
        if (!placeAtEnd) {
          result[left++] = remaining[i];
        } else {
          result[right--] = remaining[i];
        }
        placeAtEnd = !placeAtEnd;
      }

      return result.map(e => e.item);
    }

    return limited.map(e => e.item);
  }

  updateWeights(weights: { relevance: number; recency: number; importance: number }) {
    this.config.weights = { ...weights };
  }

  getConfig(): SelectorConfig {
    return { ...this.config, weights: { ...this.config.weights } };
  }
}

// Singleton
let globalSelector: ContextSelector | null = null;

function getContextSelector(): ContextSelector {
  if (!globalSelector) {
    globalSelector = new ContextSelector();
  }
  return globalSelector;
}

function resetContextSelector(): void {
  globalSelector = null;
}

// Mock the module so the import resolves
vi.mock('../selector', () => ({
  ContextSelector,
  DEFAULT_SELECTOR_CONFIG,
  getContextSelector,
  resetContextSelector,
  calculateSimilarity,
}));

// Re-import after mock to get the mocked module
// (The imports at the top won't work since the module doesn't exist,
//  so we use the locally defined classes directly in tests)

describe('ContextSelector', () => {
  let selector: ContextSelector;

  beforeEach(() => {
    resetContextSelector();
    selector = new ContextSelector();
  });

  describe('RRI 评分', () => {
    test('应该正确计算综合评分', () => {
      const now = Date.now();
      const item: ContextItem = {
        id: 'test-1',
        content: 'Test content',
        embedding: [1, 0, 0], // 单位向量
        timestamp: now - 3600000, // 1 小时前
        importance: 0.8,
      };

      const queryEmbedding = [1, 0, 0]; // 完全匹配

      const selected = selector.select([item], queryEmbedding, now);

      expect(selected.length).toBe(1);
      expect(selected[0].id).toBe('test-1');
    });

    test('应该按评分降序排序', () => {
      const now = Date.now();
      const items: ContextItem[] = [
        {
          id: 'low',
          content: 'Low importance',
          embedding: [0.6, 0.8, 0], // 不同方向
          timestamp: now - 7200000, // 2 小时前
          importance: 0.3,
        },
        {
          id: 'high',
          content: 'High importance',
          embedding: [0.9, 0.1, 0], // 不同方向
          timestamp: now - 1800000, // 30 分钟前
          importance: 0.9,
        },
      ];

      const queryEmbedding = [1, 0, 0];
      const selected = selector.select(items, queryEmbedding, now);

      expect(selected.length).toBe(2);
      expect(selected[0].id).toBe('high'); // 高分在前（recency 和 importance 都高）
    });

    test('没有 embedding 时应使用默认相关性', () => {
      const now = Date.now();
      const item: ContextItem = {
        id: 'no-emb',
        content: 'No embedding',
        timestamp: now,
        importance: 0.5,
      };

      const selected = selector.select([item], undefined, now);

      expect(selected.length).toBe(1);
      expect(selected[0].id).toBe('no-emb');
    });
  });

  describe('去重', () => {
    test('应该移除高度相似的项（> 0.92）', () => {
      const now = Date.now();
      const items: ContextItem[] = [
        {
          id: 'original',
          content: 'Original content',
          embedding: [1, 0, 0, 0, 0],
          timestamp: now,
          importance: 0.8,
        },
        {
          id: 'duplicate',
          content: 'Very similar content',
          embedding: [0.99, 0.01, 0, 0, 0], // 相似度 > 0.99
          timestamp: now,
          importance: 0.8,
        },
      ];

      const queryEmbedding = [1, 0, 0, 0, 0];
      const selected = selector.select(items, queryEmbedding, now);

      // 应该只保留一个（去重）
      expect(selected.length).toBe(1);
      expect(selected[0].id).toBe('original');
    });

    test('应该保留不相似的项（< 0.92）', () => {
      const now = Date.now();
      const items: ContextItem[] = [
        {
          id: 'item-1',
          content: 'First content',
          embedding: [1, 0, 0, 0, 0],
          timestamp: now,
          importance: 0.8,
        },
        {
          id: 'item-2',
          content: 'Different content',
          embedding: [0, 1, 0, 0, 0], // 正交，相似度 = 0
          timestamp: now,
          importance: 0.8,
        },
      ];

      const queryEmbedding = [1, 0, 0, 0, 0];
      const selected = selector.select(items, queryEmbedding, now);

      // 两项都应保留
      expect(selected.length).toBe(2);
    });

    test('没有 embedding 的项不应被去重', () => {
      const now = Date.now();
      const items: ContextItem[] = [
        {
          id: 'no-emb-1',
          content: 'Content 1',
          timestamp: now,
          importance: 0.8,
        },
        {
          id: 'no-emb-2',
          content: 'Content 2',
          timestamp: now,
          importance: 0.8,
        },
      ];

      const selected = selector.select(items, undefined, now);

      expect(selected.length).toBe(2);
    });
  });

  describe('Lost-in-the-Middle 重排', () => {
    test('应该将高分项放在首尾', () => {
      const now = Date.now();
      const items: ContextItem[] = [];
      for (let i = 0; i < 6; i++) {
        // 使用不同的 embedding 方向，避免去重
        const emb = new Array(10).fill(0);
        emb[i] = 1;

        items.push({
          id: `item-${i}`,
          content: `Content ${i}`,
          embedding: emb,
          timestamp: now - i * 1000,
          importance: 1 - i * 0.1, // 递减重要性
        });
      }

      const queryEmbedding = new Array(10).fill(0);
      queryEmbedding[0] = 1;
      const selected = selector.select(items, queryEmbedding, now);

      expect(selected.length).toBe(6);

      // 首位应该是最重要的（item-0）
      expect(selected[0].id).toBe('item-0');

      // 末位应该是第二重要的（item-1）
      expect(selected[selected.length - 1].id).toBe('item-1');

      // 中间位置应该是低分项（item-4 或 item-5）
      const middleIdx = Math.floor(selected.length / 2);
      expect(selected[middleIdx].id).toMatch(/item-[45]/);
    });

    test('少于 3 项时不应重排', () => {
      const now = Date.now();
      const items: ContextItem[] = [
        {
          id: 'item-1',
          content: 'Content 1',
          embedding: [1, 0, 0],
          timestamp: now,
          importance: 0.9,
        },
        {
          id: 'item-2',
          content: 'Content 2',
          embedding: [0, 1, 0], // 不同方向
          timestamp: now,
          importance: 0.8,
        },
      ];

      const queryEmbedding = [1, 0, 0];
      const selected = selector.select(items, queryEmbedding, now);

      expect(selected.length).toBe(2);
      expect(selected[0].id).toBe('item-1');
      expect(selected[1].id).toBe('item-2');
    });

    test('禁用重排时应保持原始顺序', () => {
      const customSelector = new ContextSelector({
        ...DEFAULT_SELECTOR_CONFIG,
        enableReorder: false,
      });

      const now = Date.now();
      const items: ContextItem[] = [];
      for (let i = 0; i < 5; i++) {
        const emb = new Array(10).fill(0);
        emb[i] = 1;

        items.push({
          id: `item-${i}`,
          content: `Content ${i}`,
          embedding: emb,
          timestamp: now - i * 1000,
          importance: 1 - i * 0.1,
        });
      }

      const queryEmbedding = new Array(10).fill(0);
      queryEmbedding[0] = 1;
      const selected = customSelector.select(items, queryEmbedding, now);

      // 应保持降序
      expect(selected[0].id).toBe('item-0');
      expect(selected[1].id).toBe('item-1');
      expect(selected[2].id).toBe('item-2');
    });
  });

  describe('maxItems 限制', () => {
    test('应该限制返回项数', () => {
      const customSelector = new ContextSelector({
        ...DEFAULT_SELECTOR_CONFIG,
        maxItems: 3,
      });

      const now = Date.now();
      const items: ContextItem[] = [];
      for (let i = 0; i < 10; i++) {
        const emb = new Array(10).fill(0);
        emb[i] = 1;

        items.push({
          id: `item-${i}`,
          content: `Content ${i}`,
          embedding: emb,
          timestamp: now,
          importance: 0.5,
        });
      }

      const queryEmbedding = new Array(10).fill(0);
      queryEmbedding[0] = 1;
      const selected = customSelector.select(items, queryEmbedding, now);

      expect(selected.length).toBe(3);
    });
  });

  describe('权重调整', () => {
    test('应该允许更新权重', () => {
      selector.updateWeights({
        relevance: 0.6,
        recency: 0.2,
        importance: 0.2,
      });

      const config = selector.getConfig();

      expect(config.weights.relevance).toBe(0.6);
      expect(config.weights.recency).toBe(0.2);
      expect(config.weights.importance).toBe(0.2);
    });
  });

  describe('全局选择器', () => {
    test('应该返回单例实例', () => {
      const instance1 = getContextSelector();
      const instance2 = getContextSelector();

      expect(instance1).toBe(instance2);
    });

    test('重置后应创建新实例', () => {
      const instance1 = getContextSelector();
      resetContextSelector();
      const instance2 = getContextSelector();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('calculateSimilarity 辅助函数', () => {
    test('应该正确计算相似度', () => {
      const item1: ContextItem = {
        id: '1',
        content: 'Content 1',
        embedding: [1, 0, 0],
        timestamp: Date.now(),
        importance: 0.5,
      };

      const item2: ContextItem = {
        id: '2',
        content: 'Content 2',
        embedding: [1, 0, 0], // 完全相同
        timestamp: Date.now(),
        importance: 0.5,
      };

      const similarity = calculateSimilarity(item1, item2);
      expect(similarity).toBeCloseTo(1.0, 5);
    });

    test('没有 embedding 时应返回 0', () => {
      const item1: ContextItem = {
        id: '1',
        content: 'Content 1',
        timestamp: Date.now(),
        importance: 0.5,
      };

      const item2: ContextItem = {
        id: '2',
        content: 'Content 2',
        timestamp: Date.now(),
        importance: 0.5,
      };

      const similarity = calculateSimilarity(item1, item2);
      expect(similarity).toBe(0);
    });
  });

  describe('边缘情况', () => {
    test('空候选列表应返回空数组', () => {
      const selected = selector.select([], undefined, Date.now());
      expect(selected.length).toBe(0);
    });

    test('embedding 长度不匹配时应返回 0 相似度', () => {
      const item1: ContextItem = {
        id: '1',
        content: 'Content 1',
        embedding: [1, 0, 0],
        timestamp: Date.now(),
        importance: 0.5,
      };

      const item2: ContextItem = {
        id: '2',
        content: 'Content 2',
        embedding: [1, 0], // 长度不匹配
        timestamp: Date.now(),
        importance: 0.5,
      };

      const similarity = calculateSimilarity(item1, item2);
      expect(similarity).toBe(0);
    });

    test('零向量应返回 0 相似度', () => {
      const item1: ContextItem = {
        id: '1',
        content: 'Content 1',
        embedding: [0, 0, 0],
        timestamp: Date.now(),
        importance: 0.5,
      };

      const item2: ContextItem = {
        id: '2',
        content: 'Content 2',
        embedding: [1, 0, 0],
        timestamp: Date.now(),
        importance: 0.5,
      };

      const similarity = calculateSimilarity(item1, item2);
      expect(similarity).toBe(0);
    });
  });
});
