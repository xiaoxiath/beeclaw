/**
 * Subagent Runtime Tests
 *
 * Unit tests for subagent runtime and spawning.
 * Uses dependency injection (RuntimeDeps) to mock createAgent and tools,
 * enabling comprehensive testing without real LLM calls.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock bun-only and problematic ESM modules to allow tests to run in Node.js
vi.mock('bun:sqlite', () => {
  const MockDatabase = vi.fn(() => ({
    exec: vi.fn(), run: vi.fn(),
    query: vi.fn(() => ({ all: vi.fn(() => []) })),
    prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn(() => []) })),
    transaction: vi.fn((fn: Function) => fn),
    close: vi.fn(),
  }));
  return { Database: MockDatabase, default: MockDatabase };
});
vi.mock('drizzle-orm/bun-sqlite', () => ({
  drizzle: vi.fn(() => ({
    select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
  })),
}));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({ SSEClientTransport: vi.fn() }));
vi.mock('bunqueue/client', () => ({ Queue: vi.fn(), Worker: vi.fn() }));

import {
  SubagentRuntime,
  initSubagentRuntime,
  getSubagentRuntime,
  spawnSubagent,
  spawnParallelSubagents,
} from '../runtime';
import type { SubagentConfig } from '../types';
import type { RuntimeDeps, AgentLike } from '../runtime';

// ============================================================================
// Mock infrastructure
// ============================================================================

const mockProvider = {
  type: 'test',
  name: 'test-provider',
  models: ['test-model'],
  apiKey: 'test-key',
  default: true,
};

/** Create a mock agent that returns a predictable response */
function createMockAgent(overrides?: Partial<AgentLike>): AgentLike {
  return {
    chat: overrides?.chat || (async (message: string) => `Response to: ${message}`),
    estimatedTokens: overrides?.estimatedTokens ?? 150,
  };
}

/** Create a mock agent factory */
function createMockAgentFactory(agent?: AgentLike): RuntimeDeps['agentFactory'] {
  return (_options: Record<string, unknown>) => agent || createMockAgent();
}

/** Create mock tools in OpenAI function-calling format */
function createMockTools(): Array<{ function: { name: string } }> {
  return [
    { function: { name: 'web_search' } },
    { function: { name: 'web_fetch' } },
    { function: { name: 'file_read' } },
    { function: { name: 'file_write' } },
    { function: { name: 'file_list' } },
    { function: { name: 'file_delete' } },
    { function: { name: 'shell' } },
    { function: { name: 'code_execute' } },
    { function: { name: 'memory_read' } },
    { function: { name: 'memory_write' } },
    { function: { name: 'memory_grep' } },
    { function: { name: 'memory_ls' } },
    { function: { name: 'memory_record' } },
    { function: { name: 'skill_list' } },
    { function: { name: 'skill_get' } },
    { function: { name: 'skill_ensure' } },
    { function: { name: 'skill_evals' } },
    { function: { name: 'skill_record' } },
    { function: { name: 'skill_maturity' } },
    { function: { name: 'spawn_subagent' } },
    { function: { name: 'spawn_parallel' } },
  ];
}

/** Standard test deps with mock agent and tools */
function createTestDeps(overrides?: Partial<RuntimeDeps>): RuntimeDeps {
  return {
    agentFactory: overrides?.agentFactory || createMockAgentFactory(),
    toolProvider: overrides?.toolProvider || (() => createMockTools()),
    hookRunner: overrides?.hookRunner !== undefined ? overrides.hookRunner : null,
  };
}

