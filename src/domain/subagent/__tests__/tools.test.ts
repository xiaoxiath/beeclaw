/**
 * Subagent Tools Tests
 *
 * Unit tests for subagent tool formatters and state tool formatters.
 *
 * Note: Tests for the old individual tool definition objects (spawnSubagentTool,
 * spawnParallelTool, stateSetTool, etc.) have been removed. Tool definitions
 * now live in builtin.ts (spawnSubagentToolDef / spawnParallelToolDef) and
 * state-tools-consolidated.ts respectively.
 */

import { describe, test, expect, vi } from 'vitest';
import {
  formatSubagentResult,
  formatParallelResults,
} from '../tools';
import type { SubagentResult } from '../types';
import {
  formatStateEntry,
  formatStateStats,
} from '../state-tools-consolidated';
import type { StateEntry, StateStats } from '../state';

describe('Subagent Tools', () => {
  describe('formatSubagentResult', () => {
    test('should format successful result', () => {
      const result: SubagentResult = {
        success: true,
        output: 'Test output',
        tokensUsed: 100,
        duration: 1500,
        id: 'test-id',
      };

      const formatted = formatSubagentResult(result, 'Test task');

      expect(formatted).toContain('## Subagent Result');
      expect(formatted).toContain('✅ Success');
      expect(formatted).toContain('1500ms');
      expect(formatted).toContain('100');
      expect(formatted).toContain('Test output');
    });

    test('should format failed result', () => {
      const result: SubagentResult = {
        success: false,
        output: '',
        tokensUsed: 0,
        duration: 500,
        id: 'test-id',
        error: 'Test error',
      };

      const formatted = formatSubagentResult(result, 'Test task');

      expect(formatted).toContain('❌ Failed');
      expect(formatted).toContain('Test error');
    });

    test('should truncate long task description', () => {
      const longTask = 'A'.repeat(200);
      const result: SubagentResult = {
        success: true,
        output: 'Output',
        tokensUsed: 0,
        duration: 100,
        id: 'test-id',
      };

      const formatted = formatSubagentResult(result, longTask);

      expect(formatted).toContain('AAA...');
      expect(formatted.length).toBeLessThan(longTask.length + 500);
    });

    test('should not show tokens if zero', () => {
      const result: SubagentResult = {
        success: true,
        output: 'Output',
        tokensUsed: 0,
        duration: 100,
        id: 'test-id',
      };

      const formatted = formatSubagentResult(result, 'Task');

      expect(formatted).not.toContain('Tokens Used');
    });
  });

  describe('formatParallelResults', () => {
    test('should format multiple results', () => {
      const results: SubagentResult[] = [
        { success: true, output: 'Result 1', tokensUsed: 50, duration: 1000, id: 'id1' },
        { success: true, output: 'Result 2', tokensUsed: 75, duration: 1200, id: 'id2' },
        { success: false, output: '', tokensUsed: 0, duration: 800, id: 'id3', error: 'Failed' },
      ];

      const descriptions = ['Task 1', 'Task 2', 'Task 3'];
      const formatted = formatParallelResults(results, descriptions);

      expect(formatted).toContain('## Parallel Execution Results');
      expect(formatted).toContain('2/3 tasks');
      expect(formatted).toContain('1200ms (parallel)');
      expect(formatted).toContain('Task 1');
      expect(formatted).toContain('Result 1');
      expect(formatted).toContain('Failed');
    });

    test('should show max duration', () => {
      const results: SubagentResult[] = [
        { success: true, output: 'R1', tokensUsed: 0, duration: 1000, id: 'id1' },
        { success: true, output: 'R2', tokensUsed: 0, duration: 3000, id: 'id2' },
        { success: true, output: 'R3', tokensUsed: 0, duration: 2000, id: 'id3' },
      ];

      const formatted = formatParallelResults(results, ['T1', 'T2', 'T3']);

      expect(formatted).toContain('3000ms (parallel)');
    });

    test('should handle empty results', () => {
      const formatted = formatParallelResults([], []);

      expect(formatted).toContain('0/0 tasks');
    });
  });
});

describe('State Tools Formatters', () => {
  describe('formatStateEntry', () => {
    test('should format entry with metadata', () => {
      const entry: StateEntry = {
        value: 'test value',
        createdAt: new Date('2026-02-28T10:00:00Z'),
        updatedAt: new Date('2026-02-28T10:00:00Z'),
        metadata: { source: 'test' },
      };

      const formatted = formatStateEntry('test-key', entry);

      expect(formatted).toContain('**Key**: test-key');
      expect(formatted).toContain('**Metadata**');
      expect(formatted).toContain('test value');
    });

    test('should format entry with TTL', () => {
      const entry: StateEntry = {
        value: 'test',
        createdAt: new Date(),
        updatedAt: new Date(),
        ttl: 3600000,
        expiresAt: new Date(Date.now() + 3600000),
      };

      const formatted = formatStateEntry('key', entry);

      expect(formatted).toContain('**TTL**');
      expect(formatted).toContain('**Expires**');
    });

    test('should format complex values as JSON', () => {
      const entry: StateEntry = {
        value: { nested: { data: [1, 2, 3] } },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const formatted = formatStateEntry('complex', entry);

      expect(formatted).toContain('```json');
      expect(formatted).toContain('nested');
    });

    test('should not show metadata if empty', () => {
      const entry: StateEntry = {
        value: 'test',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const formatted = formatStateEntry('key', entry);

      expect(formatted).not.toContain('**Metadata**');
    });
  });

  describe('formatStateStats', () => {
    test('should format statistics', () => {
      const stats: StateStats = {
        totalEntries: 10,
        lockedKeys: 2,
        activeSubscriptions: 5,
        expiredEntries: 3,
        estimatedMemoryUsage: 4096,
      };

      const formatted = formatStateStats(stats);

      expect(formatted).toContain('## Shared State Statistics');
      expect(formatted).toContain('**Total Entries**: 10');
      expect(formatted).toContain('**Locked Keys**: 2');
      expect(formatted).toContain('**Active Subscriptions**: 5');
      expect(formatted).toContain('**Expired Entries**: 3');
      expect(formatted).toContain('**Estimated Memory**:');
      expect(formatted).toContain('KB');
    });

    test('should format memory in KB', () => {
      const stats: StateStats = {
        totalEntries: 0,
        lockedKeys: 0,
        activeSubscriptions: 0,
        expiredEntries: 0,
        estimatedMemoryUsage: 2048, // 2 KB
      };

      const formatted = formatStateStats(stats);

      expect(formatted).toContain('2.00 KB');
    });
  });
});
