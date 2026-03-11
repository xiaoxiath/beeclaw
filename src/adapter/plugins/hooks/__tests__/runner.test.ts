/**
 * Hooks System Tests
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { HookRunner, registerHook, getHookRunner, resetHookRunner } from '../runner';
import type { HookContext } from '../../types';

describe('HookRunner', () => {
  let runner: HookRunner;

  beforeEach(() => {
    runner = new HookRunner();
  });

  afterEach(() => {
    runner.clear();
  });

  test('should register and run sequential hooks', async () => {
    const results: number[] = [];

    runner.register({
      id: 'hook-1',
      hookName: 'message_received',
      handler: async () => ({ value: 1 }),
      priority: 5,
      source: 'builtin',
    });

    runner.register({
      id: 'hook-2',
      hookName: 'message_received',
      handler: async () => ({ value: 2 }),
      priority: 10, // Higher priority, should run first
      source: 'builtin',
    });

    const ctx: HookContext = { timestamp: new Date().toISOString() };
    const result = await runner.runSequential('message_received', {}, ctx);

    // Lower priority hook runs last, so its result is preserved (sequential execution)
    expect(result).toEqual({ value: 1 });
  });

  test('should run parallel hooks', async () => {
    const results: string[] = [];

    runner.register({
      id: 'hook-1',
      hookName: 'message_sent',
      handler: async () => { results.push('a'); },
      priority: 0,
      source: 'builtin',
    });

    runner.register({
      id: 'hook-2',
      hookName: 'message_sent',
      handler: async () => { results.push('b'); },
      priority: 0,
      source: 'builtin',
    });

    const ctx: HookContext = { timestamp: new Date().toISOString() };
    await runner.runParallel('message_sent', {}, ctx);

    // Both hooks should have run
    expect(results.length).toBe(2);
    expect(results).toContain('a');
    expect(results).toContain('b');
  });

  test('should run sync hooks', () => {
    const results: string[] = [];

    runner.register({
      id: 'hook-1',
      hookName: 'before_message_write',
      handler: () => ({ blocked: true }),
      priority: 0,
      source: 'builtin',
    });

    const ctx: HookContext = { timestamp: new Date().toISOString() };
    const result = runner.runSync('before_message_write', {}, ctx);

    expect(result).toEqual({ blocked: true });
  });

  test('should handle hook errors gracefully', async () => {
    const results: string[] = [];

    runner.register({
      id: 'hook-error',
      hookName: 'message_received',
      handler: async () => { throw new Error('Test error'); },
      priority: 0,
      source: 'builtin',
    });

    runner.register({
      id: 'hook-ok',
      hookName: 'message_received',
      handler: async () => { results.push('ok'); },
      priority: 0,
      source: 'builtin',
    });

    const ctx: HookContext = { timestamp: new Date().toISOString() };

    // Should not throw, should continue to next hook
    await runner.runParallel('message_received', {}, ctx);

    expect(results).toContain('ok');
  });

  test('should unregister hooks', () => {
    runner.register({
      id: 'hook-1',
      hookName: 'message_received',
      handler: () => {},
      priority: 0,
      source: 'builtin',
    });

    expect(runner.getRegistrationCount('message_received' as any)).toBe(1);

    const unregistered = runner.unregister('message_received', 'hook-1');

    expect(unregistered).toBe(true);
    expect(runner.getRegistrationCount('message_received' as any)).toBe(0);
  });

  test('should clear hooks by source', () => {
    runner.register({
      id: 'hook-1',
      hookName: 'message_received',
      handler: () => {},
      priority: 0,
      source: 'plugin',
    });

    runner.register({
      id: 'hook-2',
      hookName: 'message_sent',
      handler: () => {},
      priority: 0,
      source: 'plugin',
    });

    runner.register({
      id: 'hook-3',
      hookName: 'message_received',
      handler: () => {},
      priority: 0,
      source: 'builtin',
    });

    const count = runner.clearBySource('plugin');

    expect(count).toBe(2);
  });
});

describe('registerHook helper', () => {
  afterEach(() => {
    resetHookRunner();
  });

  test('should register hook using helper function', async () => {
    const results: string[] = [];

    const unregister = registerHook('message_received', async (event, ctx) => {
      results.push('called');
    });

    const runner = getHookRunner();
    await runner.runParallel('message_received', { content: 'test' }, { timestamp: new Date().toISOString() });

    expect(results).toContain('called');

    // Test unregister
    unregister();
  });
});
