/**
 * timeout-hierarchy.test.ts — 超时体系测试
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  TimeoutOrchestrator,
  TurnDeadlineGuard,
  TimeoutError,
  createRequestTimeout,
  executeWithStepTimeout,
} from '../../timeout-hierarchy';

describe('TimeoutOrchestrator', () => {
  let orchestrator: TimeoutOrchestrator;

  beforeEach(() => {
    orchestrator = new TimeoutOrchestrator({
      turnTimeoutMs: 5000,
      requestTimeoutMs: 1000,
      llmStepTimeoutMs: 2000,
      toolStepTimeoutMs: 1500,
      inactivityTimeoutMs: 3000,
      inactivityCheckIntervalMs: 500,
    });
  });

  afterEach(() => {
    orchestrator.stop();
  });

  test('should start and stop correctly', () => {
    orchestrator.start();
    orchestrator.stop();
    // 不应该抛出错误
    expect(true).toBe(true);
  });

  test('should track turn time', () => {
    orchestrator.start();

    const remaining1 = orchestrator.turnRemainingMs();
    expect(remaining1).toBeGreaterThan(4000);
    expect(remaining1).toBeLessThanOrEqual(5000);

    const utilization = orchestrator.turnUtilization();
    expect(utilization).toBeGreaterThanOrEqual(0);
    expect(utilization).toBeLessThan(0.5);

    orchestrator.stop();
  });

  test('should check turn deadline', () => {
    orchestrator.start();

    // 应该不会抛出错误
    expect(() => orchestrator.checkTurn()).not.toThrow();

    orchestrator.stop();
  });

  test('should record activity', () => {
    orchestrator.start();

    orchestrator.recordActivity('llm_call_start', { model: 'gpt-4' });
    orchestrator.recordActivity('tool_call_end', { tool: 'search' });

    const status = orchestrator.getStatus();
    expect(status.inactiveMs).toBeLessThan(100);

    orchestrator.stop();
  });

  test('should wrap LLM call', async () => {
    orchestrator.start();

    const result = await orchestrator.wrapLLMCall(
      async () => 'test response',
      { streaming: false }
    );

    expect(result).toBe('test response');

    orchestrator.stop();
  });

  test('should wrap tool call', async () => {
    orchestrator.start();

    const result = await orchestrator.wrapToolCall('test_tool', async () => ({
      success: true,
    }));

    expect(result).toEqual({ success: true });

    orchestrator.stop();
  });
});

describe('TurnDeadlineGuard', () => {
  test('should track elapsed time', () => {
    const guard = new TurnDeadlineGuard(5000);

    const elapsed = guard.elapsedMs();
    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(100);
  });

  test('should calculate remaining time', () => {
    const guard = new TurnDeadlineGuard(5000);

    const remaining = guard.remainingMs();
    expect(remaining).toBeGreaterThan(4900);
    expect(remaining).toBeLessThanOrEqual(5000);
  });

  test('should check deadline', () => {
    const guard = new TurnDeadlineGuard(5000);

    // 应该不会抛出错误
    expect(() => guard.check()).not.toThrow();
  });

  test('should detect near deadline', () => {
    const guard = new TurnDeadlineGuard(5000);

    const isNear = guard.isNearDeadline(0.8);
    expect(isNear).toBe(false);
  });

  test('should calculate allowed step timeout', () => {
    const guard = new TurnDeadlineGuard(5000);

    const allowed = guard.getAllowedStepTimeout(3000);
    expect(allowed).toBeGreaterThan(0);
    expect(allowed).toBeLessThanOrEqual(3000);
  });
});

describe('createRequestTimeout', () => {
  test('should create abort handle', () => {
    const handle = createRequestTimeout(1000, 'test');

    expect(handle.signal).toBeDefined();
    expect(handle.signal.aborted).toBe(false);

    handle.cleanup();
  });

  test('should abort after timeout', async () => {
    const handle = createRequestTimeout(100, 'test');

    await new Promise(resolve => setTimeout(resolve, 150));

    expect(handle.signal.aborted).toBe(true);

    handle.cleanup();
  });
});

describe('executeWithStepTimeout', () => {
  test('should execute function successfully', async () => {
    const result = await executeWithStepTimeout(
      async () => 'success',
      1000,
      'test-operation'
    );

    expect(result).toBe('success');
  });

  test('should timeout for slow function', async () => {
    await expect(
      executeWithStepTimeout(
        async () => {
          await new Promise(resolve => setTimeout(resolve, 200));
          return 'too slow';
        },
        100,
        'slow-operation'
      )
    ).rejects.toThrow(TimeoutError);
  });
});

describe('TimeoutError', () => {
  test('should create timeout error', () => {
    const error = new TimeoutError('Test timeout', 'step', 1000);

    expect(error.message).toBe('Test timeout');
    expect(error.layer).toBe('step');
    expect(error.timeoutMs).toBe(1000);
    expect(error.retryable).toBe(true);
  });

  test('should mark turn timeout as non-retryable', () => {
    const error = new TimeoutError('Turn timeout', 'turn', 5000);

    expect(error.retryable).toBe(false);
  });
});
