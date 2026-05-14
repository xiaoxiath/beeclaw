/**
 * Session storage migration: JSONL → SQLite.
 *
 * The existing dual-mode (USE_SQLITE_SESSIONS env var) writes both stores
 * but the SQLite path was silently lossy — the `sessions` table only knows
 * the base fields (id, channel, userId, messages, metadata, needsRecovery,
 * timestamps) while the Session interface has 10+ extra fields
 * (summary, responseDelivered, pendingDelivery, recoveryAttempts,
 * lastRecoveryAt, lastAiResponse, lastMessageSource,
 * consecutiveRecoveryFailures, processedMessageIds, archivedSegments).
 *
 * To avoid a schema migration that breaks deployed databases, we pack
 * those extras into a reserved key inside the existing `metadata` JSON
 * column: `metadata._sessionExtras`. A round-trip through pack/unpack
 * is lossless. Both the migration script and the regular storage
 * read/write path use the same helpers so behaviour is consistent.
 *
 * The migration scans JSONL session files on disk and INSERT … ON
 * CONFLICT DO NOTHING into the SQLite table. Existing rows are left
 * untouched — running the migration twice is a no-op for everything
 * already migrated.
 *
 * The migration NEVER deletes JSONL files. Operators verify in their
 * own time and clean up manually (or leave them as backup).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import type { Session } from './index';
import type { SqlDatabase } from '../../infra/queue/task-repo';

/** Fields on Session that are NOT in the SQLite base schema. Packed into metadata._sessionExtras. */
const SESSION_EXTRA_FIELD_NAMES = [
  'summary',
  'responseDelivered',
  'pendingDelivery',
  'recoveryAttempts',
  'lastRecoveryAt',
  'lastAiResponse',
  'lastMessageSource',
  'consecutiveRecoveryFailures',
  'processedMessageIds',
  'archivedSegments',
] as const;

const EXTRAS_KEY = '_sessionExtras';

/** Build the JSON value for the sessions.metadata column from a Session. */
export function packSessionExtras(session: Session): Record<string, unknown> | null {
  const baseMeta = (session.metadata ?? {}) as Record<string, unknown>;
  const extras: Record<string, unknown> = {};
  for (const k of SESSION_EXTRA_FIELD_NAMES) {
    const value = (session as unknown as Record<string, unknown>)[k];
    if (value !== undefined) extras[k] = value;
  }
  const merged: Record<string, unknown> = { ...baseMeta };
  if (Object.keys(extras).length > 0) {
    merged[EXTRAS_KEY] = extras;
  }
  return Object.keys(merged).length > 0 ? merged : null;
}

/**
 * Reverse of packSessionExtras: read a row from SQLite back into a full Session.
 * Caller must supply the columns from the query (avoids importing drizzle here).
 */
export function unpackSessionFromRow(row: {
  id: string;
  channel: string;
  userId: string;
  messages: unknown;
  metadata: unknown;
  needsRecovery: boolean | number | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}): Session {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const extras = (meta[EXTRAS_KEY] ?? {}) as Record<string, unknown>;
  const cleanMeta = { ...meta };
  delete cleanMeta[EXTRAS_KEY];

  const session: Session = {
    id: row.id,
    channel: row.channel,
    userId: row.userId,
    messages: (row.messages as Session['messages']) ?? [],
    metadata: Object.keys(cleanMeta).length > 0 ? cleanMeta : undefined,
    pendingRecovery: row.needsRecovery ? true : undefined,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : row.createdAt.toISOString(),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : row.updatedAt.toISOString(),
  };

  // Splice extras back in.
  for (const [k, v] of Object.entries(extras)) {
    (session as unknown as Record<string, unknown>)[k] = v;
  }

  return session;
}

export interface MigrationReport {
  /** Total .json files scanned. */
  filesScanned: number;
  /** Sessions newly inserted into SQLite. */
  inserted: number;
  /** Sessions already present in SQLite (skipped). */
  alreadyPresent: number;
  /** Files that failed to parse / migrate. */
  errors: Array<{ file: string; error: string }>;
}

export interface MigrationOptions {
  /**
   * If true, only report what would happen — do not write to SQLite.
   * Useful for operators piloting the cutover.
   */
  dryRun?: boolean;
  /** Optional filter — skip files where the predicate returns false. */
  fileFilter?: (fileName: string) => boolean;
}

/**
 * Migrate every JSONL session file under `storagePath` into the SQLite
 * sessions table. Idempotent: existing rows are left untouched.
 *
 * Does NOT delete the source JSONL files — operators decide when (and if)
 * to remove them.
 */
export function migrateJsonlSessionsToSqlite(
  storagePath: string,
  db: SqlDatabase,
  opts: MigrationOptions = {},
): MigrationReport {
  const report: MigrationReport = {
    filesScanned: 0,
    inserted: 0,
    alreadyPresent: 0,
    errors: [],
  };

  if (!existsSync(storagePath) || !statSync(storagePath).isDirectory()) {
    return report;
  }

  const insertStmt = opts.dryRun ? null : db.prepare(`
    INSERT INTO sessions (
      id, channel, user_id, messages, metadata, needs_recovery,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  const existsStmt = db.prepare('SELECT id FROM sessions WHERE id = ?');

  const files = readdirSync(storagePath)
    .filter(f => f.endsWith('.json') && !f.endsWith('.bak') && !f.endsWith('.tmp'))
    .filter(f => opts.fileFilter ? opts.fileFilter(f) : true);

  for (const file of files) {
    report.filesScanned += 1;
    const fullPath = join(storagePath, file);

    let session: Session;
    try {
      const raw = readFileSync(fullPath, 'utf-8');
      session = JSON.parse(raw) as Session;
      if (!session || typeof session !== 'object' || typeof session.id !== 'string') {
        report.errors.push({ file, error: 'invalid session shape (missing id)' });
        continue;
      }
    } catch (e) {
      report.errors.push({ file, error: `parse failed: ${(e as Error).message}` });
      continue;
    }

    // Skip if already present — counts as alreadyPresent for the report.
    const existing = existsStmt.get(session.id);
    if (existing) {
      report.alreadyPresent += 1;
      continue;
    }

    if (opts.dryRun) {
      // In dry-run we still report that an insert WOULD happen.
      report.inserted += 1;
      continue;
    }

    try {
      const metadataJson = JSON.stringify(packSessionExtras(session) ?? null);
      const messagesJson = JSON.stringify(session.messages ?? []);
      const createdAt = toEpochSeconds(session.createdAt);
      const updatedAt = toEpochSeconds(session.updatedAt);
      insertStmt!.run(
        session.id,
        session.channel ?? 'unknown',
        session.userId ?? 'unknown',
        messagesJson,
        metadataJson,
        session.pendingRecovery ? 1 : 0,
        createdAt,
        updatedAt,
      );
      report.inserted += 1;
    } catch (e) {
      report.errors.push({ file, error: `insert failed: ${(e as Error).message}` });
    }
  }

  return report;
}

function toEpochSeconds(value: string | undefined): number {
  if (!value) return Math.floor(Date.now() / 1000);
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000);
}
