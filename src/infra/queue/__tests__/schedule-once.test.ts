/**
 * Integration test for schedule_once functionality
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// Comprehensive bunqueue mock
const jobStores = new Map<string, Map<string, any>>();
let globalJobCounter = 0;

vi.mock('bunqueue/client', () => {
  class MockQueue {
    name: string;
    private store: Map<string, any>;
    constructor(name: string, _opts?: any) {
      this.name = name;
      if (!jobStores.has(name)) jobStores.set(name, new Map());
      this.store = jobStores.get(name)!;
    }
    async add(name: string, data: any, opts?: any) {
      const id = `job-${++globalJobCounter}`;
      const job: any = {
        id, name, data, state: opts?.delay ? 'delayed' : 'waiting',
        progress: 0, timestamp: Date.now(), returnvalue: null, failedReason: null,
        processedOn: null, finishedOn: null,
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

import { getTaskManager } from '../manager';

describe('schedule_once Integration', () => {
  beforeEach(async () => {
    jobStores.clear();
    globalJobCounter = 0;
    const manager = getTaskManager({
      enabled: true,
      mode: 'embedded',
      storage: { path: './test-schedule-once.db' },
    });
    await manager.initialize();
  });

  afterEach(async () => {
    const manager = getTaskManager();
    await manager.shutdown();
    jobStores.clear();
  });

  test('schedule_once creates job in proactive-jobs queue', async () => {
    const manager = getTaskManager();

    const { jobId } = await manager.addJob(
      'proactive-jobs',
      'once-test-reminder',
      {
        scheduleId: 'once-test-reminder',
        taskType: 'send_reminder',
        params: { message: 'Test reminder from schedule_once' },
        triggeredAt: new Date(Date.now() + 5000).toISOString(),
        triggeredBy: 'delay',
      },
      { delay: 5000 }
    );

    expect(jobId).toBeDefined();

    const stats = await manager.getQueueStats('proactive-jobs');
    expect(stats.delayed).toBe(1);
  });

  test('schedule_once job can be created with minimal delay', async () => {
    const manager = getTaskManager();

    const { jobId } = await manager.addJob(
      'proactive-jobs',
      'once-immediate-test',
      {
        scheduleId: 'once-immediate-test',
        taskType: 'send_reminder',
        params: { message: 'Immediate test reminder' },
        triggeredAt: new Date().toISOString(),
        triggeredBy: 'delay',
      },
      { delay: 100 }
    );

    expect(jobId).toBeDefined();
    expect(jobId).toBeTruthy();
  });
});