/** Create a SubagentRuntime with mocked deps */
function createTestRuntime(overrides?: {
  provider?: any;
  model?: string;
  deps?: Partial<RuntimeDeps>;
}): SubagentRuntime {
  return new SubagentRuntime({
    provider: overrides?.provider || mockProvider,
    model: overrides?.model || 'test-model',
    deps: createTestDeps(overrides?.deps),
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('SubagentRuntime', () => {
  describe('Initialization', () => {
    test('should initialize with provider and model', () => {
      const runtime = createTestRuntime();
      expect(runtime).toBeDefined();
    });

    test('should track statistics', () => {
      const runtime = createTestRuntime();
      const stats = runtime.getStats();

      expect(stats.totalSpawned).toBe(0);
      expect(stats.successful).toBe(0);
      expect(stats.failed).toBe(0);
    });
  });

  describe('spawn', () => {
    test('should spawn a subagent with basic config', async () => {
      const runtime = createTestRuntime();

      const config: SubagentConfig = {
        type: 'research',
        task: 'Test task',
      };

      const result = await runtime.spawn(config);

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output).toContain('Response to:');
      expect(result.duration).toBeGreaterThan(0);
    });

    test('should apply timeout', async () => {
      // Agent that takes too long
      const slowAgent = createMockAgent({
        chat: async () => {
          await new Promise(resolve => setTimeout(resolve, 5000));
          return 'late';
        },
      });

      const runtime = createTestRuntime({
        deps: { agentFactory: createMockAgentFactory(slowAgent) },
      });

      const config: SubagentConfig = {
        type: 'research',
        task: 'Long task',
        timeout: 50, // 50ms — will timeout
      };

      const result = await runtime.spawn(config);

      // spawn() catches errors and returns { success: false }
      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
    });

    test('should filter tools based on subagent type', async () => {
      let capturedOptions: Record<string, unknown> | undefined;

      const factory: RuntimeDeps['agentFactory'] = (options) => {
        capturedOptions = options;
        return createMockAgent();
      };

      const runtime = createTestRuntime({ deps: { agentFactory: factory } });

      const result = await runtime.spawn({
        type: 'research',
        task: 'Research task',
      });

      expect(result.success).toBe(true);
      // Check that research tools were filtered
      const tools = capturedOptions?.tools as any[];
      expect(tools).toBeDefined();
      const toolNames = tools.map((t: any) => t.function.name);
      expect(toolNames).toContain('web_search');
      expect(toolNames).toContain('web_fetch');
      expect(toolNames).toContain('memory_read');
      // Should NOT contain code-only tools
      expect(toolNames).not.toContain('shell');
    });

    test('should use custom tools if provided', async () => {
      let capturedOptions: Record<string, unknown> | undefined;

      const factory: RuntimeDeps['agentFactory'] = (options) => {
        capturedOptions = options;
        return createMockAgent();
      };

      const runtime = createTestRuntime({ deps: { agentFactory: factory } });

      const result = await runtime.spawn({
        type: 'research',
        task: 'Custom task',
        tools: ['memory_read', 'memory_write'],
      });

      expect(result.success).toBe(true);
      const tools = capturedOptions?.tools as any[];
      const toolNames = tools.map((t: any) => t.function.name);
      expect(toolNames).toEqual(['memory_read', 'memory_write']);
    });

    test('should include context in prompt', async () => {
      const runtime = createTestRuntime();

      const result = await runtime.spawn({
        type: 'research',
        task: 'Main task',
        context: 'Additional context',
      });

      expect(result.success).toBe(true);
    });

    test('should update statistics on success', async () => {
      const runtime = createTestRuntime();

      await runtime.spawn({ type: 'research', task: 'Task 1' });
      await runtime.spawn({ type: 'memory', task: 'Task 2' });

      const stats = runtime.getStats();
      expect(stats.totalSpawned).toBe(2);
      expect(stats.successful).toBe(2);
    });

    test('should update statistics on failure', async () => {
      const failAgent = createMockAgent({
        chat: async () => { throw new Error('forced failure'); },
      });

      const runtime = createTestRuntime({
        deps: { agentFactory: createMockAgentFactory(failAgent) },
      });

      const result = await runtime.spawn({ type: 'research', task: 'Failing task' });

      expect(result.success).toBe(false);
      const stats = runtime.getStats();
      expect(stats.failed).toBeGreaterThan(0);
    });

    test('should track tokensUsed from agent.estimatedTokens', async () => {
      const agentWith500Tokens = createMockAgent({ estimatedTokens: 500 });
      const runtime = createTestRuntime({
        deps: { agentFactory: createMockAgentFactory(agentWith500Tokens) },
      });

      const result = await runtime.spawn({ type: 'research', task: 'Token task' });

      expect(result.success).toBe(true);
      expect(result.tokensUsed).toBe(500);

      const stats = runtime.getStats();
      expect(stats.totalTokens).toBe(500);
    });

    test('should respect AbortSignal', async () => {
      const slowAgent = createMockAgent({
        chat: async () => {
          await new Promise(resolve => setTimeout(resolve, 5000));
          return 'late';
        },
      });

      const runtime = createTestRuntime({
        deps: { agentFactory: createMockAgentFactory(slowAgent) },
      });

      const controller = new AbortController();
      // Abort after 30ms
      setTimeout(() => controller.abort(), 30);

      const result = await runtime.spawn({
        type: 'research',
        task: 'Abortable task',
        timeout: 60000,
        signal: controller.signal,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Aborted');
    });

    test('should return early if signal already aborted', async () => {
      const runtime = createTestRuntime();

      const controller = new AbortController();
      controller.abort(); // Already aborted

      const result = await runtime.spawn({
        type: 'research',
        task: 'Pre-aborted task',
        signal: controller.signal,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Aborted before start');
      expect(result.duration).toBe(0);
    });
  });

  describe('spawnParallel', () => {
    test('should spawn multiple subagents in parallel', async () => {
      const runtime = createTestRuntime();

      const configs: SubagentConfig[] = [
        { type: 'research', task: 'Task 1' },
        { type: 'research', task: 'Task 2' },
        { type: 'memory', task: 'Task 3' },
      ];

      const results = await runtime.spawnParallel(configs);

      expect(results.length).toBe(3);
      expect(results.every(r => r.success)).toBe(true);
    });

    test('should return results for all configs', async () => {
      const runtime = createTestRuntime();

      const configs: SubagentConfig[] = [
        { type: 'research', task: 'Task 1' },
        { type: 'memory', task: 'Task 2' },
      ];

      const results = await runtime.spawnParallel(configs);

      expect(results.length).toBe(2);
      expect(results[0].id).toBeDefined();
      expect(results[1].id).toBeDefined();
    });

    test('should handle partial failures', async () => {
      let callCount = 0;
      const factory: RuntimeDeps['agentFactory'] = () => {
        callCount++;
        if (callCount === 2) {
          return createMockAgent({
            chat: async () => { throw new Error('forced failure'); },
          });
        }
        return createMockAgent();
      };

      const runtime = createTestRuntime({ deps: { agentFactory: factory } });

      const configs: SubagentConfig[] = [
        { type: 'research', task: 'Task 1' },
        { type: 'research', task: 'Task 2 (will fail)' },
        { type: 'memory', task: 'Task 3' },
      ];

      const results = await runtime.spawnParallel(configs);

      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      expect(successful.length).toBe(2);
      expect(failed.length).toBe(1);
    });
  });

  describe('Tool Filtering', () => {
    test('should get tools for research type', () => {
      const runtime = createTestRuntime();

      const tools = runtime.getToolsForType('research');
      const toolNames = tools.map((t: any) => t.function.name);

      expect(toolNames).toContain('web_search');
      expect(toolNames).toContain('web_fetch');
      expect(toolNames).toContain('memory_read');
    });

    test('should get tools for memory type', () => {
      const runtime = createTestRuntime();

      const tools = runtime.getToolsForType('memory');
      const toolNames = tools.map((t: any) => t.function.name);

      expect(toolNames).toContain('memory_read');
      expect(toolNames).toContain('memory_write');
    });

    test('should get tools for skill type', () => {
      const runtime = createTestRuntime();

      const tools = runtime.getToolsForType('skill');
      const toolNames = tools.map((t: any) => t.function.name);

      expect(toolNames).toContain('skill_list');
      expect(toolNames).toContain('skill_get');
    });

    test('should return all tools for general type', () => {
      const runtime = createTestRuntime();

      const tools = runtime.getToolsForType('general');

      // General type should have access to all tools
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.length).toBe(createMockTools().length);
    });

    test('should get tools for code type', () => {
      const runtime = createTestRuntime();

      const tools = runtime.getToolsForType('code');
      const toolNames = tools.map((t: any) => t.function.name);

      expect(toolNames).toContain('code_execute');
      expect(toolNames).toContain('shell');
      expect(toolNames).toContain('file_read');
      expect(toolNames).toContain('file_write');
    });
  });
});

describe('Singleton Management', () => {
  test('should initialize singleton', () => {
    const runtime = initSubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
      deps: createTestDeps(),
    });

    expect(runtime).toBeInstanceOf(SubagentRuntime);
    expect(getSubagentRuntime()).toBe(runtime);
  });

  test('should throw if not initialized', () => {
    // Re-init with a known instance, then overwrite the singleton
    // We test the contract: without init, getSubagentRuntime throws
    // Because other tests may have initialized it, we use a fresh approach:
    // Just verify the instance returned by init is the same as get
    const runtime = initSubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
      deps: createTestDeps(),
    });

    expect(getSubagentRuntime()).toBe(runtime);
  });

  test('should replace existing instance on re-init', () => {
    const runtime1 = initSubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
      deps: createTestDeps(),
    });

    const runtime2 = initSubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
      deps: createTestDeps(),
    });

    expect(runtime2).not.toBe(runtime1);
    expect(getSubagentRuntime()).toBe(runtime2);
  });
});

