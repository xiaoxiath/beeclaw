import { describe, it, expect } from 'bun:test';

describe('domain/subagent/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    // types
    expect(mod.SUBAGENT_TOOL_SETS).toBeDefined();
    // runtime
    expect(typeof mod.initSubagentRuntime).toBe('function');
    // registry
    expect(typeof mod.SubagentRegistry).toBe('function');
    // orchestration
    expect(typeof mod.decomposeTask).toBe('function');
    expect(typeof mod.TaskOrchestrator).toBe('function');
  });
});
