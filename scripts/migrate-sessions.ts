#!/usr/bin/env bun
/**
 * Sessions migration CLI: JSONL → SQLite.
 *
 * Operators run this once before flipping USE_SQLITE_SESSIONS=true (or
 * a future single-source default). Idempotent — safe to re-run.
 *
 *   bun scripts/migrate-sessions.ts --dry-run            # preview
 *   bun scripts/migrate-sessions.ts --commit             # actually migrate
 *   bun scripts/migrate-sessions.ts --commit --path data/memory/sessions
 *
 * Exit code:
 *   0 — every file accounted for (inserted or already-present), no errors
 *   1 — one or more files failed (corrupt JSON, missing id, etc.)
 *   2 — invocation error
 *
 * The migration NEVER deletes the source JSONL files. Operators verify
 * counts with `--commit`'s output and clean up manually.
 */

import * as path from 'path';
import { initDataConnection, getSQLite } from '../src/infra/db/connection';
import { migrateJsonlSessionsToSqlite } from '../src/domain/session/migration';

interface CliArgs {
  dryRun: boolean;
  commit: boolean;
  storagePath: string;
  dbPath: string;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    dryRun: false,
    commit: false,
    storagePath: path.resolve('data/memory/sessions'),
    dbPath: path.resolve('data/beeclaw.db'),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--commit') out.commit = true;
    else if (a === '--path' && i + 1 < argv.length) out.storagePath = path.resolve(argv[++i]);
    else if (a === '--db' && i + 1 < argv.length) out.dbPath = path.resolve(argv[++i]);
  }
  return out;
}

function usage(): void {
  // eslint-disable-next-line no-console
  console.error(
    'Usage: bun scripts/migrate-sessions.ts (--dry-run | --commit) [--path <dir>] [--db <file>]\n' +
    '\n' +
    '  --dry-run         Report what would happen, do not write to SQLite.\n' +
    '  --commit          Actually perform the migration.\n' +
    '  --path <dir>      Sessions JSONL directory (default: data/memory/sessions).\n' +
    '  --db <file>       SQLite database file (default: data/beeclaw.db).\n',
  );
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dryRun && !args.commit) {
    usage();
    return 2;
  }
  if (args.dryRun && args.commit) {
    // eslint-disable-next-line no-console
    console.error('Choose one of --dry-run or --commit, not both.');
    return 2;
  }

  /* eslint-disable no-console */
  console.log(`mode:    ${args.dryRun ? 'dry-run (no writes)' : 'commit (will insert)'}`);
  console.log(`path:    ${args.storagePath}`);
  console.log(`db:      ${args.dbPath}`);
  console.log('');

  initDataConnection({ path: args.dbPath, migrate: true });
  const db = getSQLite();

  const report = migrateJsonlSessionsToSqlite(args.storagePath, db as never, {
    dryRun: args.dryRun,
  });

  console.log(`scanned:        ${report.filesScanned}`);
  console.log(`${args.dryRun ? 'would insert:   ' : 'inserted:       '}${report.inserted}`);
  console.log(`already in db:  ${report.alreadyPresent}`);
  console.log(`errors:         ${report.errors.length}`);
  if (report.errors.length > 0) {
    console.log('');
    for (const e of report.errors) {
      console.log(`  ✗ ${e.file}: ${e.error}`);
    }
  }
  /* eslint-enable no-console */

  return report.errors.length === 0 ? 0 : 1;
}

main().then(code => process.exit(code)).catch(err => {
  // eslint-disable-next-line no-console
  console.error('migrate-sessions crashed:', err);
  process.exit(2);
});
