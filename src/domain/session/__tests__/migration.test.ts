/**
 * Real-SQL + real-fs tests for the JSONL → SQLite session migration.
 * Uses node:sqlite (Node 24+) so the same SQL the production path runs
 * is exercised — no mocking of the storage layer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseSync } from 'node:sqlite';

vi.unmock('fs');

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  migrateJsonlSessionsToSqlite,
  packSessionExtras,
  unpackSessionFromRow,
} from '../migration';
import type { Session } from '../index';
import type { SqlDatabase } from '../../../infra/queue/task-repo';

const SESSIONS_DDL = `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    user_id TEXT NOT NULL,
    messages TEXT NOT NULL,
    metadata TEXT,
    needs_recovery INTEGER NOT NULL DEFAULT 0,
    recovered_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );
`;

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'beeclaw-session-mig-'));
}

function makeDb(): { db: SqlDatabase; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec(SESSIONS_DDL);
  return { db: raw as unknown as SqlDatabase, raw };
}

function writeSessionFile(dir: string, session: Session): void {
  fs.writeFileSync(path.join(dir, `${session.id}.json`), JSON.stringify(session, null, 2));
}

function fullSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    userId: 'u-alice',
    channel: 'feishu',
    messages: [
      { role: 'user', content: 'hello', timestamp: '2026-04-01T00:00:00Z' },
      { role: 'assistant', content: 'hi', timestamp: '2026-04-01T00:00:01Z' },
    ] as Session['messages'],
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:01Z',
    metadata: { sourceLocale: 'zh-CN' },
    pendingRecovery: false,
    ...overrides,
  };
}

// ─── pack / unpack round-trip ─────────────────────────────────────────────

describe('packSessionExtras / unpackSessionFromRow — round-trip', () => {
  it('preserves all extra Session fields through metadata._sessionExtras', () => {
    const original = fullSession({
      summary: 'compressed summary text',
      responseDelivered: true,
      pendingDelivery: false,
      recoveryAttempts: 2,
      lastRecoveryAt: '2026-04-01T00:00:05Z',
      lastAiResponse: 'cached response text',
      lastMessageSource: 'user',
      consecutiveRecoveryFailures: 1,
      processedMessageIds: { 'm-1': true, 'm-2': false },
      archivedSegments: [
        { path: '/abs/path/foo.json', reason: 'idle', startedAt: 'a', endedAt: 'b', messageCount: 3 },
      ],
    });

    const packedMeta = packSessionExtras(original);
    expect(packedMeta).toBeDefined();
    expect((packedMeta as any)._sessionExtras.summary).toBe('compressed summary text');
    expect((packedMeta as any)._sessionExtras.archivedSegments).toHaveLength(1);

    const restored = unpackSessionFromRow({
      id: original.id,
      channel: original.channel,
      userId: original.userId,
      messages: original.messages,
      metadata: packedMeta,
      needsRecovery: 0,
      createdAt: original.createdAt,
      updatedAt: original.updatedAt,
    });

    // All extras restored.
    expect(restored.summary).toBe(original.summary);
    expect(restored.responseDelivered).toBe(true);
    expect(restored.recoveryAttempts).toBe(2);
    expect(restored.archivedSegments).toEqual(original.archivedSegments);
    // Base metadata still present and clean (no _sessionExtras leak).
    expect(restored.metadata).toEqual({ sourceLocale: 'zh-CN' });
  });

  it('packSessionExtras returns null when metadata is empty and there are no extras', () => {
    const minimal = fullSession({ metadata: undefined });
    expect(packSessionExtras(minimal)).toBeNull();
  });

  it('preserves base metadata when no extras are set', () => {
    const s = fullSession({ metadata: { foo: 'bar' } });
    expect(packSessionExtras(s)).toEqual({ foo: 'bar' });
  });

  it('unpacks pendingRecovery from the boolean column', () => {
    const restored = unpackSessionFromRow({
      id: 's', channel: 'feishu', userId: 'u',
      messages: [], metadata: null, needsRecovery: 1,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    });
    expect(restored.pendingRecovery).toBe(true);
  });
});

// ─── migration ───────────────────────────────────────────────────────────

describe('migrateJsonlSessionsToSqlite', () => {
  let dir: string;
  beforeEach(() => { dir = mkTmp(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('migrates each .json file as one row', () => {
    writeSessionFile(dir, fullSession({ id: 'a' }));
    writeSessionFile(dir, fullSession({ id: 'b' }));
    writeSessionFile(dir, fullSession({ id: 'c' }));

    const { db, raw } = makeDb();
    const report = migrateJsonlSessionsToSqlite(dir, db);
    expect(report).toEqual({
      filesScanned: 3, inserted: 3, alreadyPresent: 0, errors: [],
    });

    const count = (raw.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
    expect(count).toBe(3);
  });

  it('is idempotent — second run inserts nothing', () => {
    writeSessionFile(dir, fullSession({ id: 'a' }));
    const { db } = makeDb();
    migrateJsonlSessionsToSqlite(dir, db);
    const second = migrateJsonlSessionsToSqlite(dir, db);
    expect(second.inserted).toBe(0);
    expect(second.alreadyPresent).toBe(1);
  });

  it('skips corrupt JSON files without aborting the rest', () => {
    fs.writeFileSync(path.join(dir, 'bad.json'), '{not valid');
    writeSessionFile(dir, fullSession({ id: 'good' }));
    const { db, raw } = makeDb();
    const report = migrateJsonlSessionsToSqlite(dir, db);
    expect(report.inserted).toBe(1);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].file).toBe('bad.json');
    expect(report.errors[0].error).toMatch(/parse failed/);
    expect((raw.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n).toBe(1);
  });

  it('rejects sessions without an id (recorded as error, not crash)', () => {
    fs.writeFileSync(path.join(dir, 'noid.json'), JSON.stringify({ channel: 'x' }));
    const { db } = makeDb();
    const report = migrateJsonlSessionsToSqlite(dir, db);
    expect(report.errors[0].error).toMatch(/missing id/);
    expect(report.inserted).toBe(0);
  });

  it('preserves all extra Session fields end-to-end', () => {
    const rich = fullSession({
      id: 'rich',
      summary: 'summary',
      responseDelivered: true,
      recoveryAttempts: 5,
      archivedSegments: [
        { path: '/x.json', reason: 'idle', startedAt: 'a', endedAt: 'b', messageCount: 1 },
      ],
    });
    writeSessionFile(dir, rich);

    const { db, raw } = makeDb();
    migrateJsonlSessionsToSqlite(dir, db);

    const row = raw.prepare('SELECT * FROM sessions WHERE id = ?').get('rich') as any;
    const meta = JSON.parse(row.metadata as string);
    expect(meta._sessionExtras.summary).toBe('summary');
    expect(meta._sessionExtras.responseDelivered).toBe(true);
    expect(meta._sessionExtras.archivedSegments).toHaveLength(1);
    expect(meta._sessionExtras.recoveryAttempts).toBe(5);
  });

  it('dry-run reports planned inserts without writing rows', () => {
    writeSessionFile(dir, fullSession({ id: 'a' }));
    writeSessionFile(dir, fullSession({ id: 'b' }));
    const { db, raw } = makeDb();
    const report = migrateJsonlSessionsToSqlite(dir, db, { dryRun: true });
    expect(report.inserted).toBe(2);
    expect((raw.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n).toBe(0);
  });

  it('skips .bak and .tmp files', () => {
    writeSessionFile(dir, fullSession({ id: 'live' }));
    fs.writeFileSync(path.join(dir, 'leftover.tmp'), 'partial');
    fs.writeFileSync(path.join(dir, 'old.json.bak'), 'backup');
    const { db } = makeDb();
    const report = migrateJsonlSessionsToSqlite(dir, db);
    expect(report.filesScanned).toBe(1);
    expect(report.inserted).toBe(1);
  });

  it('returns zero counts when storagePath does not exist', () => {
    const { db } = makeDb();
    const report = migrateJsonlSessionsToSqlite('/nonexistent/path', db);
    expect(report).toEqual({
      filesScanned: 0, inserted: 0, alreadyPresent: 0, errors: [],
    });
  });

  it('preserves createdAt / updatedAt timestamps on the row', () => {
    writeSessionFile(dir, fullSession({
      id: 'ts',
      createdAt: '2026-01-15T10:00:00Z',
      updatedAt: '2026-01-15T10:30:00Z',
    }));
    const { db, raw } = makeDb();
    migrateJsonlSessionsToSqlite(dir, db);
    const row = raw.prepare('SELECT created_at, updated_at FROM sessions WHERE id = ?').get('ts') as any;
    // SQLite stores as epoch seconds.
    expect(row.created_at).toBe(Math.floor(Date.parse('2026-01-15T10:00:00Z') / 1000));
    expect(row.updated_at).toBe(Math.floor(Date.parse('2026-01-15T10:30:00Z') / 1000));
  });

  it('does NOT delete the source JSONL files', () => {
    writeSessionFile(dir, fullSession({ id: 'kept' }));
    const { db } = makeDb();
    migrateJsonlSessionsToSqlite(dir, db);
    expect(fs.existsSync(path.join(dir, 'kept.json'))).toBe(true);
  });
});
