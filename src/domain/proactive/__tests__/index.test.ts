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

describe('domain/proactive/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    // Scheduler
    expect(typeof mod.Scheduler).toBe('function');
    expect(typeof mod.getScheduler).toBe('function');
    expect(typeof mod.resetScheduler).toBe('function');
    // Notifications
    expect(typeof mod.NotificationManager).toBe('function');
    expect(typeof mod.getNotificationManager).toBe('function');
    expect(typeof mod.resetNotificationManager).toBe('function');
    // Daemon
    expect(typeof mod.Daemon).toBe('function');
    expect(typeof mod.getDaemon).toBe('function');
    expect(typeof mod.resetDaemon).toBe('function');
    // Pusher
    expect(typeof mod.pushNotification).toBe('function');
    expect(typeof mod.formatNotification).toBe('function');
    expect(typeof mod.formatNotifications).toBe('function');
    expect(typeof mod.setCliDeliveryHandler).toBe('function');
    expect(typeof mod.registerDeliveryHandler).toBe('function');
    expect(typeof mod.pushPendingNotifications).toBe('function');
    expect(typeof mod.pushUrgent).toBe('function');
    expect(typeof mod.pushReminder).toBe('function');
    expect(typeof mod.pushGoalProgress).toBe('function');
    expect(typeof mod.pushToFeishu).toBe('function');
    expect(typeof mod.registerFeishuHandler).toBe('function');
    expect(typeof mod.proactiveMessageToFeishu).toBe('function');
    // Triggers
    expect(typeof mod.evaluateCondition).toBe('function');
    expect(typeof mod.evaluatePatterns).toBe('function');
    expect(typeof mod.executePatternAction).toBe('function');
    // Tools
    expect(mod.proactiveTools).toBeDefined();
    expect(typeof mod.executeProactiveTool).toBe('function');
    expect(typeof mod.getProactiveToolsForAI).toBe('function');
    expect(mod.PROACTIVE_TOOL_NAMES).toBeDefined();
  });
});
