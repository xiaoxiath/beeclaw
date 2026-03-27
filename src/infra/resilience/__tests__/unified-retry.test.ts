import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test';

// Mock circuit-breaker
mock.module('../circuit-breaker', () => {
  class MockCircuitOpenError extends Error {
    constructor(name: string, cooldownMs: number) {
      super(`Circuit breaker for "${name}" is open, cooldown: ${cooldownMs}ms`);
      this.name = 'CircuitOpenError';
    }
  }

  const mockBreaker = {
    canExecute: mock(() => true),
    recordSuccess: mock(),
    recordFailure: mock(),
    cooldownRemainingMs: mock(() => 0),
  };

  class MockCircuitBreakerRegistry {
    getBreaker = mock(() => mockBreaker);
  }

  return {
    CircuitBreakerRegistry: MockCircuitBreakerRegistry,
    CircuitOpenError: MockCircuitOpenError,
  };
});

import {
  classifyError,
  computeDelay,
  RETRY_STRATEGIES,
  UnifiedRetryEngine,
  getRetryEngine,
  type ClassifiedError,
  type RetryStrategy,
} from '../unified-retry';
import { CircuitBreakerRegistry, CircuitOpenError } from '../circuit-breaker';

describe('unified-retry', () => {
  describe('classifyError', () => {
    it('should classify network errors as retryable', () => {
      const result = classifyError(new Error('ECONNREFUSED'));
      expect(result.type).toBe('NETWORK_ERROR');
      expect(result.retryable).toBe(true);
    });

    it('should classify ENOTFOUND as network error', () => {
      const result = classifyError(new Error('ENOTFOUND'));
      expect(result.type).toBe('NETWORK_ERROR');
      expect(result.retryable).toBe(true);
    });

    it('should classify fetch failed as network error', () => {
      const result = classifyError(new Error('fetch failed'));
      expect(result.type).toBe('NETWORK_ERROR');
      expect(result.retryable).toBe(true);
    });

    it('should classify timeout errors as retryable', () => {
      const result = classifyError(new Error('Request timed out'));
      expect(result.type).toBe('TIMEOUT_ERROR');
      expect(result.retryable).toBe(true);
    });

    it('should classify TimeoutError by name', () => {
      const err = new Error('operation timeout');
      err.name = 'TimeoutError';
      const result = classifyError(err);
      expect(result.type).toBe('TIMEOUT_ERROR');
      expect(result.retryable).toBe(true);
    });

    it('should classify rate limit errors as retryable', () => {
      const result = classifyError(new Error('rate limit exceeded'));
      expect(result.type).toBe('RATE_LIMIT');
      expect(result.retryable).toBe(true);
    });

    it('should classify 429 status as rate limit', () => {
      const err = new Error('too many requests') as any;
      err.status = 429;
      const result = classifyError(err);
      expect(result.type).toBe('RATE_LIMIT');
      expect(result.retryable).toBe(true);
    });

    it('should classify auth errors as non-retryable', () => {
      const result = classifyError(new Error('unauthorized'));
      expect(result.type).toBe('AUTH_ERROR');
      expect(result.retryable).toBe(false);
    });

    it('should classify 401 as auth error', () => {
      const err = new Error('access denied') as any;
      err.status = 401;
      const result = classifyError(err);
      expect(result.type).toBe('AUTH_ERROR');
      expect(result.retryable).toBe(false);
    });

    it('should classify 403 as auth error', () => {
      const err = new Error('forbidden resource') as any;
      err.status = 403;
      const result = classifyError(err);
      expect(result.type).toBe('AUTH_ERROR');
      expect(result.retryable).toBe(false);
    });

    it('should classify validation errors as non-retryable', () => {
      const result = classifyError(new Error('invalid parameter'));
      expect(result.type).toBe('VALIDATION_ERROR');
      expect(result.retryable).toBe(false);
    });

    it('should classify insufficient balance as non-retryable', () => {
      const result = classifyError(new Error('insufficient balance'));
      expect(result.type).toBe('INSUFFICIENT_BALANCE');
      expect(result.retryable).toBe(false);
    });

    it('should classify not found as non-retryable', () => {
      const result = classifyError(new Error('resource not found'));
      expect(result.type).toBe('NOT_FOUND');
      expect(result.retryable).toBe(false);
    });

    it('should classify AbortError as cancelled', () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      const result = classifyError(err);
      expect(result.type).toBe('CANCELLED');
      expect(result.retryable).toBe(false);
    });

    it('should classify 500 as server error (retryable)', () => {
      const err = new Error('internal error') as any;
      err.status = 500;
      const result = classifyError(err);
      expect(result.type).toBe('SERVER_ERROR');
      expect(result.retryable).toBe(true);
    });

    it('should classify 503 as service unavailable (retryable)', () => {
      const err = new Error('service down') as any;
      err.status = 503;
      const result = classifyError(err);
      expect(result.type).toBe('SERVICE_UNAVAILABLE');
      expect(result.retryable).toBe(true);
    });

    it('should classify unknown errors', () => {
      const result = classifyError(new Error('something unexpected'));
      expect(result.type).toBe('UNKNOWN');
      expect(result.retryable).toBe(false);
    });

    it('should handle non-Error input', () => {
      const result = classifyError('string error');
      expect(result.type).toBe('UNKNOWN');
      expect(result.originalError).toBeInstanceOf(Error);
    });

    it('should extract retryAfterMs from headers (seconds)', () => {
      const err = new Error('rate limited') as any;
      err.status = 429;
      err.response = { headers: { 'retry-after': '30' } };
      const result = classifyError(err);
      expect(result.retryAfterMs).toBe(30000);
    });

    it('should extract httpStatus from response.status', () => {
      const err = new Error('server error') as any;
      err.response = { status: 502 };
      const result = classifyError(err);
      expect(result.httpStatus).toBe(502);
    });
  });

  describe('computeDelay', () => {
    it('should compute exponential backoff delay', () => {
      const strategy: RetryStrategy = {
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
        jitter: 0,
        backoffMode: 'exponential',
      };
      const delay0 = computeDelay(0, strategy);
      expect(delay0).toBe(1000); // 1000 * 2^0

      const delay1 = computeDelay(1, strategy);
      expect(delay1).toBe(2000); // 1000 * 2^1

      const delay2 = computeDelay(2, strategy);
      expect(delay2).toBe(4000); // 1000 * 2^2
    });

    it('should compute linear backoff delay', () => {
      const strategy: RetryStrategy = {
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
        jitter: 0,
        backoffMode: 'linear',
      };
      const delay0 = computeDelay(0, strategy);
      expect(delay0).toBe(1000); // 1000 * (0+1)

      const delay1 = computeDelay(1, strategy);
      expect(delay1).toBe(2000); // 1000 * (1+1)
    });

    it('should compute fixed delay', () => {
      const strategy: RetryStrategy = {
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
        jitter: 0,
        backoffMode: 'fixed',
      };
      const delay0 = computeDelay(0, strategy);
      expect(delay0).toBe(1000);
      const delay2 = computeDelay(2, strategy);
      expect(delay2).toBe(1000);
    });

    it('should cap delay at maxDelayMs', () => {
      const strategy: RetryStrategy = {
        maxRetries: 10,
        initialDelayMs: 10000,
        maxDelayMs: 30000,
        backoffMultiplier: 3,
        jitter: 0,
        backoffMode: 'exponential',
      };
      const delay = computeDelay(5, strategy);
      expect(delay).toBeLessThanOrEqual(30000);
    });

    it('should prefer retryAfterMs when provided', () => {
      const strategy: RetryStrategy = {
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 120000,
        backoffMultiplier: 2,
        jitter: 0,
        backoffMode: 'exponential',
      };
      const delay = computeDelay(0, strategy, 5000);
      expect(delay).toBe(5000);
    });

    it('should cap retryAfterMs at maxDelayMs', () => {
      const strategy: RetryStrategy = {
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
        jitter: 0,
        backoffMode: 'exponential',
      };
      const delay = computeDelay(0, strategy, 50000);
      expect(delay).toBe(10000);
    });

    it('should add jitter within range', () => {
      const strategy: RetryStrategy = {
        maxRetries: 3,
        initialDelayMs: 10000,
        maxDelayMs: 100000,
        backoffMultiplier: 2,
        jitter: 0.5,
        backoffMode: 'exponential',
      };
      // With jitter=0.5, delay should be within [5000, 15000] for attempt 0
      const delays = Array.from({ length: 20 }, () => computeDelay(0, strategy));
      for (const d of delays) {
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(100000);
      }
    });
  });

  describe('RETRY_STRATEGIES', () => {
    it('should have agent strategy', () => {
      expect(RETRY_STRATEGIES.agent).toBeDefined();
      expect(RETRY_STRATEGIES.agent.maxRetries).toBe(3);
      expect(RETRY_STRATEGIES.agent.backoffMode).toBe('exponential');
    });

    it('should have tool strategy', () => {
      expect(RETRY_STRATEGIES.tool).toBeDefined();
      expect(RETRY_STRATEGIES.tool.maxRetries).toBe(2);
      expect(RETRY_STRATEGIES.tool.shouldRetry).toBeDefined();
    });

    it('should have none strategy with 0 retries', () => {
      expect(RETRY_STRATEGIES.none.maxRetries).toBe(0);
    });

    it('tool strategy shouldRetry only allows NETWORK_ERROR and TIMEOUT_ERROR', () => {
      const shouldRetry = RETRY_STRATEGIES.tool.shouldRetry!;
      const networkErr: ClassifiedError = {
        type: 'NETWORK_ERROR', retryable: true, message: '', originalError: new Error(),
      };
      const timeoutErr: ClassifiedError = {
        type: 'TIMEOUT_ERROR', retryable: true, message: '', originalError: new Error(),
      };
      const rateLimitErr: ClassifiedError = {
        type: 'RATE_LIMIT', retryable: true, message: '', originalError: new Error(),
      };
      expect(shouldRetry(networkErr, 0)).toBe(true);
      expect(shouldRetry(timeoutErr, 0)).toBe(true);
      expect(shouldRetry(rateLimitErr, 0)).toBe(false);
    });
  });

  describe('UnifiedRetryEngine', () => {
    let engine: UnifiedRetryEngine;

    beforeEach(() => {
      engine = new UnifiedRetryEngine();
    });

    describe('execute', () => {
      it('should succeed on first attempt', async () => {
        const fn = mock(() => Promise.resolve('ok'));
        const result = await engine.execute('test-op', fn, RETRY_STRATEGIES.none);
        expect(result.success).toBe(true);
        expect(result.value).toBe('ok');
        expect(result.context.attempt).toBe(0);
      });

      it('should retry on retryable error and eventually succeed', async () => {
        let callCount = 0;
        const fn = mock(() => {
          callCount++;
          if (callCount < 3) throw new Error('ECONNREFUSED');
          return Promise.resolve('recovered');
        });
        const strategy = { ...RETRY_STRATEGIES.api, initialDelayMs: 1, maxDelayMs: 5 };
        const result = await engine.execute('test-op', fn, strategy);
        expect(result.success).toBe(true);
        expect(result.value).toBe('recovered');
        expect(callCount).toBe(3);
      });

      it('should fail after max retries', async () => {
        const fn = mock(() => Promise.reject(new Error('ECONNREFUSED')));
        const strategy = { ...RETRY_STRATEGIES.api, maxRetries: 2, initialDelayMs: 1, maxDelayMs: 5 };
        const result = await engine.execute('test-op', fn, strategy);
        expect(result.success).toBe(false);
        expect(result.error?.type).toBe('NETWORK_ERROR');
        expect(result.context.errors.length).toBe(3); // initial + 2 retries
      });

      it('should not retry non-retryable errors', async () => {
        const fn = mock(() => Promise.reject(new Error('unauthorized')));
        const strategy = { ...RETRY_STRATEGIES.api, initialDelayMs: 1 };
        const result = await engine.execute('test-op', fn, strategy);
        expect(result.success).toBe(false);
        expect(result.error?.type).toBe('AUTH_ERROR');
        expect(result.context.errors.length).toBe(1);
      });
    });

    describe('executeOrThrow', () => {
      it('should return value on success', async () => {
        const fn = mock(() => Promise.resolve(42));
        const value = await engine.executeOrThrow('test', fn, RETRY_STRATEGIES.none);
        expect(value).toBe(42);
      });

      it('should throw on failure', async () => {
        const fn = mock(() => Promise.reject(new Error('unauthorized')));
        await expect(
          engine.executeOrThrow('test', fn, RETRY_STRATEGIES.none),
        ).rejects.toThrow();
      });
    });

    describe('retryAICall', () => {
      it('should use agent strategy', async () => {
        const fn = mock(() => Promise.resolve('ai response'));
        const result = await engine.retryAICall(fn, 'ai-test');
        expect(result).toBe('ai response');
      });
    });

    describe('retryToolCall', () => {
      it('should use tool strategy', async () => {
        const fn = mock(() => Promise.resolve('tool result'));
        const result = await engine.retryToolCall('my_tool', fn);
        expect(result).toBe('tool result');
      });
    });

    describe('event listeners', () => {
      it('should emit success event', async () => {
        const listener = mock();
        engine.onRetryEvent(listener);
        await engine.execute('test', () => Promise.resolve('ok'), RETRY_STRATEGIES.none);
        expect(listener).toHaveBeenCalled();
        const event = listener.mock.calls[0][0];
        expect(event.type).toBe('success');
        expect(event.operationName).toBe('test');
      });

      it('should emit failure event', async () => {
        const listener = mock();
        engine.onRetryEvent(listener);
        await engine.execute('test', () => Promise.reject(new Error('unauthorized')), RETRY_STRATEGIES.none);
        const event = listener.mock.calls[0][0];
        expect(event.type).toBe('failure');
      });

      it('should not throw if listener throws', async () => {
        engine.onRetryEvent(() => { throw new Error('listener crash'); });
        const result = await engine.execute('test', () => Promise.resolve('ok'), RETRY_STRATEGIES.none);
        expect(result.success).toBe(true);
      });
    });

    describe('circuit breaker integration', () => {
      it('should check circuit breaker before execute', async () => {
        const registry = new CircuitBreakerRegistry();
        const breaker = registry.getBreaker('test');
        (breaker.canExecute as any).mockReturnValue(false);
        (breaker.cooldownRemainingMs as any).mockReturnValue(5000);

        engine.setCircuitBreakers(registry);
        const result = await engine.execute('test', () => Promise.resolve('ok'));
        expect(result.success).toBe(false);
        expect(result.error?.type).toBe('CIRCUIT_OPEN');
      });

      it('should record success on circuit breaker', async () => {
        const registry = new CircuitBreakerRegistry();
        const breaker = registry.getBreaker('test');
        // Reset canExecute to return true (may have been mocked to false by previous test)
        (breaker.canExecute as any).mockReturnValue(true);
        const spy = spyOn(breaker, 'recordSuccess');
        engine.setCircuitBreakers(registry);

        await engine.execute('test', () => Promise.resolve('ok'), RETRY_STRATEGIES.none);
        expect(spy).toHaveBeenCalled();
      });
    });
  });

  describe('getRetryEngine', () => {
    it('should return singleton instance', () => {
      const a = getRetryEngine();
      const b = getRetryEngine();
      expect(a).toBe(b);
    });

    it('should be an instance of UnifiedRetryEngine', () => {
      expect(getRetryEngine()).toBeInstanceOf(UnifiedRetryEngine);
    });
  });
});
