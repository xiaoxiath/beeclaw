/**
 * Tests for memory/tools.ts
 *
 * Mocks memory store, compression engine, scoring, and fs to test
 * all 11 tool definitions and execution.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---- Mocks ----

const mockMemoryStore = {
  ls: vi.fn(() => ({ success: true, data: ['file1.md', 'file2.md'] })),
  grep: vi.fn(() => ({ success: true, data: [{ file: 'facts/user.md', line: 'match' }] })),
  read: vi.fn(() => ({ success: true, data: 'file content' })),
  write: vi.fn(() => Promise.resolve({ success: true, data: 'written' })),
  record: vi.fn(() => Promise.resolve({ success: true, data: 'recorded' })),
  getBasePath: vi.fn(() => '/tmp/test-memory'),
  rebuildIndex: vi.fn(() => ({ success: true, data: 'Index rebuilt' })),
  getIndexStats: vi.fn(() => ({ factsKeywords: 100, knowledgeKeywords: 50 })),
  searchByKeyword: vi.fn(() => ({ success: true, data: [] })),
};

const mockCompressionEngine = {
  getStats: vi.fn(() => ({ totalFiles: 10, compressedFiles: 3 })),
};

const mockScoreImportance = vi.fn(() => ({ score: 0.8, recommendation: 'keep' }));

vi.mock('../store', () => ({
  getMemoryStore: () => mockMemoryStore,
}));

vi.mock('../compression', () => ({
  getCompressionEngine: () => mockCompressionEngine,
}));

vi.mock('../scoring', () => ({
  scoreImportance: mockScoreImportance,
}));

vi.mock('fs', () => ({
  existsSync: vi.fn((path: string) => path.includes('existing')),
  writeFileSync: vi.fn(() => {}),
}));

import {
  memoryTools,
  executeMemoryTool,
  getMemoryToolsForAI,
  getAllMemoryTools,
  MEMORY_TOOL_NAMES,
  MemoryLsSchema,
  MemoryGrepSchema,
  MemoryReadSchema,
  MemoryWriteSchema,
  MemoryRecordSchema,
} from '../tools';

describe('memory/tools', () => {
  beforeEach(() => {
    mockMemoryStore.ls.mockClear();
    mockMemoryStore.grep.mockClear();
    mockMemoryStore.read.mockClear();
    mockMemoryStore.write.mockClear();
    mockMemoryStore.record.mockClear();
    mockMemoryStore.rebuildIndex.mockClear();
    mockMemoryStore.searchByKeyword.mockClear();
    mockScoreImportance.mockClear();
  });

  describe('tool definitions', () => {
    it('should define 11 tools', () => {
      expect(MEMORY_TOOL_NAMES).toHaveLength(11);
    });

    it('should include expected tool names', () => {
      const expected = [
        'memory_ls', 'memory_grep', 'memory_read', 'memory_write',
        'memory_record', 'memory_compress', 'memory_score', 'memory_dedupe',
        'memory_knowledge_create', 'memory_index', 'memory_search',
      ];
      for (const name of expected) {
        expect(MEMORY_TOOL_NAMES).toContain(name);
      }
    });

    it('getMemoryToolsForAI should return all tools', () => {
      const tools = getMemoryToolsForAI();
      expect(tools).toHaveLength(11);
    });

    it('getAllMemoryTools should be an alias', () => {
      expect(getAllMemoryTools()).toEqual(getMemoryToolsForAI());
    });
  });

  describe('Zod schemas', () => {
    it('MemoryLsSchema should require path', () => {
      expect(MemoryLsSchema.safeParse({}).success).toBe(false);
      expect(MemoryLsSchema.safeParse({ path: 'facts' }).success).toBe(true);
    });

    it('MemoryGrepSchema should require query', () => {
      expect(MemoryGrepSchema.safeParse({}).success).toBe(false);
      expect(MemoryGrepSchema.safeParse({ query: 'search' }).success).toBe(true);
      expect(MemoryGrepSchema.safeParse({ query: 'search', path: 'facts' }).success).toBe(true);
    });

    it('MemoryReadSchema should require file', () => {
      expect(MemoryReadSchema.safeParse({}).success).toBe(false);
      expect(MemoryReadSchema.safeParse({ file: 'facts/user.md' }).success).toBe(true);
    });

    it('MemoryWriteSchema should require file and content', () => {
      expect(MemoryWriteSchema.safeParse({}).success).toBe(false);
      expect(MemoryWriteSchema.safeParse({ file: 'f.md', content: 'data' }).success).toBe(true);
    });

    it('MemoryRecordSchema should require category and fact', () => {
      expect(MemoryRecordSchema.safeParse({}).success).toBe(false);
      expect(MemoryRecordSchema.safeParse({ category: 'user', fact: 'likes dark mode' }).success).toBe(true);
      expect(MemoryRecordSchema.safeParse({ category: 'invalid', fact: 'test' }).success).toBe(false);
    });
  });

  describe('executeMemoryTool', () => {
    it('memory_ls should call store.ls', async () => {
      const result = await executeMemoryTool('memory_ls', { path: 'facts' });
      expect(result.success).toBe(true);
      expect(mockMemoryStore.ls).toHaveBeenCalledWith('facts');
    });

    it('memory_ls should fail with missing path', async () => {
      const result = await executeMemoryTool('memory_ls', {});
      expect(result.success).toBe(false);
    });

    it('memory_grep should call store.grep', async () => {
      const result = await executeMemoryTool('memory_grep', { query: 'test' });
      expect(result.success).toBe(true);
      expect(mockMemoryStore.grep).toHaveBeenCalled();
    });

    it('memory_read should call store.read', async () => {
      const result = await executeMemoryTool('memory_read', { file: 'facts/user.md' });
      expect(result.success).toBe(true);
      expect(mockMemoryStore.read).toHaveBeenCalledWith('facts/user.md');
    });

    it('memory_write should call store.write', async () => {
      const result = await executeMemoryTool('memory_write', {
        file: 'facts/test.md',
        content: 'new content',
        mode: 'append',
      });
      expect(result.success).toBe(true);
      expect(mockMemoryStore.write).toHaveBeenCalled();
    });

    it('memory_record should call store.record', async () => {
      const result = await executeMemoryTool('memory_record', {
        category: 'user',
        fact: 'likes TypeScript',
      });
      expect(result.success).toBe(true);
      expect(mockMemoryStore.record).toHaveBeenCalledWith('user', 'likes TypeScript');
    });

    it('memory_compress should return stats', async () => {
      const result = await executeMemoryTool('memory_compress', {});
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('stats');
    });

    it('memory_score should score content', async () => {
      const result = await executeMemoryTool('memory_score', {
        content: 'important fact',
        timestamp: '2026-01-01T00:00:00Z',
      });
      expect(result.success).toBe(true);
      expect(mockScoreImportance).toHaveBeenCalled();
    });

    it('memory_dedupe should return analysis', async () => {
      const result = await executeMemoryTool('memory_dedupe', { threshold: 0.8 });
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('threshold');
    });

    it('memory_index should rebuild index', async () => {
      mockMemoryStore.rebuildIndex.mockReturnValue({ success: true, data: 'Index rebuilt' });
      const result = await executeMemoryTool('memory_index', {});
      expect(result.success).toBe(true);
      expect(mockMemoryStore.rebuildIndex).toHaveBeenCalled();
    });

    it('memory_search should call searchByKeyword', async () => {
      const result = await executeMemoryTool('memory_search', { query: 'test' });
      expect(result.success).toBe(true);
      expect(mockMemoryStore.searchByKeyword).toHaveBeenCalled();
    });

    it('should return error for unknown tool', async () => {
      const result = await executeMemoryTool('memory_nonexistent', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown tool');
    });
  });
});
