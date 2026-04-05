/**
 * bee — Unified Retry Engine.
 *
 * Unified error classification, Retry-After header parsing, circuit-breaker
 * integration, and retry context tracking.
 * Extracted from beeclaw's src/infra/resilience/unified-retry.ts.
 */

import { CircuitBreakerRegistry, CircuitOpenError } from './circuit-breaker';

// ============================================================================
// Types
// ============================================================================

/** Unified error classification */
export type UnifiedErrorType =
  // Retryable
  | 'NETWORK_ERROR'
  | 'TIMEOUT_ERROR'
  | 'RATE_LIMIT'
  | 'SERVER_ERROR'
  | 'SERVICE_UNAVAILABLE'
  // Non-retryable
  | 'AUTH_ERROR'
  | 'VALIDATION_ERROR'
  | 'BUSINESS_ERROR'
  | 'INSUFFICIENT_BALANCE'
  | 'NOT_FOUND'
  | 'CANCELLED'
  | 'CIRCUIT_OPEN'
  | 'UNKNOWN';

export interface ClassifiedError {
  type: UnifiedErrorType;
  retryable: boolean;
  message: string;
  originalError: Error;
  httpStatus?: number;
  retryAfterMs?: number;
}

export interface RetryStrategy {
  /** Maximum retry attempts */
  maxRetries: number;
  /** Initial delay (ms) */
  initialDelayMs: number;
  /** Maximum delay (ms) */
  maxDelayMs: number;
  /** Backoff multiplier */
  backoffMultiplier: number;
  /** Jitter factor (0-1) */
  jitter: number;
  /** Backoff mode */
  backoffMode: 'exponential' | 'linear' | 'fixed';
  /** Custom retry predicate */
  shouldRetry?: (error: ClassifiedError, attempt: number) => boolean;
}

export interface RetryContext {
  /** Operation name */
  operationName: string;
  /** Current attempt (0 = first) */
  attempt: number;
  /** Total wait time so far */
  totalWaitMs: number;
  /** History of errors */
  errors: ClassifiedError[];
  /** Start time */
  startTime: number;
}

export interface RetryResult<T> {
  /** Whether the operation succeeded */
  success: boolean;
  /** Return value (on success) */
  value?: T;
  /** Final error (on failure) */
  error?: ClassifiedError;
  /** Retry context */
  context: RetryContext;
}

export type RetryEventListener = (event: RetryEvent) => void;

export interface RetryEvent {
  type: 'retry' | 'success' | 'failure' | 'circuit_open';
  operationName: string;
  attempt: number;
  error?: ClassifiedError;
  delayMs?: number;
  totalElapsedMs: number;
}

// ============================================================================
// Preset Retry Strategies
// ============================================================================

export const RETRY_STRATEGIES: Record<string, RetryStrategy> = {
  /** Agent-level -- core LLM calls */
  agent: {
    maxRetries: 3,
    initialDelayMs: 2_000,
    maxDelayMs: 30_000,
    backoffMultiplier: 2,
    jitter: 0.2,
    backoffMode: 'exponential',
  },

  /** Sub-agent calls */
  subagent: {
    maxRetries: 2,
    initialDelayMs: 1_000,
    maxDelayMs: 10_000,
    backoffMultiplier: 2,
    jitter: 0.15,
    backoffMode: 'exponential',
  },

  /** Tool calls -- only retry network / timeout */
  tool: {
    maxRetries: 2,
    initialDelayMs: 500,
    maxDelayMs: 5_000,
    backoffMultiplier: 2,
    jitter: 0.1,
    backoffMode: 'exponential',
    shouldRetry: (error, _attempt) => {
      return error.retryable && (error.type === 'NETWORK_ERROR' || error.type === 'TIMEOUT_ERROR');
    },
  },

  /** Generic API calls */
  api: {
    maxRetries: 3,
    initialDelayMs: 1_000,
    maxDelayMs: 20_000,
    backoffMultiplier: 2,
    jitter: 0.2,
    backoffMode: 'exponential',
  },

  /** Rate-limit -- prefer Retry-After header, otherwise long exponential backoff */
  rate_limit: {
    maxRetries: 5,
    initialDelayMs: 10_000,
    maxDelayMs: 120_000,
    backoffMultiplier: 2,
    jitter: 0.3,
    backoffMode: 'exponential',
    shouldRetry: (error) => error.type === 'RATE_LIMIT',
  },

  /** No retries */
  none: {
    maxRetries: 0,
    initialDelayMs: 0,
    maxDelayMs: 0,
    backoffMultiplier: 1,
    jitter: 0,
    backoffMode: 'fixed',
  },
};

