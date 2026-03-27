import { describe, it, expect, vi } from 'vitest';

vi.mock('bun:sqlite', () => {
  class MockDatabase {
    constructor() {}
    exec = vi.fn();
    run = vi.fn();
    query = vi.fn(() => ({ all: vi.fn(() => []) }));
    prepare = vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn() }));
    transaction = vi.fn((fn: Function) => fn);
    close = vi.fn();
  }
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

describe('domain/subagent/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    // types
    expect(mod.SUBAGENT_TOOL_SETS).toBeDefined();
    // runtime
    expect(typeof mod.SubagentRuntime).toBe('function');
    expect(typeof mod.initSubagentRuntime).toBe('function');
    expect(typeof mod.getSubagentRuntime).toBe('function');
    expect(typeof mod.spawnSubagent).toBe('function');
    expect(typeof mod.spawnParallelSubagents).toBe('function');
    // registry
    expect(typeof mod.SubagentRegistry).toBe('function');
    expect(typeof mod.getSubagentRegistry).toBe('function');
    expect(typeof mod.resetSubagentRegistry).toBe('function');
    // orchestration
    expect(typeof mod.decomposeTask).toBe('function');
    expect(typeof mod.createSequentialDecomposition).toBe('function');
    expect(typeof mod.createParallelDecomposition).toBe('function');
    expect(typeof mod.TaskOrchestrator).toBe('function');
    expect(typeof mod.initTaskOrchestrator).toBe('function');
    expect(typeof mod.getTaskOrchestrator).toBe('function');
    expect(typeof mod.orchestrateTask).toBe('function');
  });
});
