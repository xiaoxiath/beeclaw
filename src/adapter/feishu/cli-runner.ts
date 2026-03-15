/**
 * Feishu CLI Runner
 *
 * Executes feishu-cli commands for Feishu operations
 */

import { getLogger } from '../../infra/observability/logger';
import { spawn } from 'child_process';
import { z } from 'zod';

const logger = getLogger('feishu:cli-runner');

/**
 * Feishu CLI configuration
 */
export interface FeishuCLIConfig {
  cliPath: string;              // Path to feishu-cli binary
  env: {
    FEISHU_APP_ID: string;
    FEISHU_APP_SECRET: string;
  };
  timeout?: number;              // Default: 30000ms
  retries?: number;              // Default: 2
}

/**
 * CLI error types
 */
export enum FeishuCLIError {
  BINARY_NOT_FOUND = 'CLI_BINARY_NOT_FOUND',
  PROCESS_TIMEOUT = 'CLI_PROCESS_TIMEOUT',
  AUTH_FAILED = 'CLI_AUTH_FAILED',
  RATE_LIMIT = 'CLI_RATE_LIMIT',
  PERMISSION_DENIED = 'CLI_PERMISSION_DENIED',
  API_ERROR = 'CLI_API_ERROR',
  UNKNOWN = 'CLI_UNKNOWN_ERROR',
}

/**
 * Map CLI exit codes to error types
 */
const EXIT_CODE_ERROR_MAP: Record<number, FeishuCLIError> = {
  1: FeishuCLIError.API_ERROR,
  2: FeishuCLIError.AUTH_FAILED,
  3: FeishuCLIError.PERMISSION_DENIED,
  4: FeishuCLIError.RATE_LIMIT,
};

/**
 * CLI execution options
 */
export interface CLIExecutionOptions {
  json?: boolean;                // Auto-add --json flag
  timeout?: number;              // Override default timeout
  userAccessToken?: string;      // For user-authorized operations
}

/**
 * CLI execution result
 */
export interface CLIResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errorType?: FeishuCLIError;
}

/**
 * Feishu CLI Runner
 *
 * Executes feishu-cli commands with proper error handling and retries
 */
export class FeishuCLIRunner {
  private config: FeishuCLIConfig;

  constructor(config: FeishuCLIConfig) {
    this.config = config;
  }

