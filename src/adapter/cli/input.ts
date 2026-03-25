/**
 * CLI Input Handler
 *
 * Handles multiline input, paste detection, and loading states
 */

import { logger } from '../../infra/observability/logger';
import * as readline from 'readline';
import { EventEmitter } from 'events';

// Spinner frames for loading animation
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL = 80;

/**
 * Loading indicator with spinner animation
 */
export class LoadingIndicator {
  private interval: NodeJS.Timeout | null = null;
  private frameIndex = 0;
  private message: string;
  private prefix: string;

  constructor(message: string = 'Processing', prefix: string = '\n') {
    this.message = message;
    this.prefix = prefix;
  }

  /**
   * Start the loading animation
   */
  start(): void {
    if (this.interval) return;

    // Hide cursor
    process.stdout.write('\x1B[?25l');

    this.frameIndex = 0;
    this.interval = setInterval(() => {
      const frame = SPINNER_FRAMES[this.frameIndex];
      process.stdout.write(`\r${this.prefix}${frame} ${this.message}...`);
      this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
    }, SPINNER_INTERVAL);
  }

  /**
   * Update the loading message
   */
  update(message: string): void {
    this.message = message;
  }

  /**
   * Stop the loading animation
   */
  stop(clearLine: boolean = true): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    // Show cursor
    process.stdout.write('\x1B[?25h');

    if (clearLine) {
      // Clear the line
      process.stdout.write('\r\x1B[2K');
    }
  }

  /**
   * Stop and show success message
   */
  success(message: string): void {
    this.stop(false);
    process.stdout.write(`\r✅ ${message}\n`);
  }

  /**
   * Stop and show error message
   */
  error(message: string): void {
    this.stop(false);
    process.stdout.write(`\r❌ ${message}\n`);
  }
}

/**
 * Progress indicator for multi-step operations
 */
export class ProgressIndicator {
  private current = 0;
  private total: number;
  private width = 30;

  constructor(total: number) {
    this.total = total;
  }

  /**
   * Update progress
   */
  update(current: number, message?: string): void {
    this.current = current;
    const percent = Math.floor((current / this.total) * 100);
    const filled = Math.floor((current / this.total) * this.width);
    const empty = this.width - filled;

    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const msg = message ? ` ${message}` : '';

    process.stdout.write(`\r  [${bar}] ${percent}%${msg}`);
  }

  /**
   * Complete the progress
   */
  complete(message?: string): void {
    this.update(this.total, message || 'Done');
    process.stdout.write('\n');
  }
}

/**
 * Input handler with multiline and paste support
 */
export class InputHandler extends EventEmitter {
  private rl: readline.Interface;
  private inputBuffer: string[] = [];
  private isInMultilineMode = false;
  private multilineDelimiter = '';
  private pasteMode = false;
  private lastInputTime = 0;
  private pasteThreshold = 50; // ms between keystrokes to detect paste

