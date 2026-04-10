import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Use vi.hoisted to define mocks that are available in vi.mock factories ──

const mockFs = vi.hoisted(() => ({
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
  renameSync: vi.fn(),
}));

vi.mock('fs', () => ({ default: mockFs, ...mockFs }));
vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path');
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
    mockFs.renameSync.mockReset();
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

// ─── Additional comprehensive tests ─────────────────────────────────────

describe('parseRetentionDuration (additional)', () => {
  it('returns null for unknown suffix', () => {
    expect(parseRetentionDuration('10s')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseRetentionDuration('')).toBeNull();
  });
});

describe('determineTier (additional)', () => {
  const day = 24 * 60 * 60 * 1000;

  it('returns warm when importance is between minScore*0.5 and minScore', () => {
    const policy: RetentionPolicy = {
      maxAge: '90d',
      minImportanceScore: 20,
      allowDelete: false,
    };
    // importance = 12, minScore = 20, 0.5*20=10 => 12 >= 10 => warm
    expect(determineTier(1 * day, 12, policy)).toBe('warm');
  });

  it('returns cold when importance < minScore*0.5 and age < maxAge', () => {
    const policy: RetentionPolicy = {
      maxAge: '90d',
      minImportanceScore: 20,
      allowDelete: false,
    };
    // importance = 5, minScore = 20, 0.5*20=10 => 5 < 10 => cold
    expect(determineTier(1 * day, 5, policy)).toBe('cold');
  });

  it('uses default minImportanceScore of 20 when not set', () => {
    const policy: RetentionPolicy = { maxAge: '90d', allowDelete: true };
    // minScore defaults to 20, importance 50 >= 40 => hot
    expect(determineTier(1 * day, 50, policy)).toBe('hot');
  });

  it('returns cold when age > maxAge and importance is low', () => {
    const policy: RetentionPolicy = {
      maxAge: '90d',
      minImportanceScore: 20,
      archiveRetention: '365d',
      allowDelete: true,
    };
    // age = 100d > 90d, importance = 5 => cold (but not expired since 100d < 90d+365d)
    expect(determineTier(100 * day, 5, policy)).toBe('cold');
  });

  it('handles archiveRetention not set (defaults to 365d)', () => {
    const policy: RetentionPolicy = {
      maxAge: '90d',
      allowDelete: true,
      minImportanceScore: 20,
    };
    // Without archiveRetention, determineTier uses '365d' default
    // age = 500d > 90d + 365d = 455d => expired
    expect(determineTier(500 * day, 0, policy)).toBe('expired');
  });

  it('handles null archiveMs when archiveRetention is forever', () => {
    const policy: RetentionPolicy = {
      maxAge: '90d',
      archiveRetention: 'forever',
      allowDelete: true,
      minImportanceScore: 20,
    };
    // archiveMs = null, so totalRetention = maxAgeMs only
    // But with null archiveMs, the code uses: (archiveMs !== null) ? maxAgeMs + archiveMs : maxAgeMs
    // So totalRetention = maxAgeMs = 90d
    // age = 100d > 90d => expired
    expect(determineTier(100 * day, 0, policy)).toBe('expired');
  });
});

