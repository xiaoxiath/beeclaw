import { describe, test, expect, vi } from 'vitest';

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

import { createJobProcessor } from '../../../app/queue-handlers/workers';

// Mock Job object
function createMockJob<T>(data: T) {
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

describe('Queue Workers', () => {
  describe('createJobProcessor', () => {
    test('creates processor that calls handler with job data', async () => {
      const handler = async (data: { query: string }) => {
        return { result: `processed: ${data.query}` };
      };

      const processor = createJobProcessor(handler);
      const job = createMockJob({ query: 'test query' });

      const result = await processor(job as any);

      expect(result).toEqual({ result: 'processed: test query' });
    });

    test('updates progress to 100 at end', async () => {
      const handler = async () => {
        return 'done';
      };

      const processor = createJobProcessor(handler);
      const job = createMockJob({});

      await processor(job as any);

      expect(job.getProgress()).toBe(100);
    });

    test('handles handler that throws', async () => {
      const handler = async () => {
        throw new Error('Handler error');
      };

      const processor = createJobProcessor(handler);
      const job = createMockJob({});

      await expect(processor(job as any)).rejects.toThrow('Handler error');
    });

    test('passes complex data to handler', async () => {
      const handler = async (data: { items: number[]; options: Record<string, boolean> }) => {
        return { sum: data.items.reduce((a, b) => a + b, 0), options: data.options };
      };

      const processor = createJobProcessor(handler);
      const job = createMockJob({ items: [1, 2, 3, 4, 5], options: { flag: true } });

      const result = await processor(job as any);

      expect(result).toEqual({ sum: 15, options: { flag: true } });
    });

    test('returns handler result', async () => {
      const handler = async () => {
        return { status: 'success', count: 42 };
      };

      const processor = createJobProcessor(handler);
      const job = createMockJob({});

      const result = await processor(job as any);

      expect(result).toEqual({ status: 'success', count: 42 });
    });

    test('handles null result from handler', async () => {
      const handler = async () => {
        return null;
      };

      const processor = createJobProcessor(handler);
      const job = createMockJob({});

      const result = await processor(job as any);

      expect(result).toBeNull();
    });

    test('handles undefined result from handler', async () => {
      const handler = async () => {
        return undefined;
      };

      const processor = createJobProcessor(handler);
      const job = createMockJob({});

      const result = await processor(job as any);

      expect(result).toBeUndefined();
    });
  });
});
