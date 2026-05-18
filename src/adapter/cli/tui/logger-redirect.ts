/**
 * In TUI mode, the logger MUST NOT write to stdout — stdout is reserved
 * for Ink's render output. Without this redirect, every logger call
 * would interleave with the chat UI and corrupt the terminal grid.
 *
 * Strategy (post-pino): swap pino's destination stream to a sync file
 * appender. Sync is intentional — it keeps the log line ordered with
 * surrounding code paths even across async boundaries, which matters
 * for diagnosing TUI flow bugs.
 *
 * Format: pino's JSON-line output goes straight to the file. Operators
 * tail it with `tail -f logs/cli-debug.log | jq .` for pretty viewing.
 *
 * Rotation: truncate at TUI startup if the file is > 5 MB.
 */

import * as fs from 'fs';
import * as path from 'path';
import { setLoggerDestination } from '../../../infra/observability/logger';

function resolveLogPath(): string {
  return path.join(process.cwd(), 'logs', 'cli-debug.log');
}
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

let activeLogPath: string | null = null;
let activeFd: number | null = null;

function ensureLogDir(logPath: string): void {
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  try {
    const stat = fs.statSync(logPath);
    if (stat.size > MAX_SIZE) {
      fs.renameSync(logPath, logPath + '.1');
    }
  } catch {
    // doesn't exist yet — fine
  }
}

/**
 * Activate redirect. Idempotent — multiple calls are no-ops.
 * Call once at TUI mount.
 */
export function activateLoggerRedirect(): void {
  if (activeFd !== null) return;

  activeLogPath = resolveLogPath();
  ensureLogDir(activeLogPath);
  activeFd = fs.openSync(activeLogPath, 'a');
  const fdSnapshot = activeFd;

  // Pino destination contract: an object with a `.write(chunk)` method.
  // Sync fs.writeSync keeps ordering deterministic, which is critical
  // for diagnosing TUI flow bugs (we don't want async ordering noise
  // between the bug repro and the log capture).
  setLoggerDestination({
    write(chunk: string): void {
      try {
        fs.writeSync(fdSnapshot, chunk);
      } catch {
        // Last-resort: drop. We must NEVER write to stdout from the
        // logger while Ink owns the terminal.
      }
    },
  });
}

/** Restore the default pino destination (stdout). Used by tests + /exit. */
export function restoreLogger(): void {
  if (activeFd === null) return;
  setLoggerDestination(undefined);
  try { fs.closeSync(activeFd); } catch { /* ignore */ }
  activeFd = null;
  activeLogPath = null;
}

/** Path callers can show in the UI ("logs at: ./logs/cli-debug.log"). */
export function getLogPath(): string {
  return activeLogPath ?? resolveLogPath();
}
