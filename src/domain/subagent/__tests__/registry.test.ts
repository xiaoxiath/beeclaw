// Subagent Registry Tests

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, unlinkSync } from 'fs';
import { SubagentRegistry, type SubagentSpawnOptions } from '../registry';

describe('SubagentRegistry', () => {
  let registry: SubagentRegistry;
  let testPath: string;

  beforeEach(() => {
    // Use unique path for each test run to avoid state leakage
    testPath = `/tmp/test-subagent-runs-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;

    registry = new SubagentRegistry({
      persistPath: testPath,
      maxDepth: 3,
      archiveAfterMinutes: 60,
      cleanupIntervalMinutes: 1,
      maxRecords: 100,
    });
  });

  afterEach(() => {
    registry.destroy();
    // Clean up test file
    try {
      if (existsSync(testPath)) {
        unlinkSync(testPath);
      }
    } catch {
      // ignore
    }
  });

  describe('register', () => {
    test('should register a new subagent run', async () => {
      const options: SubagentSpawnOptions = {
        runId: 'test-run-1',
        childSessionKey: 'child-session-1',
        requesterSessionKey: 'parent-session-1',
        task: 'Test task',
        type: 'general',
      };

      const record = await registry.register(options);

      expect(record.runId).toBe('test-run-1');
      expect(record.task).toBe('Test task');
      expect(record.spawnMode).toBe('run');

      // Verify it can get the record
      const retrieved = registry.get('test-run-1');
      expect(retrieved).toBeDefined();
    });
  });

  describe('complete', () => {
    test('should complete a run with ok outcome', async () => {
      await registry.register({
        runId: 'complete-test-1',
        childSessionKey: 'child-1',
        requesterSessionKey: 'parent-1',
        task: 'Test',
      });

      await registry.complete('complete-test-1', 'ok', {
        output: 'Success result',
        tokensUsed: 100,
      });

      const record = registry.get('complete-test-1');
      expect(record?.outcome).toBe('ok');
      expect(record?.endedReason).toBe('complete');
    });

    test('should complete with error outcome', async () => {
      await registry.register({
        runId: 'complete-test-2',
        childSessionKey: 'child-2',
        requesterSessionKey: 'parent-2',
        task: 'Test',
      });

      await registry.complete('complete-test-2', 'error', {
        error: 'Something went wrong',
      });

      const record = registry.get('complete-test-2');
      expect(record?.outcome).toBe('error');
      expect(record?.error).toBe('Something went wrong');
    });
  });

  describe('checkDepth', () => {
    test('should return correct depth', async () => {
      // Level 0 - no parent
      const depth0 = registry.checkDepth('root-session');
      expect(depth0.depth).toBe(0);
      expect(depth0.allowed).toBe(true);

      // Level 1 - one parent (child-1's parent is root-session)
      await registry.register({
        runId: 'depth-test-1',
        childSessionKey: 'child-1',
        requesterSessionKey: 'root-session',
        task: 'Test',
      });

      const depth1 = registry.checkDepth('child-1');
      expect(depth1.depth).toBe(1);
      expect(depth1.allowed).toBe(true);

      // Level 2 - two parents (child-2's parent is child-1)
      await registry.register({
        runId: 'depth-test-2',
        childSessionKey: 'child-2',
        requesterSessionKey: 'child-1',
        task: 'Test',
      });

      const depth2 = registry.checkDepth('child-2');
      expect(depth2.depth).toBe(2);
      expect(depth2.allowed).toBe(true);

      // Level 3 - three parents (maxDepth is 3, so depth 3 is not allowed)
      await registry.register({
        runId: 'depth-test-3',
        childSessionKey: 'child-3',
        requesterSessionKey: 'child-2',
        task: 'Test',
      });

      const depth3 = registry.checkDepth('child-3');
      expect(depth3.depth).toBe(3);
      expect(depth3.allowed).toBe(false); // maxDepth is 3, depth >= maxDepth not allowed
    });
  });

  describe('getActiveRuns', () => {
    test('should return only active runs', async () => {
      await registry.register({
        runId: 'active-test-1',
        childSessionKey: 'child-a1',
        requesterSessionKey: 'parent-a1',
        task: 'Active task',
      });

      await registry.register({
        runId: 'active-test-2',
        childSessionKey: 'child-a2',
        requesterSessionKey: 'parent-a2',
        task: 'Active task 2',
      });

      // Complete one
      await registry.complete('active-test-2', 'ok');

      const active = registry.getActiveRuns();
      expect(active.length).toBe(1);
      expect(active[0].runId).toBe('active-test-1');
    });
  });

  describe('getStats', () => {
    test('should return correct statistics', async () => {
      await registry.register({
        runId: 'stats-test-1',
        childSessionKey: 'child-s1',
        requesterSessionKey: 'parent-s1',
        task: 'Test 1',
      });

      await registry.register({
        runId: 'stats-test-2',
        childSessionKey: 'child-s2',
        requesterSessionKey: 'parent-s2',
        task: 'Test 2',
      });

      await registry.complete('stats-test-1', 'ok');
      await registry.complete('stats-test-2', 'error');

      const stats = registry.getStats();

      expect(stats.totalRuns).toBe(2);
      expect(stats.completedRuns).toBe(1);
      expect(stats.failedRuns).toBe(1);
      expect(stats.activeRuns).toBe(0);
    });
  });
});

// ============================================================================
// Additional comprehensive tests
// ============================================================================

import { getSubagentRegistry, resetSubagentRegistry, type RegistryHookRunner } from '../registry';

describe('SubagentRegistry — register edge cases', () => {
  let registry: SubagentRegistry;
  let testPath: string;

  beforeEach(() => {
    testPath = `/tmp/test-reg-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
    registry = new SubagentRegistry({
      persistPath: testPath,
      maxDepth: 3,
      archiveAfterMinutes: 60,
      cleanupIntervalMinutes: 999,
      maxRecords: 100,
    });
  });

  afterEach(() => {
    registry.destroy();
    try { if (existsSync(testPath)) unlinkSync(testPath); } catch {}
  });

  test('defaults for spawnMode, cleanup, expectsCompletionMessage, type', async () => {
    const record = await registry.register({
      runId: 'default-test',
      childSessionKey: 'child',
      requesterSessionKey: 'parent',
      task: 'Task with defaults',
    });

    expect(record.spawnMode).toBe('run');
    expect(record.cleanup).toBe('delete');
    expect(record.expectsCompletionMessage).toBe(true);
    expect(record.type).toBe('general');
    expect(record.cleanupHandled).toBe(false);
    expect(record.createdAt).toBeGreaterThan(0);
  });

  test('custom spawnMode, cleanup, expectsCompletionMessage', async () => {
    const record = await registry.register({
      runId: 'custom-test',
      childSessionKey: 'child',
      requesterSessionKey: 'parent',
      task: 'Custom task',
      type: 'research',
      spawnMode: 'session',
      cleanup: 'keep',
      expectsCompletionMessage: false,
      label: 'My label',
      model: 'gpt-4',
      provider: 'openai',
      requesterOrigin: { channel: 'slack', accountId: 'u123' },
    });

    expect(record.spawnMode).toBe('session');
    expect(record.cleanup).toBe('keep');
    expect(record.expectsCompletionMessage).toBe(false);
    expect(record.type).toBe('research');
    expect(record.label).toBe('My label');
    expect(record.model).toBe('gpt-4');
    expect(record.provider).toBe('openai');
    expect(record.requesterOrigin?.channel).toBe('slack');
  });
});

