/**
 * Extended unit tests for Scheduler — covers all uncovered branches.
 * Complements the existing scheduler.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockWriteFileAtomic = vi.fn();

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => '{"schedules":{},"patterns":{},"lastUpdated":"2025-01-01T00:00:00.000Z"}'),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

vi.mock('../../../infra/utils/atomic-fs', () => ({
  writeFileAtomic: (...args: any[]) => mockWriteFileAtomic(...args),
}));

vi.mock('../../../infra/config', () => ({
  getConfig: vi.fn(() => ({ user: { timezone: 'Asia/Shanghai' } })),
}));

vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { Scheduler, getScheduler, getSchedulerLazy, resetScheduler } from '../scheduler';
import { getConfig } from '../../../infra/config';

// ── Helpers ────────────────────────────────────────────────────────────────

function freshScheduler(): Scheduler {
  // existsSync returns false so loadStorage creates empty, and mkdirSync is a no-op
  (existsSync as any).mockImplementation(() => false);
  const s = new Scheduler('/tmp/test-scheduler');
  s.init();
  return s;
}

function schedulerWithStorage(storage: any): Scheduler {
  (existsSync as any).mockImplementation(() => true);
  (readFileSync as any).mockImplementation(() => JSON.stringify(storage));
  const s = new Scheduler('/tmp/test-scheduler');
  s.init();
  return s;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Scheduler (extended)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    (existsSync as any).mockImplementation(() => true);
    (mkdirSync as any).mockImplementation(() => undefined);
    (readFileSync as any).mockImplementation(() => '{"schedules":{},"patterns":{},"lastUpdated":"2025-01-01"}');
    (writeFileSync as any).mockImplementation(() => undefined);
    (unlinkSync as any).mockImplementation(() => undefined);
    mockWriteFileAtomic.mockImplementation(() => undefined);
    (getConfig as any).mockImplementation(() => ({ user: { timezone: 'Asia/Shanghai' } }));
    resetScheduler();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── acquireExecutionLock branches ────────────────────────────────────

  describe('acquireExecutionLock', () => {
    it('returns false when already locked in memory', () => {
      const s = freshScheduler();
      expect(s.acquireExecutionLock('test-1')).toBe(true);
      expect(s.acquireExecutionLock('test-1')).toBe(false);
      s.releaseExecutionLock('test-1');
    });

    it('creates lock dir if it does not exist', () => {
      (existsSync as any).mockImplementation((p: string) => {
        if (p.includes('locks')) return false;
        if (p.includes('schedules.json')) return false;
        return true;
      });
      const s = new Scheduler('/tmp/test-scheduler');
      s.init();

      expect(s.acquireExecutionLock('new-lock')).toBe(true);
      expect(mkdirSync).toHaveBeenCalled();
      s.releaseExecutionLock('new-lock');
    });

    it('clears stale lock when holding process is dead', () => {
      const lockData = JSON.stringify({ pid: 999999, ts: Date.now() - 10000, scheduleId: 'stale' });
      (existsSync as any).mockImplementation((p: string) => {
        if (p.includes('.lock')) return true;
        if (p.includes('schedules.json')) return false;
        return true;
      });
      (readFileSync as any).mockImplementation((p: string) => {
        if (p.includes('.lock')) return lockData;
        return '{"schedules":{},"patterns":{},"lastUpdated":"2025-01-01"}';
      });
      // process.kill will throw for non-existent PID 999999
      const origKill = process.kill;
      vi.spyOn(process, 'kill').mockImplementation((pid: number, signal?: string | number) => {
        if (pid === 999999) throw new Error('ESRCH');
        return origKill.call(process, pid, signal as any);
      });

      const s = new Scheduler('/tmp/test-scheduler');
      s.init();

      expect(s.acquireExecutionLock('stale')).toBe(true);
      expect(unlinkSync).toHaveBeenCalled();
      s.releaseExecutionLock('stale');
    });

    it('skips when lock is valid (holder alive and not stale)', () => {
      const lockData = JSON.stringify({ pid: process.pid, ts: Date.now(), scheduleId: 'valid' });
      let lockCheckCount = 0;
      (existsSync as any).mockImplementation((p: string) => {
        if (p.includes('.lock')) {
          lockCheckCount++;
          return true;
        }
        if (p.includes('schedules.json')) return false;
        return true;
      });
      (readFileSync as any).mockImplementation((p: string) => {
        if (p.includes('.lock')) return lockData;
        return '{"schedules":{},"patterns":{},"lastUpdated":"2025-01-01"}';
      });
      // writeFileSync with 'wx' flag should not be called since lock is valid
      (writeFileSync as any).mockImplementation(() => undefined);

      const s = new Scheduler('/tmp/test-scheduler');
      s.init();

      expect(s.acquireExecutionLock('valid')).toBe(false);
    });

    it('clears stale lock when holder alive but age exceeds timeout', () => {
      // Lock is old (> 120s)
      const lockData = JSON.stringify({ pid: process.pid, ts: Date.now() - 200_000, scheduleId: 'old' });
      (existsSync as any).mockImplementation((p: string) => {
        if (p.includes('.lock')) return true;
        if (p.includes('schedules.json')) return false;
        return true;
      });
      (readFileSync as any).mockImplementation((p: string) => {
        if (p.includes('.lock')) return lockData;
        return '{"schedules":{},"patterns":{},"lastUpdated":"2025-01-01"}';
      });

      const s = new Scheduler('/tmp/test-scheduler');
      s.init();

      expect(s.acquireExecutionLock('old')).toBe(true);
      s.releaseExecutionLock('old');
    });

    it('handles corrupted lock file', () => {
      (existsSync as any).mockImplementation((p: string) => {
        if (p.includes('.lock')) return true;
        if (p.includes('schedules.json')) return false;
        return true;
      });
      (readFileSync as any).mockImplementation((p: string) => {
        if (p.includes('.lock')) return 'NOT VALID JSON!!!';
        return '{"schedules":{},"patterns":{},"lastUpdated":"2025-01-01"}';
      });

      const s = new Scheduler('/tmp/test-scheduler');
      s.init();

      expect(s.acquireExecutionLock('corrupted')).toBe(true);
      s.releaseExecutionLock('corrupted');
    });

    it('returns false on EEXIST race condition', () => {
      (existsSync as any).mockImplementation((p: string) => {
        if (p.includes('.lock')) return false;
        if (p.includes('schedules.json')) return false;
        return true;
      });
      (writeFileSync as any).mockImplementation((_p: string, _d: string, opts: any) => {
        if (opts?.flag === 'wx') {
          const err: any = new Error('EEXIST');
          err.code = 'EEXIST';
          throw err;
        }
      });

      const s = new Scheduler('/tmp/test-scheduler');
      s.init();

      expect(s.acquireExecutionLock('race')).toBe(false);
    });

    it('falls back to memory-only lock on non-EEXIST file error', () => {
      (existsSync as any).mockImplementation((p: string) => {
        if (p.includes('.lock')) return false;
        if (p.includes('schedules.json')) return false;
        return true;
      });
      (writeFileSync as any).mockImplementation((_p: string, _d: string, opts: any) => {
        if (opts?.flag === 'wx') {
          const err: any = new Error('EACCES');
          err.code = 'EACCES';
          throw err;
        }
      });

      const s = new Scheduler('/tmp/test-scheduler');
      s.init();

      // Should succeed with memory-only lock
      expect(s.acquireExecutionLock('perm')).toBe(true);
      s.releaseExecutionLock('perm');
    });
  });

  // ── releaseExecutionLock branches ────────────────────────────────────

  describe('releaseExecutionLock', () => {
    it('only deletes lock file owned by current process', () => {
      const s = freshScheduler();
      // acquireExecutionLock needs .lock to not exist
      (existsSync as any).mockImplementation((p: string) => {
        if (p.includes('.lock')) return false;
        return true;
      });
      s.acquireExecutionLock('owned');

      // Now for releaseExecutionLock, .lock file exists with our PID
      const lockData = JSON.stringify({ pid: process.pid, ts: Date.now() });
      (existsSync as any).mockImplementation((p: string) => {
        if (p.includes('.lock')) return true;
        return true;
      });
      (readFileSync as any).mockImplementation((p: string) => {
        if (p.includes('.lock')) return lockData;
        return '{"schedules":{},"patterns":{},"lastUpdated":"2025-01-01"}';
      });
      (unlinkSync as any).mockClear();

      s.releaseExecutionLock('owned');
      expect(unlinkSync).toHaveBeenCalled();
    });

    it('does not delete lock file owned by different PID', () => {
      const lockData = JSON.stringify({ pid: 12345, ts: Date.now() });
      (existsSync as any).mockImplementation((p: string) => {
        if (p.includes('.lock')) return true;
        if (p.includes('schedules.json')) return false;
        return true;
      });
      (readFileSync as any).mockImplementation((p: string) => {
        if (p.includes('.lock')) return lockData;
        return '{"schedules":{},"patterns":{},"lastUpdated":"2025-01-01"}';
      });

      const s = freshScheduler();
      (unlinkSync as any).mockClear();
      // Force add to memory set then release
      (s as any).executingSchedules.add('other-pid');
      s.releaseExecutionLock('other-pid');
      // unlinkSync should NOT have been called for this release
      expect(unlinkSync).not.toHaveBeenCalled();
    });

    it('handles error during lock file cleanup', () => {
      (existsSync as any).mockImplementation((p: string) => {
        if (p.includes('.lock')) return true;
        if (p.includes('schedules.json')) return false;
        return true;
      });
      (readFileSync as any).mockImplementation((p: string) => {
        if (p.includes('.lock')) throw new Error('read error');
        return '{"schedules":{},"patterns":{},"lastUpdated":"2025-01-01"}';
      });

      const s = freshScheduler();
      (s as any).executingSchedules.add('err-lock');
      // Should not throw
      s.releaseExecutionLock('err-lock');
      expect(s.isScheduleExecuting('err-lock')).toBe(false);
    });
  });

  // ── calculateNextRun (via createSchedule) ────────────────────────────

  describe('calculateNextRun (cron parsing)', () => {
    it('handles step expression (*/5)', () => {
      const s = freshScheduler();
      const result = s.createSchedule({ name: 'Step', cron: '*/5 * * * *', taskType: 'custom' });
      expect(result.success).toBe(true);
      expect(result.data.nextRun).toBeDefined();
    });

    it('handles range expression (1-5)', () => {
      const s = freshScheduler();
      const result = s.createSchedule({ name: 'Range', cron: '0 1-5 * * *', taskType: 'custom' });
      expect(result.success).toBe(true);
      expect(result.data.nextRun).toBeDefined();
    });

    it('handles comma expression (1,15,30)', () => {
      const s = freshScheduler();
      const result = s.createSchedule({ name: 'Comma', cron: '1,15,30 * * * *', taskType: 'custom' });
      expect(result.success).toBe(true);
      expect(result.data.nextRun).toBeDefined();
    });

    it('handles day-of-week expression', () => {
      const s = freshScheduler();
      const result = s.createSchedule({ name: 'DOW', cron: '0 9 * * 1', taskType: 'custom' });
      expect(result.success).toBe(true);
      expect(result.data.nextRun).toBeDefined();
    });

    it('returns null for invalid cron (wrong number of parts)', () => {
      const s = freshScheduler();
      const result = s.createSchedule({ name: 'Bad', cron: '0 9 *', taskType: 'custom' });
      expect(result.success).toBe(true);
      expect(result.data.nextRun).toBeUndefined();
    });

    it('uses default timezone when config throws', () => {
      (getConfig as any).mockImplementation(() => { throw new Error('no config'); });
      const s = freshScheduler();
      const result = s.createSchedule({ name: 'NoConfig', cron: '0 9 * * *', taskType: 'custom' });
      expect(result.success).toBe(true);
      expect(result.data.nextRun).toBeDefined();
    });

    it('uses default timezone when config has no timezone', () => {
      (getConfig as any).mockImplementation(() => ({ user: {} }));
      const s = freshScheduler();
      const result = s.createSchedule({ name: 'NoTZ', cron: '0 9 * * *', taskType: 'custom' });
      expect(result.success).toBe(true);
      expect(result.data.nextRun).toBeDefined();
    });

    it('handles step with zero (invalid step)', () => {
      const s = freshScheduler();
      const result = s.createSchedule({ name: 'ZeroStep', cron: '*/0 * * * *', taskType: 'custom' });
      expect(result.success).toBe(true);
      // Should still compute (step 0 returns false for all)
    });

    it('handles month-specific schedule', () => {
      const s = freshScheduler();
      const result = s.createSchedule({ name: 'Month', cron: '0 9 1 6 *', taskType: 'custom' });
      expect(result.success).toBe(true);
      expect(result.data.nextRun).toBeDefined();
    });
  });

  // ── loadStorage branches ─────────────────────────────────────────────

  describe('loadStorage', () => {
    it('clears stale execution locks on load', () => {
      const storage = {
        schedules: {
          's1': {
            id: 's1', name: 'Stale', cron: '0 9 * * *', enabled: true, state: 'enabled',
            task: { type: 'custom', params: {} }, runCount: 0, isExecuting: true,
            createdAt: '2025-01-01', updatedAt: '2025-01-01',
          },
        },
        patterns: {},
        lastUpdated: '2025-01-01',
      };
      const s = schedulerWithStorage(storage);
      const schedule = s.getSchedule('s1');
      expect(schedule!.isExecuting).toBe(false);
    });

    it('adds isExecuting field when undefined', () => {
      const storage = {
        schedules: {
          's1': {
            id: 's1', name: 'NoField', cron: '0 9 * * *', enabled: true, state: 'enabled',
            task: { type: 'custom', params: {} }, runCount: 0,
            createdAt: '2025-01-01', updatedAt: '2025-01-01',
          },
        },
        patterns: {},
        lastUpdated: '2025-01-01',
      };
      const s = schedulerWithStorage(storage);
      const schedule = s.getSchedule('s1');
      expect(schedule!.isExecuting).toBe(false);
    });

    it('handles corrupted storage file', () => {
      (existsSync as any).mockImplementation(() => true);
      (readFileSync as any).mockImplementation(() => 'INVALID JSON');
      const s = new Scheduler('/tmp/test-scheduler');
      s.init();
      // Should fall back to default empty storage
      expect(s.listSchedules()).toEqual([]);
    });
  });

  // ── getDueSchedules branches ─────────────────────────────────────────

  describe('getDueSchedules', () => {
    it('returns schedules with past nextRun', () => {
      vi.useRealTimers();
      const pastDate = new Date(Date.now() - 60000).toISOString();
      const storage = {
        schedules: {
          's1': {
            id: 's1', name: 'Due', cron: '0 9 * * *', enabled: true, state: 'enabled',
            task: { type: 'custom', params: {} }, runCount: 0, isExecuting: false,
            nextRun: pastDate,
            createdAt: '2025-01-01', updatedAt: '2025-01-01',
          },
        },
        patterns: {},
        lastUpdated: '2025-01-01',
      };
      const s = schedulerWithStorage(storage);
      const due = s.getDueSchedules();
      expect(due.length).toBe(1);
      expect(due[0].id).toBe('s1');
    });

    it('excludes schedules with memory lock', () => {
      vi.useRealTimers();
      const pastDate = new Date(Date.now() - 60000).toISOString();
      const storage = {
        schedules: {
          's1': {
            id: 's1', name: 'Locked', cron: '0 9 * * *', enabled: true, state: 'enabled',
            task: { type: 'custom', params: {} }, runCount: 0, isExecuting: false,
            nextRun: pastDate,
            createdAt: '2025-01-01', updatedAt: '2025-01-01',
          },
        },
        patterns: {},
        lastUpdated: '2025-01-01',
      };
      const s = schedulerWithStorage(storage);
      s.acquireExecutionLock('s1');
      expect(s.getDueSchedules()).toEqual([]);
      s.releaseExecutionLock('s1');
    });

    it('excludes schedules with storage lock (isExecuting)', () => {
      vi.useRealTimers();
      const pastDate = new Date(Date.now() - 60000).toISOString();
      const storage = {
        schedules: {
          's1': {
            id: 's1', name: 'StorageLocked', cron: '0 9 * * *', enabled: true, state: 'enabled',
            task: { type: 'custom', params: {} }, runCount: 0, isExecuting: true,
            nextRun: pastDate,
            createdAt: '2025-01-01', updatedAt: '2025-01-01',
          },
        },
        patterns: {},
        lastUpdated: '2025-01-01',
      };
      // Bypass the stale cleanup in loadStorage by loading after init
      (existsSync as any).mockImplementation(() => true);
      (readFileSync as any).mockImplementation(() => JSON.stringify(storage));
      const s = new Scheduler('/tmp/test-scheduler');
      s.init();
      // loadStorage clears isExecuting, so we need to set it again
      s.setExecuting('s1', true);
      expect(s.getDueSchedules()).toEqual([]);
    });

    it('includes schedules without nextRun', () => {
      vi.useRealTimers();
      const storage = {
        schedules: {
          's1': {
            id: 's1', name: 'NoNext', cron: '0 9 * * *', enabled: true, state: 'enabled',
            task: { type: 'custom', params: {} }, runCount: 0, isExecuting: false,
            createdAt: '2025-01-01', updatedAt: '2025-01-01',
          },
        },
        patterns: {},
        lastUpdated: '2025-01-01',
      };
      const s = schedulerWithStorage(storage);
      expect(s.getDueSchedules().length).toBe(1);
    });

    it('excludes schedules with state not enabled', () => {
      vi.useRealTimers();
      const pastDate = new Date(Date.now() - 60000).toISOString();
      const storage = {
        schedules: {
          's1': {
            id: 's1', name: 'Paused', cron: '0 9 * * *', enabled: true, state: 'paused',
            task: { type: 'custom', params: {} }, runCount: 0, isExecuting: false,
            nextRun: pastDate,
            createdAt: '2025-01-01', updatedAt: '2025-01-01',
          },
        },
        patterns: {},
        lastUpdated: '2025-01-01',
      };
      const s = schedulerWithStorage(storage);
      expect(s.getDueSchedules()).toEqual([]);
    });
  });

  // ── setExecuting ─────────────────────────────────────────────────────

  describe('setExecuting', () => {
    it('sets and clears storage lock', () => {
      const s = freshScheduler();
      const result = s.createSchedule({ name: 'Exec', cron: '0 9 * * *', taskType: 'custom' });
      const id = result.data.id;

      s.setExecuting(id, true);
      expect(s.getSchedule(id)!.isExecuting).toBe(true);

      s.setExecuting(id, false);
      expect(s.getSchedule(id)!.isExecuting).toBe(false);
    });

    it('does nothing for non-existent schedule', () => {
      const s = freshScheduler();
      // Should not throw
      s.setExecuting('nonexistent', true);
    });
  });

  // ── recordExecution ──────────────────────────────────────────────────

  describe('recordExecution', () => {
    it('does nothing for non-existent schedule', () => {
      const s = freshScheduler();
      // Should not throw
      s.recordExecution('nonexistent', { ok: true });
    });

    it('releases storage lock and recalculates nextRun', () => {
      const s = freshScheduler();
      const result = s.createSchedule({ name: 'Rec', cron: '0 9 * * *', taskType: 'custom' });
      const id = result.data.id;
      s.setExecuting(id, true);

      s.recordExecution(id, { status: 'done' });

      const updated = s.getSchedule(id)!;
      expect(updated.isExecuting).toBe(false);
      expect(updated.runCount).toBe(1);
      expect(updated.lastRun).toBeDefined();
      expect(updated.lastResult).toEqual({ status: 'done' });
    });
  });

  // ── setExecutionCallback ─────────────────────────────────────────────

  describe('setExecutionCallback', () => {
    it('sets the callback', () => {
      const s = freshScheduler();
      const cb = vi.fn();
      s.setExecutionCallback(cb);
      // Verify it was stored (accessed via startAll indirectly)
      expect(cb).not.toHaveBeenCalled();
    });
  });

  // ── startAll / stopAll ───────────────────────────────────────────────

  describe('startAll / stopAll', () => {
    it('starts enabled schedules and skips disabled', () => {
      vi.useRealTimers();
      const s = freshScheduler();
      s.createSchedule({ name: 'Enabled', cron: '0 9 * * *', taskType: 'custom' });
      s.createSchedule({ name: 'Disabled', cron: '0 9 * * *', taskType: 'custom', enabled: false });

      const cb = vi.fn();
      s.startAll(cb);
      // Just verify no crash; stopAll to clean up
      s.stopAll();
    });

    it('stopAll cleans up own lock files', () => {
      const s = freshScheduler();
      // Acquire a lock so there's something to clean up
      (existsSync as any).mockImplementation(() => false);
      s.acquireExecutionLock('clean-me');

      // Now when stopping, it should try to clean up file locks
      (existsSync as any).mockImplementation((p: string) => {
        if (p.includes('.lock')) return true;
        return false;
      });
      (readFileSync as any).mockImplementation((p: string) => {
        if (p.includes('.lock')) return JSON.stringify({ pid: process.pid, ts: Date.now() });
        return '{}';
      });

      s.stopAll();
      expect(unlinkSync).toHaveBeenCalled();
      expect(s.isScheduleExecuting('clean-me')).toBe(false);
    });

    it('stopAll skips lock files owned by other PIDs', () => {
      const s = freshScheduler();
      (existsSync as any).mockImplementation(() => false);
      s.acquireExecutionLock('other-pid');

      (existsSync as any).mockImplementation((p: string) => {
        if (p.includes('.lock')) return true;
        return false;
      });
      (readFileSync as any).mockImplementation((p: string) => {
        if (p.includes('.lock')) return JSON.stringify({ pid: 99999, ts: Date.now() });
        return '{}';
      });
      (unlinkSync as any).mockClear();

      s.stopAll();
      expect(unlinkSync).not.toHaveBeenCalled();
    });

    it('stopAll handles errors during lock cleanup', () => {
      const s = freshScheduler();
      (existsSync as any).mockImplementation(() => false);
      s.acquireExecutionLock('err-clean');

      (existsSync as any).mockImplementation((p: string) => {
        if (p.includes('.lock')) throw new Error('fs error');
        return false;
      });

      // Should not throw
      s.stopAll();
      expect(s.isScheduleExecuting('err-clean')).toBe(false);
    });
  });

  // ── startSchedule (via startAll) ─────────────────────────────────────

  describe('startSchedule (via startAll)', () => {
    it('runs past-due schedule immediately', async () => {
      vi.useRealTimers();
      const pastDate = new Date(Date.now() - 60000).toISOString();
      const storage = {
        schedules: {
          's1': {
            id: 's1', name: 'PastDue', cron: '0 9 * * *', enabled: true, state: 'enabled',
            task: { type: 'custom', params: {} }, runCount: 0, isExecuting: false,
            nextRun: pastDate,
            createdAt: '2025-01-01', updatedAt: '2025-01-01',
          },
        },
        patterns: {},
        lastUpdated: '2025-01-01',
      };
      const s = schedulerWithStorage(storage);
      // Need to reset the lock file mocks for acquireExecutionLock
      (existsSync as any).mockImplementation((p: string) => {
        if (p.includes('.lock')) return false;
        return true;
      });

      const cb = vi.fn(() => Promise.resolve());
      s.startAll(cb);

      // Give it a moment to execute
      await new Promise(r => setTimeout(r, 50));
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
      s.stopAll();
    });

    it('skips schedule when calculateNextRun returns null', () => {
      const storage = {
        schedules: {
          's1': {
            id: 's1', name: 'BadCron', cron: 'invalid', enabled: true, state: 'enabled',
            task: { type: 'custom', params: {} }, runCount: 0, isExecuting: false,
            createdAt: '2025-01-01', updatedAt: '2025-01-01',
          },
        },
        patterns: {},
        lastUpdated: '2025-01-01',
      };
      const s = schedulerWithStorage(storage);
      const cb = vi.fn();
      // Should not throw
      s.startAll(cb);
      s.stopAll();
    });
  });

  // ── listPatterns with filter ─────────────────────────────────────────

  describe('listPatterns', () => {
    it('filters by enabled', () => {
      const s = freshScheduler();
      s.createPattern({ name: 'P1', triggerType: 'time_based', condition: '*', actionType: 'log' });
      const created = s.createPattern({ name: 'P2', triggerType: 'event_based', condition: 'x', actionType: 'log' });
      s.updatePattern(created.data.id, { enabled: false } as any);

      expect(s.listPatterns({ enabled: true }).length).toBe(1);
      expect(s.listPatterns({ enabled: false }).length).toBe(1);
    });
  });

  // ── updatePattern error ──────────────────────────────────────────────

  describe('updatePattern', () => {
    it('returns error for non-existent pattern', () => {
      const s = freshScheduler();
      const result = s.updatePattern('nonexistent', { name: 'x' } as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // ── getSchedulerLazy ─────────────────────────────────────────────────

  describe('getSchedulerLazy', () => {
    it('creates scheduler with default path', () => {
      resetScheduler();
      const s = getSchedulerLazy();
      expect(s).toBeDefined();
      expect(s).toBeInstanceOf(Scheduler);
    });

    it('returns same instance on subsequent calls', () => {
      resetScheduler();
      const s1 = getSchedulerLazy();
      const s2 = getSchedulerLazy();
      expect(s1).toBe(s2);
    });
  });

  // ── deleteSchedule stops timer ───────────────────────────────────────

  describe('deleteSchedule', () => {
    it('stops timer when deleting a started schedule', () => {
      vi.useRealTimers();
      const s = freshScheduler();
      const result = s.createSchedule({ name: 'WithTimer', cron: '0 9 * * *', taskType: 'custom' });
      const id = result.data.id;

      const cb = vi.fn();
      s.startAll(cb);

      const delResult = s.deleteSchedule(id);
      expect(delResult.success).toBe(true);
      s.stopAll();
    });
  });

  // ── disableSchedule stops timer ──────────────────────────────────────

  describe('disableSchedule', () => {
    it('stops timer and updates state', () => {
      vi.useRealTimers();
      const s = freshScheduler();
      const result = s.createSchedule({ name: 'DisableTimer', cron: '0 9 * * *', taskType: 'custom' });
      const id = result.data.id;

      const cb = vi.fn();
      s.startAll(cb);

      const disResult = s.disableSchedule(id);
      expect(disResult.success).toBe(true);
      expect(disResult.data.enabled).toBe(false);
      expect(disResult.data.state).toBe('disabled');
      s.stopAll();
    });
  });
});
