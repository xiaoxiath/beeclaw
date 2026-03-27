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

describe('app/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    expect(typeof mod.initApp).toBe('function');
    expect(typeof mod.getAgent).toBe('function');
    expect(typeof mod.getProvider).toBe('function');
    expect(typeof mod.getModel).toBe('function');
    expect(typeof mod.getExtractionManager).toBe('function');
    expect(typeof mod.getConfig_).toBe('function');
    expect(typeof mod.switchModel).toBe('function');
    expect(typeof mod.resetApp).toBe('function');
    expect(typeof mod.isInitialized).toBe('function');
    expect(typeof mod.getTokenStatsConfig).toBe('function');
    // Re-exported session functions
    expect(typeof mod.getOrCreateSession).toBe('function');
    expect(typeof mod.getSession).toBe('function');
    expect(typeof mod.listSessions).toBe('function');
    expect(typeof mod.deleteSession).toBe('function');
    expect(typeof mod.getSessionStats).toBe('function');
    expect(typeof mod.continueConversation).toBe('function');
  });
});
