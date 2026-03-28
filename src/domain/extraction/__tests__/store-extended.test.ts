/**
 * Extended tests for domain/extraction/store.ts
 *
 * Covers uncovered branches:
 * - getAll across multiple categories
 * - search by key and value
 * - getPending filtering
 * - confirm by id (found + not found)
 * - reject by id (found + not found)
 * - getStats (total, byCategory, pending)
 * - store error handling (catch block)
 * - getKnowledgeStore singleton (with/without memoryDir, error)
 * - initKnowledgeStore / resetKnowledgeStore
 * - getCategoryFilePath fallback for unknown category
 * - parseCategoryFile with valid meta JSON
 * - store with equal confidence and older timestamp → skipped
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  KnowledgeStore,
  getKnowledgeStore,
  initKnowledgeStore,
  resetKnowledgeStore,
} from '../store';
import type { ExtractedKnowledge, KnowledgeCategory } from '../types';

const TEST_DIR = '/tmp/test-knowledge-store-ext';

function mk(overrides: Partial<ExtractedKnowledge> = {}): ExtractedKnowledge {
  return {
    id: `id_${Math.random().toString(36).slice(2, 8)}`,
    category: 'personal',
    key: 'default_key',
    value: 'default_value',
    confidence: 0.8,
    source: 'test_session',
    timestamp: new Date(),
    status: 'confirmed',
    ...overrides,
  };
}

describe('KnowledgeStore - extended coverage', () => {
  let store: KnowledgeStore;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    store = new KnowledgeStore(TEST_DIR);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  // ── getAll ───────────────────────────────────────────────────────────
  describe('getAll', () => {
    it('returns empty array when no items exist', () => {
      const all = store.getAll();
      expect(all).toEqual([]);
    });

    it('returns items from all categories', () => {
      store.store([
        mk({ category: 'personal', key: 'name', value: 'Alice' }),
        mk({ category: 'work', key: 'company', value: 'Acme' }),
        mk({ category: 'health', key: 'allergy', value: 'pollen' }),
      ]);

      const all = store.getAll();
      expect(all).toHaveLength(3);
      const keys = all.map(i => i.key).sort();
      expect(keys).toEqual(['allergy', 'company', 'name']);
    });
  });

  // ── getByCategory ────────────────────────────────────────────────────
  describe('getByCategory', () => {
    it('returns items for the specified category', () => {
      store.store([
        mk({ category: 'work', key: 'title', value: 'engineer' }),
        mk({ category: 'personal', key: 'name', value: 'Bob' }),
      ]);

      const work = store.getByCategory('work');
      expect(work).toHaveLength(1);
      expect(work[0].key).toBe('title');
    });

    it('returns empty when category has no items', () => {
      expect(store.getByCategory('finance')).toEqual([]);
    });
  });

  // ── search ───────────────────────────────────────────────────────────
  describe('search', () => {
    beforeEach(() => {
      store.store([
        mk({ category: 'personal', key: 'name', value: '张三' }),
        mk({ category: 'work', key: 'company', value: 'ByteDance' }),
        mk({ category: 'skills', key: 'python', value: '3年经验' }),
      ]);
    });

    it('finds items by key match', () => {
      const results = store.search('name');
      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('name');
    });

    it('finds items by value match', () => {
      const results = store.search('ByteDance');
      expect(results).toHaveLength(1);
      expect(results[0].value).toBe('ByteDance');
    });

    it('is case insensitive', () => {
      const results = store.search('bytedance');
      expect(results).toHaveLength(1);
    });

    it('finds items matching partial text', () => {
      const results = store.search('Byte');
      expect(results).toHaveLength(1);
    });

    it('returns empty when no matches', () => {
      expect(store.search('nonexistent_xyz')).toEqual([]);
    });

    it('matches Chinese characters', () => {
      const results = store.search('张三');
      expect(results).toHaveLength(1);
    });
  });

  // ── getPending ───────────────────────────────────────────────────────
  describe('getPending', () => {
    it('returns only pending items', () => {
      store.store([
        mk({ key: 'confirmed_item', status: 'confirmed' }),
        mk({ key: 'pending_item', status: 'pending' }),
        mk({ key: 'superseded_item', status: 'superseded' }),
      ]);

      const pending = store.getPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].key).toBe('pending_item');
    });

    it('returns empty when no pending items', () => {
      store.store([mk({ status: 'confirmed' })]);
      expect(store.getPending()).toEqual([]);
    });
  });

  // ── confirm ──────────────────────────────────────────────────────────
  describe('confirm', () => {
    it('confirms a pending item by id and persists', () => {
      const item = mk({ key: 'to_confirm', status: 'pending', id: 'confirm_test_id' });
      store.store([item]);

      const result = store.confirm('confirm_test_id');
      expect(result).toBe(true);

      // Verify persisted
      const items = store.readCategory('personal');
      const found = items.find(i => i.id === 'confirm_test_id');
      expect(found).toBeDefined();
      expect(found!.status).toBe('confirmed');
    });

    it('returns false when id not found', () => {
      expect(store.confirm('nonexistent_id')).toBe(false);
    });

    it('iterates through all categories to find the item', () => {
      const item = mk({ category: 'skills', key: 'skill1', status: 'pending', id: 'skill_confirm_id' });
      store.store([item]);

      const result = store.confirm('skill_confirm_id');
      expect(result).toBe(true);
    });
  });

  // ── reject ───────────────────────────────────────────────────────────
  describe('reject', () => {
    it('rejects (deletes) an item by id', () => {
      const item = mk({ key: 'to_reject', id: 'reject_test_id' });
      store.store([item]);

      const result = store.reject('reject_test_id');
      expect(result).toBe(true);

      const items = store.readCategory('personal');
      expect(items.find(i => i.id === 'reject_test_id')).toBeUndefined();
    });

    it('returns false when id not found', () => {
      expect(store.reject('nonexistent_id')).toBe(false);
    });

    it('searches through all categories', () => {
      const item = mk({ category: 'events', key: 'event1', id: 'event_reject_id' });
      store.store([item]);

      expect(store.reject('event_reject_id')).toBe(true);
      expect(store.readCategory('events')).toHaveLength(0);
    });
  });

  // ── getStats ─────────────────────────────────────────────────────────
  describe('getStats', () => {
    it('returns correct stats for empty store', () => {
      const stats = store.getStats();
      expect(stats.total).toBe(0);
      expect(stats.pending).toBe(0);
      expect(stats.byCategory.personal).toBe(0);
    });

    it('returns correct stats with items across categories', () => {
      store.store([
        mk({ category: 'personal', key: 'name', status: 'confirmed' }),
        mk({ category: 'personal', key: 'age', status: 'pending' }),
        mk({ category: 'work', key: 'company', status: 'confirmed' }),
        mk({ category: 'work', key: 'title', status: 'pending' }),
        mk({ category: 'work', key: 'salary', status: 'pending' }),
      ]);

      const stats = store.getStats();
      expect(stats.total).toBe(5);
      expect(stats.byCategory.personal).toBe(2);
      expect(stats.byCategory.work).toBe(3);
      expect(stats.byCategory.finance).toBe(0);
      expect(stats.pending).toBe(3);
    });
  });

  // ── store error handling ─────────────────────────────────────────────
  describe('store - error handling', () => {
    it('pushes error message when writing fails', () => {
      // Make the facts directory read-only to cause write failure
      const factsDir = path.join(TEST_DIR, 'facts');
      const profilePath = path.join(factsDir, 'profile.md');

      // Remove write permission from the file
      fs.chmodSync(profilePath, 0o444);
      fs.chmodSync(factsDir, 0o555);

      const item = mk({ category: 'personal', key: 'test' });
      const result = store.store([item]);

      // Restore permissions for cleanup
      fs.chmodSync(factsDir, 0o755);
      fs.chmodSync(profilePath, 0o644);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Failed to store personal');
    });
  });

  // ── store: skip when same confidence and older timestamp ─────────────
  describe('store - skip/update logic', () => {
    it('skips item when confidence is equal and timestamp is older', () => {
      const now = new Date();
      const earlier = new Date(now.getTime() - 10000);

      store.store([mk({ key: 'k1', confidence: 0.9, timestamp: now })]);
      const result = store.store([mk({ key: 'k1', confidence: 0.8, timestamp: earlier })]);

      expect(result.skipped).toBe(1);
    });

    it('updates item when timestamp is newer even with same confidence', () => {
      const now = new Date();
      const later = new Date(now.getTime() + 10000);

      store.store([mk({ key: 'k2', confidence: 0.8, timestamp: now })]);
      const result = store.store([mk({ key: 'k2', confidence: 0.8, value: 'updated', timestamp: later })]);

      expect(result.updated).toBe(1);
    });
  });

  // ── parseCategoryFile with valid meta ────────────────────────────────
  describe('parseCategoryFile - metadata parsing', () => {
    it('parses valid JSON metadata correctly', () => {
      const filePath = path.join(TEST_DIR, 'facts', 'profile.md');
      const meta = JSON.stringify({
        id: 'meta_id_1',
        confidence: 0.95,
        source: 'session_xyz',
        timestamp: '2024-06-15T10:30:00.000Z',
        status: 'pending',
      });
      const content = `# 个人信息\n\n> 最后更新: 2024-06-15\n\n- **name**: Alice <!-- meta: ${meta} -->\n`;
      fs.writeFileSync(filePath, content, 'utf-8');

      const items = store.readCategory('personal');
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('meta_id_1');
      expect(items[0].confidence).toBe(0.95);
      expect(items[0].source).toBe('session_xyz');
      expect(items[0].status).toBe('pending');
    });

    it('uses defaults when meta JSON parsing fails', () => {
      const filePath = path.join(TEST_DIR, 'facts', 'profile.md');
      const content = `# 个人信息\n\n> 最后更新: 2024-01-01\n\n- **name**: Bob <!-- meta: {not valid json} -->\n`;
      fs.writeFileSync(filePath, content, 'utf-8');

      const items = store.readCategory('personal');
      expect(items).toHaveLength(1);
      expect(items[0].confidence).toBe(0.8); // default
      expect(items[0].source).toBe('unknown'); // default
      expect(items[0].status).toBe('confirmed'); // default
    });

    it('handles entry without metadata comment', () => {
      const filePath = path.join(TEST_DIR, 'facts', 'profile.md');
      const content = `# 个人信息\n\n- **city**: Beijing\n`;
      fs.writeFileSync(filePath, content, 'utf-8');

      const items = store.readCategory('personal');
      expect(items).toHaveLength(1);
      expect(items[0].key).toBe('city');
      expect(items[0].value).toBe('Beijing');
      expect(items[0].id).toContain('personal_city_');
    });

    it('returns empty for non-existent file', () => {
      // Delete the file
      const filePath = path.join(TEST_DIR, 'facts', 'work.md');
      fs.unlinkSync(filePath);

      const items = store.readCategory('work');
      expect(items).toEqual([]);
    });
  });

  // ── delete ───────────────────────────────────────────────────────────
  describe('delete extended', () => {
    it('deletes the correct item when multiple exist', () => {
      store.store([
        mk({ key: 'keep1', value: 'v1' }),
        mk({ key: 'delete_me', value: 'v2' }),
        mk({ key: 'keep2', value: 'v3' }),
      ]);

      const deleted = store.delete('personal', 'delete_me');
      expect(deleted).toBe(true);

      const items = store.readCategory('personal');
      expect(items).toHaveLength(2);
      expect(items.find(i => i.key === 'delete_me')).toBeUndefined();
    });
  });

  // ── update extended ──────────────────────────────────────────────────
  describe('update extended', () => {
    it('updates specific fields while preserving others', () => {
      const original = mk({ key: 'upd_key', value: 'old', confidence: 0.7, id: 'upd_id' });
      store.store([original]);

      const updated = { ...original, value: 'new', confidence: 0.99 };
      expect(store.update(updated)).toBe(true);

      const items = store.readCategory('personal');
      const found = items.find(i => i.key === 'upd_key');
      expect(found!.value).toBe('new');
      expect(found!.confidence).toBe(0.99);
    });
  });
});

// ── singleton functions ────────────────────────────────────────────────
describe('KnowledgeStore singleton', () => {
  const SINGLETON_DIR = '/tmp/test-knowledge-store-singleton';

  beforeEach(() => {
    resetKnowledgeStore();
    if (fs.existsSync(SINGLETON_DIR)) {
      fs.rmSync(SINGLETON_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    resetKnowledgeStore();
    if (fs.existsSync(SINGLETON_DIR)) {
      fs.rmSync(SINGLETON_DIR, { recursive: true });
    }
  });

  it('getKnowledgeStore throws when not initialized and no memoryDir', () => {
    expect(() => getKnowledgeStore()).toThrow('KnowledgeStore not initialized');
  });

  it('getKnowledgeStore creates instance when memoryDir provided', () => {
    const store = getKnowledgeStore(SINGLETON_DIR);
    expect(store).toBeInstanceOf(KnowledgeStore);
  });

  it('getKnowledgeStore returns same instance on subsequent calls', () => {
    const store1 = getKnowledgeStore(SINGLETON_DIR);
    const store2 = getKnowledgeStore();
    expect(store1).toBe(store2);
  });

  it('initKnowledgeStore creates a new instance', () => {
    const store = initKnowledgeStore(SINGLETON_DIR);
    expect(store).toBeInstanceOf(KnowledgeStore);
  });

  it('initKnowledgeStore replaces existing instance', () => {
    const store1 = initKnowledgeStore(SINGLETON_DIR);
    const store2 = initKnowledgeStore(SINGLETON_DIR);
    expect(store1).not.toBe(store2);
  });

  it('resetKnowledgeStore clears the singleton', () => {
    initKnowledgeStore(SINGLETON_DIR);
    resetKnowledgeStore();
    expect(() => getKnowledgeStore()).toThrow('KnowledgeStore not initialized');
  });
});
