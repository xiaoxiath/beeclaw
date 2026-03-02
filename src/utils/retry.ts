/**
 * Retry Utility
 *
 * Provides retry mechanism with exponential backoff for API calls.
 * Now integrated with error classification system.
 */

import { classifyError as classifyErrorNew, type ClassifiedError } from './error-handler';
import { calculateDelay } from './retry-strategy';

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
  /** HTTP status codes that should trigger retry (deprecated, use error classification) */
  retryStatusCodes?: number[];
  /** Custom retry condition function */
  shouldRetry?: (error: Error, attempt: number) => boolean;
  /** Callback for retry events */
  onRetry?: (error: Error, attempt: number, delay: number) => void;
  /** Callback for classified error (new) */
  onClassifiedError?: (error: ClassifiedError, attempt: number, delay: number) => void;
}

const DEFAULT_RETRY_STATUS_CODES = [
  408, // Request Timeout
  429, // Too Many Requests (rate limit)
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
];

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Classify error with context (wrapper for new error handler)
 */
function classifyError(error: Error, context?: any): ClassifiedError {
  try {
    return classifyErrorNew(error, context);
  } catch {
    // Fallback if error handler not available
    return {
      type: 'UNKNOWN' as any,
      retryable: false,
      message: error.message,
      userMessage: error.message,
      originalError: error,
      timestamp: new Date(),
    };
  }
}

/**
 * Execute a function with retry logic
 *
 * Now uses error classification to determine retryability.
 *
 * @example
 * ```typescript
 * const result = await retry(
 *   async () => {
 *     const response = await fetch('https://api.example.com/data');
 *     if (!response.ok) {
 *       throw new Error(`HTTP ${response.status}`);
 *     }
 *     return response.json();
 *   },
 *   { maxRetries: 3, initialDelay: 1000 }
 * );
 * ```
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
    onClassifiedError,
  } = options;

  let lastError: Error | undefined;
  let lastClassifiedError: ClassifiedError | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Classify the error using new error handler
      lastClassifiedError = classifyError(lastError, { attempt });

      // Check if we should retry
      const isLastAttempt = attempt === maxRetries;
      const defaultShouldRetry = lastClassifiedError.retryable;
      const customShouldRetryResult = customShouldRetry?.(lastError, attempt);

      // Decision: use custom logic if provided, otherwise use classification
      const shouldRetryNow = customShouldRetryResult !== undefined
        ? customShouldRetryResult
        : defaultShouldRetry;

      if (isLastAttempt || !shouldRetryNow) {
        throw lastError;
      }

      // Calculate delay
      const delay = calculateDelay(
        attempt,
        initialDelay,
        maxDelay,
        backoffMultiplier,
        jitter
      );

      // Notify callbacks
      onRetry?.(lastError, attempt + 1, delay);
      onClassifiedError?.(lastClassifiedError, attempt + 1, delay);

      // Log retry
      console.log(
        `[Retry] Attempt ${attempt + 1}/${maxRetries} failed: ${lastError.message}\n` +
        `  Type: ${lastClassifiedError.type} (${lastClassifiedError.retryable ? 'retryable' : 'non-retryable'})\n` +
        `  Retrying in ${Math.round(delay / 1000)}s...`
      );

      // Wait before next attempt
      await sleep(delay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Create a retry wrapper for fetch
 *
 * @example
 * ```typescript
 * const fetchWithRetry = createRetryFetch({ maxRetries: 3 });
 * const response = await fetchWithRetry('https://api.example.com/data', {
 *   method: 'POST',
 *   body: JSON.stringify({ query: 'hello' }),
 * });
 * ```
 */
export function createRetryFetch(
  options: RetryOptions = {}
): (url: string, init?: RequestInit) => Promise<Response> {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    return retry(
      async () => {
        const response = await fetch(url, init);

        if (!response.ok) {
          // Try to get error body for more context
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
      {
        ...options,
        // For HTTP errors, parse status code from error message
        retryStatusCodes: options.retryStatusCodes || DEFAULT_RETRY_STATUS_CODES,
      }
    );
  };
}

/**
 * Retry wrapper specifically for AI API calls
 */
export async function retryAICall<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  return retry(fn, {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 60000, // Allow up to 60s delay for AI APIs
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
