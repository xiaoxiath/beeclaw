#!/usr/bin/env bun
/**
 * SQLite backup via `VACUUM INTO`.
 *
 * Why VACUUM INTO and not file copy?
 *   - Atomic: SQLite produces a consistent snapshot even while the
 *     primary process is writing. A `cp` of the .db while WAL has
 *     unwritten frames gives a torn file.
 *   - Single file: skips -wal/-shm sidecars, output is loadable
 *     directly with `sqlite3 backup.db`.
 *   - Cheap: roughly equivalent to a normal sequential read.
 *
 * Output naming: data/backups/beeclaw-YYYY-MM-DD.db (one per day).
 * Re-running on the same day overwrites — that's fine; backup is
 * for "yesterday's daemon crashed" recovery, not historical archive.
 *
 * Retention: --keep <n> removes any backup older than the most recent
 * N. Defaults to 14. Pass 0 to disable cleanup.
 *
 * Usage:
 *   bun scripts/backup-sqlite.ts                          # default db + 14-day retention
 *   bun scripts/backup-sqlite.ts --db data/beeclaw.db     # custom source
 *   bun scripts/backup-sqlite.ts --out data/backups       # custom dest dir
 *   bun scripts/backup-sqlite.ts --keep 30                # 30-day retention
 *   bun scripts/backup-sqlite.ts --keep 0                 # no cleanup
 *
 * Cron: every operator's choice. Common pattern (3am daily):
 *   0 3 * * * cd /path/to/beeclaw && bun scripts/backup-sqlite.ts
 *
 * Exit codes:
 *   0 — backup succeeded
 *   1 — source missing or vacuum failed
 *   2 — invocation error
 */

import * as fs from 'fs';
import * as path from 'path';
import { Database } from 'bun:sqlite';

interface CliArgs {
  dbPath: string;
  outDir: string;
  keep: number;
}

function parseArgs(argv: string[]): CliArgs {
  // Default mirrors src/app/bootstrap.ts: memory.path / beeclaw.db.
  const out: CliArgs = {
    dbPath: path.resolve('data/memory/beeclaw.db'),
    outDir: path.resolve('data/backups'),
    keep: 14,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db' && i + 1 < argv.length) out.dbPath = path.resolve(argv[++i]);
    else if (a === '--out' && i + 1 < argv.length) out.outDir = path.resolve(argv[++i]);
    else if (a === '--keep' && i + 1 < argv.length) out.keep = parseInt(argv[++i], 10);
    else if (a === '--help' || a === '-h') {
      // eslint-disable-next-line no-console
      console.error(
        'Usage: bun scripts/backup-sqlite.ts [--db <file>] [--out <dir>] [--keep <n>]\n' +
        '  --db <file>   Source database (default: data/beeclaw.db).\n' +
        '  --out <dir>   Destination directory (default: data/backups).\n' +
        '  --keep <n>    Retain N most recent backups; 0 disables cleanup. Default 14.\n',
      );
      process.exit(2);
    }
  }
  if (!Number.isFinite(out.keep) || out.keep < 0) {
    // eslint-disable-next-line no-console
    console.error('--keep must be a non-negative integer');
    process.exit(2);
  }
  return out;
}

function todayStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function pruneOldBackups(outDir: string, keep: number): { kept: string[]; removed: string[] } {
  if (keep === 0) return { kept: [], removed: [] };
  const entries = fs
    .readdirSync(outDir)
    .filter(n => /^beeclaw-\d{4}-\d{2}-\d{2}\.db$/.test(n))
    .map(n => ({
      name: n,
      mtime: fs.statSync(path.join(outDir, n)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  const kept = entries.slice(0, keep).map(e => e.name);
  const remove = entries.slice(keep);
  for (const e of remove) {
    fs.unlinkSync(path.join(outDir, e.name));
  }
  return { kept, removed: remove.map(e => e.name) };
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(args.dbPath)) {
    // eslint-disable-next-line no-console
    console.error(`source not found: ${args.dbPath}`);
    return 1;
  }

  if (!fs.existsSync(args.outDir)) {
    fs.mkdirSync(args.outDir, { recursive: true });
  }

  const outFile = path.join(args.outDir, `beeclaw-${todayStamp()}.db`);

  // VACUUM INTO requires the destination to NOT exist.
  if (fs.existsSync(outFile)) {
    fs.unlinkSync(outFile);
  }

  // eslint-disable-next-line no-console
  console.log(`source:  ${args.dbPath}`);
  // eslint-disable-next-line no-console
  console.log(`dest:    ${outFile}`);

  const start = Date.now();

  const db = new Database(args.dbPath, { readonly: true });
  try {
    // Parameterised path is critical — `outFile` flows from CLI args.
    // SQLite's prepare with bind handles quoting safely; do NOT string-concat.
    const stmt = db.prepare("VACUUM INTO ?");
    stmt.run(outFile);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('VACUUM INTO failed:', err instanceof Error ? err.message : String(err));
    db.close();
    return 1;
  }
  db.close();

  const sizeMb = (fs.statSync(outFile).size / (1024 * 1024)).toFixed(2);
  const ms = Date.now() - start;
  // eslint-disable-next-line no-console
  console.log(`ok:      ${sizeMb} MB in ${ms}ms`);

  if (args.keep > 0) {
    const { kept, removed } = pruneOldBackups(args.outDir, args.keep);
    // eslint-disable-next-line no-console
    console.log(`retain:  ${kept.length} kept, ${removed.length} removed`);
    if (removed.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`removed: ${removed.join(', ')}`);
    }
  }

  return 0;
}

process.exit(main());
