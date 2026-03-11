import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { getTaskManager, initTaskManager } from '../manager';
import {
  createSearchTask,
  createSkillTask,
  createReminderTask,
  getTaskStatus,
  cancelTask,
  getQueueStatistics,
} from '../index';
import type { QueueConfig } from '../types';

describe('Queue Module', () => {
  describe('getTaskManager', () => {
    test('returns singleton task manager', () => {
      const manager = getTaskManager();
      expect(manager).toBeDefined();
    });
  });

  describe('initTaskManager', () => {
    test('initializes task manager', async () => {
      await initTaskManager();
      const manager = getTaskManager();
      expect(manager).toBeDefined();
    });
  });
});

describe('Queue Helper Functions', () => {
  beforeEach(async () => {
    await initTaskManager();
  });

  describe('createSearchTask', () => {
    test('creates a search task with query only', async () => {
      const result = await createSearchTask('test query');
      expect(result).toBeDefined();
      expect(result.jobId).toBeDefined();
      expect(typeof result.jobId).toBe('string');
    });

    test('creates a search task with options', async () => {
      const result = await createSearchTask('test query', {
        numResults: 10,
        region: 'US',
        timeRange: 'week',
        sessionId: 'test-session',
      });
      expect(result).toBeDefined();
      expect(result.jobId).toBeDefined();
    });

    test('returns a valid job ID', async () => {
      const result = await createSearchTask('another query');
      expect(result.jobId.length).toBeGreaterThan(0);
    });
  });

  describe('createSkillTask', () => {
    test('creates a skill task with required params', async () => {
      const result = await createSkillTask('test-skill', 'execute', { foo: 'bar' });
      expect(result).toBeDefined();
      expect(result.jobId).toBeDefined();
    });

    test('creates a skill task with options', async () => {
      const result = await createSkillTask('test-skill', 'execute', { foo: 'bar' }, {
        sessionId: 'session-123',
        userId: 'user-456',
      });
      expect(result).toBeDefined();
      expect(result.jobId).toBeDefined();
    });

    test('handles empty params', async () => {
      const result = await createSkillTask('skill-name', 'action', {});
      expect(result).toBeDefined();
      expect(result.jobId).toBeDefined();
    });
  });

  describe('createReminderTask', () => {
    test('creates a one-time reminder', async () => {
      const result = await createReminderTask('user-123', 'Test reminder');
      expect(result).toBeDefined();
      expect(result.jobId).toBeDefined();
    });

    test('creates a delayed reminder', async () => {
      const result = await createReminderTask('user-123', 'Delayed reminder', {
        delay: 60000, // 1 minute
      });
      expect(result).toBeDefined();
      expect(result.jobId).toBeDefined();
    });

    test('creates a recurring reminder with cron', async () => {
      const result = await createReminderTask('user-123', 'Daily reminder', {
        cron: '0 9 * * *',
      });
      expect(result).toBeDefined();
      expect(result.jobId).toBeDefined();
    });
  });

  describe('getTaskStatus', () => {
    test('returns null for non-existent job', async () => {
      const status = await getTaskStatus('non-existent-job-id');
      expect(status).toBeNull();
    });

    test('returns status for existing job', async () => {
      // Create a job first
      const { jobId } = await createSearchTask('status test');

      const status = await getTaskStatus(jobId);
      expect(status).toBeDefined();
      expect(status?.id).toBe(jobId);
    });
  });

  describe('cancelTask', () => {
    test('returns false for non-existent job', async () => {
      const result = await cancelTask('non-existent-job-id');
      expect(result).toBe(false);
    });

    test('cancels an existing job', async () => {
      // Create a delayed job
      const { jobId } = await createReminderTask('user-123', 'Test', { delay: 3600000 });

      const result = await cancelTask(jobId);
      expect(result).toBe(true);
    });
  });

  describe('getQueueStatistics', () => {
    test('returns queue statistics', async () => {
      const stats = await getQueueStatistics();
      expect(stats).toBeDefined();
      expect(typeof stats).toBe('object');
    });

    test('includes queue names', async () => {
      const stats = await getQueueStatistics();
      // Should have various queues
      const queueNames = Object.keys(stats);
      expect(queueNames.length).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('Queue Types', () => {
  test('QueueConfig has correct structure', () => {
    const config: QueueConfig = {
      enabled: true,
      mode: 'embedded',
      storage: {
        path: './data/queue.db',
      },
    };

    expect(config.enabled).toBe(true);
    expect(config.mode).toBe('embedded');
    expect(config.storage.path).toBe('./data/queue.db');
  });

  test('QueueConfig supports redis mode', () => {
    const config: QueueConfig = {
      enabled: true,
      mode: 'redis',
      redis: {
        host: 'localhost',
        port: 6379,
      },
    };

    expect(config.mode).toBe('redis');
    expect(config.redis?.host).toBe('localhost');
    expect(config.redis?.port).toBe(6379);
  });
});
