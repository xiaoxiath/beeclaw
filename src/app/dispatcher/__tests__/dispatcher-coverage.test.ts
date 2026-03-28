/**
 * Additional coverage tests for app/dispatcher/index.ts
 * Targets uncovered lines: 111-164, 192-237, 250-278, 291-310, 335-376
 * (pollAndProcess, getPendingTasks, acquireLock, processTask, releaseExpiredLocks)
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Hoisted DB mock ──────────────────────────────────────────────────────
const {
  mockDbInsert,
  mockDbUpdate,
  mockDbSelect,
  mockDbRun,
  mockDbAll,
  mockLogger,
  mockSet,
  mockWhere4Update,
  mockFrom,
  mockWhere4Select,
  mockOrderBy,
  mockLimit,
} = vi.hoisted(() => {
  const mockRun = vi.fn(() => ({ changes: 1 }));
  const mockAll = vi.fn(() => []);
  const mockLimit = vi.fn(() => ({ all: mockAll }));
  const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
  const mockWhere4Select = vi.fn(() => ({ orderBy: mockOrderBy, all: mockAll }));
  const mockFrom = vi.fn(() => ({ where: mockWhere4Select, all: mockAll }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));

  const mockValues = vi.fn(() => ({ run: mockRun }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));

  const mockWhere4Update = vi.fn(() => ({ run: mockRun }));
  const mockSet = vi.fn(() => ({ where: mockWhere4Update }));
  const mockUpdate = vi.fn(() => ({ set: mockSet }));

  return {
    mockDbInsert: mockInsert,
    mockDbUpdate: mockUpdate,
    mockDbSelect: mockSelect,
    mockDbRun: mockRun,
    mockDbAll: mockAll,
    mockLogger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    mockSet,
    mockWhere4Update,
    mockFrom,
    mockWhere4Select,
    mockOrderBy,
    mockLimit,
  };
});

vi.mock('../../../infra/db', () => ({
  getDataConnection: () => ({
    insert: mockDbInsert,
    update: mockDbUpdate,
    select: mockDbSelect,
  }),
}));

vi.mock('../../../infra/db/schema', () => ({
  tasks: {
    id: 'id',
    sessionId: 'session_id',
    type: 'type',
    payload: 'payload',
    scheduledAt: 'scheduled_at',
    cron: 'cron',
    status: 'status',
    attempts: 'attempts',
    maxAttempts: 'max_attempts',
    lockedBy: 'locked_by',
    lockedAt: 'locked_at',
    error: 'error',
    createdAt: 'created_at',
    startedAt: 'started_at',
    completedAt: 'completed_at',
    result: 'result',
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

vi.mock('../../../infra/observability/logger', () => ({
  logger: mockLogger,
}));

import { TaskDispatcher, resetTaskDispatcher } from '../index';

// Helper to create a task row
function makeTaskRow(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'task-1',
    sessionId: 'session-1',
    type: 'message',
    payload: { message: 'Hello' },
    scheduledAt: new Date(Date.now() - 1000),
    cron: null,
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
    lockedBy: null,
    lockedAt: null,
    error: null,
    createdAt: new Date(),
    startedAt: null,
    completedAt: null,
    result: null,
    ...overrides,
  };
}

describe('TaskDispatcher coverage - private methods', () => {
  let dispatcher: TaskDispatcher;

  beforeEach(() => {
    vi.clearAllMocks();
    resetTaskDispatcher();
    dispatcher = new TaskDispatcher({
      maxConcurrency: 5,
      lockTimeoutMs: 10000,
      retryAttempts: 3,
      pollIntervalMs: 100,
    });
  });

  afterEach(() => {
    dispatcher.stop();
  });

  // ─── pollAndProcess: process pending tasks ─────────────────────────────
  describe('pollAndProcess via start()', () => {
    test('should poll and process a pending task successfully', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      dispatcher.registerHandler('message', handler);

      // First poll: getPendingTasks returns one task
      const taskRow = makeTaskRow();
      // First mockAll call is for releaseExpiredLocks (update), then getPendingTasks (select)
      mockDbAll
        .mockReturnValueOnce([taskRow]); // getPendingTasks

      // acquireLock returns changes: 1 (success)
      mockDbRun.mockReturnValue({ changes: 1 });

      dispatcher.start();

      // Allow async operations to complete
      await new Promise(r => setTimeout(r, 50));

      dispatcher.stop();

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'task-1',
          sessionId: 'session-1',
          type: 'message',
        }),
      );

      // Task should be marked as completed
      expect(mockDbUpdate).toHaveBeenCalled();
    });

    test('should skip processing when at max concurrency', async () => {
      const handler = vi.fn(() => new Promise(() => {})); // Never resolves
      dispatcher.registerHandler('message', handler);

      // Create a dispatcher with maxConcurrency of 1
      dispatcher.stop();
      dispatcher = new TaskDispatcher({
        maxConcurrency: 1,
        pollIntervalMs: 50,
      });
      dispatcher.registerHandler('message', handler);

      // First poll returns a task
      mockDbAll.mockReturnValueOnce([makeTaskRow()]);
      mockDbRun.mockReturnValue({ changes: 1 });

      dispatcher.start();
      await new Promise(r => setTimeout(r, 30));

      // Second poll returns another task - but should be skipped (at max)
      mockDbAll.mockReturnValueOnce([makeTaskRow({ id: 'task-2', sessionId: 'session-2' })]);

      await new Promise(r => setTimeout(r, 80));
      dispatcher.stop();

      // Only the first task should have been processed
      expect(handler).toHaveBeenCalledTimes(1);
    });

    test('should skip tasks for sessions that are already locked', async () => {
      const handler = vi.fn(() => new Promise(() => {})); // Never resolves
      dispatcher.registerHandler('message', handler);

      // Return two tasks for the same session
      mockDbAll.mockReturnValueOnce([
        makeTaskRow({ id: 'task-1', sessionId: 'same-session' }),
        makeTaskRow({ id: 'task-2', sessionId: 'same-session' }),
      ]);
      mockDbRun.mockReturnValue({ changes: 1 });

      dispatcher.start();
      await new Promise(r => setTimeout(r, 30));
      dispatcher.stop();

      // Only first task should be processed (second skipped due to session lock)
      expect(handler).toHaveBeenCalledTimes(1);
    });

    test('should handle poll error gracefully', async () => {
      // Make select throw
      mockFrom.mockImplementationOnce(() => { throw new Error('db error'); });

      dispatcher.start();
      await new Promise(r => setTimeout(r, 30));
      dispatcher.stop();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Initial poll error'),
        expect.any(Error),
      );
    });
  });

  // ─── acquireLock ───────────────────────────────────────────────────────
  describe('acquireLock', () => {
    test('should fail to acquire lock when changes is 0', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      dispatcher.registerHandler('message', handler);

      mockDbAll.mockReturnValueOnce([makeTaskRow()]);
      // Lock acquisition fails (0 changes)
      mockDbRun.mockReturnValueOnce({ changes: 0 }) // releaseExpiredLocks
        .mockReturnValueOnce({ changes: 0 }); // acquireLock fails

      dispatcher.start();
      await new Promise(r => setTimeout(r, 30));
      dispatcher.stop();

      // Handler should NOT have been called
      expect(handler).not.toHaveBeenCalled();
    });

    test('should handle lock acquisition error', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      dispatcher.registerHandler('message', handler);

      mockDbAll.mockReturnValueOnce([makeTaskRow()]);
      // Make update throw on acquireLock
      let callCount = 0;
      mockDbRun.mockImplementation(() => {
        callCount++;
        if (callCount === 2) { // Second call is acquireLock
          throw new Error('lock error');
        }
        return { changes: 1 };
      });

      dispatcher.start();
      await new Promise(r => setTimeout(r, 30));
      dispatcher.stop();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to acquire lock'),
        expect.any(Error),
      );
    });
  });

  // ─── processTask ───────────────────────────────────────────────────────
  describe('processTask', () => {
    test('should handle missing handler for task type', async () => {
      // Don't register any handler
      mockDbAll.mockReturnValueOnce([makeTaskRow({ type: 'unknown' })]);
      mockDbRun.mockReturnValue({ changes: 1 });

      dispatcher.start();
      await new Promise(r => setTimeout(r, 50));
      dispatcher.stop();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('failed'),
        expect.stringContaining('No handler registered'),
      );
    });

    test('should retry task on failure with exponential backoff', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('handler error'));
      dispatcher.registerHandler('message', handler);

      // Task with attempts=0, maxAttempts=3 -> should retry
      mockDbAll.mockReturnValueOnce([makeTaskRow({ attempts: 0, maxAttempts: 3 })]);
      mockDbRun.mockReturnValue({ changes: 1 });

      dispatcher.start();
      await new Promise(r => setTimeout(r, 50));
      dispatcher.stop();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('failed (attempt 1/3)'),
        expect.any(String),
      );
      // Should reschedule (not mark as permanently failed)
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('rescheduled for retry'),
      );
    });

    test('should mark task as permanently failed after max attempts', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('handler error'));
      dispatcher.registerHandler('message', handler);

      // Task at last attempt
      mockDbAll.mockReturnValueOnce([makeTaskRow({ attempts: 2, maxAttempts: 3 })]);
      mockDbRun.mockReturnValue({ changes: 1 });

      dispatcher.start();
      await new Promise(r => setTimeout(r, 50));
      dispatcher.stop();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('failed permanently'),
      );
    });

    test('should release lock and running state in finally block', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      dispatcher.registerHandler('message', handler);

      mockDbAll.mockReturnValueOnce([makeTaskRow()]);
      mockDbRun.mockReturnValue({ changes: 1 });

      dispatcher.start();
      await new Promise(r => setTimeout(r, 50));
      dispatcher.stop();

      // After processing, the task should no longer be in activeLocks/runningTasks
      // Verified indirectly: another task for the same session should be processable
      mockDbAll.mockReturnValueOnce([makeTaskRow({ id: 'task-2' })]);
      dispatcher.start();
      await new Promise(r => setTimeout(r, 50));
      dispatcher.stop();

      expect(handler).toHaveBeenCalledTimes(2);
    });

    test('should handle non-Error thrown from handler', async () => {
      const handler = vi.fn().mockRejectedValue('string error');
      dispatcher.registerHandler('message', handler);

      mockDbAll.mockReturnValueOnce([makeTaskRow({ attempts: 2, maxAttempts: 3 })]);
      mockDbRun.mockReturnValue({ changes: 1 });

      dispatcher.start();
      await new Promise(r => setTimeout(r, 50));
      dispatcher.stop();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('failed permanently'),
      );
    });
  });

  // ─── releaseExpiredLocks ───────────────────────────────────────────────
  describe('releaseExpiredLocks', () => {
    test('should handle database locked error gracefully', async () => {
      // Make update throw a "locked" error on the releaseExpiredLocks call
      mockDbRun.mockImplementationOnce(() => {
        throw new Error('database locked');
      });

      // Provide tasks so pollAndProcess continues
      mockDbAll.mockReturnValueOnce([]);

      dispatcher.start();
      await new Promise(r => setTimeout(r, 30));
      dispatcher.stop();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Database locked'),
      );
    });

    test('should handle generic error in releaseExpiredLocks', async () => {
      mockDbRun.mockImplementationOnce(() => {
        throw new Error('generic db error');
      });

      mockDbAll.mockReturnValueOnce([]);

      dispatcher.start();
      await new Promise(r => setTimeout(r, 30));
      dispatcher.stop();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error releasing expired locks'),
        expect.any(Error),
      );
    });
  });

  // ─── getStats with active locks ────────────────────────────────────────
  describe('getStats with active tasks', () => {
    test('should count active locks in stats', async () => {
      const handler = vi.fn(() => new Promise(() => {})); // Never resolves
      dispatcher.registerHandler('message', handler);

      mockDbAll
        .mockReturnValueOnce([makeTaskRow()])  // getPendingTasks
        .mockReturnValueOnce([{ status: 'running' }]); // getStats

      mockDbRun.mockReturnValue({ changes: 1 });

      dispatcher.start();
      await new Promise(r => setTimeout(r, 30));

      const stats = await dispatcher.getStats();
      expect(stats.activeLocks).toBeGreaterThanOrEqual(1);

      dispatcher.stop();
    });
  });
});