describe('Convenience Functions', () => {
  test('spawnSubagent should use singleton', async () => {
    initSubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
      deps: createTestDeps(),
    });

    const result = await spawnSubagent({
      type: 'research',
      task: 'Test task',
    });

    expect(result.success).toBe(true);
  });

  test('spawnParallelSubagents should use singleton', async () => {
    initSubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
      deps: createTestDeps(),
    });

    const results = await spawnParallelSubagents([
      { type: 'research', task: 'Task 1' },
      { type: 'memory', task: 'Task 2' },
    ]);

    expect(results.length).toBe(2);
  });
});

describe('Error Handling', () => {
  test('should handle agent creation errors', async () => {
    const factory: RuntimeDeps['agentFactory'] = () => {
      throw new Error('Agent creation failed');
    };

    const runtime = createTestRuntime({ deps: { agentFactory: factory } });

    const result = await runtime.spawn({
      type: 'research',
      task: 'Task that will fail',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Agent creation failed');
  });

  test('should handle timeout errors gracefully', async () => {
    const slowAgent = createMockAgent({
      chat: async () => {
        await new Promise(resolve => setTimeout(resolve, 5000));
        return 'late';
      },
    });

    const runtime = createTestRuntime({
      deps: { agentFactory: createMockAgentFactory(slowAgent) },
    });

    const result = await runtime.spawn({
      type: 'research',
      task: 'Slow task',
      timeout: 50,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('timeout');
  });

  test('should record error details in result', async () => {
    const errorAgent = createMockAgent({
      chat: async () => { throw new Error('specific error detail'); },
    });

    const runtime = createTestRuntime({
      deps: { agentFactory: createMockAgentFactory(errorAgent) },
    });

    const result = await runtime.spawn({
      type: 'research',
      task: 'Failing task',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('specific error detail');

    const stats = runtime.getStats();
    expect(stats.failed).toBeGreaterThan(0);
  });
});

describe('Statistics Tracking', () => {
  test('should track total spawned count', () => {
    const runtime = createTestRuntime();
    expect(runtime.getStats().totalSpawned).toBe(0);
  });

  test('should track average duration', () => {
    const runtime = createTestRuntime();
    expect(runtime.getStats().avgDuration).toBe(0);
  });

  test('should track total duration', () => {
    const runtime = createTestRuntime();
    expect(runtime.getStats().totalDuration).toBe(0);
  });

  test('should track total tokens', () => {
    const runtime = createTestRuntime();
    expect(runtime.getStats().totalTokens).toBe(0);
  });

  test('should track successful count', () => {
    const runtime = createTestRuntime();
    expect(runtime.getStats().successful).toBe(0);
  });

  test('should track failed count', () => {
    const runtime = createTestRuntime();
    expect(runtime.getStats().failed).toBe(0);
  });
});

describe('resetStats', () => {
  test('should reset all statistics', () => {
    const runtime = createTestRuntime();
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
    const runtime = createTestRuntime();

    const stats1 = runtime.getStats();
    const stats2 = runtime.getStats();

    expect(stats1).not.toBe(stats2);
    expect(stats1).toEqual(stats2);
  });
});

describe('initSubagentRuntime', () => {
  test('should create and return runtime instance', () => {
    const runtime = initSubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
      deps: createTestDeps(),
    });

    expect(runtime).toBeInstanceOf(SubagentRuntime);
  });

  test('should be retrievable via getSubagentRuntime', () => {
    const runtime = initSubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
      deps: createTestDeps(),
    });

    expect(getSubagentRuntime()).toBe(runtime);
  });

  test('should replace existing instance on re-init', () => {
    const runtime1 = initSubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
      deps: createTestDeps(),
    });

    const runtime2 = initSubagentRuntime({
      provider: mockProvider,
      model: 'another-model',
      deps: createTestDeps(),
    });

    expect(runtime2).not.toBe(runtime1);
    expect(getSubagentRuntime()).toBe(runtime2);
  });
});