describe('SubagentRegistry — start', () => {
  let registry: SubagentRegistry;
  let testPath: string;

  beforeEach(() => {
    testPath = `/tmp/test-start-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
    registry = new SubagentRegistry({
      persistPath: testPath,
      maxDepth: 3,
      cleanupIntervalMinutes: 999,
      maxRecords: 100,
    });
  });

  afterEach(() => {
    registry.destroy();
    try { if (existsSync(testPath)) unlinkSync(testPath); } catch {}
  });

  test('sets startedAt timestamp', async () => {
    await registry.register({
      runId: 'start-test',
      childSessionKey: 'c',
      requesterSessionKey: 'p',
      task: 'Task',
    });

    await registry.start('start-test');

    const record = registry.get('start-test');
    expect(record?.startedAt).toBeGreaterThan(0);
  });

  test('does nothing for non-existent runId', async () => {
    // Should not throw
    await registry.start('nonexistent');
  });
});

describe('SubagentRegistry — complete edge cases', () => {
  let registry: SubagentRegistry;
  let testPath: string;

  beforeEach(() => {
    testPath = `/tmp/test-complete-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
    registry = new SubagentRegistry({
      persistPath: testPath,
      maxDepth: 3,
      cleanupIntervalMinutes: 999,
      maxRecords: 100,
    });
  });

  afterEach(() => {
    registry.destroy();
    try { if (existsSync(testPath)) unlinkSync(testPath); } catch {}
  });

  test('does nothing for non-existent runId', async () => {
    await registry.complete('nonexistent', 'ok');
    // Should not throw
  });

  test('records all optional fields', async () => {
    await registry.register({
      runId: 'complete-opts',
      childSessionKey: 'c',
      requesterSessionKey: 'p',
      task: 'Task',
    });
    await registry.start('complete-opts');

    await registry.complete('complete-opts', 'ok', {
      output: 'hello world',
      tokensUsed: 500,
      toolCallsCount: 10,
      error: undefined,
    });

    const record = registry.get('complete-opts');
    expect(record?.outputLength).toBe('hello world'.length);
    expect(record?.tokensUsed).toBe(500);
    expect(record?.toolCallsCount).toBe(10);
    expect(record?.endedAt).toBeGreaterThan(0);
    expect(record?.duration).toBeGreaterThanOrEqual(0);
  });

  test('timeout outcome maps to timeout reason', async () => {
    await registry.register({
      runId: 'timeout-test',
      childSessionKey: 'c',
      requesterSessionKey: 'p',
      task: 'Task',
    });

    await registry.complete('timeout-test', 'timeout');

    const record = registry.get('timeout-test');
    expect(record?.outcome).toBe('timeout');
    expect(record?.endedReason).toBe('timeout');
  });

  test('killed outcome maps to killed reason', async () => {
    await registry.register({
      runId: 'killed-test',
      childSessionKey: 'c',
      requesterSessionKey: 'p',
      task: 'Task',
    });

    await registry.complete('killed-test', 'killed');

    const record = registry.get('killed-test');
    expect(record?.endedReason).toBe('killed');
  });

  test('auto-cleanup after complete with delete policy', async () => {
    await registry.register({
      runId: 'auto-cleanup',
      childSessionKey: 'c',
      requesterSessionKey: 'p',
      task: 'Task',
      cleanup: 'delete',
    });

    await registry.complete('auto-cleanup', 'ok');

    const record = registry.get('auto-cleanup');
    expect(record?.cleanupHandled).toBe(true);
    expect(record?.cleanupCompletedAt).toBeGreaterThan(0);
  });

  test('no auto-cleanup with keep policy', async () => {
    await registry.register({
      runId: 'keep-test',
      childSessionKey: 'c',
      requesterSessionKey: 'p',
      task: 'Task',
      cleanup: 'keep',
    });

    await registry.complete('keep-test', 'ok');

    const record = registry.get('keep-test');
    expect(record?.cleanupHandled).toBe(false);
  });

  test('duration computed from startedAt when available', async () => {
    await registry.register({
      runId: 'dur-test',
      childSessionKey: 'c',
      requesterSessionKey: 'p',
      task: 'Task',
    });
    await registry.start('dur-test');
    // Small delay to get measurable duration
    await new Promise(r => setTimeout(r, 5));
    await registry.complete('dur-test', 'ok');

    const record = registry.get('dur-test');
    expect(record?.duration).toBeGreaterThanOrEqual(0);
  });
});

