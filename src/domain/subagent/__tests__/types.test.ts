import { describe, it, expect, vi } from 'vitest';

describe('domain/subagent/types', () => {
  it('should export runtime constants', async () => {
    const mod = await import('../types');
    expect(mod).toBeDefined();
    expect(mod.SUBAGENT_TOOL_SETS).toBeDefined();
    expect(mod.SUBAGENT_PROFILES).toBeDefined();
    expect(mod.SUBAGENT_PROFILES.explorer.permissions.writeAccess).toBe(false);
    expect(mod.SUBAGENT_PROFILES.worker.permissions.writeAccess).toBe(true);
    expect(mod.SUBAGENT_PROFILES.memory.permissions.writeAccess).toBe(true);
    expect(mod.SUBAGENT_PROFILES.worker.permissions.canSpawnSubagents).toBe(false);
    expect(mod.SUBAGENT_TOOL_SETS.explorer).toBeDefined();
    expect(mod.SUBAGENT_TOOL_SETS.worker).toBeDefined();
    expect(mod.SUBAGENT_TOOL_SETS.research).toBeDefined();
    expect(mod.SUBAGENT_TOOL_SETS.memory).toBeDefined();
    expect(mod.SUBAGENT_TOOL_SETS.skill).toBeDefined();
    expect(mod.SUBAGENT_TOOL_SETS.code).toBeDefined();
    expect(mod.SUBAGENT_TOOL_SETS.general).toBeDefined();
    expect(Array.isArray(mod.SUBAGENT_TOOL_SETS.research)).toBe(true);
    expect(mod.resolveSubagentRole('research')).toBe('researcher');
    expect(mod.resolveSubagentRole('code')).toBe('worker');
    expect(mod.resolveSubagentRole('general')).toBe('explorer');
  });
});
