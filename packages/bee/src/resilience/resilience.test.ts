import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Circuit Breaker Tests
// ============================================================================

import {
  CircuitBreaker,
  CircuitBreakerRegistry,
  CircuitOpenError,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
} from './circuit-breaker';

describe('CircuitBreaker', () => {
  it('starts in closed state and canExecute returns true', () => {
    const cb = new CircuitBreaker('test');
    expect(cb.getState()).toBe('closed');
    expect(cb.canExecute()).toBe(true);
  });

  it('transitions to open after reaching failure threshold', () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 3 });
    expect(cb.canExecute()).toBe(true);

    cb.recordFailure('err1');
    cb.recordFailure('err2');
    expect(cb.getState()).toBe('closed');

    cb.recordFailure('err3');
    expect(cb.getState()).toBe('open');
    expect(cb.canExecute()).toBe(false);
  });

  it('transitions to half_open after cooldown elapses', () => {
    vi.useFakeTimers();
    try {
      const cb = new CircuitBreaker('test', {
        failureThreshold: 2,
        cooldownMs: 5_000,
      });

      // Trip the breaker open
      cb.recordFailure('err1');
      cb.recordFailure('err2');
      expect(cb.getState()).toBe('open');

      // Advance past cooldown
      vi.advanceTimersByTime(5_001);

      // canExecute should detect cooldown elapsed, transition to half_open
      expect(cb.canExecute()).toBe(true);
      expect(cb.getState()).toBe('half_open');
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows limited probe calls in half_open state', () => {
    vi.useFakeTimers();
    try {
      const cb = new CircuitBreaker('test', {
        failureThreshold: 2,
        cooldownMs: 5_000,
        halfOpenMaxProbes: 1,
      });

      cb.recordFailure('err1');
      cb.recordFailure('err2');
      expect(cb.getState()).toBe('open');

      vi.advanceTimersByTime(5_001);
      // First canExecute transitions from open->half_open (halfOpenProbes reset to 0)
      expect(cb.canExecute()).toBe(true);
      expect(cb.getState()).toBe('half_open');

      // Second canExecute: halfOpenProbes=0 < halfOpenMaxProbes=1, increments to 1
      expect(cb.canExecute()).toBe(true);

      // Max probes reached -- third call rejected
      expect(cb.canExecute()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('recordSuccess in half_open transitions back to closed', () => {
    vi.useFakeTimers();
    try {
      const cb = new CircuitBreaker('test', {
        failureThreshold: 2,
        cooldownMs: 5_000,
        successThreshold: 1,
      });

      cb.recordFailure('err1');
      cb.recordFailure('err2');
      expect(cb.getState()).toBe('open');

      vi.advanceTimersByTime(5_001);
      cb.canExecute(); // triggers transition to half_open
      expect(cb.getState()).toBe('half_open');

      cb.recordSuccess();
      expect(cb.getState()).toBe('closed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('recordFailure in half_open transitions back to open', () => {
    vi.useFakeTimers();
    try {
      const cb = new CircuitBreaker('test', {
        failureThreshold: 2,
        cooldownMs: 5_000,
      });

      cb.recordFailure('err1');
      cb.recordFailure('err2');
      expect(cb.getState()).toBe('open');

      vi.advanceTimersByTime(5_001);
      cb.canExecute();
      expect(cb.getState()).toBe('half_open');

      cb.recordFailure('probe failed');
      expect(cb.getState()).toBe('open');
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips timeout failures when countTimeoutAsFailure is false', () => {
    const cb = new CircuitBreaker('test', {
      failureThreshold: 2,
      countTimeoutAsFailure: false,
    });

    cb.recordFailure('timeout', true);
    cb.recordFailure('timeout', true);
    // Timeouts should not count, so breaker stays closed
    expect(cb.getState()).toBe('closed');
  });

  it('reset() returns breaker to closed state and clears counters', () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 2 });
    cb.recordFailure('err1');
    cb.recordFailure('err2');
    expect(cb.getState()).toBe('open');

    cb.reset();
    expect(cb.getState()).toBe('closed');
    expect(cb.canExecute()).toBe(true);

    const stats = cb.getStats();
    expect(stats.consecutiveFailures).toBe(0);
  });

  it('getStats returns correct snapshot', () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 5 });
    cb.recordSuccess();
    cb.recordFailure('err');

    const stats = cb.getStats();
    expect(stats.state).toBe('closed');
    expect(stats.totalCalls).toBe(2);
    expect(stats.totalSuccesses).toBe(1);
    expect(stats.totalFailures).toBe(1);
    expect(stats.consecutiveFailures).toBe(1);
    expect(stats.lastFailureTime).not.toBeNull();
    expect(stats.lastSuccessTime).not.toBeNull();
  });

  it('emits state_change events to listeners', () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 2 });
    const events: Array<{ type: string; currentState: string }> = [];
    cb.onEvent((e) => events.push({ type: e.type, currentState: e.currentState }));

    cb.recordFailure('err1');
    cb.recordFailure('err2');

    expect(events.length).toBeGreaterThanOrEqual(1);
    const stateChange = events.find((e) => e.type === 'state_change');
    expect(stateChange).toBeDefined();
    expect(stateChange!.currentState).toBe('open');
  });
});

