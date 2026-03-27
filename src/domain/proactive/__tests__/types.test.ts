import { describe, it, expect, vi } from 'vitest';

describe('domain/proactive/types', () => {
  it('should export zod schemas', async () => {
    const mod = await import('../types');
    expect(mod).toBeDefined();
    expect(mod.ScheduleSchema).toBeDefined();
    expect(mod.PatternSchema).toBeDefined();
    expect(mod.PendingNotificationSchema).toBeDefined();
    expect(mod.NotificationHistorySchema).toBeDefined();
    expect(mod.DaemonStateSchema).toBeDefined();
    expect(mod.ScheduleStorageSchema).toBeDefined();
    expect(mod.NotificationStorageSchema).toBeDefined();
    expect(mod.CreateScheduleOptionsSchema).toBeDefined();
    expect(mod.ProactiveJobDataSchema).toBeDefined();
  });
});
