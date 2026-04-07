/**
 * Session Storage / Persistence
 *
 * Handles session persistence to JSON files and SQLite (dual-mode).
 * Extracted from session/index.ts to reduce god-object complexity.
 */

import { existsSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { Session, SessionMessage } from './index';
import { logger } from '../../infra/observability/logger';
import { writeFileAtomic, readFileWithRecovery, cleanupTempFiles } from '../../infra/utils/atomic-fs';
import { getDataConnection } from '../../infra/db';
import { sessions as sessionsTable } from '../../infra/db/schema';
import { eq } from 'drizzle-orm';
import { getPluginRegistryPort } from '../ports';
import { getHookRunnerPort } from '../ports';

// Feature flag for SQLite (dual-mode)
const USE_SQLITE = process.env.USE_SQLITE_SESSIONS === 'true';

/**
 * Get session file path
 */
export function getSessionFilePath(storagePath: string, sessionId: string): string {
  // Sanitize session ID for filesystem
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(storagePath, `${safeId}.json`);
}

/**
 * Save session to disk
 */
export function saveSession(session: Session, storagePath: string): void {
  try {
    // Trigger before_message_write hook (fire-and-forget)
    try {
      const registry = getPluginRegistryPort();
      const hookRunner = getHookRunnerPort();

      if (registry && hookRunner) {
        const result = hookRunner.runBeforeMessageWrite({
          sessionId: session.id,
          messages: session.messages,
          metadata: session.metadata,
          timestamp: new Date().toISOString(),
        });

        // Handle both sync and async hook implementations
        if (result && typeof result === 'object' && 'then' in result) {
          // Async hook — fire-and-forget (modifications apply to next save)
          (result as Promise<Record<string, unknown>>).then((modifiedSession) => {
            if (modifiedSession) {
              session.messages = (modifiedSession.messages as SessionMessage[]) || session.messages;
              session.metadata = (modifiedSession.metadata as Record<string, unknown>) || session.metadata;
            }
          }).catch(() => {});
        } else {
          // Sync hook — apply immediately
          const modifiedSession = result as unknown as Record<string, unknown> | undefined;
          if (modifiedSession) {
            session.messages = (modifiedSession.messages as SessionMessage[]) || session.messages;
            session.metadata = (modifiedSession.metadata as Record<string, unknown>) || session.metadata;
          }
        }
      }
    } catch (error) {
      logger.debug('Plugin system not initialized:', error);
    }

    // Save to JSON (always for backward compatibility)
    const filePath = getSessionFilePath(storagePath, session.id);
    // BUG #3 FIX: Use atomic write instead of writeFileSync
    writeFileAtomic(filePath, JSON.stringify(session, null, 2));

    // Save to SQLite if enabled (dual-mode)
    saveSessionToSQLite(session);
  } catch (error) {
    logger.error('[Session] Failed to save session:', error);
  }
}

/**
 * Load session from disk
 */
export function loadSession(sessionId: string, storagePath: string): Session | null {
  // Try SQLite first if enabled (RFC-03)
  if (USE_SQLITE) {
    const sqliteSession = loadSessionFromSQLite(sessionId);
    if (sqliteSession) {
      logger.info(`[Session] Loaded from SQLite: ${sessionId}`);
      return sqliteSession;
    }
  }

  // Fallback to JSON file
  try {
    const filePath = getSessionFilePath(storagePath, sessionId);

    // BUG #3 FIX: Use readFileWithRecovery with structure validation
    const data = readFileWithRecovery<Session>(filePath, isValidSession);

    if (!data) {
      logger.warn(`[Session] Failed to load session ${sessionId} (corrupted or missing)`);
      return null;
    }

    return data;
  } catch (error) {
    logger.error('[Session] Failed to load session:', error);
    return null;
  }
}

/**
 * Validate session structure after loading.
 */
export function isValidSession(data: unknown): data is Session {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  // Must have id and either messages or conversationHistory
  if (typeof obj.id !== 'string') return false;
  if (!Array.isArray(obj.messages)) return false;
  return true;
}

/**
 * Load session from SQLite database (RFC-03)
 */
export function loadSessionFromSQLite(sessionId: string): Session | null {
  if (!USE_SQLITE) return null;

  try {
    const db = getDataConnection();
    const results = db.select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId))
      .limit(1)
      .all();

    if (results.length === 0) return null;

    const row = results[0];
    const session: Session = {
      id: row.id,
      channel: row.channel,
      userId: row.userId,
      messages: row.messages as SessionMessage[],
      metadata: row.metadata || undefined,
      pendingRecovery: row.needsRecovery || undefined,
      createdAt: row.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: row.updatedAt?.toISOString() || new Date().toISOString(),
    };

    return session;
  } catch (error) {
    logger.error('[Session] Failed to load from SQLite:', error);
    return null;
  }
}

