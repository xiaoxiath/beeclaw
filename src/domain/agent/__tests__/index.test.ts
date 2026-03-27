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

describe('domain/agent/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    // Tools
    expect(typeof mod.getAllToolsForAI).toBe('function');
    expect(mod.SYSTEM_PROMPTS).toBeDefined();
    expect(typeof mod.buildSystemPrompt).toBe('function');
    expect(typeof mod.formatSkillsForPrompt).toBe('function');
    expect(typeof mod.getCurrentTimeContext).toBe('function');
    expect(typeof mod.getMemoryTools).toBe('function');
    expect(typeof mod.getSkillTools).toBe('function');
    expect(typeof mod.getToolsByCategory).toBe('function');
    expect(mod.TOOL_CATEGORIES).toBeDefined();
    // Builtin tools
    expect(typeof mod.getBuiltinToolsForAI).toBe('function');
    expect(typeof mod.executeBuiltinTool).toBe('function');
    expect(typeof mod.isBuiltinTool).toBe('function');
    expect(mod.builtinToolNames).toBeDefined();
    // Evolution
    expect(typeof mod.recordSkillFailure).toBe('function');
    // Types
    expect(typeof mod.stripMessageMetadata).toBe('function');
    // Agent class
    expect(typeof mod.Agent).toBe('function');
    expect(typeof mod.createAgent).toBe('function');
    // ToolDispatcher
    expect(typeof mod.ToolDispatcher).toBe('function');
    // TokenBudgetManager
    expect(typeof mod.TokenBudgetManager).toBe('function');
    // SkillRunner
    expect(typeof mod.SkillRunner).toBe('function');
    // Tool executor
    expect(typeof mod.createDefaultToolExecutor).toBe('function');
    expect(typeof mod._executeToolInner).toBe('function');
  });
});
