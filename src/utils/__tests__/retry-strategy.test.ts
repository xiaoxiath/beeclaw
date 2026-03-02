import { describe, test, expect } from 'bun:test';
import {
  AGENT_RETRY_STRATEGY,
  SUBAGENT_RETRY_STRATEGY,
  TOOL_RETRY_STRATEGY,
  API_RETRY_STRATEGY,
  NO_RETRY_STRATEGY,
  createRetryStrategy,
  calculateDelay,
  getRetryStrategy,
  type RetryStrategy,
} from '../retry-strategy';
import type { ClassifiedError } from '../error-handler';

// Helper to create mock classified errors
function createMockError(
  type: ClassifiedError['type'],
  retryable: boolean,
  message = 'Test error'
): ClassifiedError {
  return {
    type,
    message,
    retryable,
    userMessage: 'Something went wrong',
    suggestedAction: 'Try again',
  };
}

describe('Retry Strategy', () => {
  describe('AGENT_RETRY_STRATEGY', () => {
    test('has correct default values', () => {
      expect(AGENT_RETRY_STRATEGY.maxRetries).toBe(3);
      expect(AGENT_RETRY_STRATEGY.initialDelay).toBe(2000);
      expect(AGENT_RETRY_STRATEGY.maxDelay).toBe(30000);
      expect(AGENT_RETRY_STRATEGY.backoffMultiplier).toBe(2);
      expect(AGENT_RETRY_STRATEGY.jitter).toBe(0.2);
    });

    test('shouldRetry returns false when attempt exceeds max', () => {
      const error = createMockError('NETWORK_ERROR', true);
      expect(AGENT_RETRY_STRATEGY.shouldRetry(error, 3)).toBe(false);
      expect(AGENT_RETRY_STRATEGY.shouldRetry(error, 4)).toBe(false);
    });

    test('shouldRetry returns false for non-retryable errors', () => {
      const error = createMockError('VALIDATION_ERROR', false);
      expect(AGENT_RETRY_STRATEGY.shouldRetry(error, 0)).toBe(false);
      expect(AGENT_RETRY_STRATEGY.shouldRetry(error, 1)).toBe(false);
    });

    test('shouldRetry returns true for retryable errors under max attempts', () => {
      const error = createMockError('NETWORK_ERROR', true);
      expect(AGENT_RETRY_STRATEGY.shouldRetry(error, 0)).toBe(true);
      expect(AGENT_RETRY_STRATEGY.shouldRetry(error, 1)).toBe(true);
      expect(AGENT_RETRY_STRATEGY.shouldRetry(error, 2)).toBe(true);
    });

    test('has onRetry callback', () => {
      expect(AGENT_RETRY_STRATEGY.onRetry).toBeDefined();
      expect(typeof AGENT_RETRY_STRATEGY.onRetry).toBe('function');
    });

    test('has onFailure callback', () => {
      expect(AGENT_RETRY_STRATEGY.onFailure).toBeDefined();
      expect(typeof AGENT_RETRY_STRATEGY.onFailure).toBe('function');
    });

    test('has onSuccess callback', () => {
      expect(AGENT_RETRY_STRATEGY.onSuccess).toBeDefined();
      expect(typeof AGENT_RETRY_STRATEGY.onSuccess).toBe('function');
    });
  });

  describe('SUBAGENT_RETRY_STRATEGY', () => {
    test('has correct default values', () => {
      expect(SUBAGENT_RETRY_STRATEGY.maxRetries).toBe(2);
      expect(SUBAGENT_RETRY_STRATEGY.initialDelay).toBe(1000);
      expect(SUBAGENT_RETRY_STRATEGY.maxDelay).toBe(10000);
      expect(SUBAGENT_RETRY_STRATEGY.backoffMultiplier).toBe(2);
      expect(SUBAGENT_RETRY_STRATEGY.jitter).toBe(0.15);
    });

    test('shouldRetry returns false when attempt exceeds max', () => {
      const error = createMockError('NETWORK_ERROR', true);
      expect(SUBAGENT_RETRY_STRATEGY.shouldRetry(error, 2)).toBe(false);
    });

    test('shouldRetry returns true for retryable errors under max', () => {
      const error = createMockError('NETWORK_ERROR', true);
      expect(SUBAGENT_RETRY_STRATEGY.shouldRetry(error, 0)).toBe(true);
      expect(SUBAGENT_RETRY_STRATEGY.shouldRetry(error, 1)).toBe(true);
    });

    test('has onRetry callback', () => {
      expect(SUBAGENT_RETRY_STRATEGY.onRetry).toBeDefined();
    });

    test('has onFailure callback', () => {
      expect(SUBAGENT_RETRY_STRATEGY.onFailure).toBeDefined();
    });
  });

  describe('TOOL_RETRY_STRATEGY', () => {
    test('has correct default values', () => {
      expect(TOOL_RETRY_STRATEGY.maxRetries).toBe(2);
      expect(TOOL_RETRY_STRATEGY.initialDelay).toBe(500);
      expect(TOOL_RETRY_STRATEGY.maxDelay).toBe(5000);
      expect(TOOL_RETRY_STRATEGY.backoffMultiplier).toBe(2);
      expect(TOOL_RETRY_STRATEGY.jitter).toBe(0.1);
    });

    test('shouldRetry only for NETWORK_ERROR and TIMEOUT_ERROR', () => {
      const networkError = createMockError('NETWORK_ERROR', true);
      const timeoutError = createMockError('TIMEOUT_ERROR', true);
      const rateLimitError = createMockError('RATE_LIMIT_ERROR', true);

      expect(TOOL_RETRY_STRATEGY.shouldRetry(networkError, 0)).toBe(true);
      expect(TOOL_RETRY_STRATEGY.shouldRetry(timeoutError, 0)).toBe(true);
      expect(TOOL_RETRY_STRATEGY.shouldRetry(rateLimitError, 0)).toBe(false);
    });

    test('shouldRetry returns false for non-retryable errors', () => {
      const error = createMockError('NETWORK_ERROR', false);
      expect(TOOL_RETRY_STRATEGY.shouldRetry(error, 0)).toBe(false);
    });

    test('has onRetry callback', () => {
      expect(TOOL_RETRY_STRATEGY.onRetry).toBeDefined();
    });
  });

  describe('API_RETRY_STRATEGY', () => {
    test('has correct default values', () => {
      expect(API_RETRY_STRATEGY.maxRetries).toBe(3);
      expect(API_RETRY_STRATEGY.initialDelay).toBe(1000);
      expect(API_RETRY_STRATEGY.maxDelay).toBe(20000);
      expect(API_RETRY_STRATEGY.backoffMultiplier).toBe(2);
      expect(API_RETRY_STRATEGY.jitter).toBe(0.2);
    });

    test('shouldRetry returns true for retryable errors', () => {
      const error = createMockError('NETWORK_ERROR', true);
      expect(API_RETRY_STRATEGY.shouldRetry(error, 0)).toBe(true);
    });

    test('shouldRetry returns false when attempt exceeds max', () => {
      const error = createMockError('NETWORK_ERROR', true);
      expect(API_RETRY_STRATEGY.shouldRetry(error, 3)).toBe(false);
    });

    test('has onRetry callback', () => {
      expect(API_RETRY_STRATEGY.onRetry).toBeDefined();
    });
  });

  describe('NO_RETRY_STRATEGY', () => {
    test('has zero retries', () => {
      expect(NO_RETRY_STRATEGY.maxRetries).toBe(0);
      expect(NO_RETRY_STRATEGY.initialDelay).toBe(0);
      expect(NO_RETRY_STRATEGY.maxDelay).toBe(0);
    });

    test('shouldRetry always returns false', () => {
      const error = createMockError('NETWORK_ERROR', true);
      expect(NO_RETRY_STRATEGY.shouldRetry(error, 0)).toBe(false);
      expect(NO_RETRY_STRATEGY.shouldRetry(error, 1)).toBe(false);
    });
  });

  describe('createRetryStrategy', () => {
    test('creates strategy with custom maxRetries', () => {
      const strategy = createRetryStrategy({ maxRetries: 5 });
      expect(strategy.maxRetries).toBe(5);
      expect(strategy.initialDelay).toBe(AGENT_RETRY_STRATEGY.initialDelay);
    });

    test('creates strategy with custom delays', () => {
      const strategy = createRetryStrategy({
        initialDelay: 5000,
        maxDelay: 60000,
      });
      expect(strategy.initialDelay).toBe(5000);
      expect(strategy.maxDelay).toBe(60000);
    });

    test('creates strategy with custom shouldRetry', () => {
      const customShouldRetry = () => false;
      const strategy = createRetryStrategy({ shouldRetry: customShouldRetry });
      expect(strategy.shouldRetry).toBe(customShouldRetry);
    });

    test('creates strategy with callbacks', () => {
      const onRetry = () => {};
      const onFailure = () => {};
      const onSuccess = () => {};

      const strategy = createRetryStrategy({ onRetry, onFailure, onSuccess });
      expect(strategy.onRetry).toBe(onRetry);
      expect(strategy.onFailure).toBe(onFailure);
      expect(strategy.onSuccess).toBe(onSuccess);
    });

    test('merges with base strategy', () => {
      const strategy = createRetryStrategy({ maxRetries: 10 });
      expect(strategy.backoffMultiplier).toBe(AGENT_RETRY_STRATEGY.backoffMultiplier);
      expect(strategy.jitter).toBe(AGENT_RETRY_STRATEGY.jitter);
    });
  });

  describe('calculateDelay', () => {
    test('calculates exponential backoff for first attempt', () => {
      const delay = calculateDelay(0, 1000, 10000, 2, 0);
      // With no jitter: 1000 * 2^0 = 1000
      expect(delay).toBeGreaterThanOrEqual(900);
      expect(delay).toBeLessThanOrEqual(1100);
    });

    test('calculates exponential backoff for second attempt', () => {
      const delay = calculateDelay(1, 1000, 10000, 2, 0);
      // With no jitter: 1000 * 2^1 = 2000
      expect(delay).toBeGreaterThanOrEqual(1800);
      expect(delay).toBeLessThanOrEqual(2200);
    });

    test('calculates exponential backoff for third attempt', () => {
      const delay = calculateDelay(2, 1000, 10000, 2, 0);
      // With no jitter: 1000 * 2^2 = 4000
      expect(delay).toBeGreaterThanOrEqual(3600);
      expect(delay).toBeLessThanOrEqual(4400);
    });

    test('caps delay at maxDelay', () => {
      const delay = calculateDelay(10, 1000, 5000, 2, 0);
      expect(delay).toBeLessThanOrEqual(5500);
    });

    test('applies jitter', () => {
      // With jitter, delays should vary
      const delays = new Set<number>();
      for (let i = 0; i < 100; i++) {
        const delay = calculateDelay(1, 1000, 10000, 2, 0.5);
        delays.add(Math.round(delay / 100) * 100);
      }
      // With 50% jitter, we should see some variation
      expect(delays.size).toBeGreaterThan(1);
    });

    test('respects jitter factor of 0', () => {
      const delays = new Set<number>();
      for (let i = 0; i < 50; i++) {
        const delay = calculateDelay(1, 1000, 10000, 2, 0);
        delays.add(delay);
      }
      // With 0 jitter, all delays should be the same
      expect(delays.size).toBe(1);
    });
  });

  describe('getRetryStrategy', () => {
    test('returns agent strategy', () => {
      expect(getRetryStrategy('agent')).toBe(AGENT_RETRY_STRATEGY);
    });

    test('returns subagent strategy', () => {
      expect(getRetryStrategy('subagent')).toBe(SUBAGENT_RETRY_STRATEGY);
    });

    test('returns tool strategy', () => {
      expect(getRetryStrategy('tool')).toBe(TOOL_RETRY_STRATEGY);
    });

    test('returns api strategy', () => {
      expect(getRetryStrategy('api')).toBe(API_RETRY_STRATEGY);
    });

    test('returns no retry strategy', () => {
      expect(getRetryStrategy('none')).toBe(NO_RETRY_STRATEGY);
    });
  });
});