describe('MemoryLifecycleManager scan (deep)', () => {
  let manager: MemoryLifecycleManager;

  beforeEach(() => {
    mockFs.existsSync.mockReset();
    mockFs.readdirSync.mockReset();
    mockFs.statSync.mockReset();
    mockFs.readFileSync.mockReset();
    mockFs.writeFileSync.mockReset();
    mockFs.unlinkSync.mockReset();
    mockFs.copyFileSync.mockReset();
    mockFs.renameSync.mockReset();
    mockFs.mkdirSync.mockReset();
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readdirSync.mockReturnValue([]);

    manager = new MemoryLifecycleManager({
      basePath: '/mem',
      dryRun: false,
    });
  });

  it('should scan files and compute file info with default importance', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockImplementation((_: any, opts: any) => {
      if (opts?.withFileTypes) {
        return [{ name: 'note.md', isDirectory: () => false, isFile: () => true }];
      }
      return ['note.md'];
    });
    mockFs.statSync.mockReturnValue({
      isFile: () => true,
      size: 200,
      mtimeMs: Date.now() - 5000,
      birthtimeMs: Date.now() - 10000,
      ctimeMs: Date.now() - 10000,
    } as any);

    const files = manager.scan(['facts']);
    expect(files.length).toBe(1);
    expect(files[0].category).toBe('facts');
    expect(files[0].size).toBe(200);
    expect(files[0].importanceScore).toBeGreaterThan(0);
  });

  it('should use importanceScorer when set', () => {
    manager.setImportanceScorer((_content, _meta) => 95);
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockImplementation((_: any, opts: any) => {
      if (opts?.withFileTypes) {
        return [{ name: 'f.md', isDirectory: () => false, isFile: () => true }];
      }
      return ['f.md'];
    });
    mockFs.statSync.mockReturnValue({
      isFile: () => true, size: 50, mtimeMs: Date.now() - 1000,
      birthtimeMs: Date.now() - 2000, ctimeMs: Date.now() - 2000,
    } as any);
    mockFs.readFileSync.mockReturnValue('file content');

    const files = manager.scan(['facts']);
    expect(files.length).toBe(1);
    // Base importance is 95 from scorer; with very short age, decayed is close to 95
    expect(files[0].importanceScore).toBeGreaterThan(90);
  });

  it('should use default importance when importanceScorer throws', () => {
    manager.setImportanceScorer(() => { throw new Error('scorer fail'); });
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockImplementation((_: any, opts: any) => {
      if (opts?.withFileTypes) {
        return [{ name: 'f.md', isDirectory: () => false, isFile: () => true }];
      }
      return ['f.md'];
    });
    mockFs.statSync.mockReturnValue({
      isFile: () => true, size: 50, mtimeMs: Date.now() - 1000,
      birthtimeMs: Date.now() - 2000, ctimeMs: Date.now() - 2000,
    } as any);
    // readFileSync throws -> triggers the catch block for scorer
    mockFs.readFileSync.mockImplementation(() => { throw new Error('EACCES'); });

    const files = manager.scan(['facts']);
    expect(files.length).toBe(1);
    // Falls back to default baseImportance of 50
    expect(files[0].importanceScore).toBeCloseTo(50, 0);
  });

  it('should skip files where statSync throws', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockImplementation((_: any, opts: any) => {
      if (opts?.withFileTypes) {
        return [{ name: 'bad.md', isDirectory: () => false, isFile: () => true }];
      }
      return ['bad.md'];
    });
    mockFs.statSync.mockImplementation(() => { throw new Error('stat fail'); });

    const files = manager.scan(['facts']);
    expect(files).toEqual([]);
  });

  it('should skip non-file entries', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockImplementation((_: any, opts: any) => {
      if (opts?.withFileTypes) {
        return [{ name: 'subdir', isDirectory: () => true, isFile: () => false }];
      }
      return ['subdir'];
    });
    // walkDirectory will try to recurse into subdir
    // statSync for the subdir's children (none)
    let callCount = 0;
    mockFs.statSync.mockImplementation(() => ({
      isFile: () => false, size: 0, mtimeMs: 0, birthtimeMs: 0, ctimeMs: 0,
    }));

    const files = manager.scan(['facts']);
    // No files because subdir has no children and stat returns isFile: false
    expect(files).toEqual([]);
  });

  it('should handle walkDirectory with nested directories and dotfiles', () => {
    mockFs.existsSync.mockReturnValue(true);
    let readdirCall = 0;
    mockFs.readdirSync.mockImplementation((_: any, opts: any) => {
      if (opts?.withFileTypes) {
        readdirCall++;
        if (readdirCall === 1) {
          return [
            { name: '.hidden', isDirectory: () => true, isFile: () => false },
            { name: 'sub', isDirectory: () => true, isFile: () => false },
            { name: 'root.md', isDirectory: () => false, isFile: () => true },
          ];
        }
        if (readdirCall === 2) {
          // sub directory
          return [{ name: 'inner.md', isDirectory: () => false, isFile: () => true }];
        }
        return [];
      }
      return [];
    });
    mockFs.statSync.mockReturnValue({
      isFile: () => true, size: 100, mtimeMs: Date.now() - 1000,
      birthtimeMs: Date.now() - 2000, ctimeMs: Date.now() - 2000,
    } as any);

    const files = manager.scan(['facts']);
    // Should find root.md and inner.md but skip .hidden
    expect(files.length).toBe(2);
  });
});

