import { describe, it, expect, vi } from 'vitest';

describe('domain/sandbox/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    // From manager
    expect(typeof mod.SandboxManager).toBe('function');
    // From tools
    expect(mod.sandboxTools).toBeDefined();
    expect(mod.sandboxToolNames).toBeDefined();
    expect(typeof mod.executeSandboxTool).toBe('function');
    expect(typeof mod.getSandboxToolsForAI).toBe('function');
    expect(typeof mod.setCurrentSandboxSession).toBe('function');
    expect(typeof mod.getCurrentSandboxSession).toBe('function');
  });
});
