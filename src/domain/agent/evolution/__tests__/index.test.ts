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

describe('domain/agent/evolution/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    // Reflection trigger
    expect(typeof mod.recordSkillFailure).toBe('function');
    expect(typeof mod.checkConsecutiveFailures).toBe('function');
    expect(typeof mod.clearReflectionTracking).toBe('function');
    expect(typeof mod.getReflectionStats).toBe('function');
    expect(typeof mod.shouldTriggerReflection).toBe('function');
    // Preference learning
    expect(typeof mod.detectPreferenceExpressions).toBe('function');
    expect(typeof mod.hasPreferenceExpression).toBe('function');
    expect(typeof mod.getPreferenceLearningContext).toBe('function');
    expect(typeof mod.checkPreferenceTriggers).toBe('function');
    // Query tracking
    expect(typeof mod.recordQuery).toBe('function');
    expect(typeof mod.detectPatterns).toBe('function');
    expect(typeof mod.getRecentQueries).toBe('function');
    expect(typeof mod.clearQueryTracking).toBe('function');
    expect(typeof mod.getQueryTrackingStats).toBe('function');
    // Self evolution
    expect(typeof mod.initSelfEvolution).toBe('function');
    expect(typeof mod.getSelfEvolutionStatus).toBe('function');
    // triggerSelfEvolution removed in W5-PR1 — was a stub.
    expect(mod.triggerSelfEvolution).toBeUndefined();
  });
});