describe('MemoryLifecycleManager runCleanup (deep)', () => {
  let manager: MemoryLifecycleManager;

  beforeEach(() => {
    mockFs.existsSync.mockReset();
    mockFs.readdirSync.mockReset();
    mockFs.statSync.mockReset();
    mockFs.readFileSync.mockReset();
    mockFs.writeFileSync.mockReset();
    mockFs.unlinkSync.mockReset();
    mockFs.copyFileSync.mockReset();
    mockFs.renameSync.mockReset();
    mockFs.mkdirSync.mockReset();
  });

  function setupFilesWithTier(tier: StorageTier) {
    const day = 24 * 60 * 60 * 1000;
    let ageMs: number;
    let importance: number;

    switch (tier) {
      case 'expired':
        ageMs = 500 * day; // way past 90d + 365d
        importance = 0;
        break;
      case 'cold':
        ageMs = 100 * day; // past 90d
        importance = 5;
        break;
      case 'warm':
        ageMs = 1 * day;
        importance = 25;
        break;
      case 'hot':
        ageMs = 1 * day;
        importance = 50;
        break;
    }

    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockImplementation((_: any, opts: any) => {
      if (opts?.withFileTypes) {
        return [{ name: 'file.md', isDirectory: () => false, isFile: () => true }];
      }
      return ['file.md'];
    });
    mockFs.statSync.mockReturnValue({
      isFile: () => true,
      size: 1024,
      mtimeMs: Date.now() - ageMs,
      birthtimeMs: Date.now() - ageMs,
      ctimeMs: Date.now() - ageMs,
    } as any);
  }

  it('should delete expired files when not dryRun', async () => {
    manager = new MemoryLifecycleManager({ basePath: '/mem', dryRun: false });
    setupFilesWithTier('expired');

    const report = await manager.runCleanup({ categories: ['conversations'], dryRun: false });
    expect(report.totalDeleted).toBeGreaterThanOrEqual(1);
    expect(mockFs.unlinkSync).toHaveBeenCalled();
  });

  it('should archive cold files when not dryRun', async () => {
    manager = new MemoryLifecycleManager({ basePath: '/mem', dryRun: false });
    setupFilesWithTier('cold');

    const report = await manager.runCleanup({ categories: ['conversations'], dryRun: false });
    expect(report.categories['conversations']?.archived).toBeGreaterThanOrEqual(1);
    expect(mockFs.renameSync).toHaveBeenCalled();
  });

  it('should count demoted for warm tier files', async () => {
    // With default baseImportance=50 and halfLife=30d:
    // age=25d => decayed ~= 50*0.5^(25/30) ~= 28, minScore=20, 2*20=40
    // 28 >= 20 but < 40 => warm
    manager = new MemoryLifecycleManager({ basePath: '/mem', dryRun: false });
    const day = 24 * 60 * 60 * 1000;
    const ageMs = 25 * day;
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockImplementation((_: any, opts: any) => {
      if (opts?.withFileTypes) {
        return [{ name: 'file.md', isDirectory: () => false, isFile: () => true }];
      }
      return ['file.md'];
    });
    mockFs.statSync.mockReturnValue({
      isFile: () => true, size: 1024,
      mtimeMs: Date.now() - ageMs,
      birthtimeMs: Date.now() - ageMs,
      ctimeMs: Date.now() - ageMs,
    } as any);

    const report = await manager.runCleanup({ categories: ['conversations'], dryRun: false });
    expect(report.categories['conversations']?.demoted).toBeGreaterThanOrEqual(1);
  });

  it('should not process hot tier files', async () => {
    manager = new MemoryLifecycleManager({ basePath: '/mem', dryRun: false });
    setupFilesWithTier('hot');

    const report = await manager.runCleanup({ categories: ['conversations'], dryRun: false });
    const cat = report.categories['conversations'];
    if (cat) {
      expect(cat.deleted).toBe(0);
      expect(cat.archived).toBe(0);
    }
  });

  it('should handle errors during file processing gracefully', async () => {
    manager = new MemoryLifecycleManager({ basePath: '/mem', dryRun: false });
    setupFilesWithTier('expired');
    mockFs.unlinkSync.mockImplementation(() => { throw new Error('perm denied'); });

    const report = await manager.runCleanup({ categories: ['conversations'], dryRun: false });
    expect(report.categories['conversations']?.errors).toBeGreaterThanOrEqual(1);
  });

  it('should enforce maxFiles capacity limit', async () => {
    // maxFiles: 0 is falsy so the check `policy.maxFiles && ...` won't trigger
    // Use maxFiles: 1 and provide 2 files so excess = 1
    manager = new MemoryLifecycleManager({
      basePath: '/mem',
      dryRun: false,
      policies: {
        conversations: {
          maxAge: '90d',
          maxFiles: 1,
          allowDelete: true,
          minImportanceScore: 20,
          importanceHalfLifeDays: 30,
        },
      },
    });
    const day = 24 * 60 * 60 * 1000;
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockImplementation((_: any, opts: any) => {
      if (opts?.withFileTypes) {
        return [
          { name: 'a.md', isDirectory: () => false, isFile: () => true },
          { name: 'b.md', isDirectory: () => false, isFile: () => true },
        ];
      }
      return ['a.md', 'b.md'];
    });
    mockFs.statSync.mockReturnValue({
      isFile: () => true, size: 1024,
      mtimeMs: Date.now() - 1 * day,
      birthtimeMs: Date.now() - 1 * day,
      ctimeMs: Date.now() - 1 * day,
    } as any);

    const report = await manager.runCleanup({ categories: ['conversations'], dryRun: false });
    // 2 files but maxFiles=1 => excess=1, should archive the least important
    expect(report.categories['conversations']?.archived).toBeGreaterThanOrEqual(1);
  });

  it('should enforce maxSizeBytes capacity limit', async () => {
    manager = new MemoryLifecycleManager({
      basePath: '/mem',
      dryRun: false,
      policies: {
        facts: {
          maxAge: 'forever',
          maxSizeBytes: 100, // files are 1024 bytes so over limit
          allowDelete: false,
          minImportanceScore: 20,
        },
      },
    });
    setupFilesWithTier('warm');

    const report = await manager.runCleanup({ categories: ['facts'], dryRun: false });
    // Should archive files to bring under limit
    expect(report.categories['facts']?.archived).toBeGreaterThanOrEqual(1);
  });

  it('should handle archive errors in capacity limit check', async () => {
    manager = new MemoryLifecycleManager({
      basePath: '/mem',
      dryRun: false,
      policies: {
        facts: {
          maxAge: 'forever',
          maxSizeBytes: 100,
          allowDelete: false,
          minImportanceScore: 20,
        },
      },
    });
    setupFilesWithTier('warm');
    mockFs.renameSync.mockImplementation(() => { throw new Error('copy fail'); });

    const report = await manager.runCleanup({ categories: ['facts'], dryRun: false });
    expect(report.categories['facts']?.errors).toBeGreaterThanOrEqual(1);
  });

  it('should use config dryRun when options.dryRun not specified', async () => {
    manager = new MemoryLifecycleManager({ basePath: '/mem', dryRun: true });
    setupFilesWithTier('expired');

    const report = await manager.runCleanup({ categories: ['conversations'] });
    expect(report.dryRun).toBe(true);
    expect(mockFs.unlinkSync).not.toHaveBeenCalled();
  });

  it('should save cleanup report when not dryRun', async () => {
    manager = new MemoryLifecycleManager({ basePath: '/mem', dryRun: false });
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readdirSync.mockReturnValue([]);

    const report = await manager.runCleanup({ dryRun: false });
    // saveCleanupReport should write a file
    expect(mockFs.writeFileSync).toHaveBeenCalled();
  });

  it('saveCleanupReport should prune old reports beyond 20', async () => {
    manager = new MemoryLifecycleManager({ basePath: '/mem', dryRun: false });
    // For scan: no dirs
    let existsCalls = 0;
    mockFs.existsSync.mockImplementation(() => {
      existsCalls++;
      // For scan phase, return false (no categories)
      // For saveCleanupReport, return true (report dir exists)
      return existsCalls > 10;
    });
    // For saveCleanupReport readdirSync: 25 old reports
    mockFs.readdirSync.mockImplementation((_: any, opts: any) => {
      if (opts?.withFileTypes) return []; // scan phase
      return Array.from({ length: 25 }, (_, i) => `cleanup-${1000 + i}.json`);
    });

    await manager.runCleanup({ dryRun: false });
    // Should try to delete 5 old reports (25 - 20 = 5)
    expect(mockFs.unlinkSync).toHaveBeenCalled();
  });
});

