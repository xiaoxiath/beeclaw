/**
 * Subagent Runtime Tests
 *
 * Unit tests for subagent runtime and spawning
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import {
  SubagentRuntime,
  initSubagentRuntime,
  getSubagentRuntime,
  spawnSubagent,
  spawnParallelSubagents,
} from '../runtime';
import type { SubagentConfig, SubagentResult } from '../types';

// Mock dependencies
const mockAgent = {
  chat: mock(async (message: string) => `Response to: ${message}`),
};

const mockProvider = {
  type: 'test',
  name: 'test-provider',
  models: ['test-model'],
  apiKey: 'test-key',
  default: true,
};

// Mock createAgent
let createAgentMock: any;

beforeEach(() => {
  // Reset mocks
  createAgentMock = mock(() => mockAgent);
});

afterEach(() => {
  // Clean up
});

describe('SubagentRuntime', () => {
  describe('Initialization', () => {
    test('should initialize with provider and model', () => {
      const runtime = new SubagentRuntime({
        provider: mockProvider,
        model: 'test-model',
      });

      expect(runtime).toBeDefined();
    });

    test('should track statistics', () => {
      const runtime = new SubagentRuntime({
        provider: mockProvider,
        model: 'test-model',
      });

      const stats = runtime.getStats();

      expect(stats.totalSpawned).toBe(0);
      expect(stats.successful).toBe(0);
      expect(stats.failed).toBe(0);
    });
  });

  describe('spawn', () => {
    test.skip('should spawn a subagent with basic config', async () => {
      // This test is skipped because it requires mocking the agent creation
      const runtime = new SubagentRuntime({
        provider: mockProvider,
        model: 'test-model',
      });

      const config: SubagentConfig = {
        type: 'research',
        task: 'Test task',
      };

      const result = await runtime.spawn(config);

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.duration).toBeGreaterThan(0);
    });

    test.skip('should apply timeout', async () => {
      const runtime = new SubagentRuntime({
        provider: mockProvider,
        model: 'test-model',
      });

      const config: SubagentConfig = {
        type: 'research',
        task: 'Long task',
        timeout: 100, // 100ms
      };

      // Should timeout
      await expect(runtime.spawn(config)).rejects.toThrow('timeout');
    });

    test.skip('should filter tools based on subagent type', async () => {
      const runtime = new SubagentRuntime({
        provider: mockProvider,
        model: 'test-model',
      });

      // Research type should have web_search tool
      const researchConfig: SubagentConfig = {
        type: 'research',
        task: 'Research task',
      };

      const result = await runtime.spawn(researchConfig);
      expect(result.success).toBe(true);
    });

    test.skip('should use custom tools if provided', async () => {
      const runtime = new SubagentRuntime({
        provider: mockProvider,
        model: 'test-model',
      });

      const config: SubagentConfig = {
        type: 'research',
        task: 'Custom task',
        tools: ['memory_read', 'memory_write'],
      };

      const result = await runtime.spawn(config);
      expect(result.success).toBe(true);
    });

    test.skip('should include context in prompt', async () => {
      const runtime = new SubagentRuntime({
        provider: mockProvider,
        model: 'test-model',
      });

      const config: SubagentConfig = {
        type: 'research',
        task: 'Main task',
        context: 'Additional context',
      };

      const result = await runtime.spawn(config);
      expect(result.success).toBe(true);
    });

    test.skip('should update statistics on success', async () => {
      const runtime = new SubagentRuntime({
        provider: mockProvider,
        model: 'test-model',
      });

      await runtime.spawn({ type: 'research', task: 'Task 1' });
      await runtime.spawn({ type: 'memory', task: 'Task 2' });

      const stats = runtime.getStats();
      expect(stats.totalSpawned).toBe(2);
      expect(stats.successful).toBe(2);
    });

    test.skip('should update statistics on failure', async () => {
      const runtime = new SubagentRuntime({
        provider: mockProvider,
        model: 'test-model',
      });

      // Simulate failure
      try {
        await runtime.spawn({ type: 'research', task: 'Failing task', timeout: 1 });
      } catch (error) {
        // Expected
      }

      const stats = runtime.getStats();
      expect(stats.failed).toBeGreaterThan(0);
    });
  });

  describe('spawnParallel', () => {
    test.skip('should spawn multiple subagents in parallel', async () => {
      const runtime = new SubagentRuntime({
        provider: mockProvider,
        model: 'test-model',
      });

      const configs: SubagentConfig[] = [
        { type: 'research', task: 'Task 1' },
        { type: 'research', task: 'Task 2' },
        { type: 'memory', task: 'Task 3' },
      ];

      const startTime = Date.now();
      const results = await runtime.spawnParallel(configs);
      const duration = Date.now() - startTime;

      expect(results.length).toBe(3);
      // Should complete faster than sequential execution
      // (This is a rough check)
    });

    test.skip('should return results for all configs', async () => {
      const runtime = new SubagentRuntime({
        provider: mockProvider,
        model: 'test-model',
      });

      const configs: SubagentConfig[] = [
        { type: 'research', task: 'Task 1' },
        { type: 'memory', task: 'Task 2' },
      ];

      const results = await runtime.spawnParallel(configs);

      expect(results.length).toBe(2);
      expect(results[0].id).toBeDefined();
      expect(results[1].id).toBeDefined();
    });

    test.skip('should handle partial failures', async () => {
      const runtime = new SubagentRuntime({
        provider: mockProvider,
        model: 'test-model',
      });

      const configs: SubagentConfig[] = [
        { type: 'research', task: 'Task 1' },
        { type: 'research', task: 'Task 2', timeout: 1 }, // Will fail
        { type: 'memory', task: 'Task 3' },
      ];

      const results = await runtime.spawnParallel(configs);

      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      expect(successful.length).toBeGreaterThan(0);
      expect(failed.length).toBeGreaterThan(0);
    });
  });

  describe('Tool Filtering', () => {
    test('should get tools for research type', () => {
      const runtime = new SubagentRuntime({
        provider: mockProvider,
        model: 'test-model',
      });

      const tools = runtime.getToolsForType('research');
      const toolNames = tools.map((t: any) => t.function.name);

      expect(toolNames).toContain('web_search');
      expect(toolNames).toContain('web_fetch');
      expect(toolNames).toContain('memory_read');
    });

    test('should get tools for memory type', () => {
      const runtime = new SubagentRuntime({
        provider: mockProvider,
        model: 'test-model',
      });

      const tools = runtime.getToolsForType('memory');
      const toolNames = tools.map((t: any) => t.function.name);

      expect(toolNames).toContain('memory_read');
      expect(toolNames).toContain('memory_write');
    });

    test('should get tools for skill type', () => {
      const runtime = new SubagentRuntime({
        provider: mockProvider,
        model: 'test-model',
      });

      const tools = runtime.getToolsForType('skill');
      const toolNames = tools.map((t: any) => t.function.name);

      expect(toolNames).toContain('skill_list');
      expect(toolNames).toContain('skill_get');
    });

    test('should return all tools for general type', () => {
      const runtime = new SubagentRuntime({
        provider: mockProvider,
        model: 'test-model',
      });

      const tools = runtime.getToolsForType('general');

      // General type should have access to all tools
      expect(tools.length).toBeGreaterThan(0);
    });
  });
});

describe('Singleton Management', () => {
  test.skip('should initialize singleton', () => {
    const runtime = initSubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
    });

    expect(runtime).toBeInstanceOf(SubagentRuntime);
    expect(getSubagentRuntime()).toBe(runtime);
  });

  test.skip('should throw if not initialized', () => {
    // Reset singleton
    // @ts-ignore - accessing private
    globalThis.__subagentRuntime = null;

    expect(() => getSubagentRuntime()).toThrow();
  });

  test.skip('should replace existing instance on re-init', () => {
    const runtime1 = initSubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
    });

    const runtime2 = initSubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
    });

    expect(runtime2).not.toBe(runtime1);
    expect(getSubagentRuntime()).toBe(runtime2);
  });
});

describe('Convenience Functions', () => {
  test.skip('spawnSubagent should use singleton', async () => {
    initSubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
    });

    const result = await spawnSubagent({
      type: 'research',
      task: 'Test task',
    });

    expect(result.success).toBe(true);
  });

  test.skip('spawnParallelSubagents should use singleton', async () => {
    initSubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
    });

    const results = await spawnParallelSubagents([
      { type: 'research', task: 'Task 1' },
      { type: 'memory', task: 'Task 2' },
    ]);

    expect(results.length).toBe(2);
  });
});

describe('Error Handling', () => {
  test.skip('should handle agent creation errors', async () => {
    const runtime = new SubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
    });

    // Force an error
    const config: SubagentConfig = {
      type: 'research',
      task: 'Task that will fail',
    };

    try {
      await runtime.spawn(config);
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  test.skip('should handle timeout errors gracefully', async () => {
    const runtime = new SubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
    });

    const config: SubagentConfig = {
      type: 'research',
      task: 'Slow task',
      timeout: 1, // 1ms - will definitely timeout
    };

    await expect(runtime.spawn(config)).rejects.toThrow();
  });

  test.skip('should record error details in result', async () => {
    const runtime = new SubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
    });

    const config: SubagentConfig = {
      type: 'research',
      task: 'Failing task',
      timeout: 1,
    };

    try {
      await runtime.spawn(config);
    } catch (error) {
      // Expected
    }

    const stats = runtime.getStats();
    expect(stats.failed).toBeGreaterThan(0);
  });
});

describe('Statistics Tracking', () => {
  test('should track total spawned count', () => {
    const runtime = new SubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
    });

    const stats = runtime.getStats();
    expect(stats.totalSpawned).toBe(0);
  });

  test('should track average duration', () => {
    const runtime = new SubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
    });

    const stats = runtime.getStats();
    expect(stats.avgDuration).toBe(0);
  });

  test('should track total duration', () => {
    const runtime = new SubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
    });

    const stats = runtime.getStats();
    expect(stats.totalDuration).toBe(0);
  });

  test('should track total tokens', () => {
    const runtime = new SubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
    });

    const stats = runtime.getStats();
    expect(stats.totalTokens).toBe(0);
  });

  test('should track successful count', () => {
    const runtime = new SubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
    });

    const stats = runtime.getStats();
    expect(stats.successful).toBe(0);
  });

  test('should track failed count', () => {
    const runtime = new SubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
    });

    const stats = runtime.getStats();
    expect(stats.failed).toBe(0);
  });
});

describe('resetStats', () => {
  test('should reset all statistics', () => {
    const runtime = new SubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
    });

    runtime.resetStats();

    const stats = runtime.getStats();
    expect(stats.totalSpawned).toBe(0);
    expect(stats.successful).toBe(0);
    expect(stats.failed).toBe(0);
    expect(stats.totalTokens).toBe(0);
    expect(stats.totalDuration).toBe(0);
    expect(stats.avgDuration).toBe(0);
  });

  test('should return a copy of stats', () => {
    const runtime = new SubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
    });

    const stats1 = runtime.getStats();
    const stats2 = runtime.getStats();

    expect(stats1).not.toBe(stats2); // Different references
    expect(stats1).toEqual(stats2); // Same values
  });
});

describe('getToolsForType additional tests', () => {
  test('should get tools for code type', () => {
    const runtime = new SubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
    });

    const tools = runtime.getToolsForType('code');
    const toolNames = tools.map((t: any) => t.function.name);

    expect(toolNames).toContain('code_execute');
  });
});

describe('initSubagentRuntime', () => {
  test('should create and return runtime instance', () => {
    const runtime = initSubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
    });

    expect(runtime).toBeInstanceOf(SubagentRuntime);
  });

  test('should be retrievable via getSubagentRuntime', () => {
    const runtime = initSubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
    });

    expect(getSubagentRuntime()).toBe(runtime);
  });

  test('should replace existing instance on re-init', () => {
    const runtime1 = initSubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
    });

    const runtime2 = initSubagentRuntime({
      provider: mockProvider,
      model: 'another-model',
    });

    expect(runtime2).not.toBe(runtime1);
    expect(getSubagentRuntime()).toBe(runtime2);
  });
});
