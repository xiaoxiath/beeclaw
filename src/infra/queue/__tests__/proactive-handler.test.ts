import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('bunqueue/client', () => ({ Queue: vi.fn(), Worker: vi.fn() }));

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

import { handleProactiveJob } from '../../../app/queue-handlers/handlers/proactive-handler';

// Mock Job object
function createMockJob<T>(data: T): any {
  let progress = 0;
  return {
    id: `job-${Date.now()}`,
    name: 'test-job',
    data,
    queueName: 'test-queue',
    state: 'waiting',
    progress: 0,
    timestamp: Date.now(),
    updateProgress: async (p: number) => { progress = p; },
    getProgress: () => progress,
  };
}

describe('Proactive Handler', () => {
  describe('handleProactiveJob', () => {
    test('handles send_reminder task', async () => {
      const mockJob = createMockJob({
        scheduleId: 'once-reminder-123',
        taskType: 'send_reminder',
        params: { message: 'Test reminder message', priority: 'normal' },
        triggeredAt: new Date().toISOString(),
        triggeredBy: 'delay',
      });

      const result = await handleProactiveJob(mockJob);

      expect(result).toMatchObject({
        success: true,
        scheduleId: 'once-reminder-123',
        taskType: 'send_reminder',
      });
    });

    test('handles llm_proactive_chat task', async () => {
      const mockJob = createMockJob({
        scheduleId: 'once-llm-456',
        taskType: 'llm_proactive_chat',
        params: { prompt: 'Say hello', userId: 'test-user' },
        triggeredAt: new Date().toISOString(),
        triggeredBy: 'delay',
      });

      const result = await handleProactiveJob(mockJob);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('scheduleId', 'once-llm-456');
      expect(result).toHaveProperty('taskType', 'llm_proactive_chat');
    });

    test('includes completedAt timestamp', async () => {
      const mockJob = createMockJob({
        scheduleId: 'schedule-10',
        taskType: 'send_reminder',
        params: { message: 'test' },
        triggeredAt: new Date().toISOString(),
        triggeredBy: 'cron',
      });

      const result = await handleProactiveJob(mockJob);

      expect((result as any).completedAt).toBeDefined();
    });

    test('includes scheduleId in result', async () => {
      const mockJob = createMockJob({
        scheduleId: 'test-schedule-id',
        taskType: 'send_reminder',
        params: { message: 'test' },
        triggeredAt: new Date().toISOString(),
        triggeredBy: 'cron',
      });

      const result = await handleProactiveJob(mockJob);

      expect((result as any).scheduleId).toBe('test-schedule-id');
    });
  });
});
