/**
 * TaskRepo — durable layer for the queue.
 *
 * Bunqueue runs jobs in-memory; on a process crash any pending or in-flight
 * job vanishes. TaskRepo writes one row per job to the SQLite `tasks` table
 * so we can replay them on the next startup. The wrapper in manager.ts
 * calls into this repo on every addJob / handler entry / handler exit.
 *
 * Operations are intentionally narrow — there is no general-purpose CRUD,
 * only the state transitions a queue actually uses (insert → running →
 * completed/failed) and the recovery scan (loadActive).
 *
 * Uses raw prepared statements (not drizzle) so the same code runs in:
 *   - production: Bun + bun:sqlite
 *   - tests:      Node + node:sqlite
 * which share the same prepared-statement API surface.
 */

export type PersistedTaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface PersistedTask {
  id: string;
  sessionId: string;
  type: string;
  payload: Record<string, unknown>;
  scheduledAt: Date;
  status: PersistedTaskStatus;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  result: Record<string, unknown> | null;
  lockedBy: string | null;
  lockedAt: Date | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface NewPersistedTask {
  id: string;
  /** Logical owner. For queue-only jobs use 'queue:<queueName>'. */
  sessionId: string;
  /** Job name within the queue. */
  type: string;
  payload: Record<string, unknown>;
  /** When the queue should consider the job runnable. */
  scheduledAt: Date;
  maxAttempts?: number;
}

export interface RecoverableTask {
  id: string;
  sessionId: string;
  type: string;
  payload: Record<string, unknown>;
  scheduledAt: Date;
  attempts: number;
  maxAttempts: number;
}

export interface TaskCounts {
  pending: number;
  running: number;
  completed: number;
  failed: number;
}

/**
 * Minimal SQLite handle interface satisfied by both bun:sqlite Database
 * and node:sqlite DatabaseSync. Keeps the repo runtime-agnostic.
 */
export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
}

export interface SqlStatement {
  run(...params: unknown[]): { changes?: number | bigint };
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}

interface RawTaskRow {
  id: string;
  session_id: string;
  type: string;
  payload: string;
  scheduled_at: number;
  status: PersistedTaskStatus;
  attempts: number;
  max_attempts: number;
  error: string | null;
  result: string | null;
  locked_by: string | null;
  locked_at: number | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
}

const epochSecondsToDate = (s: number | null): Date | null =>
  s == null ? null : new Date(s * 1000);

const dateToEpochSeconds = (d: Date): number => Math.floor(d.getTime() / 1000);

function rowToTask(row: RawTaskRow): PersistedTask {
  return {
    id: row.id,
    sessionId: row.session_id,
    type: row.type,
    payload: JSON.parse(row.payload),
    scheduledAt: new Date(row.scheduled_at * 1000),
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    error: row.error,
    result: row.result ? JSON.parse(row.result) : null,
    lockedBy: row.locked_by,
    lockedAt: epochSecondsToDate(row.locked_at),
    createdAt: new Date(row.created_at * 1000),
    startedAt: epochSecondsToDate(row.started_at),
    completedAt: epochSecondsToDate(row.completed_at),
  };
}

export class TaskRepo {
  private readonly insertStmt: SqlStatement;
  private readonly markRunningStmt: SqlStatement;
  private readonly markCompletedStmt: SqlStatement;
  private readonly markFailedStmt: SqlStatement;
  private readonly reclaimStaleStmt: SqlStatement;
  private readonly loadActiveStmt: SqlStatement;
  private readonly cleanupTerminalStmt: SqlStatement;
  private readonly countsStmt: SqlStatement;
  private readonly getByIdStmt: SqlStatement;