describe('CircuitBreakerRegistry', () => {
  it('getBreaker creates a breaker on demand', () => {
    const registry = new CircuitBreakerRegistry();
    const breaker = registry.getBreaker('my_tool');
    expect(breaker).toBeInstanceOf(CircuitBreaker);
    expect(breaker.name).toBe('my_tool');
  });

  it('getBreaker returns the same instance for the same tool', () => {
    const registry = new CircuitBreakerRegistry();
    const a = registry.getBreaker('tool_a');
    const b = registry.getBreaker('tool_a');
    expect(a).toBe(b);
  });

  it('execute wraps a function with circuit-breaker protection', async () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 2 });
    const result = await registry.execute('tool_x', async () => 42);
    expect(result).toBe(42);

    const stats = registry.getAllStats()['tool_x'];
    expect(stats.totalSuccesses).toBe(1);
  });

  it('execute throws CircuitOpenError when breaker is open', async () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 1 });

    // Trip the breaker
    try {
      await registry.execute('tool_y', async () => {
        throw new Error('fail');
      });
    } catch {
      // expected
    }

    await expect(
      registry.execute('tool_y', async () => 'should not run'),
    ).rejects.toThrow(CircuitOpenError);
  });

  it('resolves config via registerToolConfig prefix matching', () => {
    const registry = new CircuitBreakerRegistry();
    registry.registerToolConfig('custom_', { failureThreshold: 10 });

    const breaker = registry.getBreaker('custom_mytool');
    // It should exist; we verify indirectly by recording fewer than 10 failures
    // and confirming it stays closed
    for (let i = 0; i < 9; i++) {
      breaker.recordFailure(`err${i}`);
    }
    expect(breaker.getState()).toBe('closed');
  });

  it('getHealthSummary reports correct counts', () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 1 });
    registry.getBreaker('healthy_tool');

    const health = registry.getHealthSummary();
    expect(health.total).toBe(1);
    expect(health.closed).toBe(1);
    expect(health.open).toBe(0);
    expect(health.healthy).toBe(true);
  });

  it('resetAll resets every breaker', () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 1 });
    const b1 = registry.getBreaker('a');
    b1.recordFailure('err');
    expect(b1.getState()).toBe('open');

    registry.resetAll();
    expect(b1.getState()).toBe('closed');
  });
});

describe('CircuitOpenError', () => {
  it('has correct properties', () => {
    const err = new CircuitOpenError('my_tool', 5000);
    expect(err.name).toBe('CircuitOpenError');
    expect(err.toolName).toBe('my_tool');
    expect(err.cooldownRemainingMs).toBe(5000);
    expect(err.retryable).toBe(false);
    expect(err.message).toContain('my_tool');
  });

  it('accepts a custom message', () => {
    const err = new CircuitOpenError('t', 0, 'custom msg');
    expect(err.message).toBe('custom msg');
  });
});

// ============================================================================
// Retry Tests
// ============================================================================

import {
  UnifiedRetryEngine,
  classifyError,
  computeDelay,
  RETRY_STRATEGIES,
} from './retry';

