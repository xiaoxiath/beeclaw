/**
 * 测试飞书日历授权流程 - Vitest unit test version
 *
 * The original was a manual integration script. This converts it into
 * a proper vitest test that validates the relevant exports exist.
 */
import { describe, it, expect, vi } from 'vitest';

// Standard mock block
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

describe('feishu calendar auth flow', () => {
  it('initApp and getAgent are importable from app', async () => {
    const appModule = await import('../src/app');
    expect(appModule.initApp).toBeDefined();
    expect(typeof appModule.initApp).toBe('function');
    expect(appModule.getAgent).toBeDefined();
    expect(typeof appModule.getAgent).toBe('function');
  });

  it('Agent class is importable from domain/agent', async () => {
    const agentModule = await import('../src/domain/agent');
    expect(agentModule.Agent).toBeDefined();
    expect(agentModule.createAgent).toBeDefined();
  });

  it('getAgent throws if app not initialized', async () => {
    const { getAgent } = await import('../src/app');
    expect(() => getAgent()).toThrow('App not initialized');
  });
});
