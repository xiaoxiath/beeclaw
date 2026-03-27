/**
 * Tests for tool-dispatcher.ts
 *
 * Covers: ToolDispatcher — executeSingle, executeToolBatches, isToolBlocked, persistResult
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('../../../infra/observability/logger', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

vi.mock('../tool-dependencies', () => ({
  groupToolCalls: (items: any[]) => [items], // single batch
  getGroupingStats: (items: any[]) => ({ totalCalls: items.length, parallelBatches: 1 }),
}));

vi.mock('../../../infra/resilience/timeout-enforcer', () => ({
  TimeoutEnforcer: class {},
  ToolTimeoutError: class ToolTimeoutError extends Error {
    constructor(msg: string) { super(msg); this.name = 'ToolTimeoutError'; }
  },
}));

import { ToolDispatcher, type ToolBatchResult } from '../tool-dispatcher';
import { ToolTimeoutError } from '../../../infra/resilience/timeout-enforcer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeToolCall(name: string, args: Record<string, unknown> = {}) {
  return {
    id: `call_${name}`,
    type: 'function' as const,
    function: { name, arguments: JSON.stringify(args) },
  };
}

function makeLoopDetector(overrides: Partial<any> = {}) {
  return {
    check: vi.fn(() => ({ action: 'allow' })),
    recordToolCall: vi.fn(() => {}),
    recordToolResult: vi.fn(() => {}),
    acknowledgeWarning: vi.fn(() => {}),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ToolDispatcher', () => {
  let toolExecutor: ReturnType<typeof mock>;
  let hookRunner: any;
  let loopDetector: ReturnType<typeof makeLoopDetector>;

  beforeEach(() => {
    toolExecutor = vi.fn(async () => ({ success: true, data: 'ok' }));
    hookRunner = {
      runBeforeToolCall: vi.fn(async () => {}),
      runAfterToolCall: vi.fn(async () => {}),
      runToolResultPersist: vi.fn((_ctx: any) => 'persisted'),
    };
    loopDetector = makeLoopDetector();
  });

  // -----------------------------------------------------------------------
  // isToolBlocked
  // -----------------------------------------------------------------------
  describe('isToolBlocked', () => {
    it('returns false when no blocked tools configured', () => {
      const d = new ToolDispatcher(toolExecutor, null, loopDetector as any);
      expect(d.isToolBlocked('anything')).toBe(false);
    });

    it('returns true when tool is in blocked list', () => {
      const d = new ToolDispatcher(toolExecutor, null, loopDetector as any, ['web_search']);
      expect(d.isToolBlocked('web_search')).toBe(true);
    });

    it('returns false when tool is not in blocked list', () => {
      const d = new ToolDispatcher(toolExecutor, null, loopDetector as any, ['web_search']);
      expect(d.isToolBlocked('memory_read')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // executeSingle — normal flow
  // -----------------------------------------------------------------------
  describe('executeSingle', () => {
    it('executes a tool call and returns result', async () => {
      const d = new ToolDispatcher(toolExecutor, hookRunner, loopDetector as any);
      const call = makeToolCall('memory_read', { key: 'a' });
      const messages: any[] = [];

      const result = await d.executeSingle(call, 0, messages);
      expect(result.error).toBeNull();
      expect(result.result.success).toBe(true);
      expect(toolExecutor).toHaveBeenCalledWith('memory_read', { key: 'a' }, undefined);
    });

    it('invokes onToolCall and onToolResult callbacks', async () => {
      const onToolCall = vi.fn(() => {});
      const onToolResult = vi.fn(() => {});
      const d = new ToolDispatcher(toolExecutor, null, loopDetector as any);
      const call = makeToolCall('test_tool');

      await d.executeSingle(call, 0, [], { onToolCall, onToolResult });
      expect(onToolCall).toHaveBeenCalledWith('test_tool', {});
      expect(onToolResult).toHaveBeenCalled();
    });

    it('runs hookRunner before and after tool call', async () => {
      const d = new ToolDispatcher(toolExecutor, hookRunner, loopDetector as any);
      await d.executeSingle(makeToolCall('x'), 0, []);
      expect(hookRunner.runBeforeToolCall).toHaveBeenCalled();
      expect(hookRunner.runAfterToolCall).toHaveBeenCalled();
    });

    it('records tool call and result in loop detector', async () => {
      const d = new ToolDispatcher(toolExecutor, null, loopDetector as any);
      await d.executeSingle(makeToolCall('x'), 3, []);
      expect(loopDetector.recordToolCall).toHaveBeenCalledWith('x', {}, 3);
      expect(loopDetector.recordToolResult).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // executeSingle — loop detection
  // -----------------------------------------------------------------------
  describe('loop detection', () => {
    it('pushes warning to messages on warn action', async () => {
      loopDetector.check.mockReturnValue({ action: 'warn', warningMessage: 'loop warning' });
      const d = new ToolDispatcher(toolExecutor, null, loopDetector as any);
      const messages: any[] = [];

      await d.executeSingle(makeToolCall('x'), 0, messages);
      expect(messages.some((m: any) => m.content === 'loop warning')).toBe(true);
      expect(loopDetector.acknowledgeWarning).toHaveBeenCalled();
    });

    it('returns error on break action without executing tool', async () => {
      loopDetector.check.mockReturnValue({ action: 'break', details: 'repeated 5 times' });
      const d = new ToolDispatcher(toolExecutor, null, loopDetector as any);

      const result = await d.executeSingle(makeToolCall('x'), 0, []);
      expect(result.error).toBeTruthy();
      expect(result.result.success).toBe(false);
      expect(toolExecutor).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // executeSingle — blocked tools
  // -----------------------------------------------------------------------
  describe('blocked tools', () => {
    it('returns blocked error without executing', async () => {
      const d = new ToolDispatcher(toolExecutor, null, loopDetector as any, ['blocked_tool']);
      const result = await d.executeSingle(makeToolCall('blocked_tool'), 0, []);
      expect(result.result.success).toBe(false);
      expect(result.result.blocked).toBe(true);
      expect(toolExecutor).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // executeSingle — timeout
  // -----------------------------------------------------------------------
  describe('timeout enforcement', () => {
    it('uses timeoutEnforcer when provided', async () => {
      const enforcer = {
        executeWithToolTimeout: vi.fn(async (_name: string, fn: any) => fn(null)),
        getToolTimeout: vi.fn(() => 5000),
      };
      const d = new ToolDispatcher(toolExecutor, null, loopDetector as any, [], enforcer as any);
      await d.executeSingle(makeToolCall('x'), 0, []);
      expect(enforcer.executeWithToolTimeout).toHaveBeenCalled();
    });

    it('handles ToolTimeoutError', async () => {
      const enforcer = {
        executeWithToolTimeout: vi.fn(async () => { throw new ToolTimeoutError('timeout'); }),
        getToolTimeout: vi.fn(() => 5000),
      };
      const d = new ToolDispatcher(toolExecutor, null, loopDetector as any, [], enforcer as any);
      const result = await d.executeSingle(makeToolCall('slow_tool'), 0, []);
      expect(result.result.success).toBe(false);
      expect(result.result.timeout).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // executeSingle — generic error
  // -----------------------------------------------------------------------
  describe('error handling', () => {
    it('catches non-timeout errors gracefully', async () => {
      toolExecutor.mockRejectedValue(new Error('unexpected crash'));
      const d = new ToolDispatcher(toolExecutor, null, loopDetector as any);
      const result = await d.executeSingle(makeToolCall('x'), 0, []);
      expect(result.error).toContain('unexpected crash');
      expect(result.result.success).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // executeToolBatches
  // -----------------------------------------------------------------------
  describe('executeToolBatches', () => {
    it('executes all tool calls and returns results', async () => {
      const d = new ToolDispatcher(toolExecutor, null, loopDetector as any);
      const calls = [makeToolCall('a'), makeToolCall('b')];

      const results = await d.executeToolBatches(calls, 0, []);
      expect(results.length).toBe(2);
      expect(results.every((r: ToolBatchResult) => r.result.success)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // persistResult
  // -----------------------------------------------------------------------
  describe('persistResult', () => {
    it('returns raw result when no hookRunner', () => {
      const d = new ToolDispatcher(toolExecutor, null, loopDetector as any);
      const result = d.persistResult('x', { success: true }, 'call_1');
      expect(result).toEqual({ success: true });
    });

    it('delegates to hookRunner.runToolResultPersist when available', () => {
      const d = new ToolDispatcher(toolExecutor, hookRunner, loopDetector as any);
      const result = d.persistResult('x', { success: true }, 'call_1');
      expect(hookRunner.runToolResultPersist).toHaveBeenCalled();
      expect(result).toBe('persisted');
    });
  });

  // -----------------------------------------------------------------------
  // _contentBlock handling
  // -----------------------------------------------------------------------
  describe('content block handling', () => {
    it('calls onContentBlock for _contentBlock results', async () => {
      toolExecutor.mockResolvedValue({ success: true, _contentBlock: true, data: { type: 'image' } });
      const onContentBlock = vi.fn(() => {});
      const d = new ToolDispatcher(toolExecutor, null, loopDetector as any);

      await d.executeSingle(makeToolCall('x'), 0, [], { onContentBlock });
      expect(onContentBlock).toHaveBeenCalledWith({ type: 'image' });
    });
  });
});