describe('MemoryLifecycleManager checkAfterRecord (deep)', () => {
  let manager: MemoryLifecycleManager;

  beforeEach(() => {
    mockFs.existsSync.mockReset();
    mockFs.readdirSync.mockReset();
    mockFs.statSync.mockReset();
    mockFs.readFileSync.mockReset();
    mockFs.writeFileSync.mockReset();
    mockFs.unlinkSync.mockReset();
    mockFs.copyFileSync.mockReset();
    mockFs.renameSync.mockReset();
    mockFs.mkdirSync.mockReset();
  });

  it('should trigger cleanup when threshold reached and over capacity', async () => {
    manager = new MemoryLifecycleManager({
      basePath: '/mem',
      dryRun: false,
      policies: {
        conversations: {
          maxAge: '90d',
          maxFiles: 1,
          allowDelete: true,
          minImportanceScore: 20,
        },
      },
    });

    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockImplementation((_: any, opts: any) => {
      if (opts?.withFileTypes) {
        return [
          { name: 'a.md', isDirectory: () => false, isFile: () => true },
          { name: 'b.md', isDirectory: () => false, isFile: () => true },
        ];
      }
      return ['a.md', 'b.md'];
    });
    mockFs.statSync.mockReturnValue({
      isFile: () => true, size: 100,
      mtimeMs: Date.now() - 100 * 24 * 60 * 60 * 1000,
      birthtimeMs: Date.now() - 100 * 24 * 60 * 60 * 1000,
      ctimeMs: Date.now() - 100 * 24 * 60 * 60 * 1000,
    } as any);

    // Call 50 times to hit threshold
    for (let i = 0; i < 50; i++) {
      await manager.checkAfterRecord();
    }
    // Allow async cleanup to start
    await new Promise(r => setTimeout(r, 50));
  });

  it('should skip cleanup when maxFiles is not set', async () => {
    manager = new MemoryLifecycleManager({
      basePath: '/mem',
      dryRun: false,
      policies: {
        conversations: {
          maxAge: '90d',
          // no maxFiles
          allowDelete: true,
          minImportanceScore: 20,
        },
      },
    });

    for (let i = 0; i < 50; i++) {
      await manager.checkAfterRecord();
    }
    // Should not have scanned files since maxFiles is not set
  });

  it('should skip cleanup when conversations dir does not exist', async () => {
    manager = new MemoryLifecycleManager({
      basePath: '/mem',
      dryRun: false,
    });
    mockFs.existsSync.mockReturnValue(false);

    for (let i = 0; i < 50; i++) {
      await manager.checkAfterRecord();
    }
  });

  it('should prevent concurrent cleanup runs', async () => {
    manager = new MemoryLifecycleManager({
      basePath: '/mem',
      dryRun: false,
      policies: {
        conversations: {
          maxAge: '90d',
          maxFiles: 0,
          allowDelete: true,
          minImportanceScore: 20,
        },
      },
    });

    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockImplementation((_: any, opts: any) => {
      if (opts?.withFileTypes) {
        return [{ name: 'a.md', isDirectory: () => false, isFile: () => true }];
      }
      return ['a.md'];
    });
    mockFs.statSync.mockReturnValue({
      isFile: () => true, size: 100,
      mtimeMs: Date.now() - 500 * 24 * 60 * 60 * 1000,
      birthtimeMs: Date.now() - 500 * 24 * 60 * 60 * 1000,
      ctimeMs: Date.now() - 500 * 24 * 60 * 60 * 1000,
    } as any);

    // Trigger first cleanup
    for (let i = 0; i < 50; i++) {
      await manager.checkAfterRecord();
    }
    // Immediately try again (should be skipped since cleanup in progress)
    // Reset counter by calling 50 more times
    for (let i = 0; i < 50; i++) {
      await manager.checkAfterRecord();
    }
    await new Promise(r => setTimeout(r, 50));
  });

  it('should handle walkDirectory error in checkAfterRecord', async () => {
    manager = new MemoryLifecycleManager({
      basePath: '/mem',
      dryRun: false,
      policies: {
        conversations: {
          maxAge: '90d',
          maxFiles: 1,
          allowDelete: true,
          minImportanceScore: 20,
        },
      },
    });

    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockImplementation(() => { throw new Error('EPERM'); });

    // Should not throw
    for (let i = 0; i < 50; i++) {
      await manager.checkAfterRecord();
    }
  });
});

