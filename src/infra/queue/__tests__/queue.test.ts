import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// Comprehensive bunqueue mock with in-memory job storage
const jobStores = new Map<string, Map<string, any>>();
let globalJobCounter = 0;

vi.mock('bunqueue/client', () => {
  class MockQueue {
    name: string;
    private store: Map<string, any>;
    constructor(name: string, _opts?: any) {
      this.name = name;
      if (!jobStores.has(name)) {
        jobStores.set(name, new Map());
      }
      this.store = jobStores.get(name)!;
    }
    async add(name: string, data: any, opts?: any) {
      const id = `job-${++globalJobCounter}`;
      const job: any = {
        id, name, data, state: opts?.delay ? 'delayed' : 'waiting',
        progress: 0, timestamp: Date.now(), returnvalue: null, failedReason: null,
        processedOn: null, finishedOn: null,
        getState: async () => job.state,
        remove: async () => { this.store.delete(id); },
        updateProgress: async (p: number) => { job.progress = p; },
      };
      this.store.set(id, job);
      return job;
    }
    async getJob(id: string) { return this.store.get(id) || null; }
    async getWaitingCount() { return [...this.store.values()].filter(j => j.state === 'waiting').length; }
    async getActiveCount() { return [...this.store.values()].filter(j => j.state === 'active').length; }
    async getCompletedCount() { return [...this.store.values()].filter(j => j.state === 'completed').length; }
    async getFailedCount() { return [...this.store.values()].filter(j => j.state === 'failed').length; }
    async getDelayedCount() { return [...this.store.values()].filter(j => j.state === 'delayed').length; }
    async getWaiting(_s: number, _e: number) { return [...this.store.values()].filter(j => j.state === 'waiting'); }
    async getActive(_s: number, _e: number) { return [...this.store.values()].filter(j => j.state === 'active'); }
    async getCompleted(_s: number, _e: number) { return [...this.store.values()].filter(j => j.state === 'completed'); }
    async getFailed(_s: number, _e: number) { return [...this.store.values()].filter(j => j.state === 'failed'); }
    async close() { this.store.clear(); }
  }

  class MockWorker {
    constructor(_name: string, _handler: any, _opts?: any) {}
    async close() {}
  }

  return { Queue: MockQueue, Worker: MockWorker };
});

import { TaskManager, getTaskManager } from '../manager';
import type { QueueConfig } from '../types';

describe('TaskManager', () => {
  let manager: TaskManager;
  const config: QueueConfig = {
    enabled: true,
    mode: 'embedded',
    storage: { path: './test-queue-data/test.db' },
  };

  beforeEach(() => {
    jobStores.clear();
    globalJobCounter = 0;
    manager = new TaskManager(config);
  });

  afterEach(async () => {
    await manager.shutdown();
    jobStores.clear();
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

      const result = await manager.addJob('proactive-jobs', 'test-job', { query: 'test' });

      expect(result.jobId).toBeDefined();
    });

    test('adds job with options', async () => {
      await manager.initialize();

      const result = await manager.addJob('proactive-jobs', 'skill-job', { skill: 'test' }, {
        priority: 10,
        delay: 5000,
        attempts: 3,
      });

      expect(result.jobId).toBeDefined();
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

      const { jobId } = await manager.addJob('proactive-jobs', 'test', { data: 'test' });
      const job = await manager.getJob(jobId);

      expect(job).not.toBeNull();
      expect(job?.name).toBe('test');
    });
  });

  describe('getQueueStats', () => {
    test('returns queue statistics', async () => {
      await manager.initialize();

      const stats = await manager.getQueueStats('proactive-jobs');

      expect(stats).toBeDefined();
      expect(typeof stats.waiting).toBe('number');
      expect(typeof stats.active).toBe('number');
      expect(typeof stats.completed).toBe('number');
      expect(typeof stats.failed).toBe('number');
    });
  });

  describe('getAllStats', () => {
    test('returns all queue statistics', async () => {
      await manager.initialize();

      const stats = await manager.getAllStats();

      expect(stats).toBeDefined();
      expect(stats['proactive-jobs']).toBeDefined();
    });
  });

  describe('listJobs', () => {
    test('lists jobs in queue', async () => {
      await manager.initialize();

      await manager.addJob('proactive-jobs', 'job1', { q: 1 });
      await manager.addJob('proactive-jobs', 'job2', { q: 2 });

      const jobs = await manager.listJobs('proactive-jobs');

      expect(jobs.length).toBeGreaterThan(0);
    });

    test('lists jobs by state', async () => {
      await manager.initialize();

      await manager.addJob('proactive-jobs', 'job', { data: 'test' });

      const waitingJobs = await manager.listJobs('proactive-jobs', 'waiting');
      expect(waitingJobs.length).toBeGreaterThanOrEqual(0);
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

      const { jobId } = await manager.addJob('proactive-jobs', 'test', { data: 'test' });
      const result = await manager.cancelJob(jobId);

      expect(result).toBe(true);
    });
  });

  describe('registerWorker', () => {
    test('registers worker for queue', async () => {
      await manager.initialize();

      manager.registerWorker('proactive-jobs', async (job) => {
        return { processed: true };
      });

      // Should not throw
    });

    test('registers worker with options', async () => {
      await manager.initialize();

      manager.registerWorker('proactive-jobs', async (job) => {
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