describe('SubagentRegistry — kill', () => {
  let registry: SubagentRegistry;
  let testPath: string;

  beforeEach(() => {
    testPath = `/tmp/test-kill-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
    registry = new SubagentRegistry({
      persistPath: testPath,
      maxDepth: 3,
      cleanupIntervalMinutes: 999,
      maxRecords: 100,
    });
  });

  afterEach(() => {
    registry.destroy();
    try { if (existsSync(testPath)) unlinkSync(testPath); } catch {}
  });

  test('kills with custom reason', async () => {
    await registry.register({
      runId: 'kill-custom',
      childSessionKey: 'c',
      requesterSessionKey: 'p',
      task: 'Task',
    });

    await registry.kill('kill-custom', 'User cancelled');

    const record = registry.get('kill-custom');
    expect(record?.outcome).toBe('killed');
    expect(record?.error).toBe('User cancelled');
  });

  test('kills with default reason', async () => {
    await registry.register({
      runId: 'kill-default',
      childSessionKey: 'c',
      requesterSessionKey: 'p',
      task: 'Task',
    });

    await registry.kill('kill-default');

    const record = registry.get('kill-default');
    expect(record?.error).toBe('Killed by user');
  });

  test('does nothing for non-existent runId', async () => {
    await registry.kill('nonexistent');
    // Should not throw
  });
});

describe('SubagentRegistry — cleanup', () => {
  let registry: SubagentRegistry;
  let testPath: string;

  beforeEach(() => {
    testPath = `/tmp/test-cleanup-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
    registry = new SubagentRegistry({
      persistPath: testPath,
      maxDepth: 3,
      cleanupIntervalMinutes: 999,
      maxRecords: 100,
    });
  });

  afterEach(() => {
    registry.destroy();
    try { if (existsSync(testPath)) unlinkSync(testPath); } catch {}
  });

  test('does nothing for non-existent runId', async () => {
    await registry.cleanup('nonexistent');
  });

  test('does nothing if already cleaned up', async () => {
    await registry.register({
      runId: 'dup-cleanup',
      childSessionKey: 'c',
      requesterSessionKey: 'p',
      task: 'Task',
    });

    await registry.cleanup('dup-cleanup');
    const firstTime = registry.get('dup-cleanup')?.cleanupCompletedAt;

    await registry.cleanup('dup-cleanup');
    const secondTime = registry.get('dup-cleanup')?.cleanupCompletedAt;

    expect(firstTime).toBe(secondTime); // Not updated on second call
  });
});

