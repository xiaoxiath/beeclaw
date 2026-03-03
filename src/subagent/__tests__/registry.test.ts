// Subagent Registry Tests

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
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
