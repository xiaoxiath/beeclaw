import { describe, it, expect, vi } from 'vitest';

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
    // Daemon
    expect(typeof mod.Daemon).toBe('function');
    expect(typeof mod.getDaemon).toBe('function');
    // Pusher
    expect(typeof mod.pushNotification).toBe('function');
    expect(typeof mod.formatNotification).toBe('function');
    // Triggers
    expect(typeof mod.evaluateCondition).toBe('function');
    expect(typeof mod.evaluatePatterns).toBe('function');
    // Tools
    expect(mod.proactiveTools).toBeDefined();
    expect(typeof mod.executeProactiveTool).toBe('function');
    expect(mod.PROACTIVE_TOOL_NAMES).toBeDefined();
  });
});
