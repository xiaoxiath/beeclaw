import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock logger
vi.mock('../../observability/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock bunqueue/client
const mockQueueAdd = vi.fn(() => Promise.resolve({ id: 'job-1' }));
const mockQueueGetJob = vi.fn(() => Promise.resolve(null));
const mockQueueClose = vi.fn(() => Promise.resolve());
const mockGetWaitingCount = vi.fn(() => Promise.resolve(0));
const mockGetActiveCount = vi.fn(() => Promise.resolve(0));
const mockGetCompletedCount = vi.fn(() => Promise.resolve(0));
const mockGetFailedCount = vi.fn(() => Promise.resolve(0));
const mockGetDelayedCount = vi.fn(() => Promise.resolve(0));
const mockGetWaiting = vi.fn(() => Promise.resolve([]));
const mockGetActive = vi.fn(() => Promise.resolve([]));
const mockGetCompleted = vi.fn(() => Promise.resolve([]));
const mockGetFailed = vi.fn(() => Promise.resolve([]));

vi.mock('bunqueue/client', () => {
  return {
    Queue: class MockQueue {
      name: string;
      constructor(name: string, _opts?: any) {
        this.name = name;
      }
      add = mockQueueAdd;
      getJob = mockQueueGetJob;
      close = mockQueueClose;
      getWaitingCount = mockGetWaitingCount;
      getActiveCount = mockGetActiveCount;
      getCompletedCount = mockGetCompletedCount;
      getFailedCount = mockGetFailedCount;
      getDelayedCount = mockGetDelayedCount;
      getWaiting = mockGetWaiting;
      getActive = mockGetActive;
      getCompleted = mockGetCompleted;
      getFailed = mockGetFailed;
    },
    Worker: class MockWorker {
      constructor(_queue: string, _handler: any, _opts?: any) {}
      close = vi.fn(() => Promise.resolve());
    },
  };
});

import { TaskManager, getTaskManager, initTaskManager } from '../manager';

describe('TaskManager', () => {
  let manager: TaskManager;

  beforeEach(() => {
    manager = new TaskManager();
    mockQueueAdd.mockReset();
    mockQueueAdd.mockReturnValue(Promise.resolve({ id: 'job-1' }));
    mockQueueGetJob.mockReset();
    mockQueueGetJob.mockReturnValue(Promise.resolve(null));
  });

  describe('initialize', () => {
    it('should initialize without errors', async () => {
      await expect(manager.initialize()).resolves.toBeUndefined();
    });

    it('should be idempotent', async () => {
      await manager.initialize();
      await expect(manager.initialize()).resolves.toBeUndefined();
    });
  });

  describe('addJob', () => {
    it('should add a job to a queue', async () => {
      await manager.initialize();
      const result = await manager.addJob('proactive-jobs', 'test-job', { foo: 'bar' });
      expect(result.jobId).toBe('job-1');
    });

    it('should add job with options', async () => {
      await manager.initialize();
      const result = await manager.addJob('proactive-jobs', 'test-job', {}, {
        priority: 5,
        delay: 1000,
        attempts: 3,
      });
      expect(result.jobId).toBeDefined();
    });

    it('should add job with repeat pattern', async () => {
      await manager.initialize();
      const result = await manager.addJob('proactive-jobs', 'cron-job', {}, {
        repeat: { pattern: '*/5 * * * *' },
      });
      expect(result.jobId).toBeDefined();
    });

    it('should auto-initialize if not initialized', async () => {
      const result = await manager.addJob('proactive-jobs', 'test-job', {});
      expect(result.jobId).toBeDefined();
    });
  });

  describe('getJob', () => {
    it('should return null when job not found', async () => {
      await manager.initialize();
      const result = await manager.getJob('nonexistent');
      expect(result).toBeNull();
    });

    it('should return formatted job when found', async () => {
      await manager.initialize();
      mockQueueGetJob.mockReturnValue(Promise.resolve({
        id: 'job-1',
        name: 'test',
        data: { foo: 'bar' },
        returnvalue: 'done',
        failedReason: null,
        progress: 100,
        timestamp: Date.now(),
        processedOn: Date.now(),
        finishedOn: Date.now(),
        getState: () => Promise.resolve('completed'),
        remove: () => Promise.resolve(),
      }));

      const result = await manager.getJob('job-1');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('job-1');
      expect(result!.name).toBe('test');
    });
  });

  describe('getQueueStats', () => {
    it('should return stats for a queue', async () => {
      await manager.initialize();
      mockGetWaitingCount.mockReturnValue(Promise.resolve(5));
      mockGetActiveCount.mockReturnValue(Promise.resolve(2));
      mockGetCompletedCount.mockReturnValue(Promise.resolve(10));
      mockGetFailedCount.mockReturnValue(Promise.resolve(1));
      mockGetDelayedCount.mockReturnValue(Promise.resolve(0));

      const stats = await manager.getQueueStats('proactive-jobs');
      expect(stats.waiting).toBe(5);
      expect(stats.active).toBe(2);
      expect(stats.completed).toBe(10);
      expect(stats.failed).toBe(1);
    });

    it('should return zeros on error', async () => {
      await manager.initialize();
      mockGetWaitingCount.mockRejectedValue(new Error('db error'));

      const stats = await manager.getQueueStats('proactive-jobs');
      expect(stats.waiting).toBe(0);
      expect(stats.active).toBe(0);
    });
  });

  describe('cancelJob', () => {
    it('should return false when job not found', async () => {
      await manager.initialize();
      const result = await manager.cancelJob('nonexistent');
      expect(result).toBe(false);
    });

    it('should cancel and return true when job found', async () => {
      await manager.initialize();
      const mockRemove = vi.fn(() => Promise.resolve());
      mockQueueGetJob.mockReturnValue(Promise.resolve({
        id: 'job-1',
        remove: mockRemove,
      }));

      const result = await manager.cancelJob('job-1');
      expect(result).toBe(true);
      expect(mockRemove).toHaveBeenCalled();
    });
  });

  describe('registerWorker', () => {
    it('should register a worker without error', async () => {
      await manager.initialize();
      expect(() => {
        manager.registerWorker('proactive-jobs', async (_job) => {});
      }).not.toThrow();
    });

    it('should register with concurrency option', async () => {
      await manager.initialize();
      expect(() => {
        manager.registerWorker('proactive-jobs', async (_job) => {}, { concurrency: 5 });
      }).not.toThrow();
    });
  });

  describe('shutdown', () => {
    it('should shutdown cleanly', async () => {
      await manager.initialize();
      await expect(manager.shutdown()).resolves.toBeUndefined();
    });

    it('should shutdown even without initialization', async () => {
      await expect(manager.shutdown()).resolves.toBeUndefined();
    });
  });

  describe('listJobs', () => {
    it('should list waiting jobs', async () => {
      await manager.initialize();
      mockGetWaiting.mockReturnValue(Promise.resolve([]));
      const jobs = await manager.listJobs('proactive-jobs', 'waiting');
      expect(jobs).toEqual([]);
    });

    it('should list all jobs when no state specified', async () => {
      await manager.initialize();
      const jobs = await manager.listJobs('proactive-jobs');
      expect(Array.isArray(jobs)).toBe(true);
    });
  });
});

describe('getTaskManager / initTaskManager', () => {
  it('should return a TaskManager instance', () => {
    // Note: this uses the global singleton which may already be set
    const tm = getTaskManager();
    expect(tm).toBeInstanceOf(TaskManager);
  });
});
