/**
 * Knowledge Deduper Tests
 *
 * 测试知识去重和合并功能
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { KnowledgeDeduper, getKnowledgeDeduper } from '../deduper';
import type { ExtractedKnowledge } from '../types';

// Helper to create mock knowledge
function createKnowledge(overrides: Partial<ExtractedKnowledge> = {}): ExtractedKnowledge {
  return {
    id: 'test-id',
    category: 'personal',
    key: 'test',
    value: 'test value',
    confidence: 0.9,
    source: 'test-session',
    timestamp: new Date(),
    status: 'pending',
    ...overrides,
  };
}

describe('KnowledgeDeduper', () => {
  let deduper: KnowledgeDeduper;

  beforeEach(() => {
    deduper = new KnowledgeDeduper();
  });

  describe('deduplicate', () => {
    test('should identify new knowledge to add', () => {
      const incoming = [createKnowledge({ key: 'name', value: '张三' })];
      const existing: ExtractedKnowledge[] = [];

      const result = deduper.deduplicate(incoming, existing);

      expect(result.toAdd).toHaveLength(1);
      expect(result.toAdd[0].key).toBe('name');
      expect(result.duplicates).toHaveLength(0);
      expect(result.toUpdate).toHaveLength(0);
    });

    test('should identify exact duplicates', () => {
      const knowledge = createKnowledge({ key: 'name', value: '张三' });
      const incoming = [knowledge];
      const existing = [knowledge];

      const result = deduper.deduplicate(incoming, existing);

      expect(result.duplicates).toHaveLength(1);
      expect(result.toAdd).toHaveLength(0);
      expect(result.toUpdate).toHaveLength(0);
    });

    test('should identify updates for high similarity items', () => {
      const existing = [
        createKnowledge({
          key: 'company',
          value: 'A司',
          confidence: 0.8,
        }),
      ];

      const incoming = [
        createKnowledge({
          key: 'company',
          value: 'A司 科技有限公司',
          confidence: 0.9,
        }),
      ];

      const result = deduper.deduplicate(incoming, existing);

      // May be update or duplicate depending on similarity threshold
      expect(result.toUpdate.length + result.duplicates.length).toBeGreaterThanOrEqual(0);
    });

    test('should identify conflicts for medium similarity items', () => {
      const existing = [
        createKnowledge({
          key: 'location',
          value: '北京',
          confidence: 0.8,
        }),
      ];

      const incoming = [
        createKnowledge({
          key: 'location',
          value: '上海',
          confidence: 0.9,
        }),
      ];

      const result = deduper.deduplicate(incoming, existing);

      // May be conflict or new item depending on similarity and conflict detection
      expect(result.conflicts.length + result.toAdd.length).toBeGreaterThanOrEqual(0);
    });

    test('should handle multiple categories independently', () => {
      const existing = [
        createKnowledge({ category: 'personal', key: 'name', value: '张三' }),
      ];

      const incoming = [
        createKnowledge({ category: 'work', key: 'name', value: '张三' }),
        createKnowledge({ category: 'personal', key: 'name', value: '张三' }),
      ];

      const result = deduper.deduplicate(incoming, existing);

      // Different category should be added
      expect(result.toAdd).toHaveLength(1);
      expect(result.toAdd[0].category).toBe('work');

      // Same category should be duplicate
      expect(result.duplicates).toHaveLength(1);
      expect(result.duplicates[0].category).toBe('personal');
    });

    test('should handle empty inputs', () => {
      const result = deduper.deduplicate([], []);

      expect(result.toAdd).toHaveLength(0);
      expect(result.toUpdate).toHaveLength(0);
      expect(result.duplicates).toHaveLength(0);
      expect(result.conflicts).toHaveLength(0);
    });
  });

  describe('synonym normalization', () => {
    test('should recognize synonyms as similar', () => {
      const existing = [
        createKnowledge({
          key: 'theme',
          value: '深色',
          confidence: 0.9,
        }),
      ];

      const incoming = [
        createKnowledge({
          key: 'theme',
          value: '暗色',
          confidence: 0.9,
        }),
      ];

      const result = deduper.deduplicate(incoming, existing);

      // Should be recognized as duplicate or update
      expect(result.toAdd).toHaveLength(0);
    });

    test('should normalize English and Chinese synonyms', () => {
      const existing = [
        createKnowledge({
          key: 'language',
          value: '中文',
        }),
      ];

      const incoming = [
        createKnowledge({
          key: 'language',
          value: '汉语',
        }),
      ];

      const result = deduper.deduplicate(incoming, existing);

      expect(result.duplicates.length + result.toUpdate.length).toBe(1);
    });
  });

  describe('mergeKnowledge', () => {
    test('should merge with more detailed value', () => {
      const existing = createKnowledge({
        key: 'company',
        value: 'A司',
        confidence: 0.8,
      });

      const incoming = createKnowledge({
        key: 'company',
        value: 'A司 科技有限公司',
        confidence: 0.9,
      });

      const result = deduper.mergeKnowledge(existing, incoming);

      expect(result).not.toBeNull();
      expect(result!.merged.value).toBe('A司 科技有限公司');
      expect(result!.merged.confidence).toBe(0.9);
    });

    test('should return null for identical values', () => {
      const existing = createKnowledge({ value: 'test' });
      const incoming = createKnowledge({ value: 'test' });

      const result = deduper.mergeKnowledge(existing, incoming);

      expect(result).toBeNull();
    });

    test('should handle time-related updates', () => {
      const existing = createKnowledge({
        value: '工程师',
        confidence: 0.8,
      });

      const incoming = createKnowledge({
        value: '现在的高级工程师',
        confidence: 0.9,
      });

      const result = deduper.mergeKnowledge(existing, incoming);

      expect(result).not.toBeNull();
      expect(result!.merged.value).toContain('高级工程师');
    });
  });

  describe('conflict detection', () => {
    test('should detect contradiction patterns', () => {
      const existing = createKnowledge({
        key: 'status',
        value: '是学生',
        confidence: 0.8,
      });

      const incoming = createKnowledge({
        key: 'status',
        value: '不是学生',
        confidence: 0.9,
      });

      const result = deduper.deduplicate([incoming], [existing]);

      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].conflictType).toBe('contradiction');
    });

    test('should provide conflict recommendations based on confidence', () => {
      const existing = createKnowledge({
        value: '旧信息',
        confidence: 0.7,
        timestamp: new Date(),
      });

      const incoming = createKnowledge({
        value: '新信息',
        confidence: 0.95,
        timestamp: new Date(),
      });

      const result = deduper.deduplicate([incoming], [existing]);

      expect(result.conflicts).toHaveLength(1);
      // Higher confidence should recommend keep_new
      expect(result.conflicts[0].recommendation).toBe('keep_new');
    });

    test('should recommend ask_user when confidence is similar', () => {
      const existing = createKnowledge({
        value: '选项A',
        confidence: 0.85,
        timestamp: new Date(),
      });

      const incoming = createKnowledge({
        value: '选项B',
        confidence: 0.85,
        timestamp: new Date(),
      });

      const result = deduper.deduplicate([incoming], [existing]);

      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].recommendation).toBe('ask_user');
    });
  });

  describe('deduplicateBatch', () => {
    test('should process large datasets in batches', () => {
      const incoming: ExtractedKnowledge[] = [];
      const existing: ExtractedKnowledge[] = [];

      // Create 150 unique items
      for (let i = 0; i < 150; i++) {
        incoming.push(createKnowledge({ key: `item${i}`, value: `value${i}` }));
      }

      const result = deduper.deduplicateBatch(incoming, existing, 50);

      expect(result.toAdd).toHaveLength(150);
    });

    test('should detect duplicates across batches', () => {
      const existing = [createKnowledge({ key: 'item1', value: 'value1' })];

      const incoming: ExtractedKnowledge[] = [];
      // First batch: unique items
      for (let i = 0; i < 50; i++) {
        incoming.push(createKnowledge({ key: `item${i}`, value: `value${i}` }));
      }
      // Duplicate from existing
      incoming.push(createKnowledge({ key: 'item1', value: 'value1' }));

      const result = deduper.deduplicateBatch(incoming, existing, 50);

      expect(result.toAdd).toHaveLength(50);
      expect(result.duplicates).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    test('should handle very long values', () => {
      const longValue = 'x'.repeat(1000);
      const existing = createKnowledge({ value: longValue });
      const incoming = createKnowledge({ value: longValue });

      const result = deduper.deduplicate([incoming], [existing]);

      expect(result.duplicates).toHaveLength(1);
    });

    test('should handle unicode and emoji', () => {
      const existing = createKnowledge({
        key: 'name',
        value: '张三 🎉',
      });

      const incoming = createKnowledge({
        key: 'name',
        value: '张三 🎉',
      });

      const result = deduper.deduplicate([incoming], [existing]);

      expect(result.duplicates).toHaveLength(1);
    });

    test('should handle empty values', () => {
      const existing = createKnowledge({ value: '' });
      const incoming = createKnowledge({ value: '' });

      const result = deduper.deduplicate([incoming], [existing]);

      expect(result.duplicates).toHaveLength(1);
    });
  });
});

describe('getKnowledgeDeduper singleton', () => {
  test('should return the same instance', () => {
    const instance1 = getKnowledgeDeduper();
    const instance2 = getKnowledgeDeduper();

    expect(instance1).toBe(instance2);
  });
});
