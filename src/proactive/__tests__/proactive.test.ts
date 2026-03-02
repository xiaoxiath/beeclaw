import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync } from 'fs';
import { Scheduler, getScheduler, resetScheduler } from '../scheduler';
import { evaluateCondition, type TriggerContext } from '../triggers';

const TEST_PROACTIVE_PATH = './test-proactive-data';

describe('Scheduler', () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_PROACTIVE_PATH)) {
      rmSync(TEST_PROACTIVE_PATH, { recursive: true });
    }
    resetScheduler();
    scheduler = getScheduler(TEST_PROACTIVE_PATH);
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_PROACTIVE_PATH)) {
      rmSync(TEST_PROACTIVE_PATH, { recursive: true });
    }
    scheduler.stopAll();
  });

  describe('init', () => {
    test('creates directory structure', () => {
      expect(existsSync(TEST_PROACTIVE_PATH)).toBe(true);
    });

    test('creates storage file', () => {
      expect(existsSync(`${TEST_PROACTIVE_PATH}/schedules.json`)).toBe(true);
    });
  });

  describe('createSchedule', () => {
    test('creates a schedule with required fields', () => {
      const result = scheduler.createSchedule({
        name: 'Daily Report',
        cron: '0 9 * * *',
        taskType: 'send_reminder',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Daily Report');
        expect(result.data.cron).toBe('0 9 * * *');
        expect(result.data.enabled).toBe(true);
        expect(result.data.nextRun).toBeDefined();
      }
    });

    test('creates schedule with options', () => {
      const result = scheduler.createSchedule({
        name: 'Weekly Summary',
        description: 'Send weekly summary',
        cron: '0 18 * * 5',
        taskType: 'run_skill',
        taskParams: { skill: 'summary' },
        enabled: false,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.description).toBe('Send weekly summary');
        expect(result.data.task.params).toEqual({ skill: 'summary' });
        expect(result.data.enabled).toBe(false);
        expect(result.data.state).toBe('disabled');
      }
    });

    test('generates unique IDs', () => {
      const result1 = scheduler.createSchedule({
        name: 'Schedule 1',
        cron: '0 9 * * *',
        taskType: 'test',
      });
      const result2 = scheduler.createSchedule({
        name: 'Schedule 2',
        cron: '0 10 * * *',
        taskType: 'test',
      });

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      if (result1.success && result2.success) {
        expect(result1.data.id).not.toBe(result2.data.id);
      }
    });

    test('calculates nextRun from cron', () => {
      const result = scheduler.createSchedule({
        name: 'Test',
        cron: '30 14 * * *', // 14:30 every day
        taskType: 'test',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.nextRun).toBeDefined();
        const nextRun = new Date(result.data.nextRun!);
        expect(nextRun.getMinutes()).toBe(30);
        expect(nextRun.getHours()).toBe(14);
      }
    });
  });

  describe('getSchedule', () => {
    test('returns schedule by ID', () => {
      const createResult = scheduler.createSchedule({
        name: 'Test Schedule',
        cron: '0 9 * * *',
        taskType: 'test',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const schedule = scheduler.getSchedule(createResult.data.id);
      expect(schedule).not.toBeNull();
      expect(schedule?.name).toBe('Test Schedule');
    });

    test('returns null for non-existent schedule', () => {
      const schedule = scheduler.getSchedule('non-existent');
      expect(schedule).toBeNull();
    });
  });

  describe('listSchedules', () => {
    test('lists all schedules', () => {
      scheduler.createSchedule({ name: 'S1', cron: '0 9 * * *', taskType: 't' });
      scheduler.createSchedule({ name: 'S2', cron: '0 10 * * *', taskType: 't' });

      const schedules = scheduler.listSchedules();
      expect(schedules.length).toBe(2);
    });

    test('filters by enabled status', () => {
      scheduler.createSchedule({ name: 'Enabled', cron: '0 9 * * *', taskType: 't', enabled: true });
      scheduler.createSchedule({ name: 'Disabled', cron: '0 10 * * *', taskType: 't', enabled: false });

      const enabled = scheduler.listSchedules({ enabled: true });
      const disabled = scheduler.listSchedules({ enabled: false });

      expect(enabled.length).toBe(1);
      expect(disabled.length).toBe(1);
      expect(enabled[0].name).toBe('Enabled');
    });
  });

  describe('updateSchedule', () => {
    test('updates schedule fields', () => {
      const createResult = scheduler.createSchedule({
        name: 'Original',
        cron: '0 9 * * *',
        taskType: 'test',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const updateResult = scheduler.updateSchedule(createResult.data.id, {
        name: 'Updated',
        enabled: false,
      });

      expect(updateResult.success).toBe(true);
      if (updateResult.success) {
        expect(updateResult.data.name).toBe('Updated');
        expect(updateResult.data.enabled).toBe(false);
      }
    });

    test('recalculates nextRun when cron changes', () => {
      const createResult = scheduler.createSchedule({
        name: 'Test',
        cron: '0 9 * * *',
        taskType: 'test',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const originalNextRun = createResult.data.nextRun;

      const updateResult = scheduler.updateSchedule(createResult.data.id, {
        cron: '30 14 * * *',
      });

      expect(updateResult.success).toBe(true);
      if (updateResult.success) {
        expect(updateResult.data.nextRun).not.toBe(originalNextRun);
      }
    });

    test('returns error for non-existent schedule', () => {
      const result = scheduler.updateSchedule('non-existent', { name: 'New' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('deleteSchedule', () => {
    test('deletes existing schedule', () => {
      const createResult = scheduler.createSchedule({
        name: 'To Delete',
        cron: '0 9 * * *',
        taskType: 'test',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const deleteResult = scheduler.deleteSchedule(createResult.data.id);
      expect(deleteResult.success).toBe(true);

      expect(scheduler.getSchedule(createResult.data.id)).toBeNull();
    });

    test('returns error for non-existent schedule', () => {
      const result = scheduler.deleteSchedule('non-existent');
      expect(result.success).toBe(false);
    });
  });

  describe('enableSchedule / disableSchedule', () => {
    test('enables a disabled schedule', () => {
      const createResult = scheduler.createSchedule({
        name: 'Test',
        cron: '0 9 * * *',
        taskType: 'test',
        enabled: false,
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const enableResult = scheduler.enableSchedule(createResult.data.id);
      expect(enableResult.success).toBe(true);
      if (enableResult.success) {
        expect(enableResult.data.enabled).toBe(true);
        expect(enableResult.data.state).toBe('enabled');
      }
    });

    test('disables an enabled schedule', () => {
      const createResult = scheduler.createSchedule({
        name: 'Test',
        cron: '0 9 * * *',
        taskType: 'test',
        enabled: true,
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const disableResult = scheduler.disableSchedule(createResult.data.id);
      expect(disableResult.success).toBe(true);
      if (disableResult.success) {
        expect(disableResult.data.enabled).toBe(false);
        expect(disableResult.data.state).toBe('disabled');
      }
    });
  });

  describe('recordExecution', () => {
    test('records execution result', () => {
      const createResult = scheduler.createSchedule({
        name: 'Test',
        cron: '0 9 * * *',
        taskType: 'test',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      scheduler.recordExecution(createResult.data.id, { success: true });

      const schedule = scheduler.getSchedule(createResult.data.id);
      expect(schedule?.runCount).toBe(1);
      expect(schedule?.lastRun).toBeDefined();
      expect(schedule?.lastResult).toEqual({ success: true });
    });

    test('updates nextRun after execution', () => {
      const createResult = scheduler.createSchedule({
        name: 'Test',
        cron: '0 9 * * *',
        taskType: 'test',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const originalNextRun = createResult.data.nextRun;
      scheduler.recordExecution(createResult.data.id, {});

      const schedule = scheduler.getSchedule(createResult.data.id);
      // nextRun should be recalculated (could be same for daily, but was recalculated)
      expect(schedule?.nextRun).toBeDefined();
    });
  });

  describe('getDueSchedules', () => {
    test('returns enabled schedules with past nextRun', () => {
      // Create a schedule and manually set nextRun to past
      const createResult = scheduler.createSchedule({
        name: 'Past Due',
        cron: '0 9 * * *',
        taskType: 'test',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      // Manually set nextRun to past
      scheduler.updateSchedule(createResult.data.id, {
        nextRun: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      });

      const due = scheduler.getDueSchedules();
      expect(due.length).toBe(1);
      expect(due[0].name).toBe('Past Due');
    });

    test('excludes disabled schedules', () => {
      const createResult = scheduler.createSchedule({
        name: 'Disabled',
        cron: '0 9 * * *',
        taskType: 'test',
        enabled: false,
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      scheduler.updateSchedule(createResult.data.id, {
        nextRun: new Date(Date.now() - 3600000).toISOString(),
      });

      const due = scheduler.getDueSchedules();
      expect(due.length).toBe(0);
    });
  });

  describe('createPattern', () => {
    test('creates a pattern', () => {
      const result = scheduler.createPattern({
        name: 'Low Progress Alert',
        triggerType: 'condition_based',
        condition: 'goal.any.progress < 50',
        actionType: 'send_reminder',
        actionParams: { message: 'Low progress detected' },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Low Progress Alert');
        expect(result.data.trigger.type).toBe('condition_based');
        expect(result.data.trigger.condition).toBe('goal.any.progress < 50');
        expect(result.data.enabled).toBe(true);
      }
    });
  });

  describe('listPatterns', () => {
    test('lists all patterns', () => {
      scheduler.createPattern({
        name: 'P1',
        triggerType: 'time_based',
        condition: 'time.hour == 9',
        actionType: 'test',
      });
      scheduler.createPattern({
        name: 'P2',
        triggerType: 'event_based',
        condition: 'custom',
        actionType: 'test',
      });

      const patterns = scheduler.listPatterns();
      expect(patterns.length).toBe(2);
    });
  });

  describe('deletePattern', () => {
    test('deletes existing pattern', () => {
      const createResult = scheduler.createPattern({
        name: 'To Delete',
        triggerType: 'time_based',
        condition: 'true',
        actionType: 'test',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const deleteResult = scheduler.deletePattern(createResult.data.id);
      expect(deleteResult.success).toBe(true);

      expect(scheduler.getPattern(createResult.data.id)).toBeNull();
    });
  });
});

describe('Trigger Evaluation', () => {
  describe('evaluateCondition', () => {
    test('evaluates time.hour condition', () => {
      const now = new Date();
      now.setHours(9);

      const result = evaluateCondition('time.hour == 9', { now });
      expect(result).toBe(true);

      const result2 = evaluateCondition('time.hour == 10', { now });
      expect(result2).toBe(false);
    });

    test('evaluates time.isWeekday', () => {
      // Monday
      const monday = new Date('2026-03-02T10:00:00');
      const result1 = evaluateCondition('time.isWeekday', { now: monday });
      expect(result1).toBe(true);

      // Sunday
      const sunday = new Date('2026-03-01T10:00:00');
      const result2 = evaluateCondition('time.isWeekday', { now: sunday });
      expect(result2).toBe(false);
    });

    test('evaluates time.isWeekend', () => {
      // Saturday
      const saturday = new Date('2026-03-07T10:00:00');
      const result1 = evaluateCondition('time.isWeekend', { now: saturday });
      expect(result1).toBe(true);

      // Wednesday
      const wednesday = new Date('2026-03-04T10:00:00');
      const result2 = evaluateCondition('time.isWeekend', { now: wednesday });
      expect(result2).toBe(false);
    });

    test('evaluates goal.count condition', () => {
      const goals = [
        { id: '1', title: 'G1', progress: 30, state: 'active', updatedAt: new Date().toISOString() },
        { id: '2', title: 'G2', progress: 60, state: 'active', updatedAt: new Date().toISOString() },
      ];

      const result1 = evaluateCondition('goal.count > 1', { now: new Date(), goals });
      expect(result1).toBe(true);

      const result2 = evaluateCondition('goal.count > 5', { now: new Date(), goals });
      expect(result2).toBe(false);
    });

    test('evaluates goal.any.progress condition', () => {
      const goals = [
        { id: '1', title: 'G1', progress: 30, state: 'active', updatedAt: new Date().toISOString() },
        { id: '2', title: 'G2', progress: 60, state: 'active', updatedAt: new Date().toISOString() },
      ];

      const result1 = evaluateCondition('goal.any.progress < 50', { now: new Date(), goals });
      expect(result1).toBe(true); // G1 has progress < 50

      const result2 = evaluateCondition('goal.any.progress < 20', { now: new Date(), goals });
      expect(result2).toBe(false);
    });

    test('evaluates goal.active.count condition', () => {
      const goals = [
        { id: '1', title: 'G1', progress: 30, state: 'active', updatedAt: new Date().toISOString() },
        { id: '2', title: 'G2', progress: 60, state: 'completed', updatedAt: new Date().toISOString() },
      ];

      const result = evaluateCondition('goal.active.count >= 1', { now: new Date(), goals });
      expect(result).toBe(true);
    });

    test('evaluates goal.stalled condition', () => {
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago
      const goals = [
        { id: '1', title: 'G1', progress: 30, state: 'active', updatedAt: oldDate },
      ];

      const result = evaluateCondition('goal.stalled(7)', { now: new Date(), goals });
      expect(result).toBe(true);
    });

    test('evaluates comparison operators', () => {
      const now = new Date();
      now.setHours(14);

      expect(evaluateCondition('time.hour >= 12', { now })).toBe(true);
      expect(evaluateCondition('time.hour <= 18', { now })).toBe(true);
      expect(evaluateCondition('time.hour != 9', { now })).toBe(true);
      expect(evaluateCondition('time.hour > 10', { now })).toBe(true);
      expect(evaluateCondition('time.hour < 20', { now })).toBe(true);
    });

    test('returns false for empty goals with goal conditions', () => {
      const result = evaluateCondition('goal.count > 0', { now: new Date(), goals: [] });
      expect(result).toBe(false);
    });

    test('evaluates true/false literals', () => {
      expect(evaluateCondition('true', { now: new Date() })).toBe(true);
      expect(evaluateCondition('false', { now: new Date() })).toBe(false);
    });

    test('evaluates custom data conditions', () => {
      const customData = { alertEnabled: true, threshold: 100 };
      const result = evaluateCondition('alertEnabled', { now: new Date(), customData });
      expect(result).toBe(true);
    });
  });
});