// ============================================================================
// Error Classifier
// ============================================================================

/** Set of retryable error types */
const RETRYABLE_TYPES = new Set<UnifiedErrorType>([
  'NETWORK_ERROR',
  'TIMEOUT_ERROR',
  'RATE_LIMIT',
  'SERVER_ERROR',
  'SERVICE_UNAVAILABLE',
]);

/**
 * Unified error classifier.
 *
 * Inspects an unknown error and produces a ClassifiedError with type,
 * retryability, and optional HTTP metadata.
 */
export function classifyError(error: unknown): ClassifiedError {
  const err = error instanceof Error ? error : new Error(String(error));
  const message = err.message.toLowerCase();

  const httpStatus = extractHttpStatus(err);
  const retryAfterMs = extractRetryAfter(err);

  let type: UnifiedErrorType;

  // Priority-ordered classification

  // 1. Insufficient balance -- never retry
  if (
    (message.includes('insufficient') && (message.includes('balance') || message.includes('quota'))) ||
    message.includes('\u4f59\u989d\u4e0d\u8db3') ||
    message.includes('\u914d\u989d') ||
    httpStatus === 402
  ) {
    type = 'INSUFFICIENT_BALANCE';
  }
  // 2. Auth errors -- never retry
  else if (
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('auth') ||
    message.includes('api key') ||
    httpStatus === 401 ||
    httpStatus === 403
  ) {
    type = 'AUTH_ERROR';
  }
  // 3. Circuit breaker open
  else if (error instanceof CircuitOpenError) {
    type = 'CIRCUIT_OPEN';
  }
  // 4. Network errors -- retryable (before cancelled, since ECONNABORTED overlaps)
  else if (
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('econnreset') ||
    message.includes('econnaborted') ||
    message.includes('epipe') ||
    message.includes('network') ||
    message.includes('fetch failed') ||
    message.includes('dns')
  ) {
    type = 'NETWORK_ERROR';
  }
  // 5. Cancelled -- not retryable
  else if (message.includes('cancel') || message.includes('abort') || err.name === 'AbortError') {
    type = 'CANCELLED';
  }
  // 6. Not found -- not retryable
  else if (message.includes('not found') || message.includes('404') || httpStatus === 404) {
    type = 'NOT_FOUND';
  }
  // 7. Validation errors -- not retryable
  else if (
    message.includes('invalid') ||
    message.includes('validation') ||
    httpStatus === 400 ||
    httpStatus === 422
  ) {
    type = 'VALIDATION_ERROR';
  }
  // 8. Rate limit -- retryable
  else if (
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('throttl') ||
    httpStatus === 429
  ) {
    type = 'RATE_LIMIT';
  }
  // 9. Timeout -- retryable
  else if (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('etimeout') ||
    message.includes('response timeout') ||
    err.name === 'TimeoutError' ||
    httpStatus === 408 ||
    httpStatus === 504
  ) {
    type = 'TIMEOUT_ERROR';
  }
  // 10. Server errors -- retryable
  else if (httpStatus !== undefined && httpStatus >= 500) {
    type = httpStatus === 503 ? 'SERVICE_UNAVAILABLE' : 'SERVER_ERROR';
  }
  // 11. Unknown
  else {
    type = 'UNKNOWN';
  }

  return {
    type,
    retryable: RETRYABLE_TYPES.has(type),
    message: err.message,
    originalError: err,
    httpStatus,
    retryAfterMs,
  };
}