/**
 * Save session to SQLite database (RFC-03)
 */
export function saveSessionToSQLite(session: Session): void {
  if (!USE_SQLITE) return;

  try {
    const db = getDataConnection();
    const now = new Date();

    // Upsert session
    const existing = db.select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, session.id))
      .limit(1)
      .all();

    if (existing.length === 0) {
      // Insert
      db.insert(sessionsTable).values({
        id: session.id,
        channel: session.channel,
        userId: session.userId,
        messages: session.messages,
        metadata: session.metadata || null,
        needsRecovery: session.pendingRecovery || false,
        recoveredAt: (session as any).recoveredAt ? new Date((session as any).recoveredAt) : null,
        createdAt: new Date(session.createdAt),
        updatedAt: now,
      }).run();
    } else {
      // Update
      db.update(sessionsTable)
        .set({
          channel: session.channel,
          userId: session.userId,
          messages: session.messages,
          metadata: session.metadata || null,
          needsRecovery: session.pendingRecovery || false,
          recoveredAt: (session as any).recoveredAt ? new Date((session as any).recoveredAt) : null,
          updatedAt: now,
        })
        .where(eq(sessionsTable.id, session.id))
        .run();
    }
  } catch (error) {
    logger.error('[Session] Failed to save to SQLite:', error);
  }
}

/**
 * Delete session from disk
 */
export function deleteSessionFile(sessionId: string, storagePath: string): void {

  // Delete JSON file
  try {
    const filePath = getSessionFilePath(storagePath, sessionId);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch (error) {
    logger.error('[Session] Failed to delete session file:', error);
  }

  // Delete from SQLite if enabled
  if (USE_SQLITE) {
    try {
      const db = getDataConnection();
      db.delete(sessionsTable)
        .where(eq(sessionsTable.id, sessionId))
        .run();
    } catch (error) {
      logger.error('[Session] Failed to delete session from SQLite:', error);
    }
  }
}

/**
 * Load all sessions from disk (call on startup)
 */
export function loadAllSessions(
  storagePath: string,
  sessionsMap: Map<string, Session>,
): number {
  if (!existsSync(storagePath)) {
    return 0;
  }

  // BUG #3 FIX: Clean up leftover temp files from crashes
  cleanupTempFiles(storagePath);

  let loaded = 0;
  const files = readdirSync(storagePath).filter(
    f => f.endsWith('.json') && !f.endsWith('.bak') && !f.endsWith('.tmp')
  );

  // Import idle rotation helpers lazily to avoid circular deps at module level
  let rotated = 0;
  const { isSessionIdle, buildIdleRotationSummary } = require('./idle-rotation');

  for (const file of files) {
    try {
      const content = readFileSync(join(storagePath, file), 'utf-8');
      const session = JSON.parse(content) as Session;

      // Rotate stale sessions at load time so old messages don't pollute context
      if (session.messages?.length > 0 && isSessionIdle(session.updatedAt)) {
        const archiveSummary = buildIdleRotationSummary(session.messages, session.summary);
        session.summary = archiveSummary;
        session.messages = [];
        session.updatedAt = new Date().toISOString();
        // Save rotated state to disk immediately
        const filePath = getSessionFilePath(storagePath, session.id);
        writeFileAtomic(filePath, JSON.stringify(session, null, 2));
        rotated++;
      }

      sessionsMap.set(session.id, session);
      loaded++;
    } catch (error) {
      logger.error('[Session] Failed to load', file, error);
    }
  }

  logger.info(`[Session] Loaded ${loaded} sessions from disk${rotated > 0 ? ` (${rotated} rotated due to idle)` : ''}`);
  return loaded;
}

/**
 * Clear old sessions (cleanup)
 */
export function clearOldSessions(
  sessionsMap: Map<string, Session>,
  deleteSessionFn: (id: string) => boolean,
  daysOld: number = 30,
): number {
  const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
  let cleared = 0;

  for (const [id, session] of sessionsMap) {
    if (new Date(session.updatedAt).getTime() < cutoff) {
      deleteSessionFn(id);
      cleared++;
    }
  }

  return cleared;
}

/**
 * Save all active sessions to disk (for graceful shutdown)
 */
export function saveAllSessions(
  sessionsMap: Map<string, Session>,
  saveFn: (session: Session) => void,
): void {
  let saved = 0;
  for (const session of sessionsMap.values()) {
    try {
      saveFn(session);
      saved++;
    } catch (error) {
      logger.error(`[Session] Failed to save session ${session.id}:`, error);
    }
  }
  logger.info(`[Session] Saved ${saved} sessions to disk`);
}
