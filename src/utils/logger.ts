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
    const formattedArgs = args.length > 0 ? ' ' + args.map(a =>
      typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
    ).join(' ') : '';

    return `${prefix.replace(level.toUpperCase(), coloredLevel)} ${message}${formattedArgs}`;
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
export type { LoggerConfig, LogLevel };
