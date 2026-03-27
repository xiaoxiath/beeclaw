import { describe, it, expect } from 'bun:test';

describe('domain/agent/goal/types', () => {
  it('should export zod schemas', async () => {
    const mod = await import('../types');
    expect(mod).toBeDefined();
    expect(mod.CheckpointSchema).toBeDefined();
    expect(mod.GoalContextSchema).toBeDefined();
    expect(mod.GoalSchema).toBeDefined();
    expect(mod.GoalIndexSchema).toBeDefined();
    expect(mod.CreateGoalOptionsSchema).toBeDefined();
    expect(mod.UpdateGoalOptionsSchema).toBeDefined();
    expect(mod.GoalFilterSchema).toBeDefined();
  });
});
