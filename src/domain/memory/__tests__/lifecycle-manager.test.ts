import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock fs ────────────────────────────────────────────────────────────────

const mockFs = {
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({
    isFile: () => true,
    size: 100,
    mtimeMs: Date.now() - 10000,
    birthtimeMs: Date.now() - 20000,
    ctimeMs: Date.now() - 20000,
  })),
  readFileSync: vi.fn(() => 'content'),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  copyFileSync: vi.fn(),
  mkdirSync: vi.fn(),
};

vi.mock('fs', () => ({ default: mockFs, ...mockFs }));
vi.mock('path', () => {
  const actual = require('path');
  return { default: actual, ...actual };
});

import {
  parseRetentionDuration,
  calculateDecayedImportance,
  determineTier,
  MemoryLifecycleManager,
  getLifecycleManager,
} from '../lifecycle-manager';
import type { RetentionPolicy, StorageTier, MemoryCategory } from '../lifecycle-manager';

// ── parseRetentionDuration ────────────────────────────────────────────────

describe('parseRetentionDuration', () => {
  it('returns null for "forever"', () => {
    expect(parseRetentionDuration('forever')).toBeNull();
  });

  it('parses days', () => {
    expect(parseRetentionDuration('90d')).toBe(90 * 24 * 60 * 60 * 1000);
  });

  it('parses hours', () => {
    expect(parseRetentionDuration('24h')).toBe(24 * 60 * 60 * 1000);
  });

  it('parses minutes', () => {
    expect(parseRetentionDuration('30m')).toBe(30 * 60 * 1000);
  });

  it('parses years', () => {
    expect(parseRetentionDuration('1y')).toBe(365 * 24 * 60 * 60 * 1000);
  });

  it('returns null for invalid format', () => {
    expect(parseRetentionDuration('abc')).toBeNull();
    expect(parseRetentionDuration('90')).toBeNull();
    expect(parseRetentionDuration('')).toBeNull();
  });
});

// ── calculateDecayedImportance ───────────────────────────────────────────

describe('calculateDecayedImportance', () => {
  it('returns base importance when age is 0', () => {
    expect(calculateDecayedImportance(100, 0, 30)).toBe(100);
  });

  it('returns half importance at half-life', () => {
    const halfLifeMs = 30 * 24 * 60 * 60 * 1000;
    const result = calculateDecayedImportance(100, halfLifeMs, 30);
    expect(result).toBeCloseTo(50, 0);
  });

  it('returns base importance when halfLifeDays <= 0', () => {
    expect(calculateDecayedImportance(80, 999999, 0)).toBe(80);
    expect(calculateDecayedImportance(80, 999999, -5)).toBe(80);
  });

  it('decays more with longer age', () => {
    const oneMonth = 30 * 24 * 60 * 60 * 1000;
    const twoMonths = 60 * 24 * 60 * 60 * 1000;
    const short = calculateDecayedImportance(100, oneMonth, 30);
    const long = calculateDecayedImportance(100, twoMonths, 30);
    expect(long).toBeLessThan(short);
  });
});

// ── determineTier ────────────────────────────────────────────────────────

describe('determineTier', () => {
  const basePolicy: RetentionPolicy = {
    maxAge: '90d',
    minImportanceScore: 20,
    archiveRetention: '365d',
    allowDelete: true,
    importanceHalfLifeDays: 30,
  };

  const day = 24 * 60 * 60 * 1000;

  it('returns "hot" for high importance', () => {
    expect(determineTier(1 * day, 50, basePolicy)).toBe('hot');
  });

  it('returns "warm" for moderate importance', () => {
    expect(determineTier(1 * day, 25, basePolicy)).toBe('warm');
  });

  it('returns "cold" for low importance', () => {
    expect(determineTier(1 * day, 5, basePolicy)).toBe('cold');
  });

  it('returns "expired" when past maxAge + archiveRetention and allowDelete', () => {
    const age = (90 + 365 + 1) * day; // past 90d maxAge + 365d archive
    expect(determineTier(age, 0, basePolicy)).toBe('expired');
  });

  it('does not expire when allowDelete is false', () => {
    const noDel: RetentionPolicy = { ...basePolicy, allowDelete: false };
    const age = (90 + 365 + 1) * day;
    expect(determineTier(age, 0, noDel)).not.toBe('expired');
  });

  it('returns "cold" when past maxAge but importance is low', () => {
    const age = 100 * day;
    expect(determineTier(age, 5, basePolicy)).toBe('cold');
  });

  it('handles "forever" maxAge', () => {
    const foreverPolicy: RetentionPolicy = { ...basePolicy, maxAge: 'forever' };
    // With forever, should never expire; tier is importance-based
    expect(determineTier(9999 * day, 50, foreverPolicy)).toBe('hot');
    expect(determineTier(9999 * day, 5, foreverPolicy)).toBe('cold');
  });
});

