/**
 * Unified logger for beeclaw.
 *
 * NOTE: This module is imported directly by domain layer files.
 * Ideally, the domain should depend on a Logger interface (port)
 * defined in the domain layer, with this as the concrete implementation.
 * TODO: [CR-Layer] Extract ILogger interface to domain/ports/logger.ts
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerConfig {
  level: LogLevel;
  format: 'json' | 'pretty';
}

// ─── Secret redaction ──────────────────────────────────────────────────────
// Defense-in-depth: even if a contributor accidentally logs a config
// blob or response body, we mask common secret shapes before stdout.
// Caller can opt out per-call via { __noRedact: true } sentinel.

const REDACTED = '[REDACTED]';

/** Object keys whose value should be masked regardless of shape. */
const SECRET_KEY_RE = /^(api[_-]?key|apikey|secret|token|password|passwd|auth(?:orization)?|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key)$/i;

/** String patterns that look like secrets in free text. */
const SECRET_VALUE_PATTERNS: Array<{ re: RegExp; replace: string }> = [
  // OpenAI / Anthropic / Zhipu style: sk-...
  { re: /\bsk-[A-Za-z0-9_-]{16,}\b/g, replace: 'sk-[REDACTED]' },
  // Bearer tokens
  { re: /\bBearer\s+[A-Za-z0-9._\-/+=]{16,}/gi, replace: 'Bearer [REDACTED]' },
  // Generic key=value in URL-encoded / query strings
  { re: /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password)=([^&\s"']+)/gi, replace: '$1=[REDACTED]' },
  // GitHub-style: ghp_/ghs_/gho_/ghu_/ghr_ + 36 chars
  { re: /\bgh[psour]_[A-Za-z0-9]{36,}\b/g, replace: 'gh[REDACTED]' },
];

export function redactString(s: string): string {
  let out = s;
  for (const { re, replace } of SECRET_VALUE_PATTERNS) {
    out = out.replace(re, replace);
  }
  return out;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private level: LogLevel = 'info';
  private format: 'json' | 'pretty' = 'pretty';

  configure(config: Partial<LoggerConfig>): void {
    if (config.level) this.level = config.level;
    if (config.format) this.format = config.format;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private formatMessage(level: LogLevel, message: string, ...args: unknown[]): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    const safeMessage = redactString(message);

    if (this.format === 'json') {
      return JSON.stringify({
        timestamp,
        level,
        message: safeMessage,
        args: args.length > 0 ? args.map(a => this.redactValue(a)) : undefined,
      });
    }

    const coloredLevel = this.colorize(level, level.toUpperCase());
    const formattedArgs = args.length > 0 ? ' ' + args.map(a => {
      // Special handling for Error objects to avoid empty {} serialization
      if (a instanceof Error) {
        const errorObj: Record<string, unknown> = {
          name: a.name,
          message: redactString(a.message),
        };
        if (a.stack) {
          errorObj.stack = redactString(a.stack);
        }
        // Include any additional enumerable properties
        Object.keys(a).forEach(key => {
          errorObj[key] = (a as any)[key];
        });
        return this.safeStringify(errorObj, 2);
      }
      return typeof a === 'object' ? this.safeStringify(a, 2) : redactString(String(a));
    }).join(' ') : '';

    return `${prefix.replace(level.toUpperCase(), coloredLevel)} ${safeMessage}${formattedArgs}`;
  }

  /** Recursively redact a value (object/array/string), used for JSON-mode args. */
  private redactValue(v: unknown, seen = new WeakSet<object>()): unknown {
    if (typeof v === 'string') return redactString(v);
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v as object)) return '[Circular]';
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(item => this.redactValue(item, seen));
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k) && val != null && val !== '') {
        out[k] = REDACTED;
      } else {
        out[k] = this.redactValue(val, seen);
      }
    }
    return out;
  }

  /**
   * Safely stringify an object, handling circular references
   */
  private safeStringify(obj: unknown, indent?: number): string {
    try {
      const seen = new WeakSet();
      return JSON.stringify(obj, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular]';
          }
          seen.add(value);
        }
        // Mask values whose KEY looks like a secret (apiKey, token, password, ...).
        // Empty / null values pass through so structure stays inspectable.
        if (key && SECRET_KEY_RE.test(key) && value != null && value !== '') {
          return REDACTED;
        }
        // Mask secret-shaped strings inside any string value.
        if (typeof value === 'string') {
          return redactString(value);
        }
        return value;
      }, indent);
    } catch (error) {
      return `[Stringify Error: ${error instanceof Error ? error.message : String(error)}]`;
    }
  }

  private colorize(level: LogLevel, text: string): string {
    const colors: Record<LogLevel, string> = {
      debug: '\x1b[36m', // cyan
      info: '\x1b[32m',  // green
      warn: '\x1b[33m',  // yellow
      error: '\x1b[31m', // red
    };
    const reset = '\x1b[0m';
    return `${colors[level]}${text}${reset}`;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, ...args));
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, ...args));
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, ...args));
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, ...args));
    }
  }

  child(context: Record<string, unknown>): ChildLogger {
    return new ChildLogger(this, context);
  }
}

class ChildLogger {
  constructor(
    private parent: Logger,
    private context: Record<string, unknown>
  ) {}

  debug(message: string, ...args: unknown[]): void {
    this.parent.debug(message, { ...this.context }, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.parent.info(message, { ...this.context }, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.parent.warn(message, { ...this.context }, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.parent.error(message, { ...this.context }, ...args);
  }
}

export const logger = new Logger();
export type { Logger };

export function getLogger(context: string) {
  return logger.child({ context });
}

export type { LoggerConfig, LogLevel };