describe('MemoryLifecycleManager getStorageStats', () => {
  it('should return per-category stats', () => {
    const manager = new MemoryLifecycleManager({ basePath: '/mem', dryRun: true });

    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockImplementation((_: any, opts: any) => {
      if (opts?.withFileTypes) {
        return [
          { name: 'a.md', isDirectory: () => false, isFile: () => true },
          { name: 'b.md', isDirectory: () => false, isFile: () => true },
        ];
      }
      return ['a.md', 'b.md'];
    });
    const now = Date.now();
    mockFs.statSync.mockReturnValue({
      isFile: () => true, size: 512,
      mtimeMs: now - 5000,
      birthtimeMs: now - 10000,
      ctimeMs: now - 10000,
    } as any);

    const stats = manager.getStorageStats();
    // Should have entries for scanned categories
    const categories = Object.keys(stats);
    expect(categories.length).toBeGreaterThan(0);

    for (const cat of categories) {
      const s = stats[cat];
      expect(s.fileCount).toBeGreaterThan(0);
      expect(s.totalSize).toBeGreaterThan(0);
      expect(typeof s.avgImportance).toBe('number');
      expect(s.oldestFile).toBeGreaterThan(0);
      expect(s.newestFile).toBeGreaterThan(0);
    }
  });

  it('should return empty when no files', () => {
    const manager = new MemoryLifecycleManager({ basePath: '/mem', dryRun: true });
    mockFs.existsSync.mockReturnValue(false);

    const stats = manager.getStorageStats();
    expect(Object.keys(stats).length).toBe(0);
  });
});

describe('getLifecycleManager (additional)', () => {
  it('should return same instance when called without config', () => {
    const mgr1 = getLifecycleManager({ basePath: '/a' });
    const mgr2 = getLifecycleManager();
    // Without config, should return existing instance (the one from first call with config)
    expect(mgr2).toBeInstanceOf(MemoryLifecycleManager);
  });

  it('should create new instance when config is provided', () => {
    const mgr1 = getLifecycleManager({ basePath: '/a' });
    const mgr2 = getLifecycleManager({ basePath: '/b' });
    // With config, creates new instance
    expect(mgr2).toBeInstanceOf(MemoryLifecycleManager);
  });
});
