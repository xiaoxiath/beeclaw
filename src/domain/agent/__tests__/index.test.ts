import { describe, it, expect, vi } from 'vitest';

describe('domain/agent/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    // Tools
    expect(typeof mod.getAllToolsForAI).toBe('function');
    expect(mod.SYSTEM_PROMPTS).toBeDefined();
    expect(typeof mod.buildSystemPrompt).toBe('function');
    // Builtin tools
    expect(typeof mod.getBuiltinToolsForAI).toBe('function');
    expect(typeof mod.executeBuiltinTool).toBe('function');
    expect(typeof mod.isBuiltinTool).toBe('function');
    // Evolution
    expect(typeof mod.recordSkillFailure).toBe('function');
    // Types
    expect(typeof mod.stripMessageMetadata).toBe('function');
    // Agent class
    expect(typeof mod.Agent).toBe('function');
    expect(typeof mod.createAgent).toBe('function');
    // ToolDispatcher
    expect(typeof mod.ToolDispatcher).toBe('function');
    // TokenBudgetManager
    expect(typeof mod.TokenBudgetManager).toBe('function');
    // SkillRunner
    expect(typeof mod.SkillRunner).toBe('function');
  });
});
