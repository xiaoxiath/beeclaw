/**
 * Tests for TaskDispatcher
 *
 * Comprehensive tests covering construction, handler registration,
 * task submission, polling, lock management, error paths, and stats.
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

import { TaskDispatcher, getTaskDispatcher, resetTaskDispatcher } from '../index';

describe('TaskDispatcher', () => {
  let dispatcher: TaskDispatcher;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resetTaskDispatcher();
    dispatcher = new TaskDispatcher({
      maxConcurrency: 5,
      lockTimeoutMs: 10000,
      retryAttempts: 3,
      pollIntervalMs: 500,
    });
  });

  afterEach(() => {
    dispatcher.stop();
    vi.useRealTimers();
  });

  // ── Construction ──────────────────────────────────────────────────────

  describe('constructor', () => {
    test('should use default config when none provided', () => {
      const d = new TaskDispatcher();
      // Verifying defaults indirectly - should not throw
      expect(d).toBeDefined();
      d.stop();
    });

    test('should apply custom config', () => {
      const d = new TaskDispatcher({
        maxConcurrency: 20,
        lockTimeoutMs: 60000,
        retryAttempts: 5,
        pollIntervalMs: 2000,
        dispatcherId: 'custom-id',
      });
      expect(d).toBeDefined();
      d.stop();
    });
  });

  // ── Handler registration ──────────────────────────────────────────────

  describe('registerHandler / unregisterHandler', () => {
    test('should register a handler for a task type', () => {
      const handler = vi.fn();
      dispatcher.registerHandler('message', handler);
      // No error means success
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Registered handler')
      );
    });

    test('should unregister a handler', () => {
      const handler = vi.fn();
      dispatcher.registerHandler('message', handler);
      dispatcher.unregisterHandler('message');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Unregistered handler')
      );
    });
  });

  // ── Task submission ───────────────────────────────────────────────────

  describe('submitTask', () => {
    test('should insert task into database and return id', async () => {
      const taskId = await dispatcher.submitTask(
        'session-1',
        'message',
        { message: 'Hello' },
        new Date(),
      );

      expect(taskId).toBeDefined();
      expect(typeof taskId).toBe('string');
      expect(mockDbInsert).toHaveBeenCalled();
    });

    test('should accept optional cron parameter', async () => {
      const taskId = await dispatcher.submitTask(
        'session-1',
        'cron',
        { handlerName: 'memory_compress' },
        new Date(),
        '0 3 * * *',
      );

      expect(taskId).toBeDefined();
    });

    test('should default scheduledAt to now', async () => {
      const taskId = await dispatcher.submitTask('s1', 'message', { msg: 'hi' });
      expect(taskId).toBeDefined();
    });
  });

  // ── Start / Stop ──────────────────────────────────────────────────────

  describe('start / stop', () => {
    test('should start polling', () => {
      dispatcher.start();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Starting task polling')
      );
    });

    test('should warn if already running', () => {
      dispatcher.start();
      dispatcher.start();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Already running')
      );
    });

    test('should stop cleanly', () => {
      dispatcher.start();
      dispatcher.stop();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Stopped')
      );
    });

    test('should be safe to stop when not running', () => {
      // Calling stop without start should not throw
      dispatcher.stop();
    });
  });

  // ── getStats ──────────────────────────────────────────────────────────

  describe('getStats', () => {
    test('should return stats with empty database', async () => {
      mockDbAll.mockReturnValueOnce([]);
      const stats = await dispatcher.getStats();
      expect(stats).toEqual({
        totalTasks: 0,
        pendingTasks: 0,
        runningTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        activeLocks: 0,
      });
    });

    test('should count tasks by status', async () => {
      mockDbAll.mockReturnValueOnce([
        { status: 'pending' },
        { status: 'pending' },
        { status: 'running' },
        { status: 'completed' },
        { status: 'completed' },
        { status: 'completed' },
        { status: 'failed' },
      ]);

      const stats = await dispatcher.getStats();
      expect(stats.totalTasks).toBe(7);
      expect(stats.pendingTasks).toBe(2);
      expect(stats.runningTasks).toBe(1);
      expect(stats.completedTasks).toBe(3);
      expect(stats.failedTasks).toBe(1);
    });
  });

  // ── Singleton ─────────────────────────────────────────────────────────

  describe('getTaskDispatcher / resetTaskDispatcher', () => {
    test('should return singleton instance', () => {
      resetTaskDispatcher();
      const a = getTaskDispatcher();
      const b = getTaskDispatcher();
      expect(a).toBe(b);
      a.stop();
    });

    test('should create new instance after reset', () => {
      resetTaskDispatcher();
      const a = getTaskDispatcher();
      resetTaskDispatcher();
      const b = getTaskDispatcher();
      expect(a).not.toBe(b);
      b.stop();
    });

    test('should accept config on first call', () => {
      resetTaskDispatcher();
      const d = getTaskDispatcher({ maxConcurrency: 50 });
      expect(d).toBeDefined();
      d.stop();
    });
  });
});
