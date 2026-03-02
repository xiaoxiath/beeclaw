import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync, mkdirSync } from 'fs';
import { handleProactiveJob } from '../handlers/proactive-handler';
import { getGoalStore, resetGoalStore } from '../../goal/store';
import { getNotificationManager, resetNotificationManager } from '../../proactive/notifications';
import type { ProactiveJobData } from '../../types';
import type { Job } from 'bunqueue/client';

const TEST_PROACTIVE_HANDLER_PATH = './test-proactive-handler-data';

// Mock Job object
function createMockJob<T>(data: T): Job<T> {
  let progress = 0;
  return {
    id: `job-${Date.now()}`,
    name: 'test-job',
    data,
    queueName: 'test-queue',
    state: 'waiting',
    progress: 0,
    timestamp: Date.now(),
    updateProgress: async (p: number) => {
      progress = p;
    },
    getProgress: () => progress,
  } as unknown as Job<T>;
}

describe('Proactive Handler', () => {
  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_PROACTIVE_HANDLER_PATH)) {
      rmSync(TEST_PROACTIVE_HANDLER_PATH, { recursive: true });
    }
    mkdirSync(TEST_PROACTIVE_HANDLER_PATH, { recursive: true });
    resetGoalStore();
    resetNotificationManager();
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_PROACTIVE_HANDLER_PATH)) {
      rmSync(TEST_PROACTIVE_HANDLER_PATH, { recursive: true });
    }
    resetGoalStore();
    resetNotificationManager();
  });

  describe('handleProactiveJob', () => {
    test('handles check_goal_progress task', async () => {
      // Initialize goal store
      const goalStore = getGoalStore(TEST_PROACTIVE_HANDLER_PATH);
      goalStore.init();

      // Create a goal with low progress
      goalStore.create({
        title: 'Test Goal',
        description: 'Test description',
        progress: 30,
        target: 100,
        state: 'active',
      });

      const job = createMockJob<ProactiveJobData>({
        scheduleId: 'schedule-1',
        taskType: 'check_goal_progress',
        triggeredAt: new Date().toISOString(),
        triggeredBy: 'cron',
      });

      const result = await handleProactiveJob(job);

      expect(result).toBeDefined();
      expect((result as any).success).toBe(true);
      expect((result as any).taskType).toBe('check_goal_progress');
    });

    test('handles run_skill task', async () => {
      const job = createMockJob<ProactiveJobData>({
        scheduleId: 'schedule-2',
        taskType: 'run_skill',
        params: {
          skillName: 'test-skill',
          skillParams: { key: 'value' },
        },
        triggeredAt: new Date().toISOString(),
        triggeredBy: 'manual',
      });

      const result = await handleProactiveJob(job);

      expect(result).toBeDefined();
      expect((result as any).success).toBe(true);
      expect((result as any).result.skillName).toBe('test-skill');
    });

    test('run_skill throws without skillName', async () => {
      const job = createMockJob<ProactiveJobData>({
        scheduleId: 'schedule-3',
        taskType: 'run_skill',
        params: {},
        triggeredAt: new Date().toISOString(),
        triggeredBy: 'manual',
      });

      const result = await handleProactiveJob(job);

      expect((result as any).success).toBe(false);
      expect((result as any).error).toContain('skillName');
    });

    test('handles send_reminder task', async () => {
      // Initialize notification manager
      getNotificationManager(TEST_PROACTIVE_HANDLER_PATH);

      const job = createMockJob<ProactiveJobData>({
        scheduleId: 'schedule-4',
        taskType: 'send_reminder',
        params: {
          message: 'Test reminder message',
          userId: 'test-user',
          priority: 'high',
        },
        triggeredAt: new Date().toISOString(),
        triggeredBy: 'cron',
      });

      const result = await handleProactiveJob(job);

      expect(result).toBeDefined();
      expect((result as any).success).toBe(true);
      expect((result as any).result.message).toBe('Test reminder message');
    });

    test('send_reminder throws without message', async () => {
      const job = createMockJob<ProactiveJobData>({
        scheduleId: 'schedule-5',
        taskType: 'send_reminder',
        params: {},
        triggeredAt: new Date().toISOString(),
        triggeredBy: 'cron',
      });

      const result = await handleProactiveJob(job);

      expect((result as any).success).toBe(false);
      expect((result as any).error).toContain('message');
    });

    test('handles memory_compress task', async () => {
      const job = createMockJob<ProactiveJobData>({
        scheduleId: 'schedule-6',
        taskType: 'memory_compress',
        triggeredAt: new Date().toISOString(),
        triggeredBy: 'cron',
      });

      const result = await handleProactiveJob(job);

      expect(result).toBeDefined();
      expect((result as any).success).toBe(true);
      // Memory compression is not fully implemented yet
      expect((result as any).result.executed).toBe(false);
    });

    test('handles custom task', async () => {
      const job = createMockJob<ProactiveJobData>({
        scheduleId: 'schedule-7',
        taskType: 'custom',
        params: {
          action: 'custom-action',
          customParam: 'value',
        },
        triggeredAt: new Date().toISOString(),
        triggeredBy: 'pattern',
      });

      const result = await handleProactiveJob(job);

      expect(result).toBeDefined();
      expect((result as any).success).toBe(true);
      expect((result as any).result.action).toBe('custom-action');
    });

    test('custom task throws without action', async () => {
      const job = createMockJob<ProactiveJobData>({
        scheduleId: 'schedule-8',
        taskType: 'custom',
        params: {},
        triggeredAt: new Date().toISOString(),
        triggeredBy: 'manual',
      });

      const result = await handleProactiveJob(job);

      expect((result as any).success).toBe(false);
      expect((result as any).error).toContain('action');
    });

    test('returns error for unknown task type', async () => {
      const job = createMockJob<ProactiveJobData>({
        scheduleId: 'schedule-9',
        taskType: 'unknown_type' as any,
        triggeredAt: new Date().toISOString(),
        triggeredBy: 'manual',
      });

      const result = await handleProactiveJob(job);

      expect((result as any).success).toBe(false);
      expect((result as any).error).toContain('Unknown task type');
    });

    test('includes completedAt timestamp', async () => {
      const job = createMockJob<ProactiveJobData>({
        scheduleId: 'schedule-10',
        taskType: 'check_goal_progress',
        triggeredAt: new Date().toISOString(),
        triggeredBy: 'cron',
      });

      const result = await handleProactiveJob(job);

      expect((result as any).completedAt).toBeDefined();
    });

    test('includes scheduleId in result', async () => {
      const job = createMockJob<ProactiveJobData>({
        scheduleId: 'test-schedule-id',
        taskType: 'check_goal_progress',
        triggeredAt: new Date().toISOString(),
        triggeredBy: 'cron',
      });

      const result = await handleProactiveJob(job);

      expect((result as any).scheduleId).toBe('test-schedule-id');
    });
  });
});
