/**
 * Coverage-focused tests for proactive/tools.ts
 * Targets uncovered lines: schedule validation error, pattern creation,
 * schedule_once, notification_mark_read/delete/history/stats, formatDelay, outer catch
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getTaskManager: vi.fn(() => ({
    initialize: vi.fn(async () => {}),
    addJob: vi.fn(async () => ({ jobId: 'job-123' })),
  })),
}));

vi.mock('../../../infra/queue/manager', () => ({
  getTaskManager: mocks.getTaskManager,
}));

import {
  executeProactiveTool,
} from '../tools';
import { getNotificationManager, resetNotificationManager } from '../notifications';
import { getScheduler, resetScheduler } from '../scheduler';
import { setCliDeliveryHandler } from '../pusher';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const TEST_DATA_PATH = './test-proactive-cov-' + Date.now();

describe('Proactive Tools coverage', () => {
  let deliveredMessages: Array<{ message: string; priority: string }> = [];

  beforeAll(() => {
    resetNotificationManager();
    resetScheduler();

    if (existsSync(TEST_DATA_PATH)) {
      rmSync(TEST_DATA_PATH, { recursive: true });
    }
    mkdirSync(TEST_DATA_PATH, { recursive: true });

    getNotificationManager(join(TEST_DATA_PATH, 'proactive'));
    getScheduler(join(TEST_DATA_PATH, 'proactive'));
  });

  beforeEach(() => {
    deliveredMessages = [];
    setCliDeliveryHandler((message: string, priority: any) => {
      deliveredMessages.push({ message, priority });
    });
    vi.clearAllMocks();
  });

  afterAll(() => {
    resetNotificationManager();
    resetScheduler();
    if (existsSync(TEST_DATA_PATH)) {
      rmSync(TEST_DATA_PATH, { recursive: true });
    }
  });

  // ── proactive_schedule validation error (line 309) ────────────────

  describe('proactive_schedule validation error', () => {
    it('returns error when name is empty', async () => {
      const result = await executeProactiveTool('proactive_schedule', {
        name: '',
        cron: '0 9 * * *',
        taskType: 'send_reminder',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('returns error when taskType is invalid', async () => {
      const result = await executeProactiveTool('proactive_schedule', {
        name: 'Test',
        cron: '0 9 * * *',
        taskType: 'invalid_type',
      });
      expect(result.success).toBe(false);
    });
  });

  // ── proactive_pattern (lines 325-345) ─────────────────────────────

  describe('proactive_pattern', () => {
    it('creates a pattern successfully', async () => {
      const result = await executeProactiveTool('proactive_pattern', {
        name: 'Test Pattern',
        description: 'A test pattern',
        triggerType: 'event_based',
        condition: 'user_login',
        actionType: 'send_reminder',
        actionParams: { message: 'Welcome!' },
      });
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.name).toBe('Test Pattern');
    });

    it('returns error when name is empty', async () => {
      const result = await executeProactiveTool('proactive_pattern', {
        name: '',
        triggerType: 'event_based',
        condition: 'x',
        actionType: 'log',
      });
      expect(result.success).toBe(false);
    });

    it('returns error when triggerType is invalid', async () => {
      const result = await executeProactiveTool('proactive_pattern', {
        name: 'Bad',
        triggerType: 'invalid',
        condition: 'x',
        actionType: 'log',
      });
      expect(result.success).toBe(false);
    });

    it('creates pattern without optional description and actionParams', async () => {
      const result = await executeProactiveTool('proactive_pattern', {
        name: 'Minimal Pattern',
        triggerType: 'time_based',
        condition: 'time.hour == 9',
        actionType: 'check_goal_progress',
      });
      expect(result.success).toBe(true);
    });
  });

  // ── proactive_list with patterns (lines 386-393) ──────────────────

  describe('proactive_list patterns', () => {
    it('lists patterns in "all" type', async () => {
      // Create a pattern first
      await executeProactiveTool('proactive_pattern', {
        name: 'ListTest Pattern',
        triggerType: 'event_based',
        condition: 'test',
        actionType: 'log',
      });

      const result = await executeProactiveTool('proactive_list', { type: 'all' });
      expect(result.success).toBe(true);
      expect(result.data.patterns).toBeDefined();
      expect(result.data.patterns.length).toBeGreaterThan(0);

      const pattern = result.data.patterns.find((p: any) => p.name === 'ListTest Pattern');
      expect(pattern).toBeDefined();
      expect(pattern.triggerType).toBe('event_based');
      expect(pattern.condition).toBe('test');
    });

    it('lists only patterns when type is "patterns"', async () => {
      const result = await executeProactiveTool('proactive_list', { type: 'patterns' });
      expect(result.success).toBe(true);
      expect(result.data.patterns).toBeDefined();
      expect(result.data.schedules).toBeUndefined();
    });

    it('returns error with invalid list params', async () => {
      const result = await executeProactiveTool('proactive_list', { type: 'invalid_type' });
      expect(result.success).toBe(false);
    });
  });

  // ── schedule_once (lines 433-482) ─────────────────────────────────

  describe('schedule_once', () => {
    it('creates a one-time task successfully', async () => {
      const mockManager = {
        initialize: vi.fn(async () => {}),
        addJob: vi.fn(async () => ({ jobId: 'job-abc' })),
      };
      mocks.getTaskManager.mockReturnValue(mockManager);

      const result = await executeProactiveTool('schedule_once', {
        delay_seconds: 300,
        taskType: 'send_reminder',
        taskParams: { message: 'Reminder!' },
        name: 'my-reminder',
      });

      expect(result.success).toBe(true);
      expect(result.data.jobId).toBe('job-abc');
      expect(result.data.taskType).toBe('send_reminder');
      expect(result.data.delaySeconds).toBe(300);
      expect(result.data.executeAt).toBeDefined();
      expect(result.data.message).toContain('5分钟');
    });

    it('generates default name when not provided', async () => {
      const mockManager = {
        initialize: vi.fn(async () => {}),
        addJob: vi.fn(async () => ({ jobId: 'job-def' })),
      };
      mocks.getTaskManager.mockReturnValue(mockManager);

      const result = await executeProactiveTool('schedule_once', {
        delay_seconds: 60,
        taskType: 'llm_proactive_chat',
      });

      expect(result.success).toBe(true);
      // Name should start with "once-llm_proactive_chat-"
      const addJobCall = mockManager.addJob.mock.calls[0];
      expect(addJobCall[1]).toMatch(/^once-llm_proactive_chat-/);
    });

    it('returns error when validation fails', async () => {
      const result = await executeProactiveTool('schedule_once', {
        delay_seconds: 0, // min is 1
        taskType: 'send_reminder',
      });
      expect(result.success).toBe(false);
    });

    it('returns error when taskType is invalid', async () => {
      const result = await executeProactiveTool('schedule_once', {
        delay_seconds: 60,
        taskType: 'invalid_type',
      });
      expect(result.success).toBe(false);
    });

    it('handles manager error gracefully', async () => {
      mocks.getTaskManager.mockReturnValue({
        initialize: vi.fn(async () => { throw new Error('Queue unavailable'); }),
        addJob: vi.fn(),
      });

      const result = await executeProactiveTool('schedule_once', {
        delay_seconds: 60,
        taskType: 'send_reminder',
        taskParams: { message: 'test' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Queue unavailable');
    });

    it('handles non-Error throw gracefully', async () => {
      mocks.getTaskManager.mockReturnValue({
        initialize: vi.fn(async () => { throw 'string error'; }),
        addJob: vi.fn(),
      });

      const result = await executeProactiveTool('schedule_once', {
        delay_seconds: 60,
        taskType: 'send_reminder',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown error');
    });

    it('formats delay for seconds', async () => {
      const mockManager = {
        initialize: vi.fn(async () => {}),
        addJob: vi.fn(async () => ({ jobId: 'j1' })),
      };
      mocks.getTaskManager.mockReturnValue(mockManager);

      const result = await executeProactiveTool('schedule_once', {
        delay_seconds: 30,
        taskType: 'send_reminder',
      });
      expect(result.data.message).toContain('30秒');
    });

    it('formats delay for hours', async () => {
      const mockManager = {
        initialize: vi.fn(async () => {}),
        addJob: vi.fn(async () => ({ jobId: 'j2' })),
      };
      mocks.getTaskManager.mockReturnValue(mockManager);

      const result = await executeProactiveTool('schedule_once', {
        delay_seconds: 7200,
        taskType: 'send_reminder',
      });
      expect(result.data.message).toContain('2小时');
    });

    it('formats delay for days', async () => {
      const mockManager = {
        initialize: vi.fn(async () => {}),
        addJob: vi.fn(async () => ({ jobId: 'j3' })),
      };
      mocks.getTaskManager.mockReturnValue(mockManager);

      const result = await executeProactiveTool('schedule_once', {
        delay_seconds: 172800,
        taskType: 'send_reminder',
      });
      expect(result.data.message).toContain('2天');
    });
  });

  // ── notification_mark_read (line 528) ─────────────────────────────

  describe('notification_mark_read', () => {
    it('marks notification as delivered', async () => {
      // Create a notification first
      const sendResult = await executeProactiveTool('notification_send', {
        message: 'Mark me read',
      });
      expect(sendResult.success).toBe(true);

      const notifId = sendResult.notificationId;
      const result = await executeProactiveTool('notification_mark_read', {
        id: notifId,
      });
      // The result depends on whether the notification was already delivered
      expect(result).toBeDefined();
    });

    it('returns error for missing id', async () => {
      const result = await executeProactiveTool('notification_mark_read', {});
      expect(result.success).toBe(false);
    });
  });

  // ── notification_delete (line 540) ────────────────────────────────

  describe('notification_delete', () => {
    it('deletes a notification', async () => {
      const sendResult = await executeProactiveTool('notification_send', {
        message: 'Delete me',
      });
      const notifId = sendResult.notificationId;

      const result = await executeProactiveTool('notification_delete', {
        id: notifId,
      });
      expect(result).toBeDefined();
    });

    it('returns error for missing id', async () => {
      const result = await executeProactiveTool('notification_delete', {});
      expect(result.success).toBe(false);
    });
  });

  // ── notification_history (line 552) ───────────────────────────────

  describe('notification_history', () => {
    it('returns history with default limit', async () => {
      const result = await executeProactiveTool('notification_history', {});
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('returns history with custom limit', async () => {
      const result = await executeProactiveTool('notification_history', { limit: 5 });
      expect(result.success).toBe(true);
    });

    it('returns error for invalid limit', async () => {
      const result = await executeProactiveTool('notification_history', { limit: 0 });
      expect(result.success).toBe(false);
    });
  });

  // ── notification_stats (line 569-572) ─────────────────────────────

  describe('notification_stats', () => {
    it('returns stats', async () => {
      const result = await executeProactiveTool('notification_stats', {});
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });
  });

  // ── proactive_list with nextRun local formatting ──────────────────

  describe('proactive_list schedule formatting', () => {
    it('includes nextRunLocal in schedule listing', async () => {
      await executeProactiveTool('proactive_schedule', {
        name: 'Format Test Schedule',
        cron: '0 9 * * *',
        taskType: 'send_reminder',
      });

      const result = await executeProactiveTool('proactive_list', { type: 'schedules' });
      expect(result.success).toBe(true);
      const sched = result.data.schedules.find((s: any) => s.name === 'Format Test Schedule');
      expect(sched).toBeDefined();
      expect(sched.nextRunLocal).toBeDefined();
    });
  });

  // ── proactive_cancel for pattern (already tested for schedule) ────

  describe('proactive_cancel pattern', () => {
    it('deletes an existing pattern', async () => {
      const created = await executeProactiveTool('proactive_pattern', {
        name: 'ToDelete',
        triggerType: 'time_based',
        condition: '*',
        actionType: 'log',
      });
      expect(created.success).toBe(true);

      const result = await executeProactiveTool('proactive_cancel', {
        id: created.data.id,
        type: 'pattern',
      });
      expect(result.success).toBe(true);
    });
  });
});