  /**
   * Execute a feishu-cli command
   *
   * @param command - Main command (e.g., 'file', 'wiki', 'calendar')
   * @param args - Command arguments
   * @param options - Execution options
   * @returns CLI result with parsed data
   */
  async execute<T = unknown>(
    command: string,
    args: string[],
    options: CLIExecutionOptions = {}
  ): Promise<CLIResult<T>> {
    const maxRetries = this.config.retries || 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.executeOnce<T>(command, args, options);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');

        // Check if error is retryable
        const errorType = this.classifyError(lastError);
        if (errorType === FeishuCLIError.RATE_LIMIT || errorType === FeishuCLIError.PROCESS_TIMEOUT) {
          if (attempt < maxRetries) {
            logger.warn(`Attempt ${attempt + 1} failed, retrying...`, { error: lastError.message });
            await this.delay(1000 * (attempt + 1)); // Exponential backoff
            continue;
          }
        }

        // Non-retryable error or max retries reached
        break;
      }
    }

    // All retries failed
    const errorType = lastError ? this.classifyError(lastError) : FeishuCLIError.UNKNOWN;
    return {
      success: false,
      error: lastError?.message || 'Unknown error',
      errorType,
    };
  }

  /**
   * Execute command once (single attempt)
   */
  private async executeOnce<T>(
    command: string,
    args: string[],
    options: CLIExecutionOptions
  ): Promise<CLIResult<T>> {
    // Build full command
    const fullArgs = this.buildArgs(command, args, options);

    logger.debug(`Executing: ${this.config.cliPath} ${fullArgs.join(' ')}`);

    const timeout = options.timeout || this.config.timeout || 30000;
    const env = { ...process.env, ...this.config.env };

    // Add user access token if provided
    if (options.userAccessToken) {
      env.FEISHU_USER_ACCESS_TOKEN = options.userAccessToken;
    }

    return new Promise((resolve) => {
      const proc = spawn(this.config.cliPath, fullArgs, {
        env,
        timeout,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // Collect stdout
      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      // Collect stderr
      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // Handle timeout
      proc.on('close', (code) => {
        if (timedOut) {
          resolve({
            success: false,
            error: `Command timed out after ${timeout}ms`,
            errorType: FeishuCLIError.PROCESS_TIMEOUT,
          });
          return;
        }

        if (code === 0) {
          try {
            // Parse JSON if json flag was set
            const data = options.json ? JSON.parse(stdout) : stdout;
            resolve({
              success: true,
              data,
            });
          } catch (parseError) {
            resolve({
              success: false,
              error: `Failed to parse CLI output: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}`,
              errorType: FeishuCLIError.UNKNOWN,
            });
          }
        } else {
          // Non-zero exit code
          const errorType = EXIT_CODE_ERROR_MAP[code || 1] || FeishuCLIError.API_ERROR;
          const errorMsg = stderr || stdout || `Process exited with code ${code}`;

          resolve({
            success: false,
            error: errorMsg,
            errorType,
          });
        }
      });

      // Handle process errors
      proc.on('error', (error) => {
        if (error.message.includes('ENOENT')) {
          resolve({
            success: false,
            error: `CLI binary not found at ${this.config.cliPath}`,
            errorType: FeishuCLIError.BINARY_NOT_FOUND,
          });
        } else {
          resolve({
            success: false,
            error: error.message,
            errorType: FeishuCLIError.UNKNOWN,
          });
        }
      });

      // Set timeout
      setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, timeout);
    });
  }

  /**
   * Build command arguments
   */
  private buildArgs(
    command: string,
    args: string[],
    options: CLIExecutionOptions
  ): string[] {
    const fullArgs = [command, ...args];

    // Add --json flag if requested
    if (options.json) {
      fullArgs.push('--json');
    }

    return fullArgs;
  }

  /**
   * Classify error type from error message
   */
  private classifyError(error: Error): FeishuCLIError {
    const message = error.message.toLowerCase();

    if (message.includes('enoent') || message.includes('not found')) {
      return FeishuCLIError.BINARY_NOT_FOUND;
    }

    if (message.includes('timeout')) {
      return FeishuCLIError.PROCESS_TIMEOUT;
    }

    if (message.includes('auth') || message.includes('unauthorized')) {
      return FeishuCLIError.AUTH_FAILED;
    }

    if (message.includes('rate limit') || message.includes('too many requests')) {
      return FeishuCLIError.RATE_LIMIT;
    }

    if (message.includes('permission') || message.includes('forbidden')) {
      return FeishuCLIError.PERMISSION_DENIED;
    }

    return FeishuCLIError.API_ERROR;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if CLI binary is available
   */
  async checkBinary(): Promise<boolean> {
    try {
      const result = await this.execute('version', [], { timeout: 5000 });
      return result.success;
    } catch {
      return false;
    }
  }
}

// ============================================================
// Singleton Instance
// ============================================================

let cliRunnerInstance: FeishuCLIRunner | null = null;

/**
 * Initialize the Feishu CLI runner with configuration
 */
export function initFeishuCLIRunner(config: FeishuCLIConfig): FeishuCLIRunner {
  if (!cliRunnerInstance) {
    cliRunnerInstance = new FeishuCLIRunner(config);
  }
  return cliRunnerInstance;
}

/**
 * Get the Feishu CLI runner instance
 */
export function getFeishuCLIRunner(): FeishuCLIRunner | null {
  return cliRunnerInstance;
}

/**
 * Reset the CLI runner instance (for testing)
 */
export function resetFeishuCLIRunner(): void {
  cliRunnerInstance = null;
}
