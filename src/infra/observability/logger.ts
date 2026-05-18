/**
 * Unified logger for beeclaw — pino-backed.
 *
 * Three things this module guarantees:
 *
 *   1. **API stability** — `logger.{debug,info,warn,error}(msg, ...args)` keeps
 *      working for all ~1100 existing call sites. No big-bang migration needed.
 *
 *   2. **Per-namespace levels** — `getLogger('agent')` returns a logger whose
 *      effective level can be overridden via `logger.configure({ namespaces:
 *      { 'agent': 'info', 'memory.*': 'error' } })`. Glob suffix `*` matches
 *      prefix. Operators tune noise per subsystem instead of one global knob.
 *
 *   3. **Secret redaction at the boundary** — message and args run through
 *      `redactString` / `redactValue` before pino sees them. Pino's own
 *      path-based `redact` config is bypassed (it can't catch free-text leaks).
 *
 * Destination swapping (TUI mode writes JSON-line to logs/cli-debug.log instead
 * of corrupting Ink's render area) goes through `setLoggerDestination()` —
 * see src/adapter/cli/tui/logger-redirect.ts.
 */

import pino from 'pino';
import type { Logger as PinoLogger, DestinationStream } from 'pino';
import pretty from 'pino-pretty';

// ─── Secret redaction (unchanged from the pre-pino implementation) ────────

const REDACTED = '[REDACTED]';

const SECRET_KEY_RE = /^(api[_-]?key|apikey|secret|token|password|passwd|auth(?:orization)?|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key)$/i;

const SECRET_VALUE_PATTERNS: Array<{ re: RegExp; replace: string }> = [
  { re: /\bsk-[A-Za-z0-9_-]{16,}\b/g, replace: 'sk-[REDACTED]' },
  { re: /\bBearer\s+[A-Za-z0-9._\-/+=]{16,}/gi, replace: 'Bearer [REDACTED]' },
  { re: /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password)=([^&\s"']+)/gi, replace: '$1=[REDACTED]' },
  { re: /\bgh[psour]_[A-Za-z0-9]{36,}\b/g, replace: 'gh[REDACTED]' },
];

export function redactString(s: string): string {
  let out = s;
  for (const { re, replace } of SECRET_VALUE_PATTERNS) {
    out = out.replace(re, replace);
  }
  return out;
}

// Exported for tests — verifying the recursive walker directly is
// less brittle than diffing pino's serialized output across versions.
export function redactValue(v: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof v === 'string') return redactString(v);
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Error) {
    return {
      name: v.name,
      message: redactString(v.message),
      ...(v.stack ? { stack: redactString(v.stack) } : {}),
    };
  }
  if (seen.has(v as object)) return '[Circular]';
  seen.add(v as object);
  if (Array.isArray(v)) return v.map(item => redactValue(item, seen));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(k) && val != null && val !== '') {
      out[k] = REDACTED;
    } else {
      out[k] = redactValue(val, seen);
    }
  }
  return out;
}

// ─── Levels & namespace registry ─────────────────────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LoggerConfig {
  level: LogLevel;
  format: 'json' | 'pretty';
  /**
   * Per-namespace level override. Key matches the string passed to
   * getLogger(ns). Trailing `*` is a prefix glob ("memory.*" matches
   * "memory.injector", "memory.scoring", etc.). Exact match wins
   * over glob; ties broken by registration order.
   */
  namespaces: Record<string, LogLevel>;
}

let defaultLevel: LogLevel = 'info';
let activeFormat: 'json' | 'pretty' =
  process.env.NODE_ENV === 'production' ? 'json' : 'pretty';
let nsLevels: Record<string, LogLevel> = {};

function resolveLevel(ns: string | undefined): LogLevel {
  if (!ns) return defaultLevel;
  if (nsLevels[ns]) return nsLevels[ns];
  for (const [pattern, level] of Object.entries(nsLevels)) {
    if (pattern.endsWith('*') && ns.startsWith(pattern.slice(0, -1))) return level;
  }
  return defaultLevel;
}

// ─── Pino root construction & destination management ─────────────────────

let activeDestination: DestinationStream | undefined;
let rootPino: PinoLogger = buildPino();