// ============================================================================
// HTTP Response Header Parsing
// ============================================================================

/** Extract HTTP status code from an error object. */
function extractHttpStatus(error: Error): number | undefined {
  const anyError = error as any;
  if (anyError.status) return anyError.status;
  if (anyError.statusCode) return anyError.statusCode;
  if (anyError.response?.status) return anyError.response.status;

  const match = error.message.match(/\b(\d{3})\b/);
  if (match) {
    const code = parseInt(match[1], 10);
    if (code >= 400 && code < 600) return code;
  }

  return undefined;
}

/**
 * Extract Retry-After value from an error's response headers.
 *
 * Supports both formats:
 *   Retry-After: 120           (seconds)
 *   Retry-After: Wed, 21 Oct 2025 07:28:00 GMT  (HTTP-date)
 */
function extractRetryAfter(error: Error): number | undefined {
  const anyError = error as any;

  const headers = anyError.response?.headers ?? anyError.headers;
  if (!headers) return undefined;

  let retryAfterValue: string | null = null;

  if (typeof headers.get === 'function') {
    retryAfterValue = headers.get('retry-after');
  } else if (typeof headers === 'object') {
    retryAfterValue = headers['retry-after'] ?? headers['Retry-After'];
  }

  if (!retryAfterValue) return undefined;

  // Try parsing as seconds
  const seconds = parseInt(retryAfterValue, 10);
  if (!isNaN(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  // Try parsing as HTTP-date
  const date = new Date(retryAfterValue);
  if (!isNaN(date.getTime())) {
    const delayMs = date.getTime() - Date.now();
    return delayMs > 0 ? delayMs : undefined;
  }

  return undefined;
}

// ============================================================================
// Delay Computation
// ============================================================================

/**
 * Compute the retry delay for a given attempt.
 *
 * Priority: Retry-After header > strategy-computed value.
 */
export function computeDelay(attempt: number, strategy: RetryStrategy, retryAfterMs?: number): number {
  // If a Retry-After header was provided, prefer it (capped at maxDelay)
  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    return Math.min(retryAfterMs, strategy.maxDelayMs);
  }

  let baseDelay: number;

  switch (strategy.backoffMode) {
    case 'exponential':
      baseDelay = strategy.initialDelayMs * Math.pow(strategy.backoffMultiplier, attempt);
      break;
    case 'linear':
      baseDelay = strategy.initialDelayMs * (attempt + 1);
      break;
    case 'fixed':
      baseDelay = strategy.initialDelayMs;
      break;
    default:
      baseDelay = strategy.initialDelayMs;
  }

  // Add jitter
  const jitterFactor = 1 + (Math.random() * 2 - 1) * strategy.jitter;
  const finalDelay = baseDelay * jitterFactor;

  return Math.min(Math.max(finalDelay, 0), strategy.maxDelayMs);
}

// ============================================================================
// UnifiedRetryEngine
// ============================================================================

export class UnifiedRetryEngine {
  private circuitBreakers: CircuitBreakerRegistry | null = null;
  private readonly listeners: RetryEventListener[] = [];

  /**
   * Associate a circuit-breaker registry.
   * The engine checks breakers before retrying and records results after.
   */
  setCircuitBreakers(registry: CircuitBreakerRegistry): void {
    this.circuitBreakers = registry;
  }

  /**
   * Register a retry event listener.
   */
  onRetryEvent(listener: RetryEventListener): void {
    this.listeners.push(listener);
  }

  /**
   * Core retry execution.
   *
   * @param operationName - Name used for logging and circuit-breaker lookup
   * @param fn - Async function to execute
   * @param strategy - Retry strategy (defaults to `api`)
   */
  async execute<T>(
    operationName: string,
    fn: () => Promise<T>,
    strategy: RetryStrategy = RETRY_STRATEGIES.api,
  ): Promise<RetryResult<T>> {
    const context: RetryContext = {
      operationName,
      attempt: 0,
      totalWaitMs: 0,
      errors: [],
      startTime: Date.now(),
    };

    // Pre-check circuit breaker
    if (this.circuitBreakers) {
      const breaker = this.circuitBreakers.getBreaker(operationName);
      if (!breaker.canExecute()) {
        const classified: ClassifiedError = {
          type: 'CIRCUIT_OPEN',
          retryable: false,
          message: `Circuit breaker for "${operationName}" is open`,
          originalError: new CircuitOpenError(operationName, breaker.cooldownRemainingMs()),
        };
        context.errors.push(classified);

        this.emitEvent({
          type: 'circuit_open',
          operationName,
          attempt: 0,
          error: classified,
          totalElapsedMs: Date.now() - context.startTime,
        });

        return { success: false, error: classified, context };
      }
    }

    for (let attempt = 0; attempt <= strategy.maxRetries; attempt++) {
      context.attempt = attempt;

      try {
        const value = await fn();

        // Success -- update circuit breaker
        if (this.circuitBreakers) {
          this.circuitBreakers.getBreaker(operationName).recordSuccess();
        }

        this.emitEvent({
          type: 'success',
          operationName,
          attempt,
          totalElapsedMs: Date.now() - context.startTime,
        });

        return { success: true, value, context };
      } catch (error) {
        const classified = classifyError(error);
        context.errors.push(classified);

        // Update circuit breaker
        if (this.circuitBreakers) {
          this.circuitBreakers
            .getBreaker(operationName)
            .recordFailure(classified.message, classified.type === 'TIMEOUT_ERROR');
        }

        const isLastAttempt = attempt === strategy.maxRetries;

        const shouldRetry = strategy.shouldRetry ? strategy.shouldRetry(classified, attempt) : classified.retryable;

        if (isLastAttempt || !shouldRetry) {
          this.emitEvent({
            type: 'failure',
            operationName,
            attempt,
            error: classified,
            totalElapsedMs: Date.now() - context.startTime,
          });

          return { success: false, error: classified, context };
        }

        // Compute delay
        const delayMs = computeDelay(attempt, strategy, classified.retryAfterMs);
        context.totalWaitMs += delayMs;

        this.emitEvent({
          type: 'retry',
          operationName,
          attempt,
          error: classified,
          delayMs,
          totalElapsedMs: Date.now() - context.startTime,
        });

        // Wait before next attempt
        await sleep(delayMs);
      }
    }

    // Unreachable under normal conditions, but defensive return
    return {
      success: false,
      error: context.errors[context.errors.length - 1],
      context,
    };
  }

  /**
   * Execute and return the value directly; throws on failure.
   */
  async executeOrThrow<T>(
    operationName: string,
    fn: () => Promise<T>,
    strategy?: RetryStrategy,
  ): Promise<T> {
    const result = await this.execute(operationName, fn, strategy);
    if (!result.success) {
      throw result.error?.originalError ?? new Error(`Operation "${operationName}" failed`);
    }
    return result.value!;
  }

  /**
   * Convenience: retry an AI API call using the `agent` strategy.
   */
  async retryAICall<T>(fn: () => Promise<T>, label?: string): Promise<T> {
    return this.executeOrThrow(label ?? 'ai_call', fn, RETRY_STRATEGIES.agent);
  }

  /**
   * Convenience: retry a tool call using the `tool` strategy.
   */
  async retryToolCall<T>(toolName: string, fn: () => Promise<T>): Promise<T> {
    return this.executeOrThrow(`tool:${toolName}`, fn, RETRY_STRATEGIES.tool);
  }

  private emitEvent(event: RetryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Don't disrupt main flow
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
