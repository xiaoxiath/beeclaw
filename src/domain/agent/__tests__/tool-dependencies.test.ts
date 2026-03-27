import { describe, test, expect, vi } from 'vitest';
import {
  groupToolCalls,
  getGroupingStats,
  isParallelTool,
  getToolDependency,
  hasSideEffects,
} from '../tool-dependencies';

describe('Tool Dependencies', () => {
  describe('getToolDependency', () => {
    test('returns parallel config for read-only tools', () => {
      expect(getToolDependency('memory_read').mode).toBe('parallel');
      expect(getToolDependency('memory_ls').mode).toBe('parallel');
      expect(getToolDependency('skill_list').mode).toBe('parallel');
      expect(getToolDependency('goal_get').mode).toBe('parallel');
      expect(getToolDependency('web_search').mode).toBe('parallel');
    });

    test('returns sequential config for write tools', () => {
      expect(getToolDependency('memory_write').mode).toBe('sequential');
      expect(getToolDependency('skill_ensure').mode).toBe('sequential');
      expect(getToolDependency('goal_update').mode).toBe('sequential');
    });

    test('returns default parallel for unknown tools', () => {
      expect(getToolDependency('unknown_tool').mode).toBe('parallel');
    });
  });

  describe('isParallelTool', () => {
    test('returns true for parallel tools', () => {
      expect(isParallelTool('memory_read')).toBe(true);
      expect(isParallelTool('web_search')).toBe(true);
    });

    test('returns false for sequential tools', () => {
      expect(isParallelTool('memory_write')).toBe(false);
      expect(isParallelTool('skill_ensure')).toBe(false);
    });
  });

  describe('hasSideEffects', () => {
    test('returns false for read-only tools', () => {
      expect(hasSideEffects('memory_read')).toBe(false);
      expect(hasSideEffects('skill_list')).toBe(false);
    });

    test('returns true for write tools', () => {
      expect(hasSideEffects('memory_write')).toBe(true);
      expect(hasSideEffects('skill_ensure')).toBe(true);
    });
  });

  describe('groupToolCalls', () => {
    test('groups single call into single batch', () => {
      const calls = [{ name: 'memory_read' }];
      const batches = groupToolCalls(calls);
      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(1);
    });

    test('groups multiple parallel calls into single batch', () => {
      const calls = [
        { name: 'memory_read' },
        { name: 'skill_list' },
        { name: 'goal_get' },
      ];
      const batches = groupToolCalls(calls);
      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(3);
    });

    test('separates sequential tools into their own batches', () => {
      const calls = [
        { name: 'memory_read' },
        { name: 'memory_write' },
        { name: 'skill_list' },
      ];
      const batches = groupToolCalls(calls);

      // Should be: [memory_read], [memory_write], [skill_list]
      expect(batches).toHaveLength(3);
      expect(batches[0]).toHaveLength(1);
      expect(batches[0][0].name).toBe('memory_read');
      expect(batches[1]).toHaveLength(1);
      expect(batches[1][0].name).toBe('memory_write');
      expect(batches[2]).toHaveLength(1);
      expect(batches[2][0].name).toBe('skill_list');
    });

    test('groups parallel tools between sequential ones', () => {
      const calls = [
        { name: 'memory_read' },
        { name: 'skill_list' },
        { name: 'goal_get' },
        { name: 'memory_write' },
        { name: 'skill_ensure' },
      ];
      const batches = groupToolCalls(calls);

      // Should be: [memory_read, skill_list, goal_get], [memory_write], [skill_ensure]
      expect(batches).toHaveLength(3);
      expect(batches[0]).toHaveLength(3); // parallel batch
      expect(batches[1]).toHaveLength(1); // memory_write
      expect(batches[2]).toHaveLength(1); // skill_ensure
    });

    test('handles all sequential tools', () => {
      const calls = [
        { name: 'memory_write' },
        { name: 'skill_ensure' },
        { name: 'goal_update' },
      ];
      const batches = groupToolCalls(calls);

      // Each sequential tool gets its own batch
      expect(batches).toHaveLength(3);
      expect(batches.every(b => b.length === 1)).toBe(true);
    });

    test('handles empty array', () => {
      const batches = groupToolCalls([]);
      expect(batches).toHaveLength(0);
    });
  });

  describe('getGroupingStats', () => {
    test('calculates correct stats for mixed calls', () => {
      const calls = [
        { name: 'memory_read' },
        { name: 'skill_list' },
        { name: 'memory_write' },
        { name: 'goal_create' },
      ];
      const stats = getGroupingStats(calls);

      expect(stats.totalCalls).toBe(4);
      expect(stats.parallelBatches).toBe(1); // memory_read + skill_list
      expect(stats.sequentialBatches).toBe(2); // memory_write + goal_create
      expect(stats.maxParallelism).toBe(2);
    });

    test('calculates max parallelism correctly', () => {
      const calls = [
        { name: 'memory_read' },
        { name: 'skill_list' },
        { name: 'goal_get' },
        { name: 'web_search' },
        { name: 'memory_write' },
      ];
      const stats = getGroupingStats(calls);

      expect(stats.maxParallelism).toBe(4);
    });
  });
});