  constructor() {
    super();

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      historySize: 1000,
      removeHistoryDuplicates: true,
    });

    // Handle terminal resize
    process.stdout.on('resize', () => {
      this.emit('resize');
    });
  }

  /**
   * Check if input appears to be a paste (large content)
   */
  private detectPaste(input: string): boolean {
    const now = Date.now();
    const timeSinceLastInput = now - this.lastInputTime;
    this.lastInputTime = now;

    // Detect paste by:
    // 1. Large input (more than 500 chars)
    // 2. Multiple lines
    // 3. Very fast input
    const isLargeInput = input.length > 500;
    const hasMultipleLines = input.includes('\n');
    const isFastInput = timeSinceLastInput < this.pasteThreshold && input.length > 50;

    return isLargeInput || hasMultipleLines || isFastInput;
  }

  /**
   * Show input indicator with character count for large inputs
   */
  private showInputIndicator(input: string): void {
    if (input.length > 100) {
      const lines = input.split('\n').length;
      const chars = input.length;
      process.stdout.write(`\x1B[90m  (${lines} lines, ${chars} chars)\x1B[0m\n`);
    }
  }

  /**
   * Prompt for single-line input
   */
  async prompt(query: string = '> '): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(query, (input) => {
        // Detect paste and emit event
        if (this.detectPaste(input)) {
          this.emit('paste', input);
          this.showInputIndicator(input);
        }

        this.emit('input', input);
        resolve(input);
      });
    });
  }

  /**
   * Prompt for multiline input (ends with delimiter on its own line)
   */
  async promptMultiline(query: string = '>>> ', endDelimiter: string = 'END'): Promise<string> {
    return new Promise((resolve) => {
      this.inputBuffer = [];
      this.isInMultilineMode = true;
      this.multilineDelimiter = endDelimiter;

      logger.debug(`(Enter ${endDelimiter} on a new line to finish, or Ctrl+D)`);

      const promptLine = () => {
        this.rl.question(query, (line) => {
          if (line.trim() === endDelimiter) {
            // End of multiline input
            this.isInMultilineMode = false;
            const result = this.inputBuffer.join('\n');
            this.inputBuffer = [];
            this.emit('multiline', result);
            resolve(result);
          } else {
            this.inputBuffer.push(line);
            promptLine();
          }
        });
      };

      promptLine();
    });
  }

  /**
   * Prompt with auto-detection of multiline (if input starts with specific triggers)
   */
  async promptAuto(query: string = '> ', multilineTriggers: string[] = ['"""', "'''", '```']): Promise<string> {
    const firstLine = await this.prompt(query);

    // Check if this should be multiline
    const trigger = multilineTriggers.find(t => firstLine.startsWith(t));

    if (trigger && !firstLine.slice(trigger.length).includes(trigger)) {
      // Started a multiline block
      logger.debug('(Continue typing, end with ' + trigger + ')');
      this.inputBuffer = [firstLine];

      while (true) {
        const line = await this.prompt('... ');
        this.inputBuffer.push(line);

        if (line.includes(trigger)) {
          break;
        }
      }

      return this.inputBuffer.join('\n');
    }

    return firstLine;
  }

  /**
   * Get a confirmation (y/n)
   */
  async confirm(query: string, defaultValue: boolean = false): Promise<boolean> {
    const hint = defaultValue ? '[Y/n]' : '[y/N]';
    const answer = await this.prompt(`${query} ${hint}: `);

    if (!answer.trim()) {
      return defaultValue;
    }

    return answer.toLowerCase().startsWith('y');
  }

  /**
   * Select from a list of options
   */
  async select(query: string, options: string[]): Promise<number> {
    logger.debug(`\n${query}\n`);
    options.forEach((opt, i) => {
      logger.debug(`  ${i + 1}. ${opt}`);
    });
    logger.debug('');

    while (true) {
      const answer = await this.prompt('Select (1-' + options.length + '): ');
      const num = parseInt(answer, 10);

      if (num >= 1 && num <= options.length) {
        return num - 1;
      }

      logger.debug('Invalid selection. Please try again.');
    }
  }

  /**
   * Close the input handler
   */
  close(): void {
    this.rl.close();
  }

  /**
   * Get the underlying readline interface
   */
  getReadline(): readline.Interface {
    return this.rl;
  }
}

/**
 * Format elapsed time for display
 */
export function formatElapsed(startTime: number): string {
  const elapsed = Date.now() - startTime;

  if (elapsed < 1000) {
    return `${elapsed}ms`;
  } else if (elapsed < 60000) {
    return `${(elapsed / 1000).toFixed(1)}s`;
  } else {
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
}

/**
 * Create a simple spinner that can be used in async functions
 */
export async function withSpinner<T>(
  message: string,
  fn: () => Promise<T>,
  successMessage?: string
): Promise<T> {
  const spinner = new LoadingIndicator(message);
  spinner.start();

  try {
    const result = await fn();
    spinner.success(successMessage || message + ' complete');
    return result;
  } catch (error) {
    spinner.error(message + ' failed');
    throw error;
  }
}

/**
 * Type animation effect for output
 */
export async function typeText(text: string, delay: number = 10): Promise<void> {
  for (const char of text) {
    process.stdout.write(char);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

/**
 * Clear current line and rewrite
 */
export function rewriteLine(text: string): void {
  process.stdout.write('\r\x1B[2K' + text);
}

/**
 * Show a temporary message that disappears
 */
export async function showTemporaryMessage(message: string, duration: number = 2000): Promise<void> {
  process.stdout.write(`\x1B[90m${message}\x1B[0m`);
  await new Promise(resolve => setTimeout(resolve, duration));
  process.stdout.write('\r\x1B[2K');
}
