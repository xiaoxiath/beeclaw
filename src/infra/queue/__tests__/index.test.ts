import { describe, test, expect, beforeEach, vi } from 'vitest';

// Comprehensive bunqueue mock with in-memory job storage
vi.mock('bunqueue/client', () => {
  const jobs = new Map<string, any>();
  let jobIdCounter = 0;

  class MockQueue {
    name: string;
    constructor(name: string, _opts?: any) { this.name = name; }
    async add(name: string, data: any, opts?: any) {
      const id = `job-${++jobIdCounter}`;
      const job = {
        id, name, data, state: opts?.delay ? 'delayed' : 'waiting',
        progress: 0, timestamp: Date.now(), returnvalue: null, failedReason: null,
        processedOn: null, finishedOn: null,
        remove: async () => { jobs.delete(id); },
        updateProgress: async (p: number) => { job.progress = p; },
      };
      jobs.set(id, job);
      return job;
    }
    async getJob(id: string) { return jobs.get(id) || null; }
    async getWaitingCount() { return [...jobs.values()].filter(j => j.state === 'waiting').length; }
    async getActiveCount() { return [...jobs.values()].filter(j => j.state === 'active').length; }
    async getCompletedCount() { return [...jobs.values()].filter(j => j.state === 'completed').length; }
    async getFailedCount() { return [...jobs.values()].filter(j => j.state === 'failed').length; }
    async getDelayedCount() { return [...jobs.values()].filter(j => j.state === 'delayed').length; }
    async getWaiting(_s: number, _e: number) { return [...jobs.values()].filter(j => j.state === 'waiting'); }
    async getActive(_s: number, _e: number) { return [...jobs.values()].filter(j => j.state === 'active'); }
    async getCompleted(_s: number, _e: number) { return [...jobs.values()].filter(j => j.state === 'completed'); }
    async getFailed(_s: number, _e: number) { return [...jobs.values()].filter(j => j.state === 'failed'); }
    async close() { jobs.clear(); }
  }

  class MockWorker {
    constructor(_name: string, _handler: any, _opts?: any) {}
    async close() {}
  }

  return { Queue: MockQueue, Worker: MockWorker };
});

vi.mock('bun:sqlite', () => {
  class MockDatabase {
    constructor() {}
    exec = vi.fn();
    run = vi.fn();
    query = vi.fn(() => ({ all: vi.fn(() => []) }));
    prepare = vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn() }));
    transaction = vi.fn((fn: Function) => fn);
    close = vi.fn();
  }
  return { Database: MockDatabase, default: MockDatabase };
});

vi.mock('drizzle-orm/bun-sqlite', () => ({
  drizzle: vi.fn(() => ({
    select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({ SSEClientTransport: vi.fn() }));

import { getTaskManager, initTaskManager, getTaskStatus, cancelTask, getQueueStatistics } from '../index';
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

  describe('getTaskStatus', () => {
    test('returns null for non-existent job', async () => {
      const status = await getTaskStatus('non-existent-job-id');
      expect(status).toBeNull();
    });
  });

  describe('cancelTask', () => {
    test('returns false for non-existent job', async () => {
      const result = await cancelTask('non-existent-job-id');
      expect(result).toBe(false);
    });
  });

  describe('getQueueStatistics', () => {
    test('returns queue statistics', async () => {
      const stats = await getQueueStatistics();
      expect(stats).toBeDefined();
      expect(typeof stats).toBe('object');
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
