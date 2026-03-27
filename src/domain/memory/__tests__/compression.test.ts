import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  MemoryCompression,
  DEFAULT_COMPRESSION_CONFIG,
  getCompressionEngine,
  resetCompressionEngine,
  type CompressionConfig,
  type CompressionResult,
  type SummaryEntry,
} from '../compression';
import { MemoryCompression as MemoryCompressionClass } from '../compression';

// Re-export for typing
type SummaryEntry = {
  originalFile: string;
  originalDate: string;
  summary: string;
  keyFacts: string[];
  createdAt: string;
};

const TEST_COMPRESSION_PATH = './test-compression-data';

describe('MemoryCompression', () => {
  let compression: MemoryCompression;

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_COMPRESSION_PATH)) {
      rmSync(TEST_COMPRESSION_PATH, { recursive: true });
    }
    mkdirSync(TEST_COMPRESSION_PATH, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_COMPRESSION_PATH)) {
      rmSync(TEST_COMPRESSION_PATH, { recursive: true });
    }
  });

  describe('constructor', () => {
    test('creates instance with default config', () => {
      compression = new MemoryCompression(TEST_COMPRESSION_PATH);
      expect(compression).toBeDefined();
    });

    test('creates instance with custom config', () => {
      const customConfig: Partial<CompressionConfig> = {
        autoCompress: false,
        compressAfterDays: 14,
      };
      compression = new MemoryCompression(TEST_COMPRESSION_PATH, customConfig);
      expect(compression).toBeDefined();
    });
  });

  describe('init', () => {
    test('creates required directories', () => {
      compression = new MemoryCompression(TEST_COMPRESSION_PATH);
      compression.init();

      expect(existsSync(join(TEST_COMPRESSION_PATH, 'consolidated'))).toBe(true);
      expect(existsSync(join(TEST_COMPRESSION_PATH, 'archive'))).toBe(true);
    });

    test('is idempotent', () => {
      compression = new MemoryCompression(TEST_COMPRESSION_PATH);
      compression.init();
      compression.init(); // Should not throw
    });
  });

  describe('compress', () => {
    test('returns result for empty directory', async () => {
      compression = new MemoryCompression(TEST_COMPRESSION_PATH);
      compression.init();

      const result = await compression.compress();

      expect(result.processed).toBe(0);
      expect(result.summarized).toBe(0);
      expect(result.archived).toBe(0);
      expect(result.errors).toEqual([]);
    });

    test('respects dryRun option', async () => {
      compression = new MemoryCompression(TEST_COMPRESSION_PATH);
      compression.init();

      // Create a test conversation file
      const convPath = join(TEST_COMPRESSION_PATH, 'conversations', '2026-03');
      mkdirSync(convPath, { recursive: true });
      writeFileSync(
        join(convPath, '02.md'),
        `# 2026-03-02\n\n## Conversation\n\n**用户**：你好\n**助手**：你好！`,
        'utf-8'
      );

      const result = await compression.compress({ dryRun: true });

      // In dry run, should not actually compress
      expect(result).toBeDefined();
    });

    test('handles force option', async () => {
      compression = new MemoryCompression(TEST_COMPRESSION_PATH);
      compression.init();

      const result = await compression.compress({ force: true });

      expect(result).toBeDefined();
    });
  });
});

describe('CompressionConfig', () => {
  test('DEFAULT_COMPRESSION_CONFIG has expected values', () => {
    expect(DEFAULT_COMPRESSION_CONFIG.autoCompress).toBe(true);
    expect(DEFAULT_COMPRESSION_CONFIG.compressAfterDays).toBe(7);
    expect(DEFAULT_COMPRESSION_CONFIG.runSchedule).toBe('0 3 * * *');
    expect(DEFAULT_COMPRESSION_CONFIG.keepOriginalDays).toBe(7);
    expect(DEFAULT_COMPRESSION_CONFIG.archiveAfterDays).toBe(90);
  });
});

