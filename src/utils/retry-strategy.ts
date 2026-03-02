/**
 * Retry Strategy - Configurable retry strategies for different components
 *
 * Defines retry behavior for Agent, Subagent, and tool executions.
 */

import type { ClassifiedError } from './error-handler';

/**
 * Retry strategy configuration
 */
export interface RetryStrategy {
  /** Maximum number of retry attempts */
  maxRetries: number;

  /** Initial delay in milliseconds */
  initialDelay: number;

  /** Maximum delay in milliseconds */
  maxDelay: number;

  /** Backoff multiplier (exponential backoff) */
  backoffMultiplier: number;

  /** Jitter factor (0-1) to add randomness and prevent thundering herd */
  jitter: number;

  /** Custom retry condition */
  shouldRetry: (error: ClassifiedError, attempt: number) => boolean;

  /** Callback on retry */
  onRetry?: (error: ClassifiedError, attempt: number, delay: number) => void;

  /** Callback on final failure */
  onFailure?: (error: ClassifiedError) => void;

  /** Callback on success (after retries) */
  onSuccess?: (attempts: number) => void;
}

/**
 * Default retry strategy for Agent operations
 *
 * - Max 3 retries
 * - Initial delay: 2 seconds
 * - Max delay: 30 seconds
 * - Exponential backoff with jitter
 */
export const AGENT_RETRY_STRATEGY: RetryStrategy = {
  maxRetries: 3,
  initialDelay: 2000,      // 2 seconds
  maxDelay: 30000,         // 30 seconds
  backoffMultiplier: 2,
  jitter: 0.2,

  shouldRetry: (error, attempt) => {
    // Don't retry more than max
    if (attempt >= 3) {
      return false;
    }

    // Only retry retryable errors
    return error.retryable;
  },

  onRetry: (error, attempt, delay) => {
    const delaySec = (delay / 1000).toFixed(1);
    console.warn(
      `[Agent Retry] Attempt ${attempt}/3 failed: ${error.message}\n` +
      `  Type: ${error.type} (${error.retryable ? 'retryable' : 'non-retryable'})\n` +
      `  Retrying in ${delaySec}s...`
    );
  },

  onFailure: (error) => {
    console.error(
      `[Agent] Final failure after all retries: ${error.message}\n` +
      `  Type: ${error.type}\n` +
      `  User message: ${error.userMessage}`
    );
  },

  onSuccess: (attempts) => {
    if (attempts > 1) {
      console.log(`[Agent] Success after ${attempts} attempts`);
    }
  },
};

/**
 * Retry strategy for Subagent operations
 *
 * - Max 2 retries (fewer than main agent)
 * - Faster initial delay: 1 second
 * - Max delay: 10 seconds
 */
export const SUBAGENT_RETRY_STRATEGY: RetryStrategy = {
  maxRetries: 2,
  initialDelay: 1000,      // 1 second
  maxDelay: 10000,         // 10 seconds
  backoffMultiplier: 2,
  jitter: 0.15,

  shouldRetry: (error, attempt) => {
    if (attempt >= 2) {
      return false;
    }

    return error.retryable;
  },

  onRetry: (error, attempt, delay) => {
    console.warn(
      `[Subagent Retry] Attempt ${attempt}/2 failed: ${error.message}. ` +
      `Retrying in ${delay}ms...`
    );
  },

  onFailure: (error) => {
    console.error(
      `[Subagent] Final failure: ${error.message}`
    );
  },
};

/**
 * Retry strategy for tool execution
 *
 * - Max 2 retries
 * - Quick retries: 500ms initial delay
 * - Max delay: 5 seconds
 */
export const TOOL_RETRY_STRATEGY: RetryStrategy = {
  maxRetries: 2,
  initialDelay: 500,       // 500ms
  maxDelay: 5000,          // 5 seconds
  backoffMultiplier: 2,
  jitter: 0.1,

  shouldRetry: (error, attempt) => {
    if (attempt >= 2) {
      return false;
    }

    // Only retry network and timeout errors for tools
    return (
      error.retryable &&
      (error.type === 'NETWORK_ERROR' || error.type === 'TIMEOUT_ERROR')
    );
  },

  onRetry: (error, attempt, delay) => {
    console.warn(
      `[Tool Retry] Attempt ${attempt}/2 failed: ${error.message}. ` +
      `Retrying in ${delay}ms...`
    );
  },
};

/**
 * Retry strategy for API calls (web_fetch, etc.)
 *
 * - Max 3 retries
 * - Initial delay: 1 second
 * - Max delay: 20 seconds
 */
export const API_RETRY_STRATEGY: RetryStrategy = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 20000,
  backoffMultiplier: 2,
  jitter: 0.2,

  shouldRetry: (error, attempt) => {
    if (attempt >= 3) {
      return false;
    }

    return error.retryable;
  },

  onRetry: (error, attempt, delay) => {
    console.warn(
      `[API Retry] Attempt ${attempt}/3: ${error.type} - ${error.message}. ` +
      `Retry in ${delay}ms`
    );
  },
};

/**
 * No-retry strategy (for non-retryable operations)
 */
export const NO_RETRY_STRATEGY: RetryStrategy = {
  maxRetries: 0,
  initialDelay: 0,
  maxDelay: 0,
  backoffMultiplier: 1,
  jitter: 0,

  shouldRetry: () => false,
};

/**
 * Custom retry strategy builder
 *
 * @example
 * ```typescript
 * const customStrategy = createRetryStrategy({
 *   maxRetries: 5,
 *   initialDelay: 3000,
 * });
 * ```
 */
export function createRetryStrategy(
  overrides: Partial<RetryStrategy>
): RetryStrategy {
  return {
    ...AGENT_RETRY_STRATEGY,
    ...overrides,
  };
}

/**
 * Calculate delay with exponential backoff and jitter
 */
export function calculateDelay(
  attempt: number,
  initialDelay: number,
  maxDelay: number,
  backoffMultiplier: number,
  jitter: number
): number {
  // Exponential backoff: delay = initialDelay * (backoffMultiplier ^ attempt)
  const exponentialDelay = initialDelay * Math.pow(backoffMultiplier, attempt);

  // Add jitter: random value between -jitter% and +jitter%
  const jitterFactor = 1 + (Math.random() * 2 - 1) * jitter;

  // Apply jitter and cap at maxDelay
  return Math.min(exponentialDelay * jitterFactor, maxDelay);
}

/**
 * Get retry strategy by name
 */
export function getRetryStrategy(
  name: 'agent' | 'subagent' | 'tool' | 'api' | 'none'
): RetryStrategy {
  switch (name) {
    case 'agent':
      return AGENT_RETRY_STRATEGY;
    case 'subagent':
      return SUBAGENT_RETRY_STRATEGY;
    case 'tool':
      return TOOL_RETRY_STRATEGY;
    case 'api':
      return API_RETRY_STRATEGY;
    case 'none':
      return NO_RETRY_STRATEGY;
    default:
      return AGENT_RETRY_STRATEGY;
  }
}