describe('SubagentRegistry — query methods', () => {
  let registry: SubagentRegistry;
  let testPath: string;

  beforeEach(() => {
    testPath = `/tmp/test-query-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
    registry = new SubagentRegistry({
      persistPath: testPath,
      maxDepth: 3,
      cleanupIntervalMinutes: 999,
      maxRecords: 100,
    });
  });

  afterEach(() => {
    registry.destroy();
    try { if (existsSync(testPath)) unlinkSync(testPath); } catch {}
  });

  test('get returns undefined for non-existent runId', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  test('getBySessionKey finds by childSessionKey', async () => {
    await registry.register({
      runId: 'session-lookup',
      childSessionKey: 'unique-session',
      requesterSessionKey: 'parent',
      task: 'Task',
    });

    const found = registry.getBySessionKey('unique-session');
    expect(found?.runId).toBe('session-lookup');
  });

  test('getBySessionKey returns undefined when not found', () => {
    expect(registry.getBySessionKey('no-such-session')).toBeUndefined();
  });

  test('getActiveByRequester filters by requester and active status', async () => {
    await registry.register({
      runId: 'active-1',
      childSessionKey: 'c1',
      requesterSessionKey: 'requester-A',
      task: 'Active task 1',
    });
    await registry.register({
      runId: 'active-2',
      childSessionKey: 'c2',
      requesterSessionKey: 'requester-A',
      task: 'Active task 2',
    });
    await registry.register({
      runId: 'active-3',
      childSessionKey: 'c3',
      requesterSessionKey: 'requester-B',
      task: 'Other requester',
    });

    // Complete one of A's runs
    await registry.complete('active-1', 'ok');

    const activeA = registry.getActiveByRequester('requester-A');
    expect(activeA.length).toBe(1);
    expect(activeA[0].runId).toBe('active-2');

    const activeB = registry.getActiveByRequester('requester-B');
    expect(activeB.length).toBe(1);
  });

  test('getRecent returns sorted by createdAt descending', async () => {
    await registry.register({
      runId: 'recent-1',
      childSessionKey: 'c1',
      requesterSessionKey: 'p',
      task: 'First',
    });
    await new Promise(r => setTimeout(r, 5));
    await registry.register({
      runId: 'recent-2',
      childSessionKey: 'c2',
      requesterSessionKey: 'p',
      task: 'Second',
    });

    const recent = registry.getRecent(10);
    expect(recent[0].runId).toBe('recent-2');
    expect(recent[1].runId).toBe('recent-1');
  });

  test('getRecent respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await registry.register({
        runId: `limit-${i}`,
        childSessionKey: `c-${i}`,
        requesterSessionKey: 'p',
        task: `Task ${i}`,
      });
    }

    const recent = registry.getRecent(2);
    expect(recent.length).toBe(2);
  });

  test('getRecent default limit is 20', async () => {
    const recent = registry.getRecent();
    expect(recent).toBeInstanceOf(Array);
  });
});

describe('SubagentRegistry — depth calculation', () => {
  let registry: SubagentRegistry;
  let testPath: string;

  beforeEach(() => {
    testPath = `/tmp/test-depth-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
    registry = new SubagentRegistry({
      persistPath: testPath,
      maxDepth: 5,
      cleanupIntervalMinutes: 999,
      maxRecords: 100,
    });
  });

  afterEach(() => {
    registry.destroy();
    try { if (existsSync(testPath)) unlinkSync(testPath); } catch {}
  });

  test('depth 0 for root session', () => {
    const result = registry.checkDepth('root');
    expect(result.depth).toBe(0);
    expect(result.allowed).toBe(true);
    expect(result.maxDepth).toBe(5);
  });

  test('handles circular references gracefully', async () => {
    // Create a cycle: A -> B -> A
    await registry.register({
      runId: 'cycle-1',
      childSessionKey: 'session-B',
      requesterSessionKey: 'session-A',
      task: 'Task',
    });
    await registry.register({
      runId: 'cycle-2',
      childSessionKey: 'session-A',
      requesterSessionKey: 'session-B',
      task: 'Task',
    });

    // Should not infinite loop
    const result = registry.checkDepth('session-A');
    expect(typeof result.depth).toBe('number');
    expect(result.depth).toBeLessThan(100);
  });
});

