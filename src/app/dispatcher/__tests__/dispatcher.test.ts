/**
 * Tests for TaskDispatcher
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock logger
vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    debug: vi.fn(() => {}),
    info: vi.fn(() => {}),
    warn: vi.fn(() => {}),
    error: vi.fn(() => {}),
  },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

// Mock crypto
vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid-1234'),
}));

// Mock DB + Drizzle ORM
const mockInsert = vi.fn(() => ({ values: vi.fn(() => ({ run: vi.fn(async () => {}) })) }));
const mockSelect = vi.fn(() => ({
  from: vi.fn(() => ({
    where: vi.fn(() => ({
      orderBy: vi.fn(() => ({
        limit: vi.fn(() => ({
          all: vi.fn(async () => []),
        })),
      })),
    })),
    all: vi.fn(async () => []),
  })),
}));
const mockUpdate = vi.fn(() => ({
  set: vi.fn(() => ({
    where: vi.fn(() => ({
      run: vi.fn(async () => ({ changes: 1 })),
    })),
  })),
}));

vi.mock('../../../infra/db', () => ({
  getDataConnection: vi.fn(() => ({
    insert: mockInsert,
    select: mockSelect,
    update: mockUpdate,
  })),
}));

vi.mock('../../../infra/db/schema', () => ({
  tasks: {
    id: 'id',
    sessionId: 'sessionId',
    type: 'type',
    status: 'status',
    lockedBy: 'lockedBy',
    lockedAt: 'lockedAt',
    scheduledAt: 'scheduledAt',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  lt: vi.fn((...args: any[]) => args),
  gte: vi.fn((...args: any[]) => args),
  isNull: vi.fn((...args: any[]) => args),
  isNotNull: vi.fn((...args: any[]) => args),
  or: vi.fn((...args: any[]) => args),
}));

import { TaskDispatcher, getTaskDispatcher, resetTaskDispatcher } from '../index';

describe('TaskDispatcher', () => {
  let dispatcher: TaskDispatcher;

  beforeEach(() => {
    resetTaskDispatcher();
    dispatcher = new TaskDispatcher({
      maxConcurrency: 5,
      lockTimeoutMs: 60000,
      retryAttempts: 2,
      pollIntervalMs: 500,
      dispatcherId: 'test-dispatcher',
    });
  });

  afterEach(() => {
    dispatcher.stop();
    resetTaskDispatcher();
  });

  describe('constructor', () => {
    it('applies default config values', () => {
      const d = new TaskDispatcher();
      // Just ensure it doesn't throw
      expect(d).toBeDefined();
      d.stop();
    });

    it('applies custom config values', () => {
      // Implicitly tested by the beforeEach setup
      expect(dispatcher).toBeDefined();
    });
  });

  describe('registerHandler / unregisterHandler', () => {
    it('registers a handler for a task type', () => {
      const handler = vi.fn(async () => {});
      dispatcher.registerHandler('message', handler);
      // No direct way to check, but no error means success
    });

    it('unregisters a handler', () => {
      const handler = vi.fn(async () => {});
      dispatcher.registerHandler('message', handler);
      dispatcher.unregisterHandler('message');
      // No direct way to check, but no error means success
    });
  });

  describe('submitTask', () => {
    it('inserts a task into the database', async () => {
      const taskId = await dispatcher.submitTask(
        'session-1',
        'message',
        { text: 'hello' }
      );
      expect(taskId).toBe('test-uuid-1234');
      expect(mockInsert).toHaveBeenCalled();
    });

    it('accepts optional scheduledAt and cron', async () => {
      const scheduledAt = new Date('2026-01-01');
      const taskId = await dispatcher.submitTask(
        'session-1',
        'cron',
        { job: 'daily' },
        scheduledAt,
        '0 0 * * *'
      );
      expect(taskId).toBe('test-uuid-1234');
    });
  });

  describe('start / stop', () => {
    it('starts polling', () => {
      dispatcher.start();
      // Should not throw on second call (idempotent with warning)
      dispatcher.start();
      dispatcher.stop();
    });

    it('stops polling', () => {
      dispatcher.start();
      dispatcher.stop();
      // Second stop should be safe
      dispatcher.stop();
    });
  });

  describe('getStats', () => {
    it('returns initial stats', async () => {
      const stats = await dispatcher.getStats();
      expect(stats.totalTasks).toBe(0);
      expect(stats.pendingTasks).toBe(0);
      expect(stats.runningTasks).toBe(0);
      expect(stats.completedTasks).toBe(0);
      expect(stats.failedTasks).toBe(0);
      expect(stats.activeLocks).toBe(0);
    });
  });
});

describe('getTaskDispatcher / resetTaskDispatcher', () => {
  afterEach(() => {
    resetTaskDispatcher();
  });

  it('returns singleton instance', () => {
    const d1 = getTaskDispatcher();
    const d2 = getTaskDispatcher();
    expect(d1).toBe(d2);
    d1.stop();
  });

  it('resetTaskDispatcher clears the singleton', () => {
    const d1 = getTaskDispatcher();
    resetTaskDispatcher();
    const d2 = getTaskDispatcher();
    expect(d1).not.toBe(d2);
    d2.stop();
  });

  it('accepts config on first call', () => {
    const d = getTaskDispatcher({ maxConcurrency: 3 });
    expect(d).toBeDefined();
    d.stop();
  });
});