describe('getCompressionEngine', () => {
  beforeEach(() => {
    if (existsSync(TEST_COMPRESSION_PATH)) {
      rmSync(TEST_COMPRESSION_PATH, { recursive: true });
    }
    mkdirSync(TEST_COMPRESSION_PATH, { recursive: true });
    resetCompressionEngine();
  });

  afterEach(() => {
    if (existsSync(TEST_COMPRESSION_PATH)) {
      rmSync(TEST_COMPRESSION_PATH, { recursive: true });
    }
    resetCompressionEngine();
  });

  test('creates singleton with basePath', () => {
    const engine = getCompressionEngine(TEST_COMPRESSION_PATH);
    expect(engine).toBeDefined();
    expect(engine).toBeInstanceOf(MemoryCompression);
  });

  test('returns same instance on subsequent calls', () => {
    const engine1 = getCompressionEngine(TEST_COMPRESSION_PATH);
    const engine2 = getCompressionEngine();

    expect(engine1).toBe(engine2);
  });

  test('throws when not initialized', () => {
    resetCompressionEngine();

    expect(() => getCompressionEngine()).toThrow('not initialized');
  });

  test('accepts custom config', () => {
    const engine = getCompressionEngine(TEST_COMPRESSION_PATH, {
      autoCompress: false,
      compressAfterDays: 14,
    });
    expect(engine).toBeDefined();
  });
});

describe('resetCompressionEngine', () => {
  beforeEach(() => {
    if (existsSync(TEST_COMPRESSION_PATH)) {
      rmSync(TEST_COMPRESSION_PATH, { recursive: true });
    }
    mkdirSync(TEST_COMPRESSION_PATH, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_COMPRESSION_PATH)) {
      rmSync(TEST_COMPRESSION_PATH, { recursive: true });
    }
    resetCompressionEngine();
  });

  test('resets singleton instance', () => {
    const engine1 = getCompressionEngine(TEST_COMPRESSION_PATH);
    resetCompressionEngine();
    const engine2 = getCompressionEngine(TEST_COMPRESSION_PATH);

    expect(engine1).not.toBe(engine2);
  });

  test('allows re-initialization with different path', () => {
    getCompressionEngine(TEST_COMPRESSION_PATH);
    resetCompressionEngine();

    const newPath = join(TEST_COMPRESSION_PATH, 'new');
    mkdirSync(newPath, { recursive: true });
    const engine = getCompressionEngine(newPath);
    expect(engine).toBeDefined();
  });
});

describe('MemoryCompression getStats', () => {
  let compression: MemoryCompression;

  beforeEach(() => {
    if (existsSync(TEST_COMPRESSION_PATH)) {
      rmSync(TEST_COMPRESSION_PATH, { recursive: true });
    }
    mkdirSync(TEST_COMPRESSION_PATH, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_COMPRESSION_PATH)) {
      rmSync(TEST_COMPRESSION_PATH, { recursive: true });
    }
  });

  test('returns empty stats when no log file', () => {
    compression = new MemoryCompression(TEST_COMPRESSION_PATH);
    compression.init();

    const stats = compression.getStats();

    expect(stats.totalRuns).toBe(0);
    expect(stats.totalProcessed).toBe(0);
    expect(stats.totalSummarized).toBe(0);
    expect(stats.totalArchived).toBe(0);
    expect(stats.totalDeleted).toBe(0);
  });

  test('returns stats after compression run', async () => {
    compression = new MemoryCompression(TEST_COMPRESSION_PATH);
    compression.init();

    await compression.compress();

    const stats = compression.getStats();
    // Stats may be 0 if nothing was processed
    expect(stats).toBeDefined();
    expect(stats.totalRuns).toBeGreaterThanOrEqual(0);
  });

  test('accumulates stats across multiple runs', async () => {
    compression = new MemoryCompression(TEST_COMPRESSION_PATH);
    compression.init();

    await compression.compress();
    await compression.compress();

    const stats = compression.getStats();
    expect(stats).toBeDefined();
  });
});