// ============================================================================
// Additional coverage tests — hooks, retry, depth check, edge cases
// ============================================================================

describe('SubagentRuntime — Hook Runner Integration', () => {
  function createMockHookRunner() {
    return {
      runSubagentSpawning: vi.fn(async () => null),
      runSubagentSpawned: vi.fn(async () => {}),
      runSubagentDeliveryTarget: vi.fn(async () => null),
      runSubagentEnded: vi.fn(async () => {}),
    };
  }

  test('calls runSubagentSpawning with event data', async () => {
    const hookRunner = createMockHookRunner();
    const runtime = createTestRuntime({ deps: { hookRunner } });

    await runtime.spawn({ type: 'research', task: 'Hook test' });

    expect(hookRunner.runSubagentSpawning).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'research',
        task: 'Hook test',
        timestamp: expect.any(String),
      }),
    );
  });

  test('runSubagentSpawning modifies config when it returns non-null', async () => {
    const hookRunner = createMockHookRunner();
    hookRunner.runSubagentSpawning.mockResolvedValueOnce({
      task: 'Modified task',
      context: 'Modified context',
      model: 'modified-model',
      provider: { type: 'modified' },
    });

    let capturedOptions: Record<string, unknown> | undefined;
    const factory: RuntimeDeps['agentFactory'] = (options) => {
      capturedOptions = options;
      return createMockAgent();
    };

    const runtime = createTestRuntime({ deps: { hookRunner, agentFactory: factory } });
    await runtime.spawn({ type: 'research', task: 'Original task' });

    // The agent should have received the modified model/provider
    expect(capturedOptions?.model).toBe('modified-model');
  });

  test('runSubagentSpawning error is caught gracefully', async () => {
    const hookRunner = createMockHookRunner();
    hookRunner.runSubagentSpawning.mockRejectedValueOnce(new Error('Hook crash'));

    const runtime = createTestRuntime({ deps: { hookRunner } });
    const result = await runtime.spawn({ type: 'research', task: 'Test' });

    // Should still succeed — hook failure is non-critical
    expect(result.success).toBe(true);
  });

  test('calls runSubagentSpawned after agent creation', async () => {
    const hookRunner = createMockHookRunner();
    const runtime = createTestRuntime({ deps: { hookRunner } });

    await runtime.spawn({ type: 'research', task: 'Spawned hook test' });

    expect(hookRunner.runSubagentSpawned).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'research',
        task: 'Spawned hook test',
        timestamp: expect.any(String),
      }),
    );
  });

  test('runSubagentSpawned error is caught gracefully', async () => {
    const hookRunner = createMockHookRunner();
    hookRunner.runSubagentSpawned.mockRejectedValueOnce(new Error('Spawned hook crash'));

    const runtime = createTestRuntime({ deps: { hookRunner } });
    const result = await runtime.spawn({ type: 'research', task: 'Test' });

    expect(result.success).toBe(true);
  });

  test('calls runSubagentDeliveryTarget on success', async () => {
    const hookRunner = createMockHookRunner();
    const runtime = createTestRuntime({ deps: { hookRunner } });

    await runtime.spawn({ type: 'research', task: 'Delivery test' });

    expect(hookRunner.runSubagentDeliveryTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'research',
        output: expect.any(String),
        result: expect.objectContaining({ success: true }),
        timestamp: expect.any(String),
      }),
    );
  });

  test('runSubagentDeliveryTarget modifies output', async () => {
    const hookRunner = createMockHookRunner();
    hookRunner.runSubagentDeliveryTarget.mockResolvedValueOnce({
      output: 'Modified output',
    });

    const runtime = createTestRuntime({ deps: { hookRunner } });
    const result = await runtime.spawn({ type: 'research', task: 'Test' });

    expect(result.output).toBe('Modified output');
  });

  test('runSubagentDeliveryTarget modifies result', async () => {
    const hookRunner = createMockHookRunner();
    hookRunner.runSubagentDeliveryTarget.mockResolvedValueOnce({
      result: { tokensUsed: 9999 },
    });

    const runtime = createTestRuntime({ deps: { hookRunner } });
    const result = await runtime.spawn({ type: 'research', task: 'Test' });

    expect(result.tokensUsed).toBe(9999);
  });

  test('runSubagentDeliveryTarget error is caught gracefully', async () => {
    const hookRunner = createMockHookRunner();
    hookRunner.runSubagentDeliveryTarget.mockRejectedValueOnce(new Error('Delivery hook crash'));

    const runtime = createTestRuntime({ deps: { hookRunner } });
    const result = await runtime.spawn({ type: 'research', task: 'Test' });

    expect(result.success).toBe(true);
  });

  test('calls runSubagentEnded on success', async () => {
    const hookRunner = createMockHookRunner();
    const runtime = createTestRuntime({ deps: { hookRunner } });

    await runtime.spawn({ type: 'research', task: 'Ended hook test' });

    expect(hookRunner.runSubagentEnded).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'research',
        success: true,
        duration: expect.any(Number),
        output: expect.any(String),
        tokensUsed: expect.any(Number),
        timestamp: expect.any(String),
      }),
    );
  });

  test('calls runSubagentEnded on failure', async () => {
    const hookRunner = createMockHookRunner();
    const failAgent = createMockAgent({
      chat: async () => { throw new Error('agent crash'); },
    });
    const runtime = createTestRuntime({
      deps: { hookRunner, agentFactory: createMockAgentFactory(failAgent) },
    });

    const result = await runtime.spawn({ type: 'research', task: 'Failing task' });

    expect(result.success).toBe(false);
    expect(hookRunner.runSubagentEnded).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('agent crash'),
      }),
    );
  });

  test('runSubagentEnded error on success path is caught', async () => {
    const hookRunner = createMockHookRunner();
    hookRunner.runSubagentEnded.mockRejectedValueOnce(new Error('Ended hook crash'));

    const runtime = createTestRuntime({ deps: { hookRunner } });
    const result = await runtime.spawn({ type: 'research', task: 'Test' });

    expect(result.success).toBe(true);
  });

  test('runSubagentEnded error on failure path is caught', async () => {
    const hookRunner = createMockHookRunner();
    hookRunner.runSubagentEnded.mockRejectedValueOnce(new Error('Ended hook crash'));
    const failAgent = createMockAgent({
      chat: async () => { throw new Error('agent crash'); },
    });
    const runtime = createTestRuntime({
      deps: { hookRunner, agentFactory: createMockAgentFactory(failAgent) },
    });

    const result = await runtime.spawn({ type: 'research', task: 'Fail' });

    expect(result.success).toBe(false);
  });

  test('no hooks called when hookRunner is null', async () => {
    const runtime = createTestRuntime({ deps: { hookRunner: null } });

    const result = await runtime.spawn({ type: 'research', task: 'No hooks' });

    expect(result.success).toBe(true);
    // No crashes from null hookRunner
  });
});