describe('SubagentRegistry — stats', () => {
  let registry: SubagentRegistry;
  let testPath: string;

  beforeEach(() => {
    testPath = `/tmp/test-stats-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
    registry = new SubagentRegistry({
      persistPath: testPath,
      maxDepth: 3,
      cleanupIntervalMinutes: 999,
      maxRecords: 100,
    });
  });

  afterEach(() => {
    registry.destroy();
    try { if (existsSync(testPath)) unlinkSync(testPath); } catch {}
  });

  test('avgDuration is 0 when no completed runs', () => {
    const stats = registry.getStats();
    expect(stats.avgDuration).toBe(0);
  });

  test('totalTokens sums all runs including failed', async () => {
    await registry.register({
      runId: 'tokens-1',
      childSessionKey: 'c1',
      requesterSessionKey: 'p',
      task: 'Task',
    });
    await registry.complete('tokens-1', 'ok', { tokensUsed: 100 });

    await registry.register({
      runId: 'tokens-2',
      childSessionKey: 'c2',
      requesterSessionKey: 'p',
      task: 'Task',
    });
    await registry.complete('tokens-2', 'error', { tokensUsed: 50 });

    const stats = registry.getStats();
    expect(stats.totalTokens).toBe(150);
  });

  test('timeout counts as failed', async () => {
    await registry.register({
      runId: 'timeout-stat',
      childSessionKey: 'c',
      requesterSessionKey: 'p',
      task: 'Task',
    });
    await registry.complete('timeout-stat', 'timeout');

    const stats = registry.getStats();
    expect(stats.failedRuns).toBe(1);
  });
});

describe('SubagentRegistry — persistence', () => {
  test('persists and restores records across instances', async () => {
    const testPath = `/tmp/test-persist-${Date.now()}.json`;

    const reg1 = new SubagentRegistry({
      persistPath: testPath,
      maxDepth: 3,
      cleanupIntervalMinutes: 999,
      maxRecords: 100,
    });

    await reg1.register({
      runId: 'persist-1',
      childSessionKey: 'c1',
      requesterSessionKey: 'p1',
      task: 'Persisted task',
    });
    reg1.destroy();

    // New instance should restore the record
    const reg2 = new SubagentRegistry({
      persistPath: testPath,
      maxDepth: 3,
      cleanupIntervalMinutes: 999,
      maxRecords: 100,
    });

    const record = reg2.get('persist-1');
    expect(record).toBeDefined();
    expect(record?.task).toBe('Persisted task');

    reg2.destroy();
    try { unlinkSync(testPath); } catch {}
  });

  test('handles corrupted JSON gracefully', () => {
    const testPath = `/tmp/test-corrupt-${Date.now()}.json`;
    const { writeFileSync: ws } = require('fs');
    const { mkdirSync: md } = require('fs');

    // Write invalid JSON
    ws(testPath, 'not valid json {{{', 'utf-8');

    // Should not throw
    const reg = new SubagentRegistry({
      persistPath: testPath,
      maxDepth: 3,
      cleanupIntervalMinutes: 999,
      maxRecords: 100,
    });

    expect(reg.getStats().totalRuns).toBe(0);
    reg.destroy();
    try { unlinkSync(testPath); } catch {}
  });
});

describe('SubagentRegistry — runCleanup', () => {
  test('removes expired completed records', async () => {
    const testPath = `/tmp/test-rclean-${Date.now()}.json`;
    const reg = new SubagentRegistry({
      persistPath: testPath,
      maxDepth: 3,
      archiveAfterMinutes: 0, // 0 minutes = immediate expiry
      cleanupIntervalMinutes: 999,
      maxRecords: 100,
    });

    await reg.register({
      runId: 'expired-1',
      childSessionKey: 'c1',
      requesterSessionKey: 'p',
      task: 'Old task',
      cleanup: 'delete',
    });
    await reg.complete('expired-1', 'ok');

    // Backdate endedAt to ensure it's before the archive threshold
    const record = reg.get('expired-1');
    if (record) record.endedAt = Date.now() - 10000;

    // Force cleanup by accessing private method
    (reg as any).runCleanup();

    // The expired record should be removed
    expect(reg.get('expired-1')).toBeUndefined();

    reg.destroy();
    try { unlinkSync(testPath); } catch {}
  });

  test('maxRecords overflow removes oldest', async () => {
    const testPath = `/tmp/test-overflow-${Date.now()}.json`;
    const reg = new SubagentRegistry({
      persistPath: testPath,
      maxDepth: 3,
      archiveAfterMinutes: 60,
      cleanupIntervalMinutes: 999,
      maxRecords: 2,
    });

    for (let i = 0; i < 4; i++) {
      await reg.register({
        runId: `overflow-${i}`,
        childSessionKey: `c-${i}`,
        requesterSessionKey: 'p',
        task: `Task ${i}`,
      });
      await new Promise(r => setTimeout(r, 5));
    }

    (reg as any).runCleanup();

    const stats = reg.getStats();
    expect(stats.totalRuns).toBeLessThanOrEqual(2);

    reg.destroy();
    try { unlinkSync(testPath); } catch {}
  });

  test('no-op when nothing to clean', () => {
    const testPath = `/tmp/test-noop-${Date.now()}.json`;
    const reg = new SubagentRegistry({
      persistPath: testPath,
      maxDepth: 3,
      archiveAfterMinutes: 60,
      cleanupIntervalMinutes: 999,
      maxRecords: 100,
    });

    // Should not throw
    (reg as any).runCleanup();

    reg.destroy();
    try { unlinkSync(testPath); } catch {}
  });
});

describe('SubagentRegistry — hooks', () => {
  test('triggerHook calls hookRunner.runParallel', async () => {
    const testPath = `/tmp/test-hooks-${Date.now()}.json`;
    const hookRunner: RegistryHookRunner = {
      runParallel: vi.fn(async () => {}),
    };

    const reg = new SubagentRegistry({
      persistPath: testPath,
      maxDepth: 3,
      cleanupIntervalMinutes: 999,
      maxRecords: 100,
    }, hookRunner);

    await reg.register({
      runId: 'hook-test',
      childSessionKey: 'c',
      requesterSessionKey: 'p',
      task: 'Hook task',
    });

    expect(hookRunner.runParallel).toHaveBeenCalledWith(
      'subagent_spawned',
      expect.objectContaining({ runId: 'hook-test' }),
      expect.objectContaining({ sessionKey: 'c', timestamp: expect.any(String) }),
    );

    await reg.complete('hook-test', 'ok');

    expect(hookRunner.runParallel).toHaveBeenCalledWith(
      'subagent_ended',
      expect.objectContaining({ runId: 'hook-test', outcome: 'ok' }),
      expect.any(Object),
    );

    reg.destroy();
    try { unlinkSync(testPath); } catch {}
  });

  test('hookRunner failure is caught gracefully', async () => {
    const testPath = `/tmp/test-hook-fail-${Date.now()}.json`;
    const hookRunner: RegistryHookRunner = {
      runParallel: vi.fn(async () => { throw new Error('Hook explosion'); }),
    };

    const reg = new SubagentRegistry({
      persistPath: testPath,
      maxDepth: 3,
      cleanupIntervalMinutes: 999,
      maxRecords: 100,
    }, hookRunner);

    // Should not throw
    const record = await reg.register({
      runId: 'hook-fail-test',
      childSessionKey: 'c',
      requesterSessionKey: 'p',
      task: 'Task',
    });

    expect(record.runId).toBe('hook-fail-test');

    reg.destroy();
    try { unlinkSync(testPath); } catch {}
  });
});

describe('SubagentRegistry — clear and destroy', () => {
  test('clear removes all records', async () => {
    const testPath = `/tmp/test-clear-${Date.now()}.json`;
    const reg = new SubagentRegistry({
      persistPath: testPath,
      maxDepth: 3,
      cleanupIntervalMinutes: 999,
      maxRecords: 100,
    });

    await reg.register({
      runId: 'clear-1',
      childSessionKey: 'c1',
      requesterSessionKey: 'p',
      task: 'Task 1',
    });
    await reg.register({
      runId: 'clear-2',
      childSessionKey: 'c2',
      requesterSessionKey: 'p',
      task: 'Task 2',
    });

    expect(reg.getStats().totalRuns).toBe(2);

    reg.clear();

    expect(reg.getStats().totalRuns).toBe(0);
    expect(reg.get('clear-1')).toBeUndefined();

    reg.destroy();
    try { unlinkSync(testPath); } catch {}
  });

  test('stopCleanupTimer stops the interval', () => {
    const testPath = `/tmp/test-timer-${Date.now()}.json`;
    const reg = new SubagentRegistry({
      persistPath: testPath,
      maxDepth: 3,
      cleanupIntervalMinutes: 999,
      maxRecords: 100,
    });

    reg.stopCleanupTimer();
    // Calling twice should not throw
    reg.stopCleanupTimer();

    reg.destroy();
    try { unlinkSync(testPath); } catch {}
  });
});

describe('Singleton — getSubagentRegistry / resetSubagentRegistry', () => {
  afterEach(() => {
    resetSubagentRegistry();
  });

  test('getSubagentRegistry creates singleton on first call', () => {
    const reg = getSubagentRegistry({
      persistPath: `/tmp/test-singleton-${Date.now()}.json`,
      cleanupIntervalMinutes: 999,
    });
    expect(reg).toBeInstanceOf(SubagentRegistry);
  });

  test('getSubagentRegistry returns same instance on subsequent calls', () => {
    const reg1 = getSubagentRegistry({
      persistPath: `/tmp/test-singleton2-${Date.now()}.json`,
      cleanupIntervalMinutes: 999,
    });
    const reg2 = getSubagentRegistry();
    expect(reg2).toBe(reg1);
  });

  test('resetSubagentRegistry destroys and nullifies', () => {
    const reg1 = getSubagentRegistry({
      persistPath: `/tmp/test-reset-${Date.now()}.json`,
      cleanupIntervalMinutes: 999,
    });

    resetSubagentRegistry();

    // Next call creates a new instance
    const reg2 = getSubagentRegistry({
      persistPath: `/tmp/test-reset2-${Date.now()}.json`,
      cleanupIntervalMinutes: 999,
    });
    expect(reg2).not.toBe(reg1);
  });
});
