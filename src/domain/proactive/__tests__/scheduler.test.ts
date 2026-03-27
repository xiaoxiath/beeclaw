import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join } from 'path';
import { existsSync, mkdirSync, rmSync } from 'fs';

// Mock dependencies
vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../infra/config', () => ({
  getConfig: () => ({ user: { timezone: 'Asia/Shanghai' } }),
}));

vi.mock('../../../infra/utils/atomic-fs', () => ({
  writeFileAtomic: (path: string, content: string) => {
    const { writeFileSync } = require('fs');
    writeFileSync(path, content, 'utf-8');
  },
}));

import { Scheduler, getScheduler, resetScheduler } from '../scheduler';

const TEST_BASE = join(process.cwd(), 'temp', 'test-scheduler-' + Date.now());

describe('Scheduler', () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_BASE)) {
      rmSync(TEST_BASE, { recursive: true, force: true });
    }
    mkdirSync(TEST_BASE, { recursive: true });
    scheduler = new Scheduler(TEST_BASE);
    resetScheduler();
  });

  describe('init', () => {
    it('initializes storage', () => {
      scheduler.init();
      // Should not throw
      expect(true).toBe(true);
    });

    it('is idempotent', () => {
      scheduler.init();
      scheduler.init();
      // Should not throw on double init
      expect(true).toBe(true);
    });
  });

  describe('createSchedule', () => {
    it('creates a new schedule', () => {
      scheduler.init();
      const result = scheduler.createSchedule({
        name: 'Test Schedule',
        description: 'A test',
        cron: '0 9 * * *',
        taskType: 'llm_proactive_chat',
        taskParams: { prompt: 'Hello' },
      });
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.name).toBe('Test Schedule');
      expect(result.data.cron).toBe('0 9 * * *');
      expect(result.data.enabled).toBe(true);
    });

    it('prevents duplicate names (idempotency)', () => {
      scheduler.init();
      scheduler.createSchedule({
        name: 'Unique Name',
        cron: '0 9 * * *',
        taskType: 'llm_proactive_chat',
      });
      const result = scheduler.createSchedule({
        name: 'Unique Name',
        cron: '0 10 * * *',
        taskType: 'run_skill',
      });
      expect(result.success).toBe(true);
      expect(result.message).toContain('already exists');
    });

    it('allows disabled schedule', () => {
      scheduler.init();
      const result = scheduler.createSchedule({
        name: 'Disabled',
        cron: '0 9 * * *',
        taskType: 'llm_proactive_chat',
        enabled: false,
      });
      expect(result.success).toBe(true);
      expect(result.data.enabled).toBe(false);
      expect(result.data.state).toBe('disabled');
    });
  });

  describe('listSchedules', () => {
    it('returns empty list initially', () => {
      scheduler.init();
      expect(scheduler.listSchedules()).toEqual([]);
    });

    it('returns created schedules', () => {
      scheduler.init();
      scheduler.createSchedule({ name: 'S1', cron: '0 9 * * *', taskType: 'custom' });
      scheduler.createSchedule({ name: 'S2', cron: '0 10 * * *', taskType: 'custom' });
      expect(scheduler.listSchedules().length).toBe(2);
    });

    it('filters by enabled', () => {
      scheduler.init();
      scheduler.createSchedule({ name: 'Enabled', cron: '0 9 * * *', taskType: 'custom' });
      scheduler.createSchedule({ name: 'Disabled', cron: '0 10 * * *', taskType: 'custom', enabled: false });

      const enabled = scheduler.listSchedules({ enabled: true });
      expect(enabled.length).toBe(1);
      expect(enabled[0].name).toBe('Enabled');

      const disabled = scheduler.listSchedules({ enabled: false });
      expect(disabled.length).toBe(1);
      expect(disabled[0].name).toBe('Disabled');
    });
  });

  describe('getSchedule', () => {
    it('returns null for nonexistent', () => {
      scheduler.init();
      expect(scheduler.getSchedule('nonexistent')).toBeNull();
    });

    it('returns schedule by id', () => {
      scheduler.init();
      const created = scheduler.createSchedule({ name: 'Find Me', cron: '0 9 * * *', taskType: 'custom' });
      const found = scheduler.getSchedule(created.data.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Find Me');
    });
  });

  describe('updateSchedule', () => {
    it('returns error for nonexistent', () => {
      scheduler.init();
      const result = scheduler.updateSchedule('bad-id', { name: 'New' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('updates schedule fields', () => {
      scheduler.init();
      const created = scheduler.createSchedule({ name: 'Original', cron: '0 9 * * *', taskType: 'custom' });
      const result = scheduler.updateSchedule(created.data.id, { name: 'Updated' });
      expect(result.success).toBe(true);
      expect(result.data.name).toBe('Updated');
    });

    it('recalculates nextRun when cron changes', () => {
      scheduler.init();
      const created = scheduler.createSchedule({ name: 'Cron Test', cron: '0 9 * * *', taskType: 'custom' });
      const originalNext = created.data.nextRun;
      const result = scheduler.updateSchedule(created.data.id, { cron: '30 14 * * *' });
      expect(result.success).toBe(true);
      // nextRun should change
      expect(result.data.nextRun).not.toBe(originalNext);
    });
  });

  describe('deleteSchedule', () => {
    it('returns error for nonexistent', () => {
      scheduler.init();
      const result = scheduler.deleteSchedule('bad-id');
      expect(result.success).toBe(false);
    });

    it('deletes existing schedule', () => {
      scheduler.init();
      const created = scheduler.createSchedule({ name: 'ToDelete', cron: '0 9 * * *', taskType: 'custom' });
      const result = scheduler.deleteSchedule(created.data.id);
      expect(result.success).toBe(true);
      expect(scheduler.getSchedule(created.data.id)).toBeNull();
    });
  });

  describe('enableSchedule / disableSchedule', () => {
    it('enables a disabled schedule', () => {
      scheduler.init();
      const created = scheduler.createSchedule({ name: 'Toggle', cron: '0 9 * * *', taskType: 'custom', enabled: false });
      const result = scheduler.enableSchedule(created.data.id);
      expect(result.success).toBe(true);
      expect(result.data.enabled).toBe(true);
    });

    it('disables an enabled schedule', () => {
      scheduler.init();
      const created = scheduler.createSchedule({ name: 'Toggle2', cron: '0 9 * * *', taskType: 'custom' });
      const result = scheduler.disableSchedule(created.data.id);
      expect(result.success).toBe(true);
      expect(result.data.enabled).toBe(false);
    });
  });

  describe('patterns', () => {
    it('creates a pattern', () => {
      scheduler.init();
      const result = scheduler.createPattern({
        name: 'Test Pattern',
        triggerType: 'event_based',
        condition: 'user_login',
        actionType: 'send_message',
        actionParams: { message: 'Welcome back!' },
      });
      expect(result.success).toBe(true);
      expect(result.data.name).toBe('Test Pattern');
    });

    it('lists patterns', () => {
      scheduler.init();
      scheduler.createPattern({ name: 'P1', triggerType: 'time_based', condition: '*', actionType: 'log' });
      scheduler.createPattern({ name: 'P2', triggerType: 'event_based', condition: 'x', actionType: 'log' });
      expect(scheduler.listPatterns().length).toBe(2);
    });

    it('gets pattern by id', () => {
      scheduler.init();
      const created = scheduler.createPattern({ name: 'FindMe', triggerType: 'time_based', condition: '*', actionType: 'log' });
      expect(scheduler.getPattern(created.data.id)).not.toBeNull();
    });

    it('returns null for nonexistent pattern', () => {
      scheduler.init();
      expect(scheduler.getPattern('no-such-id')).toBeNull();
    });

    it('deletes a pattern', () => {
      scheduler.init();
      const created = scheduler.createPattern({ name: 'Del', triggerType: 'time_based', condition: '*', actionType: 'log' });
      const result = scheduler.deletePattern(created.data.id);
      expect(result.success).toBe(true);
      expect(scheduler.getPattern(created.data.id)).toBeNull();
    });

    it('returns error deleting nonexistent pattern', () => {
      scheduler.init();
      const result = scheduler.deletePattern('nope');
      expect(result.success).toBe(false);
    });

    it('updates a pattern', () => {
      scheduler.init();
      const created = scheduler.createPattern({ name: 'Upd', triggerType: 'time_based', condition: '*', actionType: 'log' });
      const result = scheduler.updatePattern(created.data.id, { name: 'Updated Pattern' } as any);
      expect(result.success).toBe(true);
      expect(result.data.name).toBe('Updated Pattern');
    });
  });

  describe('execution locks', () => {
    it('acquires and releases memory lock', () => {
      scheduler.init();
      const created = scheduler.createSchedule({ name: 'Lock', cron: '0 9 * * *', taskType: 'custom' });
      const id = created.data.id;

      expect(scheduler.acquireExecutionLock(id)).toBe(true);
      expect(scheduler.isScheduleExecuting(id)).toBe(true);
      expect(scheduler.acquireExecutionLock(id)).toBe(false); // Already locked

      scheduler.releaseExecutionLock(id);
      expect(scheduler.isScheduleExecuting(id)).toBe(false);
    });
  });

  describe('getDueSchedules', () => {
    it('returns empty when no schedules', () => {
      scheduler.init();
      expect(scheduler.getDueSchedules()).toEqual([]);
    });

    it('excludes disabled schedules', () => {
      scheduler.init();
      scheduler.createSchedule({ name: 'Disabled', cron: '* * * * *', taskType: 'custom', enabled: false });
      expect(scheduler.getDueSchedules()).toEqual([]);
    });
  });

  describe('recordExecution', () => {
    it('updates runCount and lastRun', () => {
      scheduler.init();
      const created = scheduler.createSchedule({ name: 'Track', cron: '0 9 * * *', taskType: 'custom' });
      const id = created.data.id;

      scheduler.recordExecution(id, { status: 'ok' });

      const updated = scheduler.getSchedule(id);
      expect(updated!.runCount).toBe(1);
      expect(updated!.lastRun).toBeDefined();
      expect(updated!.lastResult).toEqual({ status: 'ok' });
    });
  });

  describe('startAll / stopAll', () => {
    it('starts and stops without error', () => {
      scheduler.init();
      scheduler.createSchedule({ name: 'AutoStart', cron: '0 9 * * *', taskType: 'custom' });

      const callback = vi.fn(() => Promise.resolve());
      scheduler.startAll(callback);
      scheduler.stopAll();
      // No error expected
    });
  });

  describe('getScheduler / resetScheduler', () => {
    it('getScheduler creates singleton', () => {
      const s = getScheduler(TEST_BASE);
      expect(s).toBeDefined();
    });

    it('resetScheduler clears singleton', () => {
      getScheduler(TEST_BASE);
      resetScheduler();
      // After reset, calling without basePath should throw
      expect(() => getScheduler()).toThrow('not initialized');
    });
  });
});
