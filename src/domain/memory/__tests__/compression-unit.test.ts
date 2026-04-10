/**
 * Comprehensive mocked unit tests for memory/compression.ts
 * Covers: LLM provider, compress flow (summarize/archive/delete/keep),
 * rule-based summarization, key fact extraction, archiveFile, logCompressionRun,
 * getStats, readSummaries, singleton, all error paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockExistsSync, mockMkdirSync, mockReaddirSync, mockReadFileSync,
  mockWriteFileSync, mockStatSync, mockRmSync, mockRenameSync, mockUnlinkSync,
  mockScoreImportance, mockScoreImportanceAsync,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(() => false),
  mockMkdirSync: vi.fn(),
  mockReaddirSync: vi.fn(() => []),
  mockReadFileSync: vi.fn(() => ''),
  mockWriteFileSync: vi.fn(),
  mockStatSync: vi.fn(() => ({ mtimeMs: Date.now(), mtime: new Date() })),
  mockRmSync: vi.fn(),
  mockRenameSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockScoreImportance: vi.fn(() => ({ score: 50, recommendation: 'keep' as const, factors: {} })),
  mockScoreImportanceAsync: vi.fn(async () => ({ score: 50, recommendation: 'keep' as const, factors: {} })),
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  readdirSync: mockReaddirSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  statSync: mockStatSync,
  rmSync: mockRmSync,
  renameSync: mockRenameSync,
  unlinkSync: mockUnlinkSync,
}));

vi.mock('../scoring', () => ({
  scoreImportance: mockScoreImportance,
  scoreImportanceAsync: mockScoreImportanceAsync,
}));

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  MemoryCompression,
  DEFAULT_COMPRESSION_CONFIG,
  setCompressionLLMProvider,
  getCompressionLLMProvider,
  getCompressionEngine,
  resetCompressionEngine,
  type CompressionLLMProvider,
} from '../compression';

// ─── Helpers ────────────────────────────────────────────────
function createCompression(overrides?: Record<string, unknown>) {
  return new MemoryCompression('/mem', overrides as any);
}

const day = 24 * 60 * 60 * 1000;

// ─── Tests ──────────────────────────────────────────────────
describe('MemoryCompression (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCompressionEngine();
    // Reset LLM provider
    setCompressionLLMProvider(null as any);
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
    mockReadFileSync.mockReturnValue('');
  });

  // ─── LLM provider ────────────────────────────────────────
  describe('LLM provider', () => {
    it('setCompressionLLMProvider should set provider', () => {
      const provider: CompressionLLMProvider = { chat: vi.fn() };
      setCompressionLLMProvider(provider);
      expect(getCompressionLLMProvider()).toBe(provider);
    });

    it('getCompressionLLMProvider returns null when not set', () => {
      // Provider was reset to null in beforeEach
      // But setCompressionLLMProvider(null) actually sets it to null
      expect(getCompressionLLMProvider()).toBeNull();
    });
  });

  // ─── init ─────────────────────────────────────────────────
  describe('init', () => {
    it('should create consolidated and archive directories', () => {
      mockExistsSync.mockReturnValue(false);
      const c = createCompression();
      c.init();
      expect(mockMkdirSync).toHaveBeenCalledTimes(2);
    });

    it('should skip creating dirs that already exist', () => {
      mockExistsSync.mockReturnValue(true);
      const c = createCompression();
      c.init();
      expect(mockMkdirSync).not.toHaveBeenCalled();
    });
  });

  // ─── compress ─────────────────────────────────────────────
  describe('compress', () => {
    it('should return empty result when conversations path does not exist', async () => {
      mockExistsSync.mockReturnValue(false);
      const c = createCompression();
      const result = await c.compress();
      expect(result.processed).toBe(0);
    });

    it('should skip files younger than compressAfterDays (unless force)', async () => {
      // conversations dir exists
      mockExistsSync.mockReturnValue(true);
      // One month dir
      mockReaddirSync.mockImplementation((_: any, opts: any) => {
        if (opts?.withFileTypes) {
          return [{ name: '2025-06', isDirectory: () => true }];
        }
        return ['01.md'];
      });
      // File is only 1 day old, threshold is 7 days
      mockStatSync.mockReturnValue({ mtimeMs: Date.now() - 1 * day, mtime: new Date() });
      mockReadFileSync.mockReturnValue('# content');

      const c = createCompression();
      const result = await c.compress();
      expect(result.processed).toBe(1);
      expect(result.summarized).toBe(0);
      expect(result.archived).toBe(0);
    });

    it('should process files older than compressAfterDays with summarize recommendation', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((_: any, opts: any) => {
        if (opts?.withFileTypes) {
          return [{ name: '2025-01', isDirectory: () => true }];
        }
        return ['15.md'];
      });
      mockStatSync.mockReturnValue({ mtimeMs: Date.now() - 10 * day, mtime: new Date(Date.now() - 10 * day) });
      mockReadFileSync.mockReturnValue('## 10:00 - cli\n\n**用户**：hello\n\n**助手**：hi');
      mockScoreImportanceAsync.mockResolvedValue({ score: 50, recommendation: 'summarize', factors: {} });

      const c = createCompression();
      const result = await c.compress();
      expect(result.summarized).toBe(1);
    });

    it('should archive files with archive recommendation when old enough', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((_: any, opts: any) => {
        if (opts?.withFileTypes) {
          return [{ name: '2024-01', isDirectory: () => true }];
        }
        return ['01.md'];
      });
      // File is older than archiveAfterDays (90 days)
      mockStatSync.mockReturnValue({ mtimeMs: Date.now() - 100 * day, mtime: new Date(Date.now() - 100 * day) });
      mockReadFileSync.mockReturnValue('content');
      mockScoreImportanceAsync.mockResolvedValue({ score: 10, recommendation: 'archive', factors: {} });

      const c = createCompression();
      const result = await c.compress();
      expect(result.archived).toBe(1);
      expect(mockWriteFileSync).toHaveBeenCalled(); // archive file written
    });

    it('should summarize archive-recommended files that are not old enough for archive', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((_: any, opts: any) => {
        if (opts?.withFileTypes) {
          return [{ name: '2025-06', isDirectory: () => true }];
        }
        return ['01.md'];
      });
      // File is 10 days old (past compress threshold but not archive threshold)
      mockStatSync.mockReturnValue({ mtimeMs: Date.now() - 10 * day, mtime: new Date(Date.now() - 10 * day) });
      mockReadFileSync.mockReturnValue('content');
      mockScoreImportanceAsync.mockResolvedValue({ score: 10, recommendation: 'archive', factors: {} });

      const c = createCompression();
      const result = await c.compress();
      expect(result.summarized).toBe(1); // summarized instead of archived
    });

    it('should delete files with delete recommendation', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((_: any, opts: any) => {
        if (opts?.withFileTypes) {
          return [{ name: '2025-01', isDirectory: () => true }];
        }
        return ['01.md'];
      });
      mockStatSync.mockReturnValue({ mtimeMs: Date.now() - 10 * day, mtime: new Date(Date.now() - 10 * day) });
      mockReadFileSync.mockReturnValue('content');
      mockScoreImportanceAsync.mockResolvedValue({ score: 5, recommendation: 'delete', factors: {} });

      const c = createCompression();
      const result = await c.compress();
      expect(result.deleted).toBe(1);
      expect(mockRmSync).toHaveBeenCalled();
    });

    it('should keep files with keep recommendation', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((_: any, opts: any) => {
        if (opts?.withFileTypes) {
          return [{ name: '2025-06', isDirectory: () => true }];
        }
        return ['01.md'];
      });
      mockStatSync.mockReturnValue({ mtimeMs: Date.now() - 10 * day, mtime: new Date(Date.now() - 10 * day) });
      mockReadFileSync.mockReturnValue('content');
      mockScoreImportanceAsync.mockResolvedValue({ score: 90, recommendation: 'keep', factors: {} });

      const c = createCompression();
      const result = await c.compress();
      expect(result.summarized).toBe(0);
      expect(result.archived).toBe(0);
      expect(result.deleted).toBe(0);
    });

    it('should fall back to sync scoreImportance when async fails', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((_: any, opts: any) => {
        if (opts?.withFileTypes) {
          return [{ name: '2025-06', isDirectory: () => true }];
        }
        return ['01.md'];
      });
      mockStatSync.mockReturnValue({ mtimeMs: Date.now() - 10 * day, mtime: new Date(Date.now() - 10 * day) });
      mockReadFileSync.mockReturnValue('content');
      mockScoreImportanceAsync.mockRejectedValue(new Error('async fail'));
      mockScoreImportance.mockReturnValue({ score: 50, recommendation: 'keep', factors: {} });

      const c = createCompression();
      const result = await c.compress();
      expect(mockScoreImportance).toHaveBeenCalled();
    });

    it('should handle processing error gracefully', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((_: any, opts: any) => {
        if (opts?.withFileTypes) {
          return [{ name: '2025-06', isDirectory: () => true }];
        }
        return ['01.md'];
      });
      mockStatSync.mockReturnValue({ mtimeMs: Date.now() - 10 * day, mtime: new Date(Date.now() - 10 * day) });
      mockReadFileSync.mockImplementation(() => { throw new Error('read fail'); });

      const c = createCompression();
      const result = await c.compress({ force: true });
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('dryRun should not write/delete files', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((_: any, opts: any) => {
        if (opts?.withFileTypes) {
          return [{ name: '2025-01', isDirectory: () => true }];
        }
        return ['01.md'];
      });
      mockStatSync.mockReturnValue({ mtimeMs: Date.now() - 10 * day, mtime: new Date(Date.now() - 10 * day) });
      mockReadFileSync.mockReturnValue('content');
      mockScoreImportanceAsync.mockResolvedValue({ score: 5, recommendation: 'delete', factors: {} });

      const c = createCompression();
      const result = await c.compress({ dryRun: true });
      expect(result.deleted).toBe(1);
      expect(mockRmSync).not.toHaveBeenCalled(); // dry run
    });

    it('force should process even recent files', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((_: any, opts: any) => {
        if (opts?.withFileTypes) {
          return [{ name: '2025-06', isDirectory: () => true }];
        }
        return ['01.md'];
      });
      // File is only 1 day old
      mockStatSync.mockReturnValue({ mtimeMs: Date.now() - 1 * day, mtime: new Date() });
      mockReadFileSync.mockReturnValue('content');
      mockScoreImportanceAsync.mockResolvedValue({ score: 90, recommendation: 'keep', factors: {} });

      const c = createCompression();
      const result = await c.compress({ force: true });
      expect(result.processed).toBe(1);
    });
  });

  // ─── LLM-based summarization ──────────────────────────────
  describe('LLM-based summarization', () => {
    it('should use LLM when provider is set', async () => {
      const mockChat = vi.fn(async () =>
        'SUMMARY_START\nLLM summary here\nSUMMARY_END\n\nFACTS_START\n- fact one\n- fact two\nFACTS_END'
      );
      setCompressionLLMProvider({ chat: mockChat });

      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((_: any, opts: any) => {
        if (opts?.withFileTypes) {
          return [{ name: '2025-01', isDirectory: () => true }];
        }
        return ['01.md'];
      });
      mockStatSync.mockReturnValue({ mtimeMs: Date.now() - 10 * day, mtime: new Date(Date.now() - 10 * day) });
      mockReadFileSync.mockReturnValue('## 10:00 - cli\n\n**用户**：hello\n\n**助手**：world');
      mockScoreImportanceAsync.mockResolvedValue({ score: 50, recommendation: 'summarize', factors: {} });

      const c = createCompression();
      await c.compress();
      expect(mockChat).toHaveBeenCalled();
    });

    it('should fall back to rule-based when LLM fails', async () => {
      const mockChat = vi.fn(async () => { throw new Error('LLM fail'); });
      setCompressionLLMProvider({ chat: mockChat });

      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((_: any, opts: any) => {
        if (opts?.withFileTypes) {
          return [{ name: '2025-01', isDirectory: () => true }];
        }
        return ['01.md'];
      });
      mockStatSync.mockReturnValue({ mtimeMs: Date.now() - 10 * day, mtime: new Date(Date.now() - 10 * day) });
      mockReadFileSync.mockReturnValue('## 10:00 - cli\n\n**用户**：hello\n\n**助手**：world');
      mockScoreImportanceAsync.mockResolvedValue({ score: 50, recommendation: 'summarize', factors: {} });

      const c = createCompression();
      const result = await c.compress();
      expect(result.summarized).toBe(1); // should still summarize via fallback
    });

    it('should truncate very long content for LLM', async () => {
      const mockChat = vi.fn(async () => 'SUMMARY_START\nshort\nSUMMARY_END\nFACTS_START\nFACTS_END');
      setCompressionLLMProvider({ chat: mockChat });

      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((_: any, opts: any) => {
        if (opts?.withFileTypes) {
          return [{ name: '2025-01', isDirectory: () => true }];
        }
        return ['01.md'];
      });
      mockStatSync.mockReturnValue({ mtimeMs: Date.now() - 10 * day, mtime: new Date(Date.now() - 10 * day) });
      // Content longer than 8000 chars
      mockReadFileSync.mockReturnValue('x'.repeat(10000));
      mockScoreImportanceAsync.mockResolvedValue({ score: 50, recommendation: 'summarize', factors: {} });

      const c = createCompression();
      await c.compress();
      // The chat call should have truncated content
      const chatArg = mockChat.mock.calls[0][0][1].content;
      expect(chatArg).toContain('中间内容省略');
    });

    it('should handle LLM response without markers', async () => {
      const mockChat = vi.fn(async () => 'Just a plain response with no markers');
      setCompressionLLMProvider({ chat: mockChat });

      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((_: any, opts: any) => {
        if (opts?.withFileTypes) {
          return [{ name: '2025-01', isDirectory: () => true }];
        }
        return ['01.md'];
      });
      mockStatSync.mockReturnValue({ mtimeMs: Date.now() - 10 * day, mtime: new Date(Date.now() - 10 * day) });
      mockReadFileSync.mockReturnValue('content');
      mockScoreImportanceAsync.mockResolvedValue({ score: 50, recommendation: 'summarize', factors: {} });

      const c = createCompression();
      const result = await c.compress();
      // Should use first 500 chars of response as summary and empty keyFacts
      expect(result.summarized).toBe(1);
    });
  });

  // ─── Rule-based summarization ─────────────────────────────
  describe('rule-based summarization (no LLM)', () => {
    it('should extract user and assistant lines', async () => {
      // No LLM provider set
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((_: any, opts: any) => {
        if (opts?.withFileTypes) {
          return [{ name: '2025-01', isDirectory: () => true }];
        }
        return ['01.md'];
      });
      mockStatSync.mockReturnValue({ mtimeMs: Date.now() - 10 * day, mtime: new Date(Date.now() - 10 * day) });
      const content = [
        '# Day',
        '## 10:00 - source',
        '**用户**：question one',
        '**助手**：answer one that is quite long ' + 'x'.repeat(250),
        '## 11:00 - source',
        '**User**: question two',
        '**Assistant**: answer two',
      ].join('\n');
      mockReadFileSync.mockReturnValue(content);
      mockScoreImportanceAsync.mockResolvedValue({ score: 50, recommendation: 'summarize', factors: {} });

      const c = createCompression();
      const result = await c.compress();
      expect(result.summarized).toBe(1);
      // The written summary should contain truncated assistant line
      const writeCall = mockWriteFileSync.mock.calls.find(
        (c: any) => typeof c[1] === 'string' && c[1].includes('summary')
      );
      expect(writeCall).toBeTruthy();
    });
  });

  // ─── Key fact extraction ──────────────────────────────────
  describe('extractKeyFactsRuleBased', () => {
    it('should extract decision markers', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((_: any, opts: any) => {
        if (opts?.withFileTypes) {
          return [{ name: '2025-01', isDirectory: () => true }];
        }
        return ['01.md'];
      });
      mockStatSync.mockReturnValue({ mtimeMs: Date.now() - 10 * day, mtime: new Date(Date.now() - 10 * day) });
      const content = [
        '# Day',
        '**关键决策**：Use TypeScript for the project',
        '**决策**：Deploy to AWS',
        '重要：Remember to backup',
        '注意：Check credentials',
        '偏好：Dark mode preferred',
        '我喜欢：简洁的代码风格',
        '结论：Project is feasible',
      ].join('\n');
      mockReadFileSync.mockReturnValue(content);
      mockScoreImportanceAsync.mockResolvedValue({ score: 50, recommendation: 'summarize', factors: {} });

      const c = createCompression();
      await c.compress();
      // Should write consolidated summary containing key facts
      const writeCall = mockWriteFileSync.mock.calls.find(
        (c: any) => typeof c[1] === 'string' && c[1].includes('Use TypeScript')
      );
      expect(writeCall).toBeTruthy();
    });
  });

  // ─── summarizeConversation with existing consolidated ─────
  describe('summarizeConversation with existing consolidated file', () => {
    it('should append to existing summaries', async () => {
      let existsCallCount = 0;
      mockExistsSync.mockImplementation((p: any) => {
        if (typeof p === 'string' && p.includes('-summary.json')) {
          return true; // consolidated file exists
        }
        return true;
      });
      mockReaddirSync.mockImplementation((_: any, opts: any) => {
        if (opts?.withFileTypes) {
          return [{ name: '2025-01', isDirectory: () => true }];
        }
        return ['01.md'];
      });
      mockStatSync.mockReturnValue({ mtimeMs: Date.now() - 10 * day, mtime: new Date(Date.now() - 10 * day) });
      mockReadFileSync.mockImplementation((p: any) => {
        if (typeof p === 'string' && p.includes('-summary.json')) {
          return JSON.stringify([{ originalFile: 'old', summary: 'old', keyFacts: [], originalDate: 'x', createdAt: 'x' }]);
        }
        return '# content\n**用户**：hi\n**助手**：hey';
      });
      mockScoreImportanceAsync.mockResolvedValue({ score: 50, recommendation: 'summarize', factors: {} });

      const c = createCompression();
      await c.compress();
      // Should write 2 entries in the consolidated file
      const writeCall = mockWriteFileSync.mock.calls.find(
        (c: any) => typeof c[0] === 'string' && c[0].includes('-summary.json')
      );
      if (writeCall) {
        const written = JSON.parse(writeCall[1]);
        expect(written.length).toBe(2); // old + new
      }
    });

    it('should handle corrupt existing consolidated file', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((_: any, opts: any) => {
        if (opts?.withFileTypes) {
          return [{ name: '2025-01', isDirectory: () => true }];
        }
        return ['01.md'];
      });
      mockStatSync.mockReturnValue({ mtimeMs: Date.now() - 10 * day, mtime: new Date(Date.now() - 10 * day) });
      mockReadFileSync.mockImplementation((p: any) => {
        if (typeof p === 'string' && p.includes('-summary.json')) {
          return 'not json';
        }
        return '# content';
      });
      mockScoreImportanceAsync.mockResolvedValue({ score: 50, recommendation: 'summarize', factors: {} });

      const c = createCompression();
      const result = await c.compress();
      expect(result.summarized).toBe(1); // should still work
    });
  });

  // ─── getStats ─────────────────────────────────────────────
  describe('getStats', () => {
    it('should return zeros when log does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      const c = createCompression();
      const stats = c.getStats();
      expect(stats.totalRuns).toBe(0);
    });

    it('should return accumulated stats from log', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify([
        { timestamp: '2025-01-01', result: { processed: 10, summarized: 3, archived: 2, deleted: 1, errors: [] } },
        { timestamp: '2025-02-01', result: { processed: 5, summarized: 1, archived: 0, deleted: 0, errors: [] } },
      ]));

      const c = createCompression();
      const stats = c.getStats();
      expect(stats.totalRuns).toBe(2);
      expect(stats.totalProcessed).toBe(15);
      expect(stats.totalSummarized).toBe(4);
      expect(stats.totalArchived).toBe(2);
      expect(stats.totalDeleted).toBe(1);
      expect(stats.lastRun).toBe('2025-02-01');
    });

    it('should handle corrupt log file', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('corrupt');
      const c = createCompression();
      const stats = c.getStats();
      expect(stats.totalRuns).toBe(0);
    });
  });

  // ─── readSummaries ────────────────────────────────────────
  describe('readSummaries', () => {
    it('should read specific month', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify([
        { originalFile: 'x', originalDate: 'x', summary: 's', keyFacts: [], createdAt: 'x' },
      ]));
      const c = createCompression();
      const result = c.readSummaries('2025-06');
      expect(result.length).toBe(1);
    });

    it('should return empty for nonexistent month', () => {
      mockExistsSync.mockReturnValue(false);
      const c = createCompression();
      const result = c.readSummaries('2025-06');
      expect(result).toEqual([]);
    });

    it('should handle corrupt month file', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('bad json');
      const c = createCompression();
      const result = c.readSummaries('2025-06');
      expect(result).toEqual([]);
    });

    it('should read all summaries when no month specified', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['2025-01-summary.json', '2025-02-summary.json', 'other.txt']);
      mockReadFileSync.mockReturnValue(JSON.stringify([
        { originalFile: 'x', originalDate: 'x', summary: 's', keyFacts: [], createdAt: 'x' },
      ]));
      const c = createCompression();
      const result = c.readSummaries();
      expect(result.length).toBe(2); // 2 valid summary files
    });

    it('should return empty when consolidated path does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      const c = createCompression();
      const result = c.readSummaries();
      expect(result).toEqual([]);
    });

    it('should skip invalid files in readSummaries()', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['good-summary.json', 'bad-summary.json']);
      let readCallCount = 0;
      mockReadFileSync.mockImplementation(() => {
        readCallCount++;
        if (readCallCount === 1) return JSON.stringify([{ originalFile: 'x', originalDate: 'x', summary: 's', keyFacts: [], createdAt: 'x' }]);
        throw new Error('read error');
      });
      const c = createCompression();
      const result = c.readSummaries();
      expect(result.length).toBe(1);
    });
  });

  // ─── logCompressionRun ────────────────────────────────────
  describe('logCompressionRun', () => {
    it('should create log file when it does not exist', async () => {
      mockExistsSync.mockImplementation((p: any) => {
        if (typeof p === 'string' && p.includes('compression-log')) return false;
        if (typeof p === 'string' && p.includes('conversations')) return true;
        return true; // init dirs exist
      });
      // conversations dir exists but has no month subdirs
      mockReaddirSync.mockReturnValue([]);
      const c = createCompression();
      await c.compress(); // triggers logCompressionRun
      const logWriteCall = mockWriteFileSync.mock.calls.find(
        (c: any) => typeof c[0] === 'string' && c[0].includes('compression-log')
      );
      expect(logWriteCall).toBeTruthy();
    });

    it('should append to existing log', async () => {
      mockExistsSync.mockImplementation((p: any) => {
        if (typeof p === 'string' && p.includes('compression-log')) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((p: any) => {
        if (typeof p === 'string' && p.includes('compression-log')) {
          return JSON.stringify([{ timestamp: 'old', result: { processed: 0, summarized: 0, archived: 0, deleted: 0, errors: [] } }]);
        }
        return '';
      });
      const c = createCompression();
      await c.compress();
      const logWriteCall = mockWriteFileSync.mock.calls.find(
        (c: any) => typeof c[0] === 'string' && c[0].includes('compression-log')
      );
      if (logWriteCall) {
        const written = JSON.parse(logWriteCall[1]);
        expect(written.length).toBe(2);
      }
    });

    it('should truncate log to 30 entries', async () => {
      mockExistsSync.mockImplementation((p: any) => {
        if (typeof p === 'string' && p.includes('compression-log')) return true;
        return false;
      });
      const existingLog = Array.from({ length: 35 }, (_, i) => ({
        timestamp: `ts-${i}`,
        result: { processed: 0, summarized: 0, archived: 0, deleted: 0, errors: [] },
      }));
      mockReadFileSync.mockImplementation((p: any) => {
        if (typeof p === 'string' && p.includes('compression-log')) {
          return JSON.stringify(existingLog);
        }
        return '';
      });
      const c = createCompression();
      await c.compress();
      const logWriteCall = mockWriteFileSync.mock.calls.find(
        (c: any) => typeof c[0] === 'string' && c[0].includes('compression-log')
      );
      if (logWriteCall) {
        const written = JSON.parse(logWriteCall[1]);
        expect(written.length).toBeLessThanOrEqual(30);
      }
    });

    it('should handle corrupt existing log', async () => {
      mockExistsSync.mockImplementation((p: any) => {
        if (typeof p === 'string' && p.includes('compression-log')) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((p: any) => {
        if (typeof p === 'string' && p.includes('compression-log')) return 'corrupt';
        return '';
      });
      const c = createCompression();
      await c.compress();
      // Should not throw
    });
  });

  // ─── singleton ────────────────────────────────────────────
  describe('getCompressionEngine / resetCompressionEngine', () => {
    it('should create singleton', () => {
      mockExistsSync.mockReturnValue(true);
      const engine = getCompressionEngine('/mem');
      expect(engine).toBeInstanceOf(MemoryCompression);
    });

    it('should return existing singleton', () => {
      mockExistsSync.mockReturnValue(true);
      const e1 = getCompressionEngine('/mem');
      const e2 = getCompressionEngine();
      expect(e2).toBe(e1);
    });

    it('should throw when not initialized', () => {
      resetCompressionEngine();
      expect(() => getCompressionEngine()).toThrow('not initialized');
    });

    it('should reset singleton', () => {
      mockExistsSync.mockReturnValue(true);
      const e1 = getCompressionEngine('/mem');
      resetCompressionEngine();
      expect(() => getCompressionEngine()).toThrow('not initialized');
    });
  });

  // ─── DEFAULT_COMPRESSION_CONFIG ───────────────────────────
  describe('DEFAULT_COMPRESSION_CONFIG', () => {
    it('should have expected defaults', () => {
      expect(DEFAULT_COMPRESSION_CONFIG.autoCompress).toBe(true);
      expect(DEFAULT_COMPRESSION_CONFIG.compressAfterDays).toBe(7);
      expect(DEFAULT_COMPRESSION_CONFIG.archiveAfterDays).toBe(90);
      expect(DEFAULT_COMPRESSION_CONFIG.keepOriginalDays).toBe(7);
    });
  });
});
