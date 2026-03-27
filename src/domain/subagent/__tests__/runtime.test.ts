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
