/**
 * Manager-level integration tests for the write-through persistence wiring.
 *
 * Bunqueue is mocked (we don't need its scheduler), but the TaskRepo is
 * real and runs against an in-memory node:sqlite — so the SQL the repo
 * emits is exercised end-to-end with the manager's wrapping logic.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('../../observability/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

// Capture the wrapped handler so the test can fire jobs through it directly.
let lastWrappedHandler: ((job: { id: string; data: unknown }) => Promise<unknown>) | null = null;
let queueAddCalls: Array<{ name: string; data: unknown; opts: Record<string, unknown> }> = [];
let mockJobIdCounter = 0;
const queuedJobs = new Map<string, { id: string; data: unknown }>();

vi.mock('bunqueue/client', () => {
  return {
    Queue: class MockQueue {
      name: string;
      constructor(name: string) { this.name = name; }
      async add(name: string, data: unknown, opts: Record<string, unknown> = {}) {
        queueAddCalls.push({ name, data, opts });
        const id = (opts.jobId as string | undefined) ?? `job-${++mockJobIdCounter}`;
        const job = { id, data };
        queuedJobs.set(id, job);
        return job;
      }
      async getJob(id: string) {
        return queuedJobs.get(id) ?? null;
      }
      async close() { /* noop */ }
      async getWaitingCount() { return 0; }
      async getActiveCount() { return 0; }
      async getCompletedCount() { return 0; }
      async getFailedCount() { return 0; }
      async getDelayedCount() { return 0; }
      async getWaiting() { return []; }
      async getActive() { return []; }
      async getCompleted() { return []; }
      async getFailed() { return []; }
    },
    Worker: class MockWorker {
      constructor(_queue: string, handler: (job: { id: string; data: unknown }) => Promise<unknown>) {
        lastWrappedHandler = handler;
      }
      async close() { /* noop */ }
    },
  };
});

import { TaskManager } from '../manager';
import { TaskRepo, type SqlDatabase } from '../task-repo';

const TASKS_DDL = `
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    scheduled_at INTEGER NOT NULL,
    cron TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    error TEXT,
    locked_by TEXT,
    locked_at INTEGER,
    result TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    started_at INTEGER,
    completed_at INTEGER
  );
`;

function setup(): { manager: TaskManager; repo: TaskRepo; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec(TASKS_DDL);
  const repo = new TaskRepo(raw as unknown as SqlDatabase);
  const manager = new TaskManager();
  manager.setRepo(repo);
  return { manager, repo, raw };
}

beforeEach(() => {
  lastWrappedHandler = null;
  queueAddCalls = [];
  queuedJobs.clear();
  mockJobIdCounter = 0;
});

describe('TaskManager write-through persistence', () => {
  it('addJob persists a row when a repo is attached', async () => {
    const { manager, repo } = setup();
    const { jobId } = await manager.addJob('proactive-jobs', 'send_reminder', { userId: 'u1' });

    const row = repo.getById(jobId);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('pending');
    expect(row!.type).toBe('send_reminder');
    expect(row!.sessionId).toBe('queue:proactive-jobs');
    expect(row!.payload).toEqual({ userId: 'u1' });
    expect(row!.attempts).toBe(0);
  });

  it('does not persist when no repo is attached (back-compat)', async () => {
    const manager = new TaskManager();
    // No setRepo() — should still work, just non-durable.
    const { jobId } = await manager.addJob('proactive-jobs', 'x', { y: 1 });
    expect(jobId).toMatch(/job-/);
    expect(manager.hasPersistence()).toBe(false);
  });

  it('does not persist recurring (cron) jobs because they regenerate themselves', async () => {
    const { manager, repo } = setup();
    await manager.addJob('proactive-jobs', 'cronned', {}, {
      repeat: { pattern: '*/5 * * * *' },
    });
    expect(repo.counts().pending).toBe(0);
  });

  it('worker success marks the row completed and stores the result', async () => {
    const { manager, repo } = setup();
    const handler = vi.fn(async () => ({ ok: true, n: 42 }));
    manager.registerWorker('proactive-jobs', handler);

    const { jobId } = await manager.addJob('proactive-jobs', 'work', { x: 1 });
    expect(repo.getById(jobId)!.status).toBe('pending');

    // Fire the wrapped handler the way Bunqueue would.
    await lastWrappedHandler!({ id: jobId, data: { x: 1 } });

    const row = repo.getById(jobId)!;
    expect(row.status).toBe('completed');
    expect(row.attempts).toBe(1);
    expect(row.result).toEqual({ ok: true, n: 42 });
    expect(row.lockedBy).toBeNull();
  });

  it('wraps non-object handler results in {value: …} so JSON encoding never blows up', async () => {
    const { manager, repo } = setup();
    manager.registerWorker('proactive-jobs', async () => 'plain-string');
    const { jobId } = await manager.addJob('proactive-jobs', 'work', {});
    await lastWrappedHandler!({ id: jobId, data: {} });
    expect(repo.getById(jobId)!.result).toEqual({ value: 'plain-string' });
  });

  it('worker failure marks the row failed and propagates the error', async () => {
    const { manager, repo } = setup();
    manager.registerWorker('proactive-jobs', async () => {
      throw new Error('handler boom');
    });

    const { jobId } = await manager.addJob('proactive-jobs', 'will-fail', {});
    await expect(
      lastWrappedHandler!({ id: jobId, data: {} }),
    ).rejects.toThrow('handler boom');

    const row = repo.getById(jobId)!;
    expect(row.status).toBe('failed');
    expect(row.error).toBe('handler boom');
    expect(row.lockedBy).toBeNull();
  });
});

