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

    if (this.format === 'json') {
      return JSON.stringify({
        timestamp,
        level,
        message,
        args: args.length > 0 ? args : undefined,
      });
    }

    const coloredLevel = this.colorize(level, level.toUpperCase());
    const formattedArgs = args.length > 0 ? ' ' + args.map(a => {
      // Special handling for Error objects to avoid empty {} serialization
      if (a instanceof Error) {
        const errorObj: Record<string, unknown> = {
          name: a.name,
          message: a.message,
        };
        if (a.stack) {
          errorObj.stack = a.stack;
        }
        // Include any additional enumerable properties
        Object.keys(a).forEach(key => {
          errorObj[key] = (a as any)[key];
        });
        return this.safeStringify(errorObj, 2);
      }
      return typeof a === 'object' ? this.safeStringify(a, 2) : String(a);
    }).join(' ') : '';

    return `${prefix.replace(level.toUpperCase(), coloredLevel)} ${message}${formattedArgs}`;
  }

  /**
   * Safely stringify an object, handling circular references
   */
  private safeStringify(obj: unknown, indent?: number): string {
    try {
      const seen = new WeakSet();
      return JSON.stringify(obj, (_key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular]';
          }
          seen.add(value);
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