describe('UnifiedRetryEngine', () => {
  it('returns value immediately on success', async () => {
    const engine = new UnifiedRetryEngine();
    const result = await engine.execute('op', async () => 'ok');
    expect(result.success).toBe(true);
    expect(result.value).toBe('ok');
    expect(result.context.attempt).toBe(0);
  });

  it('retries on retryable errors and eventually succeeds', async () => {
    vi.useFakeTimers();
    try {
      const engine = new UnifiedRetryEngine();
      let attempt = 0;

      const promise = engine.execute(
        'retry_op',
        async () => {
          attempt++;
          if (attempt < 3) throw new Error('ECONNREFUSED: connection refused');
          return 'recovered';
        },
        { ...RETRY_STRATEGIES.api, jitter: 0 },
      );

      // Advance timers to let retries execute
      await vi.advanceTimersByTimeAsync(60_000);

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.value).toBe('recovered');
      expect(result.context.errors.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry on non-retryable errors', async () => {
    const engine = new UnifiedRetryEngine();
    const result = await engine.execute(
      'auth_op',
      async () => {
        throw new Error('Unauthorized: invalid api key');
      },
      { ...RETRY_STRATEGIES.api, jitter: 0 },
    );

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('AUTH_ERROR');
    expect(result.context.errors.length).toBe(1);
  });

  it('returns failure when max retries are exhausted', async () => {
    vi.useFakeTimers();
    try {
      const engine = new UnifiedRetryEngine();
      const strategy = { ...RETRY_STRATEGIES.api, maxRetries: 2, jitter: 0 };

      const promise = engine.execute(
        'failing_op',
        async () => {
          throw new Error('ECONNREFUSED');
        },
        strategy,
      );

      await vi.advanceTimersByTimeAsync(120_000);
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.context.errors.length).toBe(3); // initial + 2 retries
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits retry events', async () => {
    vi.useFakeTimers();
    try {
      const engine = new UnifiedRetryEngine();
      const events: Array<{ type: string }> = [];
      engine.onRetryEvent((e) => events.push({ type: e.type }));

      let attempt = 0;
      const promise = engine.execute(
        'event_op',
        async () => {
          attempt++;
          if (attempt < 2) throw new Error('ECONNREFUSED');
          return 'done';
        },
        { ...RETRY_STRATEGIES.api, jitter: 0 },
      );

      await vi.advanceTimersByTimeAsync(60_000);
      await promise;

      expect(events.some((e) => e.type === 'retry')).toBe(true);
      expect(events.some((e) => e.type === 'success')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('respects circuit breaker state', async () => {
    const engine = new UnifiedRetryEngine();
    const registry = new CircuitBreakerRegistry({ failureThreshold: 1 });
    engine.setCircuitBreakers(registry);

    // Trip the breaker for 'guarded_op'
    const breaker = registry.getBreaker('guarded_op');
    breaker.recordFailure('err1');

    const result = await engine.execute('guarded_op', async () => 'should not run');
    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('CIRCUIT_OPEN');
  });
});

describe('computeDelay', () => {
  it('computes exponential backoff correctly', () => {
    const strategy: import('./retry').RetryStrategy = {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 60_000,
      backoffMultiplier: 2,
      jitter: 0,
      backoffMode: 'exponential',
    };

    expect(computeDelay(0, strategy)).toBe(1000); // 1000 * 2^0
    expect(computeDelay(1, strategy)).toBe(2000); // 1000 * 2^1
    expect(computeDelay(2, strategy)).toBe(4000); // 1000 * 2^2
    expect(computeDelay(3, strategy)).toBe(8000); // 1000 * 2^3
  });

  it('computes linear backoff correctly', () => {
    const strategy: import('./retry').RetryStrategy = {
      maxRetries: 3,
      initialDelayMs: 500,
      maxDelayMs: 10_000,
      backoffMultiplier: 1,
      jitter: 0,
      backoffMode: 'linear',
    };

    expect(computeDelay(0, strategy)).toBe(500);  // 500 * 1
    expect(computeDelay(1, strategy)).toBe(1000); // 500 * 2
    expect(computeDelay(2, strategy)).toBe(1500); // 500 * 3
  });

  it('computes fixed backoff correctly', () => {
    const strategy: import('./retry').RetryStrategy = {
      maxRetries: 5,
      initialDelayMs: 2000,
      maxDelayMs: 10_000,
      backoffMultiplier: 1,
      jitter: 0,
      backoffMode: 'fixed',
    };

    expect(computeDelay(0, strategy)).toBe(2000);
    expect(computeDelay(3, strategy)).toBe(2000);
  });

  it('caps delay at maxDelayMs', () => {
    const strategy: import('./retry').RetryStrategy = {
      maxRetries: 5,
      initialDelayMs: 1000,
      maxDelayMs: 3000,
      backoffMultiplier: 2,
      jitter: 0,
      backoffMode: 'exponential',
    };

    // 1000 * 2^3 = 8000, but capped at 3000
    expect(computeDelay(3, strategy)).toBe(3000);
  });

  it('prefers Retry-After header over computed delay', () => {
    const strategy: import('./retry').RetryStrategy = {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 60_000,
      backoffMultiplier: 2,
      jitter: 0,
      backoffMode: 'exponential',
    };

    // Retry-After: 5 seconds => 5000ms, which is less than max
    expect(computeDelay(0, strategy, 5000)).toBe(5000);

    // Retry-After: 120 seconds, capped at maxDelayMs 60_000
    expect(computeDelay(0, strategy, 120_000)).toBe(60_000);
  });
});

describe('classifyError', () => {
  it('classifies network errors', () => {
    const result = classifyError(new Error('ECONNREFUSED: connection refused'));
    expect(result.type).toBe('NETWORK_ERROR');
    expect(result.retryable).toBe(true);
  });

  it('classifies DNS errors', () => {
    const result = classifyError(new Error('getaddrinfo ENOTFOUND example.com'));
    expect(result.type).toBe('NETWORK_ERROR');
    expect(result.retryable).toBe(true);
  });

  it('classifies auth errors', () => {
    const result = classifyError(new Error('Unauthorized: invalid API key'));
    expect(result.type).toBe('AUTH_ERROR');
    expect(result.retryable).toBe(false);
  });

  it('classifies auth errors via http status 401', () => {
    const err: any = new Error('fail');
    err.status = 401;
    const result = classifyError(err);
    expect(result.type).toBe('AUTH_ERROR');
    expect(result.retryable).toBe(false);
  });

  it('classifies forbidden errors via http status 403', () => {
    const err: any = new Error('forbidden');
    err.status = 403;
    const result = classifyError(err);
    expect(result.type).toBe('AUTH_ERROR');
  });

  it('classifies timeout errors', () => {
    const result = classifyError(new Error('Request timeout'));
    expect(result.type).toBe('TIMEOUT_ERROR');
    expect(result.retryable).toBe(true);
  });

  it('classifies timeout errors via error name', () => {
    const err = new Error('operation took too long');
    err.name = 'TimeoutError';
    const result = classifyError(err);
    expect(result.type).toBe('TIMEOUT_ERROR');
  });

  it('classifies rate limit errors', () => {
    const result = classifyError(new Error('Rate limit exceeded'));
    expect(result.type).toBe('RATE_LIMIT');
    expect(result.retryable).toBe(true);
  });

  it('classifies rate limit via http status 429', () => {
    const err: any = new Error('too many');
    err.status = 429;
    const result = classifyError(err);
    expect(result.type).toBe('RATE_LIMIT');
  });

  it('classifies server errors via http status 500', () => {
    const err: any = new Error('internal');
    err.status = 500;
    const result = classifyError(err);
    expect(result.type).toBe('SERVER_ERROR');
    expect(result.retryable).toBe(true);
  });

  it('classifies 503 as SERVICE_UNAVAILABLE', () => {
    const err: any = new Error('unavailable');
    err.status = 503;
    const result = classifyError(err);
    expect(result.type).toBe('SERVICE_UNAVAILABLE');
    expect(result.retryable).toBe(true);
  });

  it('classifies validation errors', () => {
    const result = classifyError(new Error('Invalid parameter value'));
    expect(result.type).toBe('VALIDATION_ERROR');
    expect(result.retryable).toBe(false);
  });

  it('classifies validation errors via http status 422', () => {
    const err: any = new Error('bad data');
    err.status = 422;
    const result = classifyError(err);
    expect(result.type).toBe('VALIDATION_ERROR');
  });

  it('classifies not found errors', () => {
    const result = classifyError(new Error('Resource not found'));
    expect(result.type).toBe('NOT_FOUND');
    expect(result.retryable).toBe(false);
  });

  it('classifies cancelled errors', () => {
    const err = new Error('request aborted');
    err.name = 'AbortError';
    const result = classifyError(err);
    expect(result.type).toBe('CANCELLED');
    expect(result.retryable).toBe(false);
  });

  it('classifies insufficient balance errors', () => {
    const result = classifyError(new Error('Insufficient balance on account'));
    expect(result.type).toBe('INSUFFICIENT_BALANCE');
    expect(result.retryable).toBe(false);
  });

  it('classifies circuit open errors', () => {
    const err = new CircuitOpenError('my_tool', 5000);
    const result = classifyError(err);
    expect(result.type).toBe('CIRCUIT_OPEN');
    expect(result.retryable).toBe(false);
  });

  it('classifies unknown errors', () => {
    const result = classifyError(new Error('something completely unexpected'));
    expect(result.type).toBe('UNKNOWN');
  });

  it('classifies non-Error values', () => {
    const result = classifyError('plain string error');
    expect(result.type).toBe('UNKNOWN');
    expect(result.originalError).toBeInstanceOf(Error);
  });

  it('extracts retryAfterMs from response headers', () => {
    const err: any = new Error('rate limited');
    err.response = {
      status: 429,
      headers: {
        'retry-after': '30',
      },
    };
    const result = classifyError(err);
    expect(result.type).toBe('RATE_LIMIT');
    expect(result.retryAfterMs).toBe(30_000);
  });
});

// ============================================================================
// Loop Detector Tests
// ============================================================================

import { LoopDetector, DEFAULT_LOOP_DETECTOR_CONFIG } from './loop-detector';

describe('LoopDetector', () => {
  it('returns no detection on the first call', () => {
    const detector = new LoopDetector();
    const result = detector.check('my_tool', { q: 'test' });
    expect(result.detected).toBe(false);
    expect(result.level).toBe(0);
    expect(result.type).toBe('none');
    expect(result.action).toBe('continue');
  });

  it('detects exact duplicates after threshold', () => {
    const detector = new LoopDetector({ maxExactDuplicates: 2, injectWarningFirst: false });
    const params = { query: 'search term' };

    // Record and check multiple identical calls
    for (let i = 0; i < 3; i++) {
      detector.recordToolCall('search', params, i);
    }

    const result = detector.check('search', params);
    expect(result.detected).toBe(true);
    expect(result.level).toBe(1);
    expect(result.type).toBe('exact_duplicate');
    expect(result.involvedTool).toBe('search');
    expect(result.repetitionCount).toBeGreaterThanOrEqual(2);
  });

  it('detects semantic duplicates with similar parameters', () => {
    const detector = new LoopDetector({
      maxExactDuplicates: 100, // high so exact detection does not trigger first
      maxSemanticDuplicates: 2,
      semanticSimilarityThreshold: 0.5,
      injectWarningFirst: false,
    });

    // Record calls with different but similar params
    detector.recordToolCall('search', { query: 'hello world', limit: 10 }, 0);
    detector.recordToolCall('search', { query: 'hello world', limit: 10 }, 1);
    detector.recordToolCall('search', { query: 'hello world', limit: 10 }, 2);

    const result = detector.check('search', { query: 'hello world', limit: 10 });
    // The similar params should trigger either exact or semantic detection
    expect(result.detected).toBe(true);
  });

  it('detects progress stall when results carry no new information', () => {
    const detector = new LoopDetector({
      progressStallWindow: 3,
      minInformationGain: 0.5,
      maxExactDuplicates: 100, // suppress level 1
      maxSemanticDuplicates: 100, // suppress level 2
      injectWarningFirst: false,
    });

    const sameResult = { data: 'same old data' };

    // Pre-fill older history with this result hash
    detector.recordToolCall('tool_a', { x: 1 }, 0);
    detector.recordToolResult(sameResult);

    detector.recordToolCall('tool_b', { x: 2 }, 1);
    detector.recordToolResult(sameResult);

    detector.recordToolCall('tool_c', { x: 3 }, 2);
    detector.recordToolResult(sameResult);

    detector.recordToolCall('tool_d', { x: 4 }, 3);
    detector.recordToolResult(sameResult);

    detector.recordToolCall('tool_e', { x: 5 }, 4);
    detector.recordToolResult(sameResult);

    // Now the last 3 (the "window") all have results identical to older history
    const result = detector.check('tool_f', { x: 6 });
    expect(result.detected).toBe(true);
    expect(result.level).toBe(3);
    expect(result.type).toBe('progress_stall');
  });

  it('reset() clears all history', () => {
    const detector = new LoopDetector({ maxExactDuplicates: 2, injectWarningFirst: false });
    const params = { q: 'test' };

    for (let i = 0; i < 3; i++) {
      detector.recordToolCall('tool', params, i);
    }
    expect(detector.check('tool', params).detected).toBe(true);

    detector.reset();

    const stats = detector.getStats();
    expect(stats.totalCalls).toBe(0);
    expect(stats.uniqueResults).toBe(0);

    // After reset, same call should not detect a loop
    const result = detector.check('tool', params);
    expect(result.detected).toBe(false);
  });

  it('getStats returns correct information', () => {
    const detector = new LoopDetector();

    detector.recordToolCall('tool_a', { x: 1 }, 0);
    detector.recordToolResult('result_a');
    detector.recordToolCall('tool_b', { x: 2 }, 1);
    detector.recordToolResult('result_b');
    detector.recordToolCall('tool_a', { x: 3 }, 2);

    const stats = detector.getStats();
    expect(stats.totalCalls).toBe(3);
    expect(stats.uniqueResults).toBe(2); // only 2 results were recorded
    expect(stats.topRepeatedTools[0].tool).toBe('tool_a');
    expect(stats.topRepeatedTools[0].count).toBe(2);
  });

  it('acknowledgeWarning increments warning count', () => {
    const detector = new LoopDetector();
    expect(detector.getStats().warningCount).toBe(0);

    detector.acknowledgeWarning();
    expect(detector.getStats().warningCount).toBe(1);

    detector.acknowledgeWarning();
    expect(detector.getStats().warningCount).toBe(2);
  });

  it('issues warnings before breaking when injectWarningFirst is true', () => {
    const detector = new LoopDetector({
      maxExactDuplicates: 2,
      injectWarningFirst: true,
      maxWarningsBeforeBreak: 1,
    });
    const params = { q: 'test' };

    // Build up enough duplicates
    for (let i = 0; i < 3; i++) {
      detector.recordToolCall('tool', params, i);
    }

    // First detection should warn
    const warnResult = detector.check('tool', params);
    expect(warnResult.detected).toBe(true);
    expect(warnResult.action).toBe('warn');
    expect(warnResult.warningMessage).toBeDefined();

    // Acknowledge the warning
    detector.acknowledgeWarning();

    // Record more to re-trigger
    detector.recordToolCall('tool', params, 3);

    // Now should break
    const breakResult = detector.check('tool', params);
    expect(breakResult.detected).toBe(true);
    expect(breakResult.action).toBe('break');
  });
});

// ============================================================================
// Timeout Tests
// ============================================================================

import { TimeoutEnforcer, ToolTimeoutError } from './timeout';

describe('TimeoutEnforcer', () => {
  it('getToolTimeout returns default when no pattern matches', () => {
    const enforcer = new TimeoutEnforcer(
      { toolStepTimeoutMs: 30_000, turnTimeoutMs: 300_000 },
    );
    expect(enforcer.getToolTimeout('unknown_tool')).toBe(30_000);
  });

  it('getToolTimeout returns pattern timeout when matched', () => {
    const enforcer = new TimeoutEnforcer(
      { toolStepTimeoutMs: 30_000, turnTimeoutMs: 300_000 },
      [
        { pattern: '^feishu_', timeoutMs: 10_000, description: 'Feishu tools' },
        { pattern: '^mcp_', timeoutMs: 15_000, description: 'MCP tools' },
      ],
    );

    expect(enforcer.getToolTimeout('feishu_send_message')).toBe(10_000);
    expect(enforcer.getToolTimeout('mcp_search')).toBe(15_000);
    expect(enforcer.getToolTimeout('other_tool')).toBe(30_000);
  });

  it('first matching pattern wins', () => {
    const enforcer = new TimeoutEnforcer(
      { toolStepTimeoutMs: 30_000, turnTimeoutMs: 300_000 },
      [
        { pattern: 'tool', timeoutMs: 5_000, description: 'generic tool' },
        { pattern: '^tool_special', timeoutMs: 60_000, description: 'special tool' },
      ],
    );

    // "tool_special" matches the first pattern "tool" before the second
    expect(enforcer.getToolTimeout('tool_special')).toBe(5_000);
  });

  describe('startTurn / isTurnExpired', () => {
    it('isTurnExpired returns false when no turn started', () => {
      const enforcer = new TimeoutEnforcer(
        { toolStepTimeoutMs: 30_000, turnTimeoutMs: 60_000 },
      );
      expect(enforcer.isTurnExpired()).toBe(false);
    });

    it('isTurnExpired tracks turn deadline', () => {
      vi.useFakeTimers();
      try {
        const enforcer = new TimeoutEnforcer(
          { toolStepTimeoutMs: 30_000, turnTimeoutMs: 60_000 },
        );

        enforcer.startTurn();
        expect(enforcer.isTurnExpired()).toBe(false);

        vi.advanceTimersByTime(60_001);
        expect(enforcer.isTurnExpired()).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('getRemainingTurnMs returns null when no turn active', () => {
      const enforcer = new TimeoutEnforcer(
        { toolStepTimeoutMs: 30_000, turnTimeoutMs: 60_000 },
      );
      expect(enforcer.getRemainingTurnMs()).toBeNull();
    });

    it('getRemainingTurnMs returns remaining time during active turn', () => {
      vi.useFakeTimers();
      try {
        const enforcer = new TimeoutEnforcer(
          { toolStepTimeoutMs: 30_000, turnTimeoutMs: 60_000 },
        );

        enforcer.startTurn();
        expect(enforcer.getRemainingTurnMs()).toBe(60_000);

        vi.advanceTimersByTime(10_000);
        const remaining = enforcer.getRemainingTurnMs();
        expect(remaining).not.toBeNull();
        expect(remaining!).toBeCloseTo(50_000, -2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('executeWithToolTimeout', () => {
    it('resolves when the function completes in time', async () => {
      const enforcer = new TimeoutEnforcer(
        { toolStepTimeoutMs: 5_000, turnTimeoutMs: 60_000 },
      );

      const result = await enforcer.executeWithToolTimeout('fast_tool', async () => 'done');
      expect(result).toBe('done');
    });

    it('throws ToolTimeoutError when function exceeds timeout', async () => {
      vi.useFakeTimers();
      try {
        const enforcer = new TimeoutEnforcer(
          { toolStepTimeoutMs: 100, turnTimeoutMs: 60_000 },
        );

        const promise = enforcer.executeWithToolTimeout(
          'slow_tool',
          async (signal) => {
            // A long-running operation that never resolves on its own
            return new Promise<string>((_resolve, reject) => {
              signal.addEventListener('abort', () => {
                reject(new DOMException('Aborted', 'AbortError'));
              });
            });
          },
        );

        vi.advanceTimersByTime(200);
        await expect(promise).rejects.toThrow(ToolTimeoutError);
      } finally {
        vi.useRealTimers();
      }
    });

    it('clamps timeout to remaining turn budget', async () => {
      vi.useFakeTimers();
      try {
        const enforcer = new TimeoutEnforcer(
          { toolStepTimeoutMs: 30_000, turnTimeoutMs: 200 },
        );

        enforcer.startTurn();
        vi.advanceTimersByTime(150); // 50ms remaining in turn

        const promise = enforcer.executeWithToolTimeout(
          'clamped_tool',
          async (signal) => {
            return new Promise<string>((_resolve, reject) => {
              signal.addEventListener('abort', () => {
                reject(new DOMException('Aborted', 'AbortError'));
              });
            });
          },
        );

        // The effective timeout should be ~50ms, well under 200ms
        vi.advanceTimersByTime(100);
        await expect(promise).rejects.toThrow(ToolTimeoutError);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe('ToolTimeoutError', () => {
  it('has correct properties', () => {
    const err = new ToolTimeoutError('my_tool', 5000);
    expect(err.name).toBe('ToolTimeoutError');
    expect(err.toolName).toBe('my_tool');
    expect(err.timeoutMs).toBe(5000);
    expect(err.message).toContain('my_tool');
    expect(err.message).toContain('5000');
  });
});
