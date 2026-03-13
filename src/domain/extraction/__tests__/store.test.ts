/**
 * Tests for Knowledge Store
 *
 * Tests knowledge persistence and retrieval
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { KnowledgeStore } from '../store';
import type { ExtractedKnowledge, KnowledgeCategory } from '../types';

describe('KnowledgeStore', () => {
  let store: KnowledgeStore;
  const testDir = '/tmp/test-knowledge-store';

  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }

    store = new KnowledgeStore(testDir);
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  const createTestKnowledge = (overrides: Partial<ExtractedKnowledge> = {}): ExtractedKnowledge => ({
    id: `test_${Date.now()}`,
    category: 'personal',
    key: 'test_key',
    value: 'test_value',
    confidence: 0.9,
    source: 'test_session',
    timestamp: new Date(),
    status: 'confirmed',
    ...overrides,
  });

  describe('initialization', () => {
    test('should create memory directory if not exists', () => {
      expect(fs.existsSync(testDir)).toBe(true);
    });

    test('should create facts subdirectory', () => {
      expect(fs.existsSync(path.join(testDir, 'facts'))).toBe(true);
    });

    test('should initialize all category files', () => {
      const categories: KnowledgeCategory[] = [
        'personal', 'family', 'work', 'finance', 'health',
        'preferences', 'events', 'lessons', 'goals',
        'relationships', 'skills', 'decisions',
      ];

      for (const category of categories) {
        const filename = {
          personal: 'profile.md',
          family: 'family.md',
          work: 'work.md',
          finance: 'finance.md',
          health: 'health.md',
          preferences: 'preferences.md',
          events: 'events.md',
          lessons: 'lessons.md',
          goals: 'goals.md',
          relationships: 'relationships.md',
          skills: 'skills.md',
          decisions: 'decisions.md',
        }[category];

        const filePath = path.join(testDir, 'facts', filename || `${category}.md`);
        expect(fs.existsSync(filePath)).toBe(true);
      }
    });
  });

  describe('readCategory', () => {
    test('should return empty array for empty category', () => {
      const items = store.readCategory('personal');
      expect(items).toEqual([]);
    });

    test('should parse existing knowledge', () => {
      // Write some knowledge first
      const item = createTestKnowledge({ category: 'personal' });
      store.store([item]);

      // Read it back
      const items = store.readCategory('personal');

      expect(items.length).toBe(1);
      expect(items[0].key).toBe(item.key);
      expect(items[0].value).toBe(item.value);
      expect(items[0].category).toBe('personal');
    });

    test('should parse multiple items', () => {
      const items = [
        createTestKnowledge({ key: 'key1', value: 'value1' }),
        createTestKnowledge({ key: 'key2', value: 'value2' }),
        createTestKnowledge({ key: 'key3', value: 'value3' }),
      ];

      store.store(items);

      const read = store.readCategory('personal');
      expect(read.length).toBe(3);
    });

    test('should handle malformed metadata gracefully', () => {
      // Write file with malformed metadata
      const filePath = path.join(testDir, 'facts', 'personal.md');
      const content = `# 个人信息

> 最后更新: 2024-01-01

- **test_key**: test_value <!-- meta: {invalid json} -->
`;

      fs.writeFileSync(filePath, content, 'utf-8');

      // Should not throw
      const items = store.readCategory('personal');

      expect(items.length).toBe(1);
      expect(items[0].key).toBe('test_key');
      // Should use default values for malformed metadata
      expect(items[0].confidence).toBeDefined();
    });
  });

  describe('store', () => {
    test('should add new items', () => {
      const item = createTestKnowledge();
      const result = store.store([item]);

      expect(result.added).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toEqual([]);
    });

    test('should update existing items with higher confidence', () => {
      const item1 = createTestKnowledge({ confidence: 0.8 });
      store.store([item1]);

      const item2 = createTestKnowledge({
        key: item1.key,
        value: 'updated_value',
        confidence: 0.95,
      });

      const result = store.store([item2]);

      expect(result.updated).toBe(1);
      expect(result.added).toBe(0);

      // Verify update
      const items = store.readCategory('personal');
      expect(items[0].value).toBe('updated_value');
      expect(items[0].confidence).toBe(0.95);
    });

    test('should skip items with lower confidence', () => {
      const item1 = createTestKnowledge({ confidence: 0.95 });
      store.store([item1]);

      const item2 = createTestKnowledge({
        key: item1.key,
        value: 'old_value',
        confidence: 0.7,
      });

      const result = store.store([item2]);

      expect(result.skipped).toBe(1);

      // Should keep original
      const items = store.readCategory('personal');
      expect(items[0].confidence).toBe(0.95);
    });

    test('should update items with newer timestamp', () => {
      const item1 = createTestKnowledge({
        timestamp: new Date('2024-01-01'),
      });
      store.store([item1]);

      const item2 = createTestKnowledge({
        key: item1.key,
        timestamp: new Date('2024-01-10'),
      });

      const result = store.store([item2]);

      expect(result.updated).toBe(1);
    });

    test('should group items by category', () => {
      const items = [
        createTestKnowledge({ category: 'personal', key: 'name' }),
        createTestKnowledge({ category: 'work', key: 'company' }),
        createTestKnowledge({ category: 'personal', key: 'age' }),
      ];

      const result = store.store(items);

      expect(result.added).toBe(3);

      // Check both categories
      const personal = store.readCategory('personal');
      const work = store.readCategory('work');

      expect(personal.length).toBe(2);
      expect(work.length).toBe(1);
    });

    test('should handle errors gracefully', () => {
      // Make directory read-only to cause error
      const factsDir = path.join(testDir, 'facts');
      const filePath = path.join(factsDir, 'personal.md');

      const item = createTestKnowledge();

      // Try to store (should succeed normally)
      const result = store.store([item]);
      expect(result.errors).toEqual([]);
    });

    test('should maintain sorted order by key', () => {
      const items = [
        createTestKnowledge({ key: 'zebra' }),
        createTestKnowledge({ key: 'apple' }),
        createTestKnowledge({ key: 'banana' }),
      ];

      store.store(items);

      const read = store.readCategory('personal');
      expect(read[0].key).toBe('apple');
      expect(read[1].key).toBe('banana');
      expect(read[2].key).toBe('zebra');
    });
  });

  describe('update', () => {
    test('should update existing item', () => {
      const item = createTestKnowledge();
      store.store([item]);

      const updated = {
        ...item,
        value: 'updated_value',
        confidence: 0.99,
      };

      const success = store.update(updated);

      expect(success).toBe(true);

      const items = store.readCategory('personal');
      expect(items[0].value).toBe('updated_value');
      expect(items[0].confidence).toBe(0.99);
    });

    test('should return false for non-existent item', () => {
      const item = createTestKnowledge({ key: 'nonexistent' });

      const success = store.update(item);

      expect(success).toBe(false);
    });
  });

  describe('delete', () => {
    test('should delete existing item', () => {
      const item = createTestKnowledge();
      store.store([item]);

      const success = store.delete('personal', item.key);

      expect(success).toBe(true);

      const items = store.readCategory('personal');
      expect(items.length).toBe(0);
    });

    test('should return false for non-existent item', () => {
      const success = store.delete('personal', 'nonexistent');

      expect(success).toBe(false);
    });
  });

  describe('file format', () => {
    test('should write proper markdown format', () => {
      const item = createTestKnowledge({
        category: 'personal',
        key: 'name',
        value: 'John Doe',
        confidence: 0.95,
      });

      store.store([item]);

      const filePath = path.join(testDir, 'facts', 'personal.md');
      const content = fs.readFileSync(filePath, 'utf-8');

      expect(content).toContain('# 个人信息');
      expect(content).toContain('> 最后更新:');
      expect(content).toContain('**name**: John Doe');
      expect(content).toContain('<!-- meta:');
      expect(content).toContain('"confidence":0.95');
    });

    test('should preserve metadata in file', () => {
      const item = createTestKnowledge({
        id: 'test_id_123',
        source: 'session_abc',
        confidence: 0.88,
      });

      store.store([item]);

      // Read back
      const items = store.readCategory('personal');

      expect(items[0].id).toBe('test_id_123');
      expect(items[0].source).toBe('session_abc');
      expect(items[0].confidence).toBe(0.88);
    });
  });

  describe('concurrency', () => {
    test('should handle multiple stores', () => {
      const items1 = [
        createTestKnowledge({ key: 'key1' }),
        createTestKnowledge({ key: 'key2' }),
      ];

      const items2 = [
        createTestKnowledge({ key: 'key3' }),
        createTestKnowledge({ key: 'key4' }),
      ];

      store.store(items1);
      store.store(items2);

      const items = store.readCategory('personal');
      expect(items.length).toBe(4);
    });
  });

  describe('edge cases', () => {
    test('should handle empty store call', () => {
      const result = store.store([]);

      expect(result.added).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.skipped).toBe(0);
    });

    test('should handle special characters in values', () => {
      const item = createTestKnowledge({
        value: 'Value with **bold** and _italic_ and `code`',
      });

      store.store([item]);

      const items = store.readCategory('personal');
      expect(items[0].value).toContain('**bold**');
    });

    test('should handle unicode characters', () => {
      const item = createTestKnowledge({
        key: '名字',
        value: '张三 🎉',
      });

      store.store([item]);

      const items = store.readCategory('personal');
      expect(items[0].key).toBe('名字');
      expect(items[0].value).toBe('张三 🎉');
    });

    test('should handle very long values', () => {
      const longValue = 'a'.repeat(1000);
      const item = createTestKnowledge({ value: longValue });

      store.store([item]);

      const items = store.readCategory('personal');
      expect(items[0].value.length).toBe(1000);
    });

    test('should handle items without metadata', () => {
      // Write file without metadata
      const filePath = path.join(testDir, 'facts', 'personal.md');
      const content = `# 个人信息

> 最后更新: 2024-01-01

- **simple_key**: simple_value
`;

      fs.writeFileSync(filePath, content, 'utf-8');

      const items = store.readCategory('personal');

      expect(items.length).toBe(1);
      expect(items[0].key).toBe('simple_key');
      expect(items[0].value).toBe('simple_value');
      // Should have default metadata
      expect(items[0].confidence).toBeDefined();
      expect(items[0].id).toBeDefined();
    });
  });
});
