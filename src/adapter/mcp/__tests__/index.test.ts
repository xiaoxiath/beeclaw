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

describe('adapter/mcp/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    // From client
    expect(typeof mod.MCPClientManager).toBe('function');
    expect(typeof mod.getMCPManager).toBe('function');
    expect(typeof mod.resetMCPManager).toBe('function');
    // From executor
    expect(typeof mod.isMCPTool).toBe('function');
    expect(typeof mod.parseMCPToolName).toBe('function');
    expect(typeof mod.executeMCPTool).toBe('function');
    // From initializer
    expect(typeof mod.initializeMCP).toBe('function');
    expect(typeof mod.shutdownMCP).toBe('function');
    expect(typeof mod.getMCPStatusSummary).toBe('function');
  });
});
