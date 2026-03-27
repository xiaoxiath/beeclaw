import { describe, it, expect } from 'bun:test';

describe('domain/agent/goal/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    // Store
    expect(typeof mod.GoalStore).toBe('function');
    expect(typeof mod.getGoalStore).toBe('function');
    expect(typeof mod.resetGoalStore).toBe('function');
    // Tools
    expect(mod.goalTools).toBeDefined();
    expect(typeof mod.executeGoalTool).toBe('function');
    expect(typeof mod.getGoalToolsForAI).toBe('function');
    expect(mod.GOAL_TOOL_NAMES).toBeDefined();
  });
});