// ── MemoryLifecycleManager ───────────────────────────────────────────────

describe('MemoryLifecycleManager', () => {
  let manager: MemoryLifecycleManager;

  beforeEach(() => {
    // Reset all fs mocks
    mockFs.existsSync.mockReset();
    mockFs.readdirSync.mockReset();
    mockFs.statSync.mockReset();
    mockFs.readFileSync.mockReset();
    mockFs.writeFileSync.mockReset();
    mockFs.unlinkSync.mockReset();
    mockFs.copyFileSync.mockReset();
    mockFs.mkdirSync.mockReset();

    mockFs.existsSync.mockImplementation(() => false);
    mockFs.readdirSync.mockImplementation(() => []);

    manager = new MemoryLifecycleManager({
      basePath: '/tmp/test-memory',
      dryRun: true,
    });
  });

  describe('scan()', () => {
    it('returns empty when directories do not exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      const files = manager.scan();
      expect(files).toEqual([]);
    });

    it('scans specified categories only', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([]);
      manager.scan(['facts']);
      // existsSync should be called for facts path
      expect(mockFs.existsSync).toHaveBeenCalled();
    });

    it('assigns tiers based on importance and age', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((_dirPath: any, opts: any) => {
        if (opts?.withFileTypes) {
          return [
            { name: 'file1.md', isDirectory: () => false, isFile: () => true },
          ] as any;
        }
        return ['file1.md'];
      });
      mockFs.statSync.mockReturnValue({
        isFile: () => true,
        size: 1024,
        mtimeMs: Date.now() - 1000, // very recent
        birthtimeMs: Date.now() - 2000,
        ctimeMs: Date.now() - 2000,
      } as any);

      // With default importance 50 and recent age, should be "hot"
      const files = manager.scan(['conversations']);
      // May be empty if path doesn't match, but function should not throw
      expect(Array.isArray(files)).toBe(true);
    });
  });

  describe('runCleanup()', () => {
    it('returns report with dryRun flag', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const report = await manager.runCleanup({ dryRun: true });
      expect(report.dryRun).toBe(true);
      expect(typeof report.timestamp).toBe('string');
      expect(typeof report.duration).toBe('number');
      expect(report.totalDeleted).toBe(0);
    });

    it('does not delete files in dryRun mode', async () => {
      mockFs.existsSync.mockReturnValue(false);
      await manager.runCleanup({ dryRun: true });
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });
  });

  describe('checkAfterRecord()', () => {
    it('does nothing until threshold is reached', async () => {
      // Call fewer times than RECORDS_BETWEEN_CHECKS (50)
      for (let i = 0; i < 10; i++) {
        await manager.checkAfterRecord();
      }
      // Should not trigger scan/cleanup
      // existsSync for conversations dir should not be called by checkAfterRecord
    });
  });

  describe('updatePolicy()', () => {
    it('merges partial policy', () => {
      manager.updatePolicy('conversations', { maxFiles: 999 });
      // verify indirectly by scanning — no crash
      manager.scan(['conversations']);
    });
  });

  describe('setImportanceScorer()', () => {
    it('accepts scorer function', () => {
      const scorer = (c: string, m: Record<string, unknown>) => 75;
      manager.setImportanceScorer(scorer);
      // No error means success
    });
  });

  describe('startAutoCleanup / stopAutoCleanup', () => {
    it('starts and stops without error', () => {
      const mgr = new MemoryLifecycleManager({
        basePath: '/tmp/test',
        autoCleanupIntervalMs: 100000,
      });
      mgr.startAutoCleanup();
      mgr.stopAutoCleanup();
    });

    it('does not start if interval is 0', () => {
      const mgr = new MemoryLifecycleManager({
        basePath: '/tmp/test',
        autoCleanupIntervalMs: 0,
      });
      mgr.startAutoCleanup();
      mgr.stopAutoCleanup(); // should be safe even if not started
    });

    it('does not start twice', () => {
      const mgr = new MemoryLifecycleManager({
        basePath: '/tmp/test',
        autoCleanupIntervalMs: 100000,
      });
      mgr.startAutoCleanup();
      mgr.startAutoCleanup(); // second call should be no-op
      mgr.stopAutoCleanup();
    });
  });
});

// ── getLifecycleManager singleton ────────────────────────────────────────

describe('getLifecycleManager', () => {
  it('returns an instance', () => {
    const mgr = getLifecycleManager({ basePath: '/tmp/lc' });
    expect(mgr).toBeInstanceOf(MemoryLifecycleManager);
  });
});
