import { describe, it, expect } from 'bun:test';

describe('domain/subagent/types', () => {
  it('should export runtime constants', async () => {
    const mod = await import('../types');
    expect(mod).toBeDefined();
    expect(mod.SUBAGENT_TOOL_SETS).toBeDefined();
    expect(mod.SUBAGENT_TOOL_SETS.research).toBeDefined();
    expect(mod.SUBAGENT_TOOL_SETS.memory).toBeDefined();
    expect(mod.SUBAGENT_TOOL_SETS.skill).toBeDefined();
    expect(mod.SUBAGENT_TOOL_SETS.code).toBeDefined();
    expect(mod.SUBAGENT_TOOL_SETS.general).toBeDefined();
    expect(Array.isArray(mod.SUBAGENT_TOOL_SETS.research)).toBe(true);
  });
});