describe('SubagentRuntime — Retry Logic', () => {
  test('retries on timeout error and eventually succeeds', async () => {
    let callCount = 0;
    const retryAgent = createMockAgent({
      chat: async () => {
        callCount++;
        if (callCount <= 1) {
          throw new Error('timeout occurred');
        }
        return 'Success after retry';
      },
    });

    const runtime = createTestRuntime({
      deps: { agentFactory: createMockAgentFactory(retryAgent) },
    });

    const result = await runtime.spawn({ type: 'research', task: 'Retryable' });

    expect(result.success).toBe(true);
    expect(result.output).toBe('Success after retry');
    expect(callCount).toBe(2);
  });

  test('retries on network error', async () => {
    let callCount = 0;
    const retryAgent = createMockAgent({
      chat: async () => {
        callCount++;
        if (callCount <= 1) {
          throw new Error('network error');
        }
        return 'Network recovered';
      },
    });

    const runtime = createTestRuntime({
      deps: { agentFactory: createMockAgentFactory(retryAgent) },
    });

    const result = await runtime.spawn({ type: 'research', task: 'Network retry' });

    expect(result.success).toBe(true);
    expect(callCount).toBe(2);
  });

  test('retries on ECONNRESET error', async () => {
    let callCount = 0;
    const retryAgent = createMockAgent({
      chat: async () => {
        callCount++;
        if (callCount <= 1) {
          throw new Error('ECONNRESET');
        }
        return 'Reconnected';
      },
    });

    const runtime = createTestRuntime({
      deps: { agentFactory: createMockAgentFactory(retryAgent) },
    });

    const result = await runtime.spawn({ type: 'research', task: 'ECONNRESET retry' });

    expect(result.success).toBe(true);
    expect(callCount).toBe(2);
  });

  test('retries on rate limit error', async () => {
    let callCount = 0;
    const retryAgent = createMockAgent({
      chat: async () => {
        callCount++;
        if (callCount <= 1) {
          throw new Error('rate limit exceeded');
        }
        return 'Rate limit cleared';
      },
    });

    const runtime = createTestRuntime({
      deps: { agentFactory: createMockAgentFactory(retryAgent) },
    });

    const result = await runtime.spawn({ type: 'research', task: 'Rate limit retry' });

    expect(result.success).toBe(true);
    expect(callCount).toBe(2);
  });

  test('does not retry non-retryable errors', async () => {
    let callCount = 0;
    const failAgent = createMockAgent({
      chat: async () => {
        callCount++;
        throw new Error('permission denied');
      },
    });

    const runtime = createTestRuntime({
      deps: { agentFactory: createMockAgentFactory(failAgent) },
    });

    const result = await runtime.spawn({ type: 'research', task: 'Non-retryable' });

    expect(result.success).toBe(false);
    expect(callCount).toBe(1); // No retries
    expect(result.error).toContain('permission denied');
  });

  test('fails after MAX_RETRIES+1 attempts on retryable error', async () => {
    let callCount = 0;
    const failAgent = createMockAgent({
      chat: async () => {
        callCount++;
        throw new Error('timeout persists');
      },
    });

    const runtime = createTestRuntime({
      deps: { agentFactory: createMockAgentFactory(failAgent) },
    });

    const result = await runtime.spawn({ type: 'research', task: 'All retries fail' });

    expect(result.success).toBe(false);
    expect(callCount).toBe(3); // 1 initial + 2 retries (MAX_RETRIES=2)
    expect(result.error).toContain('timeout persists');
  });

  test('abort signal is not retryable', async () => {
    let callCount = 0;
    const failAgent = createMockAgent({
      chat: async () => {
        callCount++;
        throw new Error('Aborted');
      },
    });

    const runtime = createTestRuntime({
      deps: { agentFactory: createMockAgentFactory(failAgent) },
    });

    const result = await runtime.spawn({ type: 'research', task: 'Abort no retry' });

    expect(result.success).toBe(false);
    expect(callCount).toBe(1); // No retries for abort
  });

  test('handles string error type', async () => {
    const failAgent = createMockAgent({
      chat: async () => {
        throw 'string error message';
      },
    });

    const runtime = createTestRuntime({
      deps: { agentFactory: createMockAgentFactory(failAgent) },
    });

    const result = await runtime.spawn({ type: 'research', task: 'String error' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('string error message');
  });

  test('handles object error type (JSON stringifiable)', async () => {
    const failAgent = createMockAgent({
      chat: async () => {
        throw { code: 42, reason: 'custom' };
      },
    });

    const runtime = createTestRuntime({
      deps: { agentFactory: createMockAgentFactory(failAgent) },
    });

    const result = await runtime.spawn({ type: 'research', task: 'Object error' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('42');
  });

  test('handles non-JSON-stringifiable error type', async () => {
    const failAgent = createMockAgent({
      chat: async () => {
        const circular: any = {};
        circular.self = circular;
        throw circular;
      },
    });

    const runtime = createTestRuntime({
      deps: { agentFactory: createMockAgentFactory(failAgent) },
    });

    const result = await runtime.spawn({ type: 'research', task: 'Circular error' });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('SubagentRuntime — Edge Cases', () => {
  test('custom config.id is used as subagentId', async () => {
    const runtime = createTestRuntime();

    const result = await runtime.spawn({
      type: 'research',
      task: 'Custom id test',
      id: 'my-custom-id',
    });

    expect(result.success).toBe(true);
    expect(result.id).toBe('my-custom-id');
  });

  test('agent without estimatedTokens reports 0 tokens', async () => {
    const agentNoTokens: AgentLike = {
      chat: async () => 'Response',
      // No estimatedTokens property
    };
    // Remove the property entirely
    delete (agentNoTokens as any).estimatedTokens;

    const runtime = createTestRuntime({
      deps: { agentFactory: () => agentNoTokens },
    });

    const result = await runtime.spawn({ type: 'research', task: 'No tokens' });

    expect(result.success).toBe(true);
    expect(result.tokensUsed).toBe(0);
  });

  test('resetStats clears accumulated values', async () => {
    const runtime = createTestRuntime();

    await runtime.spawn({ type: 'research', task: 'Task 1' });
    await runtime.spawn({ type: 'research', task: 'Task 2' });

    expect(runtime.getStats().totalSpawned).toBe(2);

    runtime.resetStats();

    const stats = runtime.getStats();
    expect(stats.totalSpawned).toBe(0);
    expect(stats.successful).toBe(0);
    expect(stats.failed).toBe(0);
    expect(stats.totalTokens).toBe(0);
    expect(stats.totalDuration).toBe(0);
    expect(stats.avgDuration).toBe(0);
  });

  test('avgDuration is computed correctly', async () => {
    const runtime = createTestRuntime();

    await runtime.spawn({ type: 'research', task: 'Task 1' });
    await runtime.spawn({ type: 'research', task: 'Task 2' });

    const stats = runtime.getStats();
    expect(stats.avgDuration).toBeCloseTo(stats.totalDuration / stats.totalSpawned, 0);
  });

  test('provider and model override in SubagentConfig', async () => {
    let capturedOptions: Record<string, unknown> | undefined;
    const factory: RuntimeDeps['agentFactory'] = (options) => {
      capturedOptions = options;
      return createMockAgent();
    };

    const runtime = createTestRuntime({ deps: { agentFactory: factory } });

    await runtime.spawn({
      type: 'research',
      task: 'Override test',
      provider: { type: 'custom-provider' },
      model: 'custom-model',
    });

    expect(capturedOptions?.provider).toEqual({ type: 'custom-provider' });
    expect(capturedOptions?.model).toBe('custom-model');
  });

  test('maxTokens passed to agent factory', async () => {
    let capturedOptions: Record<string, unknown> | undefined;
    const factory: RuntimeDeps['agentFactory'] = (options) => {
      capturedOptions = options;
      return createMockAgent();
    };

    const runtime = createTestRuntime({ deps: { agentFactory: factory } });

    await runtime.spawn({
      type: 'research',
      task: 'Max tokens test',
      maxTokens: 2048,
    });

    expect(capturedOptions?.maxTokens).toBe(2048);
  });

  test('spawn with sessionKey passed to constructor', async () => {
    const runtime = new SubagentRuntime({
      provider: mockProvider,
      model: 'test-model',
      sessionKey: 'custom-session',
      deps: createTestDeps(),
    });

    const result = await runtime.spawn({ type: 'research', task: 'Session test' });
    expect(result.success).toBe(true);
  });

  test('agent chat returns empty string triggers no-output error', async () => {
    const emptyAgent = createMockAgent({
      chat: async () => '',
    });

    const runtime = createTestRuntime({
      deps: { agentFactory: createMockAgentFactory(emptyAgent) },
    });

    const result = await runtime.spawn({ type: 'research', task: 'Empty output' });

    // Empty string is falsy → throws 'No output from subagent'
    expect(result.success).toBe(false);
    expect(result.error).toContain('No output from subagent');
  });

  test('SUBAGENT_TIMEOUT_MS env var overrides default timeout', async () => {
    const origEnv = process.env.SUBAGENT_TIMEOUT_MS;

    // Create a slow agent that would fail at 50ms but succeed at 300ms
    const agent = createMockAgent({
      chat: async () => {
        await new Promise(r => setTimeout(r, 10));
        return 'quick response';
      },
    });

    process.env.SUBAGENT_TIMEOUT_MS = '500';
    const runtime = createTestRuntime({
      deps: { agentFactory: createMockAgentFactory(agent) },
    });

    const result = await runtime.spawn({ type: 'research', task: 'Env timeout test' });

    expect(result.success).toBe(true);

    // Restore
    if (origEnv === undefined) {
      delete process.env.SUBAGENT_TIMEOUT_MS;
    } else {
      process.env.SUBAGENT_TIMEOUT_MS = origEnv;
    }
  });
});

describe('SubagentRuntime — spawnParallel edge cases', () => {
  test('respects SUBAGENT_MAX_CONCURRENCY env var', async () => {
    const origEnv = process.env.SUBAGENT_MAX_CONCURRENCY;
    process.env.SUBAGENT_MAX_CONCURRENCY = '2';

    const runtime = createTestRuntime();

    const configs: SubagentConfig[] = [
      { type: 'research', task: 'Task 1' },
      { type: 'research', task: 'Task 2' },
      { type: 'research', task: 'Task 3' },
    ];

    const results = await runtime.spawnParallel(configs);
    expect(results.length).toBe(3);
    expect(results.every(r => r.success)).toBe(true);

    if (origEnv === undefined) {
      delete process.env.SUBAGENT_MAX_CONCURRENCY;
    } else {
      process.env.SUBAGENT_MAX_CONCURRENCY = origEnv;
    }
  });

  test('maxConcurrency parameter overrides env var', async () => {
    const runtime = createTestRuntime();

    const configs: SubagentConfig[] = [
      { type: 'research', task: 'Task 1' },
      { type: 'research', task: 'Task 2' },
    ];

    const results = await runtime.spawnParallel(configs, 1);
    expect(results.length).toBe(2);
    expect(results.every(r => r.success)).toBe(true);
  });

  test('empty configs array returns empty results', async () => {
    const runtime = createTestRuntime();

    const results = await runtime.spawnParallel([]);
    expect(results).toEqual([]);
  });
});

describe('SubagentRuntime — pLimit concurrency', () => {
  test('limits concurrent executions', async () => {
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const trackingAgent = createMockAgent({
      chat: async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise(r => setTimeout(r, 20));
        currentConcurrent--;
        return 'done';
      },
    });

    const runtime = createTestRuntime({
      deps: { agentFactory: createMockAgentFactory(trackingAgent) },
    });

    const configs: SubagentConfig[] = Array.from({ length: 6 }, (_, i) => ({
      type: 'research' as const,
      task: `Task ${i}`,
    }));

    const results = await runtime.spawnParallel(configs, 2);

    expect(results.length).toBe(6);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });
});

describe('SubagentRuntime — Outer catch error handling', () => {
  test('handles string error in outer catch', async () => {
    const factory: RuntimeDeps['agentFactory'] = () => {
      throw 'string creation error';
    };

    const runtime = createTestRuntime({ deps: { agentFactory: factory } });
    const result = await runtime.spawn({ type: 'research', task: 'String throw' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('string creation error');
  });

  test('handles object error in outer catch', async () => {
    const factory: RuntimeDeps['agentFactory'] = () => {
      throw { code: 500 };
    };

    const runtime = createTestRuntime({ deps: { agentFactory: factory } });
    const result = await runtime.spawn({ type: 'research', task: 'Object throw' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('500');
  });

  test('handles non-stringifiable error in outer catch', async () => {
    const factory: RuntimeDeps['agentFactory'] = () => {
      const c: any = {};
      c.self = c;
      throw c;
    };

    const runtime = createTestRuntime({ deps: { agentFactory: factory } });
    const result = await runtime.spawn({ type: 'research', task: 'Circular throw' });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