function buildPino(): PinoLogger {
  // Pass-through level on the root — shim does its own per-ns filtering
  // (pino's level is per-instance; per-ns levels at the root would mean
  // round-tripping through child loggers, more allocations and trickier
  // dynamic reconfig).
  const opts: pino.LoggerOptions = {
    level: 'trace',
    base: undefined, // drop pid/hostname from every line
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  if (activeDestination) {
    return pino(opts, activeDestination);
  }
  if (activeFormat === 'pretty') {
    // Direct stream (no worker transport) — bun + transport workers can be
    // flaky and we're not throughput-bound.
    //
    // We deliberately don't put `ns` into messageFormat: pino-pretty already
    // surfaces it as an indented key below the message, and most legacy log
    // lines still carry a `[Subsystem]` prefix in the message body. Putting
    // ns inline would produce `[session] [Session] Loaded …`.
    const stream = pretty({
      colorize: true,
      translateTime: 'SYS:HH:MM:ss.l',
      ignore: 'pid,hostname,ns',
      messageFormat: '{if ns}({ns}){end} {msg}',
    });
    return pino(opts, stream);
  }
  return pino(opts);
}

function rebuildPino(): void {
  rootPino = buildPino();
}

/**
 * Swap the underlying destination stream. Pass `undefined` to restore the
 * default stdout sink. Used by the TUI redirect to route logs to a side
 * file while Ink owns the terminal.
 */
export function setLoggerDestination(stream: DestinationStream | undefined): void {
  activeDestination = stream;
  rebuildPino();
}

// ─── Public API: backward-compatible shim ────────────────────────────────

/**
 * Backward-compatible logger interface. Same shape as the pre-pino logger
 * so existing `logger.info('[Foo] bar', { detail })` calls keep working
 * unchanged. New code should prefer `getLogger('namespace')` for filterable
 * output.
 */
export class LoggerShim {
  constructor(
    private readonly ns?: string,
    private readonly bindings?: Record<string, unknown>,
  ) {}

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[resolveLevel(this.ns)];
  }

  private emit(level: LogLevel, message: string, args: unknown[]): void {
    if (!this.shouldLog(level)) return;
    const safeMsg = redactString(message);
    const obj: Record<string, unknown> = {};
    if (this.ns) obj.ns = this.ns;
    if (this.bindings) Object.assign(obj, this.bindings);
    if (args.length > 0) {
      // Lift single-object args into top-level fields when shape allows
      // (mirrors pino idiom: log.info({ k: v }, 'msg')). Multi-arg and
      // primitive args land under `args` for inspection.
      if (args.length === 1 && args[0] && typeof args[0] === 'object' && !(args[0] instanceof Error)) {
        Object.assign(obj, redactValue(args[0]) as Record<string, unknown>);
      } else {
        obj.args = args.map(a => redactValue(a));
      }
    }
    rootPino[level](obj, safeMsg);
  }

  debug(message: string, ...args: unknown[]): void { this.emit('debug', message, args); }
  info(message: string, ...args: unknown[]): void { this.emit('info', message, args); }
  warn(message: string, ...args: unknown[]): void { this.emit('warn', message, args); }
  error(message: string, ...args: unknown[]): void { this.emit('error', message, args); }

  /**
   * Attach additional bindings (req_id, user_id, ...) to every log line
   * from the returned logger. Inherits the namespace.
   */
  child(context: Record<string, unknown>): LoggerShim {
    return new LoggerShim(this.ns, { ...(this.bindings ?? {}), ...context });
  }

  /**
   * Reconfigure the root logger. Call once from bootstrap after the
   * config is loaded; subsequent calls replace state.
   */
  configure(config: Partial<LoggerConfig>): void {
    let needsRebuild = false;
    if (config.level) defaultLevel = config.level;
    if (config.format && config.format !== activeFormat) {
      activeFormat = config.format;
      needsRebuild = true;
    }
    if (config.namespaces) nsLevels = { ...config.namespaces };
    if (needsRebuild) rebuildPino();
  }
}

export const logger = new LoggerShim();
export type { LoggerShim as Logger };

export function getLogger(ns: string): LoggerShim {
  return new LoggerShim(ns);
}
