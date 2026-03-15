/**
 * TaskDispatcher - Unified task scheduling and execution
 * RFC-02: TaskDispatcher implementation
 */

import { randomUUID } from 'crypto';
import { getDataConnection } from '../../infra/db';
import { tasks as tasksTable } from '../../infra/db/schema';
import { eq, and, lt, gte, isNull, or } from 'drizzle-orm';
import type {
  Task,
  TaskType,
  TaskStatus,
  TaskHandler,
  TaskDispatcherConfig,
  TaskDispatcherStats,
} from './types';

/**
 * TaskDispatcher - Centralized task scheduling and execution
 *
 * Features:
 * - Per-session locks (enforce serial execution per session)
 * - Task polling from SQLite
 * - Retry logic with exponential backoff
 * - Handler registration for different task types
 *
 * Usage:
 *   const dispatcher = getTaskDispatcher();
 *   dispatcher.registerHandler('message', async (task) => { ... });
 *   dispatcher.start();
 */
export class TaskDispatcher {
  private config: Required<TaskDispatcherConfig>;
  private handlers: Map<TaskType, TaskHandler> = new Map();
  private activeLocks: Map<string, string> = new Map(); // sessionId -> taskId
  private runningTasks: Set<string> = new Set();
  private pollTimer?: Timer;
  private isRunning = false;

  constructor(config: TaskDispatcherConfig = {}) {
    this.config = {
      maxConcurrency: config.maxConcurrency ?? 10,
      lockTimeoutMs: config.lockTimeoutMs ?? 300000, // 5 minutes
      retryAttempts: config.retryAttempts ?? 3,
      pollIntervalMs: config.pollIntervalMs ?? 1000,
      dispatcherId: config.dispatcherId ?? `dispatcher-${process.pid}-${Date.now()}`,
    };
  }

  /**
   * Register a handler for a task type
   */
  registerHandler(type: TaskType, handler: TaskHandler): void {
    this.handlers.set(type, handler);
    console.log(`[Dispatcher] Registered handler for task type: ${type}`);
  }

  /**
   * Unregister a handler
   */
  unregisterHandler(type: TaskType): void {
    this.handlers.delete(type);
    console.log(`[Dispatcher] Unregistered handler for task type: ${type}`);
  }

  /**
   * Submit a new task to the dispatcher
   */
  async submitTask(
    sessionId: string,
    type: TaskType,
    payload: Record<string, any>,
    scheduledAt: Date = new Date(),
    cron?: string
  ): Promise<string> {
    const db = getDataConnection();
    const taskId = randomUUID();

    await db.insert(tasksTable).values({
      id: taskId,
      sessionId,
      type,
      payload,
      scheduledAt,
      cron,
      status: 'pending',
      attempts: 0,
      maxAttempts: this.config.retryAttempts,
      createdAt: new Date(),
    }).run();

    console.log(`[Dispatcher] Submitted task ${taskId} (type: ${type}, session: ${sessionId})`);
    return taskId;
  }

  /**
   * Start the task polling loop
   */
  start(): void {
    if (this.isRunning) {
      console.warn('[Dispatcher] Already running');
      return;
    }

    this.isRunning = true;
    console.log(`[Dispatcher] Starting task polling (interval: ${this.config.pollIntervalMs}ms)`);

    // Start polling
    this.pollTimer = setInterval(() => {
      this.pollAndProcess().catch(error => {
        console.error('[Dispatcher] Poll error:', error);
      });
    }, this.config.pollIntervalMs);

    // Run initial poll immediately
    this.pollAndProcess().catch(error => {
      console.error('[Dispatcher] Initial poll error:', error);
    });
  }

  /**
   * Stop the task polling loop
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }

    console.log('[Dispatcher] Stopped task polling');
  }

  /**
   * Poll for pending tasks and process them
   */
  private async pollAndProcess(): Promise<void> {
    if (this.runningTasks.size >= this.config.maxConcurrency) {
      return; // Already at max capacity
    }

    // Release expired locks
    await this.releaseExpiredLocks();

    // Get pending tasks
    const tasks = await this.getPendingTasks();

    for (const task of tasks) {
      if (this.runningTasks.size >= this.config.maxConcurrency) {
        break; // Stop if we hit concurrency limit
      }

      // Check if session is already locked
      if (this.activeLocks.has(task.sessionId)) {
        continue; // Skip - another task for this session is running
      }

      // Acquire lock and process
      if (await this.acquireLock(task)) {
        this.processTask(task).catch(error => {
          console.error(`[Dispatcher] Task ${task.id} failed:`, error);
        });
      }
    }
  }

  /**
   * Get pending tasks from database
   */
  private async getPendingTasks(): Promise<Task[]> {
    const db = getDataConnection();
    const now = new Date();

    const rows = await db.select()
      .from(tasksTable)
      .where(and(
        eq(tasksTable.status, 'pending'),
        or(
          isNull(tasksTable.lockedBy),
          lt(tasksTable.lockedAt, new Date(now.getTime() - this.config.lockTimeoutMs))
        ),
        gte(tasksTable.scheduledAt, new Date(0)), // scheduledAt <= now
        lt(tasksTable.scheduledAt, now)
      ))
      .orderBy(tasksTable.scheduledAt)
      .limit(this.config.maxConcurrency)
      .all();

    return rows.map(row => this.rowToTask(row));
  }

