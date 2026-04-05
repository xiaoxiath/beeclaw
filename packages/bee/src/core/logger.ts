/**
 * bee — Logger interface.
 *
 * bee only defines the interface; consumers provide the implementation
 * via the setLogger() function.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ILogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  child(context: Record<string, unknown>): ILogger;
}

/** Console-based fallback logger used when no custom logger is set. */
class ConsoleLogger implements ILogger {
  private readonly prefix: string;

  constructor(prefix = '') {
    this.prefix = prefix;
  }

  private format(level: LogLevel, message: string, ...args: unknown[]): void {
    const ts = new Date().toISOString();
    const prefix = this.prefix ? `[${this.prefix}] ` : '';
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : level === 'debug' ? console.debug : console.info;
    fn(`[${ts}] [${level.toUpperCase()}] ${prefix}${message}`, ...args);
  }

  debug(message: string, ...args: unknown[]): void { this.format('debug', message, ...args); }
  info(message: string, ...args: unknown[]): void { this.format('info', message, ...args); }
  warn(message: string, ...args: unknown[]): void { this.format('warn', message, ...args); }
  error(message: string, ...args: unknown[]): void { this.format('error', message, ...args); }
  child(context: Record<string, unknown>): ILogger {
    return new ConsoleLogger(Object.entries(context).map(([k, v]) => `${k}=${v}`).join(' '));
  }
}

let _logger: ILogger = new ConsoleLogger();

/** Set a custom logger implementation. */
export function setLogger(logger: ILogger): void {
  _logger = logger;
}

/** Get the current logger instance. */
export function getLogger(): ILogger {
  return _logger;
}
