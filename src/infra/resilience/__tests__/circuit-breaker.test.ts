/**
 * circuit-breaker.test.ts — 熔断器测试
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  CircuitBreaker,
  CircuitBreakerRegistry,
  CircuitOpenError
} from '../../circuit-breaker';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker('test-breaker', {
      failureThreshold: 3,
      cooldownMs: 1000,  // 修正字段名
      halfOpenMaxProbes: 1,
      successThreshold: 1,
      countTimeoutAsFailure: true,
      windowSizeSeconds: 60,
    });
  });

  describe('CLOSED 状态', () => {
    test('should start in CLOSED state', () => {
      const stats = breaker.getStats();

      expect(stats.state).toBe('closed');
      expect(stats.consecutiveFailures).toBe(0);
      expect(stats.totalCalls).toBe(0);
    });

    test('should allow execution in CLOSED state', () => {
      expect(breaker.canExecute()).toBe(true);
    });

    test('should record successes', () => {
      breaker.recordSuccess();

      const stats = breaker.getStats();
      expect(stats.totalSuccesses).toBe(1);
      expect(stats.consecutiveSuccesses).toBe(1);
      expect(stats.state).toBe('closed');
    });

    test('should record failures', () => {
      breaker.recordFailure('Test error');
      breaker.recordFailure('Test error');
      breaker.recordFailure('Test error');

      const stats = breaker.getStats();
      expect(stats.totalFailures).toBe(3);
      expect(stats.consecutiveFailures).toBe(3);
    });

    test('should transition to OPEN after threshold', () => {
      breaker.recordFailure('Error 1');
      breaker.recordFailure('Error 2');
      breaker.recordFailure('Error 3');

      const stats = breaker.getStats();
      expect(stats.state).toBe('open');
    });
  });

  describe('OPEN 状态', () => {
    beforeEach(() => {
      // 触发熔断
      breaker.recordFailure('Error 1');
      breaker.recordFailure('Error 2');
      breaker.recordFailure('Error 3');
    });

    test('should reject execution in OPEN state', () => {
      expect(breaker.canExecute()).toBe(false);
    });

    test('should transition to HALF_OPEN after cooldown', async () => {
      // 等待冷却时间
      await new Promise(resolve => setTimeout(resolve, 1100));

      const state = breaker.getState();
      expect(state).toBe('half_open');
    });

    test('should calculate cooldown remaining', () => {
      const remaining = breaker.cooldownRemainingMs();

      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(1000);
    });
  });

  describe('HALF_OPEN 状态', () => {
    beforeEach(async () => {
      // 触发熔断
      breaker.recordFailure('Error 1');
      breaker.recordFailure('Error 2');
      breaker.recordFailure('Error 3');

      // 等待冷却
      await new Promise(resolve => setTimeout(resolve, 1100));

      // 触发惰性状态转换
      breaker.getState();
    });

    test('should allow limited execution in HALF_OPEN', () => {
      const canExec = breaker.canExecute();
      expect(canExec).toBe(true);
    });

    test('should transition to CLOSED on success', () => {
      breaker.canExecute(); // 消耗一次探测机会
      breaker.recordSuccess();

      const stats = breaker.getStats();
      expect(stats.state).toBe('closed');
    });

    test('should transition back to OPEN on failure', () => {
      breaker.canExecute(); // 消耗一次探测机会
      breaker.recordFailure('Probe failed');

      const stats = breaker.getStats();
      expect(stats.state).toBe('open');
    });

    test('should limit probe attempts', () => {
      // 第一次调用应该允许
      const canExec1 = breaker.canExecute();
      expect(canExec1).toBe(true);

      // 第二次应该被拒绝（halfOpenMaxProbes = 1）
      const canExec2 = breaker.canExecute();
      expect(canExec2).toBe(false);
    });
  });

  describe('重置', () => {
    test('should reset to CLOSED', () => {
      breaker.recordFailure('Error 1');
      breaker.recordFailure('Error 2');
      breaker.recordFailure('Error 3');

      breaker.reset();

      const stats = breaker.getStats();
      expect(stats.state).toBe('closed');
      expect(stats.consecutiveFailures).toBe(0);
    });
  });

  describe('事件监听', () => {
    test('should emit state change events', () => {
      const events: any[] = [];

      breaker.onEvent((event) => {
        events.push(event);
      });

      breaker.recordFailure('Error 1');
      breaker.recordFailure('Error 2');
      breaker.recordFailure('Error 3');

      expect(events.length).toBeGreaterThan(0);
      expect(events.some(e => e.type === 'state_change')).toBe(true);
    });
  });
});

describe('CircuitBreakerRegistry', () => {
  let registry: CircuitBreakerRegistry;

  beforeEach(() => {
    registry = new CircuitBreakerRegistry({
      failureThreshold: 2,
      cooldownMs: 500,  // 修正字段名
    });
  });

  test('should create breakers on demand', () => {
    const breaker = registry.getBreaker('tool1');

    expect(breaker).toBeDefined();
    expect(breaker.name).toBe('tool1');
  });

  test('should reuse existing breakers', () => {
    const breaker1 = registry.getBreaker('tool1');
    const breaker2 = registry.getBreaker('tool1');

    expect(breaker1).toBe(breaker2);
  });

  test('should execute with circuit breaker protection', async () => {
    const result = await registry.execute('tool1', async () => 'success');

    expect(result).toBe('success');

    const breaker = registry.getBreaker('tool1');
    expect(breaker.getStats().totalSuccesses).toBe(1);
  });

  test('should throw CircuitOpenError when circuit is open', async () => {
    const breaker = registry.getBreaker('tool1');

    // 触发熔断
    breaker.recordFailure('Error 1');
    breaker.recordFailure('Error 2');

    await expect(
      registry.execute('tool1', async () => 'should not execute')
    ).rejects.toThrow(CircuitOpenError);
  });

  test('should get all stats', () => {
    registry.getBreaker('tool1');
    registry.getBreaker('tool2');

    const stats = registry.getAllStats();

    expect(Object.keys(stats)).toHaveLength(2);
    expect(stats['tool1']).toBeDefined();
    expect(stats['tool2']).toBeDefined();
  });

  test('should get open circuits', () => {
    const breaker1 = registry.getBreaker('tool1');
    breaker1.recordFailure('Error 1');
    breaker1.recordFailure('Error 2');

    const openCircuits = registry.getOpenCircuits();

    expect(openCircuits).toContain('tool1');
    expect(openCircuits).not.toContain('tool2');
  });

  test('should get health summary', () => {
    registry.getBreaker('tool1');
    registry.getBreaker('tool2');

    const breaker1 = registry.getBreaker('tool1');
    breaker1.recordFailure('Error 1');
    breaker1.recordFailure('Error 2');

    const summary = registry.getHealthSummary();

    expect(summary.total).toBe(2);
    expect(summary.open).toBe(1);
    expect(summary.closed).toBe(1);
    expect(summary.healthy).toBe(false);
  });

  test('should reset all breakers', () => {
    const breaker1 = registry.getBreaker('tool1');
    breaker1.recordFailure('Error 1');
    breaker1.recordFailure('Error 2');

    registry.resetAll();

    const stats = breaker1.getStats();
    expect(stats.state).toBe('closed');
  });

  test('should get all breakers', () => {
    registry.getBreaker('tool1');
    registry.getBreaker('tool2');

    const breakers = registry.getAllBreakers();

    expect(breakers.size).toBe(2);
    expect(breakers.has('tool1')).toBe(true);
    expect(breakers.has('tool2')).toBe(true);
  });
});

describe('CircuitOpenError', () => {
  test('should create error with details', () => {
    const error = new CircuitOpenError('test-tool', 5000, 'Circuit is open');

    expect(error.name).toBe('CircuitOpenError');
    expect(error.toolName).toBe('test-tool');
    expect(error.cooldownRemainingMs).toBe(5000);
    expect(error.retryable).toBe(false);
  });
});