  /**
   * Acquire lock for a task
   */
  private async acquireLock(task: Task): Promise<boolean> {
    const db = getDataConnection();

    try {
      // Try to acquire lock
      const result = await db.update(tasksTable)
        .set({
          lockedBy: this.config.dispatcherId,
          lockedAt: new Date(),
        })
        .where(and(
          eq(tasksTable.id, task.id),
          or(
            isNull(tasksTable.lockedBy),
            lt(tasksTable.lockedAt, new Date(Date.now() - this.config.lockTimeoutMs))
          )
        ))
        .run();

      if (result.changes > 0) {
        this.activeLocks.set(task.sessionId, task.id);
        return true;
      }

      return false;
    } catch (error) {
      console.error(`[Dispatcher] Failed to acquire lock for task ${task.id}:`, error);
      return false;
    }
  }

  /**
   * Process a task
   */
  private async processTask(task: Task): Promise<void> {
    this.runningTasks.add(task.id);
    const db = getDataConnection();

    try {
      console.log(`[Dispatcher] Processing task ${task.id} (type: ${task.type})`);

      // Update status to running
      await db.update(tasksTable)
        .set({
          status: 'running',
          startedAt: new Date(),
          attempts: task.attempts + 1,
        })
        .where(eq(tasksTable.id, task.id))
        .run();

      // Get handler
      const handler = this.handlers.get(task.type);
      if (!handler) {
        throw new Error(`No handler registered for task type: ${task.type}`);
      }

      // Execute handler
      await handler(task);

      // Mark as completed
      await db.update(tasksTable)
        .set({
          status: 'completed',
          completedAt: new Date(),
          lockedBy: null,
          lockedAt: null,
        })
        .where(eq(tasksTable.id, task.id))
        .run();

      console.log(`[Dispatcher] Task ${task.id} completed`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Dispatcher] Task ${task.id} failed (attempt ${task.attempts + 1}/${task.maxAttempts}):`, errorMsg);

      // Check if we should retry
      if (task.attempts + 1 < task.maxAttempts) {
        // Retry with exponential backoff
        const backoffMs = Math.min(1000 * Math.pow(2, task.attempts), 60000); // Max 1 minute
        const scheduledAt = new Date(Date.now() + backoffMs);

        await db.update(tasksTable)
          .set({
            status: 'pending',
            error: errorMsg,
            lockedBy: null,
            lockedAt: null,
            scheduledAt,
          })
          .where(eq(tasksTable.id, task.id))
          .run();

        console.log(`[Dispatcher] Task ${task.id} rescheduled for retry at ${scheduledAt.toISOString()}`);
      } else {
        // Max attempts reached - mark as failed
        await db.update(tasksTable)
          .set({
            status: 'failed',
            error: errorMsg,
            completedAt: new Date(),
            lockedBy: null,
            lockedAt: null,
          })
          .where(eq(tasksTable.id, task.id))
          .run();

        console.error(`[Dispatcher] Task ${task.id} failed permanently after ${task.maxAttempts} attempts`);
      }
    } finally {
      // Release lock
      this.activeLocks.delete(task.sessionId);
      this.runningTasks.delete(task.id);
    }
  }

  /**
   * Release expired locks
   */
  private async releaseExpiredLocks(): Promise<void> {
    try {
      const db = getDataConnection();
      const now = new Date();
      const timeoutDate = new Date(now.getTime() - this.config.lockTimeoutMs);

      await db.update(tasksTable)
        .set({
          lockedBy: null,
          lockedAt: null,
        })
        .where(and(
          lt(tasksTable.lockedAt, timeoutDate),
          isNull(tasksTable.lockedBy) === false
        ))
        .run();
    } catch (error) {
      // Database lock is acceptable - we'll try again next poll
      if (error instanceof Error && error.message?.includes('locked')) {
        console.warn('[Dispatcher] Database locked while releasing expired locks, will retry next poll');
      } else {
        console.error('[Dispatcher] Error releasing expired locks:', error);
      }
    }
  }

  /**
   * Get dispatcher statistics
   */
  async getStats(): Promise<TaskDispatcherStats> {
    const db = getDataConnection();

    const rows = await db.select()
      .from(tasksTable)
      .all();

    const stats: TaskDispatcherStats = {
      totalTasks: rows.length,
      pendingTasks: 0,
      runningTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      activeLocks: this.activeLocks.size,
    };

    for (const row of rows) {
      if (row.status === 'pending') stats.pendingTasks++;
      else if (row.status === 'running') stats.runningTasks++;
      else if (row.status === 'completed') stats.completedTasks++;
      else if (row.status === 'failed') stats.failedTasks++;
    }

    return stats;
  }

  /**
   * Convert database row to Task object
   */
  private rowToTask(row: any): Task {
    return {
      id: row.id,
      sessionId: row.sessionId,
      type: row.type,
      payload: row.payload,
      scheduledAt: row.scheduledAt,
      cron: row.cron || undefined,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      error: row.error || undefined,
      lockedBy: row.lockedBy || undefined,
      lockedAt: row.lockedAt || undefined,
      result: row.result || undefined,
      createdAt: row.createdAt,
      startedAt: row.startedAt || undefined,
      completedAt: row.completedAt || undefined,
    };
  }
}

// Singleton instance
let _dispatcher: TaskDispatcher | null = null;

/**
 * Get the singleton dispatcher instance
 */
export function getTaskDispatcher(config?: TaskDispatcherConfig): TaskDispatcher {
  if (!_dispatcher) {
    _dispatcher = new TaskDispatcher(config);
  }
  return _dispatcher;
}

/**
 * Reset the dispatcher (for testing)
 */
export function resetTaskDispatcher(): void {
  if (_dispatcher) {
    _dispatcher.stop();
    _dispatcher = null;
  }
}
