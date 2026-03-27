import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { TaskManager, getTaskManager } from '../manager';
import type { QueueConfig } from '../types';

const TEST_QUEUE_PATH = './test-queue-data';

describe('TaskManager', () => {
  let manager: TaskManager;
  const config: QueueConfig = {
    enabled: true,
    mode: 'embedded',
    storage: { path: join(TEST_QUEUE_PATH, 'test.db') },
  };

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_QUEUE_PATH)) {
      rmSync(TEST_QUEUE_PATH, { recursive: true });
    }
    mkdirSync(TEST_QUEUE_PATH, { recursive: true });
    manager = new TaskManager(config);
  });

  afterEach(async () => {
    await manager.shutdown();
    // Clean up test directory
    if (existsSync(TEST_QUEUE_PATH)) {
      rmSync(TEST_QUEUE_PATH, { recursive: true });
    }
  });

  describe('initialize', () => {
    test('initializes queues', async () => {
      await manager.initialize();
      // Should not throw
    });

    test('does not initialize twice', async () => {
      await manager.initialize();
      await manager.initialize(); // Should be idempotent
    });
  });

  describe('addJob', () => {
    test('adds job to queue', async () => {
      await manager.initialize();

      const result = await manager.addJob('search-jobs', 'test-job', { query: 'test' });

      expect(result.jobId).toBeDefined();
    });

    test('adds job with options', async () => {
      await manager.initialize();

      const result = await manager.addJob('skill-jobs', 'skill-job', { skill: 'test' }, {
        priority: 10,
        delay: 5000,
        attempts: 3,
      });

      expect(result.jobId).toBeDefined();
    });

    test('throws for unknown queue', async () => {
      await manager.initialize();

      await expect(
        manager.addJob('unknown-queue' as any, 'job', {})
      ).rejects.toThrow('Queue not found');
    });
  });

  describe('getJob', () => {
    test('returns null for non-existent job', async () => {
      await manager.initialize();

      const job = await manager.getJob('non-existent');
      expect(job).toBeNull();
    });

    test('returns job by ID', async () => {
      await manager.initialize();

      const { jobId } = await manager.addJob('search-jobs', 'test', { data: 'test' });
      const job = await manager.getJob(jobId);

      expect(job).not.toBeNull();
      expect(job?.name).toBe('test');
    });
  });

  describe('getQueueStats', () => {
    test('returns queue statistics', async () => {
      await manager.initialize();

      const stats = await manager.getQueueStats('search-jobs');

      expect(stats).toBeDefined();
      expect(typeof stats.waiting).toBe('number');
      expect(typeof stats.active).toBe('number');
      expect(typeof stats.completed).toBe('number');
      expect(typeof stats.failed).toBe('number');
    });

    test('throws for unknown queue', async () => {
      await manager.initialize();

      await expect(
        manager.getQueueStats('unknown-queue' as any)
      ).rejects.toThrow('Queue not found');
    });
  });

  describe('getAllStats', () => {
    test('returns all queue statistics', async () => {
      await manager.initialize();

      const stats = await manager.getAllStats();

      expect(stats).toBeDefined();
      expect(stats['search-jobs']).toBeDefined();
      expect(stats['skill-jobs']).toBeDefined();
    });
  });

  describe('listJobs', () => {
    test('lists jobs in queue', async () => {
      await manager.initialize();

      await manager.addJob('search-jobs', 'job1', { q: 1 });
      await manager.addJob('search-jobs', 'job2', { q: 2 });

      const jobs = await manager.listJobs('search-jobs');

      expect(jobs.length).toBeGreaterThan(0);
    });

    test('lists jobs by state', async () => {
      await manager.initialize();

      await manager.addJob('search-jobs', 'job', { data: 'test' });

      const waitingJobs = await manager.listJobs('search-jobs', 'waiting');
      expect(waitingJobs.length).toBeGreaterThanOrEqual(0);
    });

    test('respects limit', async () => {
      await manager.initialize();

      for (let i = 0; i < 10; i++) {
        await manager.addJob('search-jobs', `job${i}`, { index: i });
      }

      const jobs = await manager.listJobs('search-jobs', undefined, 5);
      expect(jobs.length).toBeLessThanOrEqual(5);
    });
  });

  describe('cancelJob', () => {
    test('returns false for non-existent job', async () => {
      await manager.initialize();

      const result = await manager.cancelJob('non-existent');
      expect(result).toBe(false);
    });

    test('cancels existing job', async () => {
      await manager.initialize();

      const { jobId } = await manager.addJob('search-jobs', 'test', { data: 'test' });
      const result = await manager.cancelJob(jobId);

      expect(result).toBe(true);
    });
  });

  describe('registerWorker', () => {
    test('registers worker for queue', async () => {
      await manager.initialize();

      manager.registerWorker('search-jobs', async (job) => {
        return { processed: true };
      });

      // Should not throw
    });

    test('registers worker with options', async () => {
      await manager.initialize();

      manager.registerWorker('skill-jobs', async (job) => {
        return { done: true };
      }, { concurrency: 5 });

      // Should not throw
    });
  });

  describe('shutdown', () => {
    test('shuts down cleanly', async () => {
      await manager.initialize();
      await manager.shutdown();

      // Should be able to initialize again
      await manager.initialize();
    });
  });
});

describe('TaskManager Singleton', () => {
  afterEach(() => {
    // Reset singleton
    const manager = getTaskManager();
    manager.shutdown();
  });

  test('getTaskManager returns singleton', () => {
    const m1 = getTaskManager();
    const m2 = getTaskManager();

    expect(m1).toBe(m2);
  });
});
