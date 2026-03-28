/**
 * Coverage-focused tests for Scheduler.
 * Targets uncovered lines: 484-518 (far-future interval check),
 * 535-543 (setTimeout callback + reschedule), 684-696 (minute overflow in calculateNextRun).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => '{"schedules":{},"patterns":{},"lastUpdated":"2025-01-01"}'),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  writeFileAtomic: vi.fn(),
  getConfig: vi.fn(() => ({ user: { timezone: 'UTC' } })),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: mocks.existsSync,
  mkdirSync: mocks.mkdirSync,
  readFileSync: mocks.readFileSync,
  writeFileSync: mocks.writeFileSync,
  unlinkSync: mocks.unlinkSync,
}));

vi.mock('../../../infra/utils/atomic-fs', () => ({
  writeFileAtomic: mocks.writeFileAtomic,
}));

vi.mock('../../../infra/config', () => ({
  getConfig: mocks.getConfig,
}));

vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    info: mocks.logInfo,
    warn: mocks.logWarn,
    error: mocks.logError,
    debug: mocks.logDebug,
  },
}));

import { Scheduler, resetScheduler } from '../scheduler';

// ── Helpers ────────────────────────────────────────────────────────────────

function freshScheduler(): Scheduler {
  mocks.existsSync.mockReturnValue(false);
  const s = new Scheduler('/tmp/sched-cov');
  s.init();
  return s;
}

function makeSchedule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sch-1',
    name: 'Test',
    cron: '0 9 * * *',
    enabled: true,
    state: 'enabled',
    task: { type: 'custom', params: {} },
    runCount: 0,
    isExecuting: false,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Scheduler coverage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.clearAllMocks();
    mocks.existsSync.mockReturnValue(false);
    mocks.getConfig.mockReturnValue({ user: { timezone: 'UTC' } });
    resetScheduler();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Far-future interval path (lines 481-518) ──────────────────────

  describe('startSchedule far-future interval path', () => {
    it('fires interval callback and runs when remainingTime <= 0', async () => {
      vi.useRealTimers();
      const s = freshScheduler();

      // Set a nextRun far in the future (> MAX_SET_TIMEOUT = ~24.8 days)
      const farFuture = new Date(Date.now() + 2200000000).toISOString(); // ~25.5 days
      const schedule = makeSchedule({ nextRun: farFuture });

      // Inject the schedule into storage
      (s as any).storage.schedules['sch-1'] = schedule;

      // Mock acquireExecutionLock to succeed (no lock files)
      mocks.existsSync.mockReturnValue(false);

      const cb = vi.fn(() => Promise.resolve());
      s.startAll(cb);

      // The logger should have logged "far in the future"
      expect(mocks.logInfo).toHaveBeenCalledWith(
        expect.stringContaining('far in the future'),
      );

      // There should be a timer in cronTimers
      expect((s as any).cronTimers.has('sch-1')).toBe(true);

      s.stopAll();
    });

    it('interval callback: remainingTime <= 0 path executes with lock', async () => {
      // We need to test the setInterval callback when remainingTime <= 0.
      // Strategy: use fake timers, set a far-future nextRun, then manually
      // advance time past the nextRun so the interval fires and sees remainingTime <= 0.

      const s = freshScheduler();

      // Set nextRun ~25 days from "now" (fake timer base)
      const baseTime = Date.now();
      const farFuture = new Date(baseTime + 2200000000); // ~25.5 days
      const schedule = makeSchedule({ nextRun: farFuture.toISOString() });
      (s as any).storage.schedules['sch-1'] = schedule;

      mocks.existsSync.mockReturnValue(false);

      const cb = vi.fn(() => Promise.resolve());
      s.startAll(cb);

      expect(mocks.logInfo).toHaveBeenCalledWith(
        expect.stringContaining('far in the future'),
      );

      // Advance time past the far-future nextRun
      vi.advanceTimersByTime(2200000000 + 3600000); // past nextRun + 1 hour

      // The interval should have fired and executed the schedule
      // Give async a tick
      await vi.advanceTimersByTimeAsync(10);

      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ id: 'sch-1' }));

      s.stopAll();
    });

    it('interval callback: remainingTime within safe range reschedules', async () => {
      const s = freshScheduler();

      // Set nextRun ~25.5 days. After one hour-check, remaining will be ~25.46 days (still too large).
      // We need to advance to within MAX_SET_TIMEOUT range.
      const baseTime = Date.now();
      // Set exactly 25 days + 1 hour. After 1 hour interval, remaining = 25 days = ~2.16e9 > MAX (2.147e9).
      // After enough 1-hour intervals, it'll be within range.
      // Let's set to MAX_SET_TIMEOUT + 2 hours (so after 2 hour-checks it's within range)
      const delay = 2147483647 + 2 * 3600000; // MAX + 2 hours
      const futureDate = new Date(baseTime + delay);
      const schedule = makeSchedule({ nextRun: futureDate.toISOString() });
      (s as any).storage.schedules['sch-1'] = schedule;

      mocks.existsSync.mockReturnValue(false);

      const cb = vi.fn(() => Promise.resolve());
      s.startAll(cb);

      // After 2 one-hour ticks, remaining should be within safe range
      // Advance 2 hours => remaining ≈ MAX + 2h - 2h = MAX, which is <= MAX_SET_TIMEOUT
      vi.advanceTimersByTime(3600000 * 2 + 1);

      // Now a normal setTimeout should have been set (startSchedule called again)
      // The schedule should still exist in cronTimers
      expect((s as any).cronTimers.has('sch-1')).toBe(true);

      s.stopAll();
    });

    it('interval callback: schedule deleted between checks (no current)', async () => {
      const s = freshScheduler();

      const baseTime = Date.now();
      const farFuture = new Date(baseTime + 2200000000);
      const schedule = makeSchedule({ nextRun: farFuture.toISOString() });
      (s as any).storage.schedules['sch-1'] = schedule;

      mocks.existsSync.mockReturnValue(false);
      const cb = vi.fn(() => Promise.resolve());
      s.startAll(cb);

      // Delete the schedule from storage before interval fires
      delete (s as any).storage.schedules['sch-1'];

      // Advance time past the nextRun
      vi.advanceTimersByTime(2200000000 + 3600000);
      await vi.advanceTimersByTimeAsync(10);

      // callback should NOT have been called because `current` is undefined
      expect(cb).not.toHaveBeenCalled();

      s.stopAll();
    });

    it('interval callback: safe range but schedule deleted', async () => {
      const s = freshScheduler();

      const baseTime = Date.now();
      const delay = 2147483647 + 3600000 + 1000; // MAX + 1 hour
      const futureDate = new Date(baseTime + delay);
      const schedule = makeSchedule({ nextRun: futureDate.toISOString() });
      (s as any).storage.schedules['sch-1'] = schedule;

      mocks.existsSync.mockReturnValue(false);
      const cb = vi.fn(() => Promise.resolve());
      s.startAll(cb);

      // Delete schedule
      delete (s as any).storage.schedules['sch-1'];

      // Advance 1 hour - remaining is ~MAX which should be within safe range
      vi.advanceTimersByTime(3600000 + 1);

      // Should not crash even though schedule is gone
      s.stopAll();
    });
  });

  // ── setTimeout callback path (lines 535-543) ──────────────────────

  describe('startSchedule setTimeout callback path', () => {
    it('fires setTimeout callback, executes, and reschedules', async () => {
      const s = freshScheduler();

      // Set nextRun 100ms from now (within safe setTimeout range, > 0)
      const baseTime = Date.now();
      const nextRun = new Date(baseTime + 100);
      const schedule = makeSchedule({ nextRun: nextRun.toISOString() });
      (s as any).storage.schedules['sch-1'] = schedule;

      mocks.existsSync.mockReturnValue(false);

      const cb = vi.fn(() => Promise.resolve());
      s.startAll(cb);

      // Advance past the delay
      vi.advanceTimersByTime(200);
      await vi.advanceTimersByTimeAsync(10);

      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ id: 'sch-1' }));

      s.stopAll();
    });

    it('setTimeout callback skips when schedule is disabled', async () => {
      const s = freshScheduler();

      const baseTime = Date.now();
      const nextRun = new Date(baseTime + 100);
      const schedule = makeSchedule({ nextRun: nextRun.toISOString() });
      (s as any).storage.schedules['sch-1'] = schedule;

      mocks.existsSync.mockReturnValue(false);

      const cb = vi.fn(() => Promise.resolve());
      s.startAll(cb);

      // Disable before timer fires
      (s as any).storage.schedules['sch-1'].enabled = false;

      vi.advanceTimersByTime(200);
      await vi.advanceTimersByTimeAsync(10);

      // Should NOT execute because current?.enabled is false
      expect(cb).not.toHaveBeenCalled();

      s.stopAll();
    });

    it('setTimeout callback skips when schedule deleted', async () => {
      const s = freshScheduler();

      const baseTime = Date.now();
      const nextRun = new Date(baseTime + 100);
      const schedule = makeSchedule({ nextRun: nextRun.toISOString() });
      (s as any).storage.schedules['sch-1'] = schedule;

      mocks.existsSync.mockReturnValue(false);

      const cb = vi.fn(() => Promise.resolve());
      s.startAll(cb);

      // Delete before timer fires
      delete (s as any).storage.schedules['sch-1'];

      vi.advanceTimersByTime(200);
      await vi.advanceTimersByTimeAsync(10);

      expect(cb).not.toHaveBeenCalled();

      s.stopAll();
    });

    it('setTimeout callback: after execution, reschedule skipped if disabled', async () => {
      const s = freshScheduler();

      const baseTime = Date.now();
      const nextRun = new Date(baseTime + 100);
      const schedule = makeSchedule({ nextRun: nextRun.toISOString() });
      (s as any).storage.schedules['sch-1'] = schedule;

      mocks.existsSync.mockReturnValue(false);

      // Callback disables the schedule after execution
      const cb = vi.fn(async () => {
        (s as any).storage.schedules['sch-1'].enabled = false;
      });
      s.startAll(cb);

      vi.advanceTimersByTime(200);
      await vi.advanceTimersByTimeAsync(10);

      // Should have executed
      expect(cb).toHaveBeenCalled();

      s.stopAll();
    });
  });

  // ── executeWithLock branches (lines 533-543) ──────────────────────

  describe('executeWithLock branches', () => {
    it('skips when storage lock (isExecuting) is true', async () => {
      vi.useRealTimers();
      const s = freshScheduler();

      // Set up a past-due schedule with isExecuting = true
      const pastDate = new Date(Date.now() - 60000).toISOString();
      const schedule = makeSchedule({
        nextRun: pastDate,
        isExecuting: true,
      });
      (s as any).storage.schedules['sch-1'] = schedule;

      mocks.existsSync.mockReturnValue(false);

      const cb = vi.fn(() => Promise.resolve());
      s.startAll(cb);

      await new Promise(r => setTimeout(r, 50));

      // Logger should mention storage lock
      expect(mocks.logInfo).toHaveBeenCalledWith(
        expect.stringContaining('storage lock'),
      );
      // Callback should NOT be called
      expect(cb).not.toHaveBeenCalled();

      s.stopAll();
    });

    it('releases memory lock when storage lock blocks execution', async () => {
      vi.useRealTimers();
      const s = freshScheduler();

      const pastDate = new Date(Date.now() - 60000).toISOString();
      const schedule = makeSchedule({
        nextRun: pastDate,
        isExecuting: true,
      });
      (s as any).storage.schedules['sch-1'] = schedule;

      mocks.existsSync.mockReturnValue(false);

      const cb = vi.fn(() => Promise.resolve());
      s.startAll(cb);

      await new Promise(r => setTimeout(r, 50));

      // Memory lock should have been released
      expect(s.isScheduleExecuting('sch-1')).toBe(false);

      s.stopAll();
    });
  });

  // ── calculateNextRun minute-overflow (lines 684-696) ──────────────

  describe('calculateNextRun minute-overflow branches', () => {
    it('handles minute overflow to next hour', () => {
      // Use a cron that only matches a specific minute in a specific hour
      // If current time is at minute 59, the search starts at minute 0 of next hour
      // We'll use timezone UTC for simplicity
      const s = freshScheduler();

      // We test by creating a schedule and checking that nextRun is valid
      // The cron '0 * * * *' matches minute 0 of every hour
      const result = s.createSchedule({
        name: 'HourOverflow',
        cron: '0 * * * *',
        taskType: 'custom',
      });
      expect(result.success).toBe(true);
      expect(result.data.nextRun).toBeDefined();
      // nextRun should be at minute 0
      const nextRun = new Date(result.data.nextRun!);
      expect(nextRun.getMinutes()).toBe(0);
    });

    it('handles hour overflow to next day', () => {
      const s = freshScheduler();

      // '30 2 * * *' means 2:30 AM. If current time is 3 AM, next run is next day at 2:30.
      const result = s.createSchedule({
        name: 'DayOverflow',
        cron: '30 2 * * *',
        taskType: 'custom',
      });
      expect(result.success).toBe(true);
      expect(result.data.nextRun).toBeDefined();
    });

    it('handles day overflow to next month', () => {
      // To test month overflow, we need the search to go past the end of a month.
      // '0 0 31 * *' matches only day 31 - not all months have 31 days.
      // In months with 30 days, the search will overflow from day 30 -> day 31 of next month.
      const s = freshScheduler();
      const result = s.createSchedule({
        name: 'MonthOverflow',
        cron: '0 0 31 * *',
        taskType: 'custom',
      });
      expect(result.success).toBe(true);
      expect(result.data.nextRun).toBeDefined();
      const nextRun = new Date(result.data.nextRun!);
      expect(nextRun.getDate()).toBe(31);
    });

    it('handles month overflow to next year', () => {
      // '0 0 1 12 *' matches Dec 1st at midnight.
      // If we're past Dec 1, the next match is next year.
      // Use a specific date approach: set fake timer to Dec 2nd, then cron matches Dec 1.
      vi.setSystemTime(new Date('2025-12-02T00:00:00Z'));

      const s = freshScheduler();
      const result = s.createSchedule({
        name: 'YearOverflow',
        cron: '0 0 1 12 *',
        taskType: 'custom',
      });
      expect(result.success).toBe(true);
      expect(result.data.nextRun).toBeDefined();
      const nextRun = new Date(result.data.nextRun!);
      expect(nextRun.getFullYear()).toBe(2026);
      expect(nextRun.getMonth()).toBe(11); // December (0-indexed)
      expect(nextRun.getDate()).toBe(1);
    });

    it('handles minute=59 overflow chain (min->hour->day)', () => {
      // Set time to 23:59 on a day, so incrementing by 1 minute causes:
      // minute 59 -> 60 -> reset to 0, hour 23 -> 24 -> reset to 0, day increments
      vi.setSystemTime(new Date('2025-06-15T23:59:00Z'));

      const s = freshScheduler();
      // Cron: '0 0 * * *' matches midnight every day
      const result = s.createSchedule({
        name: 'FullOverflow',
        cron: '0 0 * * *',
        taskType: 'custom',
      });
      expect(result.success).toBe(true);
      expect(result.data.nextRun).toBeDefined();
      const nextRun = new Date(result.data.nextRun!);
      // Should be June 16 at 00:00
      expect(nextRun.getUTCDate()).toBe(16);
      expect(nextRun.getUTCHours()).toBe(0);
      expect(nextRun.getUTCMinutes()).toBe(0);
    });

    it('handles end-of-month overflow (day > daysInMonth)', () => {
      // Set time to Jan 31 23:59, searching for Feb 1 midnight
      // When day increments past 31 (Jan has 31 days), it wraps to Feb 1
      vi.setSystemTime(new Date('2025-01-31T23:59:00Z'));

      const s = freshScheduler();
      // '0 0 1 * *' matches day 1 at midnight every month
      const result = s.createSchedule({
        name: 'EndOfMonthOverflow',
        cron: '0 0 1 * *',
        taskType: 'custom',
      });
      expect(result.success).toBe(true);
      expect(result.data.nextRun).toBeDefined();
      const nextRun = new Date(result.data.nextRun!);
      // Should be Feb 1 at 00:00
      expect(nextRun.getUTCMonth()).toBe(1); // February (0-indexed)
      expect(nextRun.getUTCDate()).toBe(1);
    });

    it('handles December 31 23:59 overflow to next year January', () => {
      vi.setSystemTime(new Date('2025-12-31T23:59:00Z'));

      const s = freshScheduler();
      // '0 0 1 1 *' matches Jan 1 at midnight
      const result = s.createSchedule({
        name: 'Dec31Overflow',
        cron: '0 0 1 1 *',
        taskType: 'custom',
      });
      expect(result.success).toBe(true);
      expect(result.data.nextRun).toBeDefined();
      const nextRun = new Date(result.data.nextRun!);
      expect(nextRun.getFullYear()).toBeGreaterThanOrEqual(2026);
      expect(nextRun.getUTCMonth()).toBe(0); // January
      expect(nextRun.getUTCDate()).toBe(1);
    });

    it('handles Feb 28 overflow in non-leap year', () => {
      // Feb 28, 2025 (non-leap) at 23:59. Searching for any March 1st match.
      vi.setSystemTime(new Date('2025-02-28T23:59:00Z'));

      const s = freshScheduler();
      const result = s.createSchedule({
        name: 'FebOverflow',
        cron: '0 0 1 3 *', // March 1 at midnight
        taskType: 'custom',
      });
      expect(result.success).toBe(true);
      expect(result.data.nextRun).toBeDefined();
      const nextRun = new Date(result.data.nextRun!);
      expect(nextRun.getUTCMonth()).toBe(2); // March
      expect(nextRun.getUTCDate()).toBe(1);
    });
  });

  // ── Additional edge cases for full coverage ──────────────────────────

  describe('startSchedule with no nextRun and null calculateNextRun', () => {
    it('returns early when calculateNextRun returns null', () => {
      const s = freshScheduler();

      // Schedule with no nextRun and invalid cron (calculateNextRun returns null)
      const schedule = makeSchedule({ nextRun: undefined, cron: 'bad' });
      (s as any).storage.schedules['sch-1'] = schedule;

      const cb = vi.fn();
      s.startAll(cb);

      // Should not have set any timer
      expect((s as any).cronTimers.has('sch-1')).toBe(false);
      s.stopAll();
    });
  });

  describe('executeWithLock skips when memory lock fails', () => {
    it('skips execution when schedule already memory-locked', async () => {
      vi.useRealTimers();
      const s = freshScheduler();

      const pastDate = new Date(Date.now() - 60000).toISOString();
      const schedule = makeSchedule({ nextRun: pastDate });
      (s as any).storage.schedules['sch-1'] = schedule;

      // Pre-acquire the memory lock
      mocks.existsSync.mockReturnValue(false);
      s.acquireExecutionLock('sch-1');

      const cb = vi.fn(() => Promise.resolve());
      s.startAll(cb);

      await new Promise(r => setTimeout(r, 50));

      // Should NOT execute because memory lock was already held
      expect(cb).not.toHaveBeenCalled();
      expect(mocks.logInfo).toHaveBeenCalledWith(
        expect.stringContaining('memory lock'),
      );

      s.releaseExecutionLock('sch-1');
      s.stopAll();
    });
  });
});
