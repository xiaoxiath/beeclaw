/**
 * Subagent Tools Tests
 *
 * Unit tests for subagent tool definitions and state tools
 */

import { describe, test, expect } from 'bun:test';
import {
  spawnSubagentTool,
  spawnParallelTool,
  formatSubagentResult,
  formatParallelResults,
} from '../tools';
import type { SubagentResult } from '../types';
import {
  stateSetTool,
  stateGetTool,
  stateDeleteTool,
  stateUpdateTool,
  stateExistsTool,
  stateListTool,
  stateStatsTool,
  stateLockTool,
  stateUnlockTool,
  formatStateEntry,
  formatStateStats,
} from '../state-tools';
import type { StateEntry, StateStats } from '../state';

describe('Subagent Tools', () => {
  describe('spawn_subagent tool', () => {
    test('should have correct name', () => {
      expect(spawnSubagentTool.name).toBe('spawn_subagent');
    });

    test('should have description', () => {
      expect(spawnSubagentTool.description).toContain('specialized subagent');
    });

    test('should require type and task parameters', () => {
      const params = spawnSubagentTool.parameters;
      expect(params.required).toContain('type');
      expect(params.required).toContain('task');
    });

    test('should accept all subagent types', () => {
      const typeProperty = spawnSubagentTool.parameters.properties.type as any;
      expect(typeProperty.enum).toContain('research');
      expect(typeProperty.enum).toContain('memory');
      expect(typeProperty.enum).toContain('skill');
      expect(typeProperty.enum).toContain('code');
      expect(typeProperty.enum).toContain('general');
    });

    test('should have optional parameters', () => {
      const props = spawnSubagentTool.parameters.properties;
      expect(props.context).toBeDefined();
      expect(props.timeout).toBeDefined();
      expect(props.maxTokens).toBeDefined();
    });
  });

  describe('spawn_parallel tool', () => {
    test('should have correct name', () => {
      expect(spawnParallelTool.name).toBe('spawn_parallel');
    });

    test('should have description', () => {
      expect(spawnParallelTool.description).toContain('parallel');
    });

    test('should require tasks parameter', () => {
      const params = spawnParallelTool.parameters;
      expect(params.required).toContain('tasks');
    });

    test('should accept maxParallelism parameter', () => {
      const props = spawnParallelTool.parameters.properties;
      expect(props.maxParallelism).toBeDefined();
    });
  });

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

describe('State Tools', () => {
  describe('state_set tool', () => {
    test('should have correct name', () => {
      expect(stateSetTool.name).toBe('state_set');
    });

    test('should require key and value', () => {
      const params = stateSetTool.parameters;
      expect(params.required).toContain('key');
      expect(params.required).toContain('value');
    });

    test('should have optional ttl and metadata', () => {
      const props = stateSetTool.parameters.properties;
      expect(props.ttl).toBeDefined();
      expect(props.metadata).toBeDefined();
    });
  });

  describe('state_get tool', () => {
    test('should have correct name', () => {
      expect(stateGetTool.name).toBe('state_get');
    });

    test('should require key', () => {
      const params = stateGetTool.parameters;
      expect(params.required).toContain('key');
    });
  });

  describe('state_delete tool', () => {
    test('should have correct name', () => {
      expect(stateDeleteTool.name).toBe('state_delete');
    });

    test('should require key', () => {
      const params = stateDeleteTool.parameters;
      expect(params.required).toContain('key');
    });
  });

  describe('state_update tool', () => {
    test('should have correct name', () => {
      expect(stateUpdateTool.name).toBe('state_update');
    });

    test('should require key and operation', () => {
      const params = stateUpdateTool.parameters;
      expect(params.required).toContain('key');
      expect(params.required).toContain('operation');
    });

    test('should accept all operations', () => {
      const opProperty = stateUpdateTool.parameters.properties.operation as any;
      expect(opProperty.enum).toContain('increment');
      expect(opProperty.enum).toContain('decrement');
      expect(opProperty.enum).toContain('append');
      expect(opProperty.enum).toContain('prepend');
      expect(opProperty.enum).toContain('merge');
      expect(opProperty.enum).toContain('replace');
    });
  });

  describe('state_exists tool', () => {
    test('should have correct name', () => {
      expect(stateExistsTool.name).toBe('state_exists');
    });

    test('should require key', () => {
      const params = stateExistsTool.parameters;
      expect(params.required).toContain('key');
    });
  });

  describe('state_list tool', () => {
    test('should have correct name', () => {
      expect(stateListTool.name).toBe('state_list');
    });

    test('should have optional prefix filter', () => {
      const props = stateListTool.parameters.properties;
      expect(props.prefix).toBeDefined();
      expect(stateListTool.parameters.required).not.toContain('prefix');
    });
  });

  describe('state_stats tool', () => {
    test('should have correct name', () => {
      expect(stateStatsTool.name).toBe('state_stats');
    });

    test('should have no required parameters', () => {
      const params = stateStatsTool.parameters;
      expect(params.required).toHaveLength(0);
    });
  });

  describe('state_lock tool', () => {
    test('should have correct name', () => {
      expect(stateLockTool.name).toBe('state_lock');
    });

    test('should require key', () => {
      const params = stateLockTool.parameters;
      expect(params.required).toContain('key');
    });

    test('should have optional owner and timeout', () => {
      const props = stateLockTool.parameters.properties;
      expect(props.owner).toBeDefined();
      expect(props.timeout).toBeDefined();
    });
  });

  describe('state_unlock tool', () => {
    test('should have correct name', () => {
      expect(stateUnlockTool.name).toBe('state_unlock');
    });

    test('should require key', () => {
      const params = stateUnlockTool.parameters;
      expect(params.required).toContain('key');
    });
  });

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

describe('Tool Parameter Validation', () => {
  test('all tools should have name property', () => {
    const tools = [
      spawnSubagentTool,
      spawnParallelTool,
      stateSetTool,
      stateGetTool,
      stateDeleteTool,
      stateUpdateTool,
      stateExistsTool,
      stateListTool,
      stateStatsTool,
      stateLockTool,
      stateUnlockTool,
    ];

    for (const tool of tools) {
      expect(tool.name).toBeDefined();
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);
    }
  });

  test('all tools should have description', () => {
    const tools = [
      spawnSubagentTool,
      spawnParallelTool,
      stateSetTool,
      stateGetTool,
      stateDeleteTool,
      stateUpdateTool,
      stateExistsTool,
      stateListTool,
      stateStatsTool,
      stateLockTool,
      stateUnlockTool,
    ];

    for (const tool of tools) {
      expect(tool.description).toBeDefined();
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  test('all tools should have parameters object', () => {
    const tools = [
      spawnSubagentTool,
      spawnParallelTool,
      stateSetTool,
      stateGetTool,
      stateDeleteTool,
      stateUpdateTool,
      stateExistsTool,
      stateListTool,
      stateStatsTool,
      stateLockTool,
      stateUnlockTool,
    ];

    for (const tool of tools) {
      expect(tool.parameters).toBeDefined();
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.properties).toBeDefined();
    }
  });

  test('tools with required params should have array', () => {
    const toolsWithRequired = [
      spawnSubagentTool,
      spawnParallelTool,
      stateSetTool,
      stateGetTool,
      stateDeleteTool,
      stateUpdateTool,
      stateExistsTool,
      stateLockTool,
      stateUnlockTool,
    ];

    for (const tool of toolsWithRequired) {
      if (tool.parameters.required) {
        expect(Array.isArray(tool.parameters.required)).toBe(true);
      }
    }
  });
});