describe('TaskManager.recoverPersistedJobs', () => {
  it('re-enqueues pending rows that the queue does not know about', async () => {
    const { manager, repo } = setup();
    // Insert a pending task directly to simulate "left over from prior process".
    repo.insert({
      id: 'stranded-1',
      sessionId: 'queue:proactive-jobs',
      type: 'send_reminder',
      payload: { user: 'u' },
      scheduledAt: new Date(Date.now() - 5000), // due in the past — replay immediately
    });

    const replayed = await manager.recoverPersistedJobs();
    expect(replayed).toBe(1);
    expect(queueAddCalls).toHaveLength(1);
    expect(queueAddCalls[0]).toMatchObject({
      name: 'send_reminder',
      data: { user: 'u' },
      opts: expect.objectContaining({ jobId: 'stranded-1' }),
    });
  });

  it('skips tasks the queue still has (idempotent on multiple calls)', async () => {
    const { manager, repo } = setup();
    repo.insert({
      id: 'already-queued',
      sessionId: 'queue:proactive-jobs',
      type: 'work',
      payload: {},
      scheduledAt: new Date(),
    });

    const first = await manager.recoverPersistedJobs();
    const second = await manager.recoverPersistedJobs();
    expect(first).toBe(1);
    expect(second).toBe(0);
  });

  it('reclaims stale running rows before scanning so they are replayed', async () => {
    const { manager, repo, raw } = setup();
    repo.insert({
      id: 'stuck',
      sessionId: 'queue:proactive-jobs',
      type: 'work',
      payload: {},
      scheduledAt: new Date(),
    });
    repo.markRunning('stuck', 'dead-worker');
    // Backdate the lock so it qualifies as stale.
    raw.prepare(`UPDATE tasks SET locked_at = ? WHERE id = ?`).run(
      Math.floor((Date.now() - 60 * 60 * 1000) / 1000),
      'stuck',
    );

    const replayed = await manager.recoverPersistedJobs();
    expect(replayed).toBe(1);
    expect(repo.getById('stuck')!.status).toBe('pending');
  });

  it('respects scheduledAt and computes a non-negative delay', async () => {
    const { manager, repo } = setup();
    const future = new Date(Date.now() + 5000);
    repo.insert({
      id: 'later',
      sessionId: 'queue:proactive-jobs',
      type: 'work',
      payload: {},
      scheduledAt: future,
    });

    await manager.recoverPersistedJobs();
    const opts = queueAddCalls[0]?.opts;
    expect(opts).toBeDefined();
    expect(opts!.delay).toBeGreaterThan(0);
    expect(opts!.delay).toBeLessThanOrEqual(5000);
  });

  it('returns 0 when no repo is attached', async () => {
    const manager = new TaskManager();
    expect(await manager.recoverPersistedJobs()).toBe(0);
  });

  it('skips poison-pill rows (attempts >= maxAttempts)', async () => {
    const { manager, repo, raw } = setup();
    repo.insert({
      id: 'poison',
      sessionId: 'queue:proactive-jobs',
      type: 'work',
      payload: {},
      scheduledAt: new Date(),
      maxAttempts: 2,
    });
    raw.exec(`UPDATE tasks SET attempts = 2 WHERE id = 'poison'`);

    expect(await manager.recoverPersistedJobs()).toBe(0);
  });
});