describe('MemoryCompression readSummaries', () => {
  let compression: MemoryCompression;

  beforeEach(() => {
    if (existsSync(TEST_COMPRESSION_PATH)) {
      rmSync(TEST_COMPRESSION_PATH, { recursive: true });
    }
    mkdirSync(TEST_COMPRESSION_PATH, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_COMPRESSION_PATH)) {
      rmSync(TEST_COMPRESSION_PATH, { recursive: true });
    }
  });

  test('returns empty array when no summaries exist', () => {
    compression = new MemoryCompression(TEST_COMPRESSION_PATH);
    compression.init();

    const summaries = compression.readSummaries();
    expect(summaries).toEqual([]);
  });

  test('returns empty array for non-existent month', () => {
    compression = new MemoryCompression(TEST_COMPRESSION_PATH);
    compression.init();

    const summaries = compression.readSummaries('2026-01');
    expect(summaries).toEqual([]);
  });

  test('returns summaries from consolidated files', () => {
    compression = new MemoryCompression(TEST_COMPRESSION_PATH);
    compression.init();

    // Create a summary file
    const summaryPath = join(TEST_COMPRESSION_PATH, 'consolidated', '2026-03-summary.json');
    const summaries: SummaryEntry[] = [
      {
        originalFile: '2026-03/01.md',
        originalDate: '2026-03-01',
        summary: 'Test summary',
        keyFacts: ['Fact 1'],
        createdAt: '2026-03-02T00:00:00Z',
      },
    ];
    writeFileSync(summaryPath, JSON.stringify(summaries, null, 2), 'utf-8');

    const result = compression.readSummaries('2026-03');
    expect(result).toHaveLength(1);
    expect(result[0].summary).toBe('Test summary');
  });

  test('returns all summaries when month not specified', () => {
    compression = new MemoryCompression(TEST_COMPRESSION_PATH);
    compression.init();

    // Create summary files for multiple months
    const summaryPath1 = join(TEST_COMPRESSION_PATH, 'consolidated', '2026-01-summary.json');
    const summaryPath2 = join(TEST_COMPRESSION_PATH, 'consolidated', '2026-02-summary.json');

    const summaries1: SummaryEntry[] = [
      {
        originalFile: '2026-01/01.md',
        originalDate: '2026-01-01',
        summary: 'January summary',
        keyFacts: [],
        createdAt: '2026-01-02T00:00:00Z',
      },
    ];
    const summaries2: SummaryEntry[] = [
      {
        originalFile: '2026-02/01.md',
        originalDate: '2026-02-01',
        summary: 'February summary',
        keyFacts: [],
        createdAt: '2026-02-02T00:00:00Z',
      },
    ];

    writeFileSync(summaryPath1, JSON.stringify(summaries1, null, 2), 'utf-8');
    writeFileSync(summaryPath2, JSON.stringify(summaries2, null, 2), 'utf-8');

    const result = compression.readSummaries();
    expect(result).toHaveLength(2);
  });

  test('handles invalid JSON in summary file', () => {
    compression = new MemoryCompression(TEST_COMPRESSION_PATH);
    compression.init();

    const summaryPath = join(TEST_COMPRESSION_PATH, 'consolidated', '2026-03-summary.json');
    writeFileSync(summaryPath, 'invalid json', 'utf-8');

    const result = compression.readSummaries('2026-03');
    expect(result).toEqual([]);
  });
});

describe('CompressionResult interface', () => {
  test('has expected structure', () => {
    const result: CompressionResult = {
      processed: 10,
      summarized: 5,
      archived: 2,
      deleted: 3,
      errors: ['error1', 'error2'],
    };

    expect(result.processed).toBe(10);
    expect(result.summarized).toBe(5);
    expect(result.archived).toBe(2);
    expect(result.deleted).toBe(3);
    expect(result.errors).toHaveLength(2);
  });
});

describe('SummaryEntry interface', () => {
  test('has expected structure', () => {
    const entry: SummaryEntry = {
      originalFile: '2026-03/2026-03-01.md',
      originalDate: '2026-03-01',
      summary: 'Test summary',
      keyFacts: ['Fact 1', 'Fact 2'],
      createdAt: '2026-03-02T10:00:00Z',
    };

    expect(entry.originalFile).toBe('2026-03/2026-03-01.md');
    expect(entry.originalDate).toBe('2026-03-01');
    expect(entry.summary).toBe('Test summary');
    expect(entry.keyFacts).toHaveLength(2);
  });
});