  constructor(db: SqlDatabase) {
    this.insertStmt = db.prepare(`
      INSERT INTO tasks (id, session_id, type, payload, scheduled_at, status, attempts, max_attempts)
      VALUES (?, ?, ?, ?, ?, 'pending', 0, ?)
      ON CONFLICT(id) DO NOTHING
    `);
    this.markRunningStmt = db.prepare(`
      UPDATE tasks
      SET status = 'running',
          started_at = strftime('%s', 'now'),
          locked_by = ?,
          locked_at = strftime('%s', 'now'),
          attempts = attempts + 1
      WHERE id = ? AND status IN ('pending', 'running')
    `);
    this.markCompletedStmt = db.prepare(`
      UPDATE tasks
      SET status = 'completed',
          completed_at = strftime('%s', 'now'),
          result = ?,
          error = NULL,
          locked_by = NULL,
          locked_at = NULL
      WHERE id = ?
    `);
    this.markFailedStmt = db.prepare(`
      UPDATE tasks
      SET status = 'failed',
          completed_at = strftime('%s', 'now'),
          error = ?,
          locked_by = NULL,
          locked_at = NULL
      WHERE id = ?
    `);
    this.reclaimStaleStmt = db.prepare(`
      UPDATE tasks
      SET status = 'pending', locked_by = NULL, locked_at = NULL
      WHERE status = 'running' AND locked_at IS NOT NULL AND locked_at < ?
    `);
    this.loadActiveStmt = db.prepare(`
      SELECT id, session_id, type, payload, scheduled_at, attempts, max_attempts
      FROM tasks
      WHERE status = 'pending' AND attempts < max_attempts
      ORDER BY scheduled_at ASC
    `);
    this.cleanupTerminalStmt = db.prepare(`
      DELETE FROM tasks
      WHERE status IN ('completed', 'failed')
        AND completed_at IS NOT NULL
        AND completed_at < ?
    `);
    this.countsStmt = db.prepare(`
      SELECT status, COUNT(*) AS n FROM tasks GROUP BY status
    `);
    this.getByIdStmt = db.prepare(`SELECT * FROM tasks WHERE id = ?`);
  }

  /**
   * Insert a freshly-enqueued task. Idempotent on (id) — a duplicate insert
   * is silently ignored so addJob retries are safe.
   */
  insert(task: NewPersistedTask): void {
    this.insertStmt.run(
      task.id,
      task.sessionId,
      task.type,
      JSON.stringify(task.payload),
      dateToEpochSeconds(task.scheduledAt),
      task.maxAttempts ?? 3,
    );
  }

  /**
   * Mark a task as running. Bumps attempts, sets startedAt + lock.
   * No-op if the task no longer exists or is already terminal.
   */
  markRunning(id: string, lockedBy: string): void {
    this.markRunningStmt.run(lockedBy, id);
  }

  markCompleted(id: string, result?: Record<string, unknown>): void {
    this.markCompletedStmt.run(JSON.stringify(result ?? {}), id);
  }

  markFailed(id: string, errorMessage: string): void {
    this.markFailedStmt.run(errorMessage, id);
  }

  /**
   * Reset stale 'running' tasks back to 'pending' so recovery can re-enqueue
   * them. A task is stale if its lockedAt is older than `staleMs` (default
   * 10 minutes) — long enough that a healthy worker would have heartbeated.
   */
  reclaimStaleRunning(staleMs: number = 10 * 60 * 1000): number {
    const cutoffSec = Math.floor((Date.now() - staleMs) / 1000);
    const res = this.reclaimStaleStmt.run(cutoffSec);
    return Number(res.changes ?? 0);
  }

  /**
   * Return tasks that should be re-enqueued on startup.
   *
   * Excludes terminal statuses (completed/failed) and any task whose
   * attempts have exhausted maxAttempts (those stay marked 'pending' but
   * are filtered here so the queue doesn't loop on a poison pill).
   */
  loadActive(): RecoverableTask[] {
    const rows = this.loadActiveStmt.all() as Array<Pick<RawTaskRow,
      'id' | 'session_id' | 'type' | 'payload' | 'scheduled_at' | 'attempts' | 'max_attempts'
    >>;
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      type: r.type,
      payload: JSON.parse(r.payload),
      scheduledAt: new Date(r.scheduled_at * 1000),
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
    }));
  }

  /** Delete completed/failed rows older than `olderThanMs`. Returns rows deleted. */
  cleanupTerminal(olderThanMs: number): number {
    const cutoffSec = Math.floor((Date.now() - olderThanMs) / 1000);
    const res = this.cleanupTerminalStmt.run(cutoffSec);
    return Number(res.changes ?? 0);
  }

  /** Count rows by status. Useful for tests and metrics. */
  counts(): TaskCounts {
    const out: TaskCounts = { pending: 0, running: 0, completed: 0, failed: 0 };
    const rows = this.countsStmt.all() as Array<{ status: PersistedTaskStatus; n: number }>;
    for (const r of rows) {
      if (r.status in out) out[r.status] = Number(r.n);
    }
    return out;
  }

  /** Read one row for testing / debugging. */
  getById(id: string): PersistedTask | null {
    const row = this.getByIdStmt.get(id) as RawTaskRow | undefined;
    return row ? rowToTask(row) : null;
  }
}
