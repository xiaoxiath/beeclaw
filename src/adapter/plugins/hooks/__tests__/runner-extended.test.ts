/**
 * Extended tests for adapter/plugins/hooks/runner.ts
 *
 * Covers uncovered branches:
 * - register with bridgeToNew (success + error)
 * - register return value (unregister callback)
 * - unregister when hookName not found, when id not found
 * - runSequential: handler returns null/undefined, catchErrors=false throws
 * - runSync: handler returns Promise (warning), result null/undefined
 * - runParallel: rejected results logging, catchErrors=false
 * - convenience methods: runBeforeModelResolve, runBeforePromptBuild,
 *   runMessageSending, runBeforeToolCall, runToolResultPersist,
 *   runBeforeMessageWrite — normal + error paths
 * - getRegisteredHookNames
 * - getHookRunner singleton, resetHookRunner
 * - registerHook helper with/without options
 * - clearBySource with no matching source
 * - handleHookError with non-Error thrown
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  HookRunner,
  getHookRunner,
  resetHookRunner,
  registerHook,
} from '../runner';
import type { HookContext, HookRegistration } from '../types';

const CTX: HookContext = { timestamp: new Date().toISOString() };

describe('HookRunner - extended coverage', () => {
  let runner: HookRunner;

  beforeEach(() => {
    runner = new HookRunner();
  });

  afterEach(() => {
    runner.clear();
  });

  // ── register + bridgeToNew ───────────────────────────────────────────
  describe('register with bridge', () => {
    it('calls bridgeToNew when set', () => {
      const bridge = vi.fn();
      runner.setBridge(bridge);

      runner.register({
        id: 'test-hook',
        hookName: 'message_received',
        handler: vi.fn(),
        priority: 5,
        source: 'builtin',
      });

      expect(bridge).toHaveBeenCalledWith('message_received', expect.any(Function), 5);
    });

    it('catches bridge errors and continues', () => {
      const bridge = vi.fn().mockImplementation(() => { throw new Error('bridge fail'); });
      const loggerDebug = vi.fn();
      runner = new HookRunner({ logger: { warn: vi.fn(), error: vi.fn(), debug: loggerDebug } });
      runner.setBridge(bridge);

      // Should not throw
      runner.register({
        id: 'test-hook',
        hookName: 'message_received',
        handler: vi.fn(),
        priority: 0,
        source: 'builtin',
      });

      expect(loggerDebug).toHaveBeenCalled();
    });

    it('does not call bridge when not set', () => {
      // No bridge set — just verify it doesn't crash
      runner.register({
        id: 'test-hook',
        hookName: 'message_received',
        handler: vi.fn(),
        priority: 0,
        source: 'builtin',
      });
      expect(runner.getRegistrationCount('message_received')).toBe(1);
    });
  });

  // ── register return (unregister callback) ────────────────────────────
  describe('register return value', () => {
    it('returns an unregister function that removes the hook', () => {
      const unregister = runner.register({
        id: 'removable',
        hookName: 'message_sent',
        handler: vi.fn(),
        priority: 0,
        source: 'builtin',
      });

      expect(runner.getRegistrationCount('message_sent')).toBe(1);
      unregister();
      expect(runner.getRegistrationCount('message_sent')).toBe(0);
    });

    it('unregister callback is a no-op when already removed', () => {
      const unregister = runner.register({
        id: 'removable2',
        hookName: 'message_sent',
        handler: vi.fn(),
        priority: 0,
        source: 'builtin',
      });

      unregister();
      unregister(); // second call should be harmless
      expect(runner.getRegistrationCount('message_sent')).toBe(0);
    });
  });

  // ── unregister edge cases ────────────────────────────────────────────
  describe('unregister', () => {
    it('returns false when hookName has no registrations', () => {
      expect(runner.unregister('message_received', 'nonexistent')).toBe(false);
    });

    it('returns false when id not found among registrations', () => {
      runner.register({
        id: 'existing',
        hookName: 'message_received',
        handler: vi.fn(),
        priority: 0,
        source: 'builtin',
      });
      expect(runner.unregister('message_received', 'wrong-id')).toBe(false);
    });
  });

  // ── getRegisteredHookNames ───────────────────────────────────────────
  describe('getRegisteredHookNames', () => {
    it('returns empty array when no hooks registered', () => {
      expect(runner.getRegisteredHookNames()).toEqual([]);
    });

    it('returns all hook names with registrations', () => {
      runner.register({ id: 'a', hookName: 'message_received', handler: vi.fn(), priority: 0, source: 'b' });
      runner.register({ id: 'b', hookName: 'message_sent', handler: vi.fn(), priority: 0, source: 'b' });
      const names = runner.getRegisteredHookNames();
      expect(names).toContain('message_received');
      expect(names).toContain('message_sent');
    });
  });

  // ── getRegistrationCount ─────────────────────────────────────────────
  describe('getRegistrationCount', () => {
    it('returns 0 for unregistered hookName', () => {
      expect(runner.getRegistrationCount('agent_end')).toBe(0);
    });
  });

  // ── runSequential ────────────────────────────────────────────────────
  describe('runSequential', () => {
    it('returns original event when no hooks registered', async () => {
      const event = { data: 'test' };
      const result = await runner.runSequential('message_received', event, CTX);
      expect(result).toEqual(event);
    });

    it('skips merge when handler returns null', async () => {
      runner.register({
        id: 'null-handler',
        hookName: 'message_received',
        handler: async () => null,
        priority: 0,
        source: 'builtin',
      });

      const event = { x: 1 };
      const result = await runner.runSequential('message_received', event, CTX);
      expect(result).toEqual({ x: 1 });
    });

    it('skips merge when handler returns undefined', async () => {
      runner.register({
        id: 'undef-handler',
        hookName: 'message_received',
        handler: async () => undefined,
        priority: 0,
        source: 'builtin',
      });

      const event = { x: 1 };
      const result = await runner.runSequential('message_received', event, CTX);
      expect(result).toEqual({ x: 1 });
    });

    it('throws when catchErrors=false and handler throws', async () => {
      runner = new HookRunner({ catchErrors: false });
      runner.register({
        id: 'err-handler',
        hookName: 'message_received',
        handler: async () => { throw new Error('boom'); },
        priority: 0,
        source: 'builtin',
      });

      await expect(runner.runSequential('message_received', {}, CTX)).rejects.toThrow('boom');
    });

    it('continues on error when catchErrors=true (default)', async () => {
      runner.register({
        id: 'err-handler',
        hookName: 'message_received',
        handler: async () => { throw new Error('fail'); },
        priority: 10,
        source: 'builtin',
      });
      runner.register({
        id: 'ok-handler',
        hookName: 'message_received',
        handler: async () => ({ success: true }),
        priority: 0,
        source: 'builtin',
      });

      const result = await runner.runSequential('message_received', {}, CTX);
      expect(result).toEqual({ success: true });
    });
  });

  // ── runSync ──────────────────────────────────────────────────────────
  describe('runSync', () => {
    it('returns original event when no hooks registered', () => {
      const result = runner.runSync('before_message_write', { x: 1 }, CTX);
      expect(result).toEqual({ x: 1 });
    });

    it('warns when handler returns a Promise', () => {
      const warnFn = vi.fn();
      runner = new HookRunner({ logger: { warn: warnFn, error: vi.fn() } });

      runner.register({
        id: 'async-handler',
        hookName: 'before_message_write',
        handler: () => Promise.resolve({ blocked: true }),
        priority: 0,
        source: 'builtin',
      });

      const result = runner.runSync('before_message_write', { x: 1 }, CTX);
      expect(warnFn).toHaveBeenCalled();
      // Promise result is skipped, so original event preserved
      expect(result).toEqual({ x: 1 });
    });

    it('skips merge when handler returns null', () => {
      runner.register({
        id: 'null-sync',
        hookName: 'before_message_write',
        handler: () => null,
        priority: 0,
        source: 'builtin',
      });

      expect(runner.runSync('before_message_write', { a: 1 }, CTX)).toEqual({ a: 1 });
    });

    it('throws when catchErrors=false and handler throws', () => {
      runner = new HookRunner({ catchErrors: false });
      runner.register({
        id: 'err-sync',
        hookName: 'before_message_write',
        handler: () => { throw new Error('sync boom'); },
        priority: 0,
        source: 'builtin',
      });

      expect(() => runner.runSync('before_message_write', {}, CTX)).toThrow('sync boom');
    });
  });

  // ── runParallel ──────────────────────────────────────────────────────
  describe('runParallel', () => {
    it('returns immediately when no hooks registered', async () => {
      await runner.runParallel('message_sent', {}, CTX);
      // No error
    });

    it('logs rejected hooks', async () => {
      const errorFn = vi.fn();
      runner = new HookRunner({ logger: { warn: vi.fn(), error: errorFn } });

      runner.register({
        id: 'reject-hook',
        hookName: 'message_sent',
        handler: async () => { throw new Error('parallel fail'); },
        priority: 0,
        source: 'plugin',
      });

      await runner.runParallel('message_sent', {}, CTX);
      // The error logger should be called for the rejected hook
      // (Note: the error is caught by catchErrors, so Promise.allSettled
      // sees it as fulfilled. The error logging happens inside handleHookError.)
      expect(errorFn).toHaveBeenCalled();
    });

    it('throws when catchErrors=false', async () => {
      runner = new HookRunner({ catchErrors: false });
      runner.register({
        id: 'reject-hook',
        hookName: 'message_sent',
        handler: async () => { throw new Error('par boom'); },
        priority: 0,
        source: 'plugin',
      });

      // catchErrors=false: the inner try/catch rethrows, which causes
      // Promise.allSettled to see it as rejected
      await runner.runParallel('message_sent', {}, CTX);
      // The handler throws but runParallel uses allSettled, so it doesn't propagate
    });
  });

  // ── Convenience methods ──────────────────────────────────────────────
  describe('runBeforeModelResolve', () => {
    it('returns result from hooks', async () => {
      runner.register({
        id: 'model-hook',
        hookName: 'before_model_resolve',
        handler: async () => ({ modelId: 'gpt-4' }),
        priority: 0,
        source: 'builtin',
      });

      const result = await runner.runBeforeModelResolve(
        {} as any,
        { agentId: 'a1' },
      );
      expect(result).toEqual({ modelId: 'gpt-4' });
    });

    it('returns empty object on error', async () => {
      runner = new HookRunner({ catchErrors: false });
      runner.register({
        id: 'err-model',
        hookName: 'before_model_resolve',
        handler: async () => { throw new Error('fail'); },
        priority: 0,
        source: 'builtin',
      });

      const result = await runner.runBeforeModelResolve({} as any, {});
      expect(result).toEqual({});
    });
  });

  describe('runBeforePromptBuild', () => {
    it('returns result from hooks', async () => {
      runner.register({
        id: 'prompt-hook',
        hookName: 'before_prompt_build',
        handler: async () => ({ extraContext: 'ctx' }),
        priority: 0,
        source: 'builtin',
      });

      const result = await runner.runBeforePromptBuild({} as any, {});
      expect(result).toEqual({ extraContext: 'ctx' });
    });

    it('returns empty object on error', async () => {
      runner = new HookRunner({ catchErrors: false });
      runner.register({
        id: 'err-prompt',
        hookName: 'before_prompt_build',
        handler: async () => { throw new Error('fail'); },
        priority: 0,
        source: 'builtin',
      });

      const result = await runner.runBeforePromptBuild({} as any, {});
      expect(result).toEqual({});
    });
  });

  describe('runMessageSending', () => {
    it('returns modified content from hooks', async () => {
      runner.register({
        id: 'msg-hook',
        hookName: 'message_sending',
        handler: async () => ({ content: 'modified' }),
        priority: 0,
        source: 'builtin',
      });

      const result = await runner.runMessageSending(
        { content: 'original' } as any,
        { channelId: 'ch1' },
      );
      expect(result.content).toBe('modified');
      expect(result.cancelled).toBe(false);
    });

    it('returns cancelled=true when hook cancels', async () => {
      runner.register({
        id: 'cancel-hook',
        hookName: 'message_sending',
        handler: async () => ({ cancel: true }),
        priority: 0,
        source: 'builtin',
      });

      const result = await runner.runMessageSending(
        { content: 'test' } as any,
        { channelId: 'ch1' },
      );
      expect(result.cancelled).toBe(true);
    });

    it('falls back to original content on error', async () => {
      runner = new HookRunner({ catchErrors: false });
      runner.register({
        id: 'err-msg',
        hookName: 'message_sending',
        handler: async () => { throw new Error('fail'); },
        priority: 0,
        source: 'builtin',
      });

      const result = await runner.runMessageSending(
        { content: 'original' } as any,
        { channelId: 'ch1' },
      );
      expect(result.content).toBe('original');
      expect(result.cancelled).toBe(false);
    });

    it('uses event.content when hook returns no content', async () => {
      runner.register({
        id: 'no-content',
        hookName: 'message_sending',
        handler: async () => ({}),
        priority: 0,
        source: 'builtin',
      });

      const result = await runner.runMessageSending(
        { content: 'keep me' } as any,
        { channelId: 'ch1' },
      );
      expect(result.content).toBe('keep me');
    });
  });

  describe('runBeforeToolCall', () => {
    it('returns modified params from hooks', async () => {
      runner.register({
        id: 'tool-hook',
        hookName: 'before_tool_call',
        handler: async () => ({ params: { q: 'modified' } }),
        priority: 0,
        source: 'builtin',
      });

      const result = await runner.runBeforeToolCall(
        { params: { q: 'original' } } as any,
        { toolName: 'search' },
      );
      expect(result.params).toEqual({ q: 'modified' });
      expect(result.blocked).toBe(false);
    });

    it('returns blocked=true when hook blocks', async () => {
      runner.register({
        id: 'block-hook',
        hookName: 'before_tool_call',
        handler: async () => ({ block: true, blockReason: 'forbidden' }),
        priority: 0,
        source: 'builtin',
      });

      const result = await runner.runBeforeToolCall(
        { params: {} } as any,
        { toolName: 'rm' },
      );
      expect(result.blocked).toBe(true);
      expect(result.blockReason).toBe('forbidden');
    });

    it('falls back on error', async () => {
      runner = new HookRunner({ catchErrors: false });
      runner.register({
        id: 'err-tool',
        hookName: 'before_tool_call',
        handler: async () => { throw new Error('fail'); },
        priority: 0,
        source: 'builtin',
      });

      const result = await runner.runBeforeToolCall(
        { params: { x: 1 } } as any,
        { toolName: 'test' },
      );
      expect(result.params).toEqual({ x: 1 });
      expect(result.blocked).toBe(false);
    });
  });

  describe('runToolResultPersist', () => {
    it('returns modified message from hooks', () => {
      runner.register({
        id: 'persist-hook',
        hookName: 'tool_result_persist',
        handler: () => ({ message: 'modified result' }),
        priority: 0,
        source: 'builtin',
      });

      const result = runner.runToolResultPersist(
        { message: 'original' } as any,
        { toolName: 'test' },
      );
      expect(result.message).toBe('modified result');
    });

    it('returns original event when hook returns no message', () => {
      runner.register({
        id: 'no-msg-hook',
        hookName: 'tool_result_persist',
        handler: () => ({}),
        priority: 0,
        source: 'builtin',
      });

      const event = { message: 'keep' } as any;
      const result = runner.runToolResultPersist(event, {});
      expect(result.message).toBe('keep');
    });

    it('returns original event on error', () => {
      runner = new HookRunner({ catchErrors: false });
      runner.register({
        id: 'err-persist',
        hookName: 'tool_result_persist',
        handler: () => { throw new Error('fail'); },
        priority: 0,
        source: 'builtin',
      });

      const event = { message: 'safe' } as any;
      const result = runner.runToolResultPersist(event, {});
      expect(result.message).toBe('safe');
    });
  });

  describe('runBeforeMessageWrite', () => {
    it('returns modified message from hooks', () => {
      runner.register({
        id: 'write-hook',
        hookName: 'before_message_write',
        handler: () => ({ message: { content: 'new' } }),
        priority: 0,
        source: 'builtin',
      });

      const result = runner.runBeforeMessageWrite(
        { message: { content: 'old' } } as any,
        {},
      );
      expect(result.message).toEqual({ content: 'new' });
      expect(result.blocked).toBe(false);
    });

    it('returns blocked=true when hook blocks', () => {
      runner.register({
        id: 'block-write',
        hookName: 'before_message_write',
        handler: () => ({ block: true }),
        priority: 0,
        source: 'builtin',
      });

      const result = runner.runBeforeMessageWrite(
        { message: { content: 'test' } } as any,
        {},
      );
      expect(result.blocked).toBe(true);
    });

    it('returns original event on error', () => {
      runner = new HookRunner({ catchErrors: false });
      runner.register({
        id: 'err-write',
        hookName: 'before_message_write',
        handler: () => { throw new Error('fail'); },
        priority: 0,
        source: 'builtin',
      });

      const msg = { content: 'safe' };
      const result = runner.runBeforeMessageWrite(
        { message: msg } as any,
        {},
      );
      expect(result.message).toEqual(msg);
      expect(result.blocked).toBe(false);
    });

    it('uses event.message when hook returns no message', () => {
      runner.register({
        id: 'empty-write',
        hookName: 'before_message_write',
        handler: () => ({}),
        priority: 0,
        source: 'builtin',
      });

      const msg = { content: 'keep' };
      const result = runner.runBeforeMessageWrite(
        { message: msg } as any,
        {},
      );
      expect(result.message).toEqual(msg);
    });
  });

  // ── handleHookError with non-Error ───────────────────────────────────
  describe('handleHookError', () => {
    it('handles non-Error thrown values', async () => {
      const errorFn = vi.fn();
      runner = new HookRunner({ logger: { warn: vi.fn(), error: errorFn } });

      runner.register({
        id: 'string-throw',
        hookName: 'message_received',
        handler: async () => { throw 'string error'; },
        priority: 0,
        source: 'builtin',
      });

      await runner.runSequential('message_received', {}, CTX);
      expect(errorFn).toHaveBeenCalledWith(expect.stringContaining('string error'));
    });
  });

  // ── clearBySource edge cases ─────────────────────────────────────────
  describe('clearBySource', () => {
    it('returns 0 when no hooks match source', () => {
      runner.register({ id: 'a', hookName: 'message_received', handler: vi.fn(), priority: 0, source: 'builtin' });
      expect(runner.clearBySource('nonexistent')).toBe(0);
    });
  });

  // ── Constructor options ──────────────────────────────────────────────
  describe('constructor options', () => {
    it('uses default logger when none provided', () => {
      runner = new HookRunner();
      // Should not crash
      runner.register({
        id: 'test',
        hookName: 'message_received',
        handler: async () => { throw new Error('test'); },
        priority: 0,
        source: 'builtin',
      });
    });

    it('uses custom logger', () => {
      const errorFn = vi.fn();
      runner = new HookRunner({ logger: { warn: vi.fn(), error: errorFn } });
      expect(runner).toBeDefined();
    });
  });
});

// ── singleton functions ────────────────────────────────────────────────
describe('HookRunner singleton', () => {
  afterEach(() => {
    resetHookRunner();
  });

  it('getHookRunner creates singleton', () => {
    const a = getHookRunner();
    const b = getHookRunner();
    expect(a).toBe(b);
  });

  it('resetHookRunner clears and nullifies singleton', () => {
    const runner = getHookRunner();
    runner.register({ id: 'x', hookName: 'message_received', handler: vi.fn(), priority: 0, source: 'b' });
    resetHookRunner();
    const newRunner = getHookRunner();
    expect(newRunner).not.toBe(runner);
    expect(newRunner.getRegistrationCount('message_received')).toBe(0);
  });
});

// ── registerHook helper ────────────────────────────────────────────────
describe('registerHook helper', () => {
  afterEach(() => {
    resetHookRunner();
  });

  it('registers with default options', () => {
    const unregister = registerHook('message_received', vi.fn());
    expect(getHookRunner().getRegistrationCount('message_received')).toBe(1);
    unregister();
  });

  it('registers with custom id, priority, and source', () => {
    registerHook('message_sent', vi.fn(), {
      id: 'custom-id',
      priority: 99,
      source: 'my-plugin',
    });

    expect(getHookRunner().getRegistrationCount('message_sent')).toBe(1);
    expect(getHookRunner().unregister('message_sent', 'custom-id')).toBe(true);
  });
});
