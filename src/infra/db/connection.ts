/**
 * DataConnection - SQLite database connection singleton
 * RFC-03: SQLite + Drizzle ORM foundation
 */

import { logger } from '../../infra/observability/logger';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import { existsSync } from 'fs';
import { mkdirSync } from 'fs';
import * as schema from './schema';

export interface DataConnectionConfig {
  path: string;
  migrate?: boolean;
}

let _db: ReturnType<typeof drizzle> | null = null;
let _sqlite: Database | null = null;

/**
 * Initialize the database connection
 * Creates the database file if it doesn't exist and runs migrations
 */
export function initDataConnection(config: DataConnectionConfig): void {
  if (_db) {
    throw new Error('DataConnection already initialized');
  }

  // Ensure parent directory exists
  const dir = config.path.substring(0, config.path.lastIndexOf('/'));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Create SQLite connection
  _sqlite = new Database(config.path);

  // Enable WAL mode for better concurrency
  _sqlite.run('PRAGMA journal_mode = WAL');

  // Set busy timeout to 5 seconds to reduce lock errors
  // This tells SQLite to wait up to 5s when database is locked before throwing error
  _sqlite.run('PRAGMA busy_timeout = 5000');

  // Create drizzle ORM instance
  _db = drizzle(_sqlite, { schema });

  // Run migrations if enabled
  if (config.migrate) {
    runMigrations(_sqlite);
  }

  logger.info(`✅ DataConnection initialized: ${config.path}`);
}

/**
 * Get the database connection
 * Must call initDataConnection() first
 */
export function getDataConnection(): ReturnType<typeof drizzle> {
  if (!_db) {
    throw new Error('DataConnection not initialized. Call initDataConnection() first.');
  }
  return _db;
}

/**
 * Get the raw SQLite instance for direct queries
 */
export function getSQLite(): Database {
  if (!_sqlite) {
    throw new Error('DataConnection not initialized. Call initDataConnection() first.');
  }
  return _sqlite;
}

/**
 * Close the database connection.
 *
 * Before closing we fold the WAL back into the main database file via
 * `wal_checkpoint(TRUNCATE)` and run `optimize`. Without this, a
 * crashed/killed daemon leaves a `-wal` and `-shm` sidecar that next
 * startup must replay — usually fine, but we'd rather not depend on
 * "usually" for the only persistent store.
 */
export function closeDataConnection(): void {
  if (_sqlite) {
    try {
      // TRUNCATE mode resets the WAL file to zero bytes after checkpointing,
      // so the next start finds a single self-contained .db file.
      _sqlite.run('PRAGMA wal_checkpoint(TRUNCATE)');
      _sqlite.run('PRAGMA optimize');
    } catch (err) {
      logger.warn('[DataConnection] checkpoint/optimize failed during close', err);
    }
    _sqlite.close();
    _sqlite = null;
    _db = null;
  }
}

/**
 * Run database migrations
 * For now, we'll use simple SQL files. Can migrate to drizzle-kit later.
 */
function runMigrations(db: Database): void {
  // Create migrations tracking table
  db.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      run_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    )
  `);

  // Get list of already run migrations
  const runMigrations = db.query<{ name: string }, []>('SELECT name FROM _migrations').all();
  const runMigrationNames = new Set(runMigrations.map((m: any) => m.name));

  // Define migrations
  const migrations = [
    {
      name: '0001_create_sessions',
      sql: `
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

        CREATE INDEX IF NOT EXISTS sessions_channel_idx ON sessions(channel);
        CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS sessions_updated_at_idx ON sessions(updated_at);
      `,
    },
    {
      name: '0002_create_tasks',
      sql: `
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

        CREATE INDEX IF NOT EXISTS tasks_session_id_idx ON tasks(session_id);
        CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);
        CREATE INDEX IF NOT EXISTS tasks_scheduled_at_idx ON tasks(scheduled_at);
        CREATE INDEX IF NOT EXISTS tasks_type_idx ON tasks(type);
      `,
    },
  ];

  // Run pending migrations
  for (const migration of migrations) {
    if (!runMigrationNames.has(migration.name)) {
      logger.debug(`  Running migration: ${migration.name}`);

      // Run migration in transaction
      const tx = db.transaction(() => {
        db.run(migration.sql);
        db.run('INSERT INTO _migrations (name) VALUES (?)', [migration.name]);
      });
      tx();

      logger.info(`  ✓ Migration complete: ${migration.name}`);
    }
  }
}
