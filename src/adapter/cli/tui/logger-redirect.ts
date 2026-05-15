/**
 * In TUI mode, the logger MUST NOT write to stdout — stdout is reserved
 * for Ink's render output. Without this redirect, every `logger.info(...)`
 * call interleaves with the chat UI and corrupts the terminal grid.
 *
 * Strategy: monkey-patch the four logger methods to write to a side file
 * via fs.appendFileSync (sync to avoid interleaving across async boundaries).
 * The original methods are stashed so we can restore on shutdown if needed.
 *
 * The side file lives at logs/cli-debug.log relative to cwd. We rotate
 * by truncating on TUI startup if it's > 5MB — small enough that single
 * sessions don't collide, big enough that multi-session debugging works.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../../infra/observability/logger';

// Resolve lazily so tests / scripts that chdir before activating get the
// log file under their actual cwd (not the cwd at module-import time).
function resolveLogPath(): string {
  return path.join(process.cwd(), 'logs', 'cli-debug.log');
}
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

let activeLogPath: string | null = null;

let originalDebug: typeof logger.debug | null = null;
let originalInfo: typeof logger.info | null = null;
let originalWarn: typeof logger.warn | null = null;
let originalError: typeof logger.error | null = null;

function ensureLogDir(logPath: string): void {
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Rotate if oversized.
  try {
    const stat = fs.statSync(logPath);
    if (stat.size > MAX_SIZE) {
      fs.renameSync(logPath, logPath + '.1');
    }
  } catch {
    // Doesn't exist yet — that's fine.
  }
}

function appendLine(level: string, args: unknown[]): void {
  if (!activeLogPath) return;
  try {
    const ts = new Date().toISOString();
    const parts = args.map(a => {
      if (a instanceof Error) return `${a.message}\n${a.stack ?? ''}`;
      if (typeof a === 'object' && a !== null) {
        try { return JSON.stringify(a); } catch { return String(a); }
      }
      return String(a);
    });
    fs.appendFileSync(activeLogPath, `[${ts}] [${level}] ${parts.join(' ')}\n`);
  } catch {
    // Last-resort: drop on the floor. We are NEVER allowed to write to
    // stdout from the logger in TUI mode.
  }
}

/**
 * Activate redirect. Idempotent — multiple calls are no-ops.
 * Call once at TUI mount.
 */
export function activateLoggerRedirect(): void {
  if (originalInfo) return; // already redirected

  activeLogPath = resolveLogPath();
  ensureLogDir(activeLogPath);

  originalDebug = logger.debug.bind(logger);
  originalInfo = logger.info.bind(logger);
  originalWarn = logger.warn.bind(logger);
  originalError = logger.error.bind(logger);

  logger.debug = ((message: string, ...args: unknown[]) => {
    appendLine('DEBUG', [message, ...args]);
  }) as typeof logger.debug;

  logger.info = ((message: string, ...args: unknown[]) => {
    appendLine('INFO', [message, ...args]);
  }) as typeof logger.info;

  logger.warn = ((message: string, ...args: unknown[]) => {
    appendLine('WARN', [message, ...args]);
  }) as typeof logger.warn;

  logger.error = ((message: string, ...args: unknown[]) => {
    appendLine('ERROR', [message, ...args]);
  }) as typeof logger.error;
}

/** Restore the original logger methods. Used by tests. */
export function restoreLogger(): void {
  if (!originalInfo) return;
  if (originalDebug) logger.debug = originalDebug;
  if (originalInfo) logger.info = originalInfo;
  if (originalWarn) logger.warn = originalWarn;
  if (originalError) logger.error = originalError;
  originalDebug = null;
  originalInfo = null;
  originalWarn = null;
  originalError = null;
  activeLogPath = null;
}

/** Path callers can show in the UI ("logs at: ./logs/cli-debug.log"). */
export function getLogPath(): string {
  return activeLogPath ?? resolveLogPath();
}
