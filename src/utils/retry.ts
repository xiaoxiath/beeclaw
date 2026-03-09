/**
 * Retry Utility — Compatibility Shim
 *
 * This module now delegates to unified-retry.ts for all retry logic.
 * Kept for backward compatibility. New code should import from unified-retry directly.
 *
 * @deprecated Use `import { getRetryEngine } from './unified-retry'` for new code.
 */

import { getRetryEngine, type RetryResult } from './unified-retry';

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelay?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelay?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Jitter factor to add randomness (0-1, default: 0.1) */
  jitter?: number;
  /** Custom retry condition function */
  shouldRetry?: (error: Error, attempt: number) => boolean;
  /** Callback for retry events */
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}

/**
 * Execute a function with retry logic.
 * Delegates to UnifiedRetryEngine under the hood.
 *
 * @deprecated Use `getRetryEngine().execute()` for new code.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 2,
    jitter = 0.1,
    shouldRetry: customShouldRetry,
    onRetry,
  } = options;

  const engine = getRetryEngine();

  const result: RetryResult<T> = await engine.execute<T>(fn, {
    strategyName: 'default',
    maxAttempts: maxRetries + 1,
    overrides: {
      baseDelayMs: initialDelay,
      maxDelayMs: maxDelay,
      backoffMultiplier,
      jitterFactor: jitter,
    },
    shouldRetry: customShouldRetry
      ? (err: unknown, attempt: number) => {
          return customShouldRetry(err instanceof Error ? err : new Error(String(err)), attempt);
        }
      : undefined,
    onRetry: onRetry
      ? (attempt: number, error: unknown, delayMs: number) => {
          onRetry(error instanceof Error ? error : new Error(String(error)), attempt, delayMs);
        }
      : undefined,
  });

  if (result.success) {
    return result.value!;
  }
  throw result.error;
}

/**
 * Create a retry wrapper for fetch.
 *
 * @deprecated Use unified-retry for new code.
 */
export function createRetryFetch(
  options: RetryOptions = {}
): (url: string, init?: RequestInit) => Promise<Response> {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    return retry(
      async () => {
        const response = await fetch(url, init);
        if (!response.ok) {
          let errorBody = '';
          try {
            errorBody = await response.text();
          } catch {
            // Ignore
          }
          throw new Error(
            `HTTP ${response.status} ${response.statusText}${errorBody ? `: ${errorBody}` : ''}`
          );
        }
        return response;
      },
      options
    );
  };
}

/**
 * Retry wrapper specifically for AI API calls.
 *
 * @deprecated Use `getRetryEngine().execute(fn, { strategyName: 'ai_api' })` for new code.
 */
export async function retryAICall<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  return retry(fn, {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 60000,
    backoffMultiplier: 2,
    jitter: 0.2,
    onRetry: (error, attempt, delay) => {
      console.warn(
        `[AI Retry] Attempt ${attempt} failed: ${error.message}. ` +
        `Retrying in ${Math.round(delay / 1000)}s...`
      );
    },
    ...options,
  });
}
