import { describe, it, expect } from 'bun:test';

describe('domain/tools/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    // Namespace re-exports
    expect(mod.SearchTools).toBeDefined();
    expect(mod.ShellTools).toBeDefined();
    expect(mod.FinanceTools).toBeDefined();
    expect(mod.UtilityTools).toBeDefined();
    expect(mod.SubagentTools).toBeDefined();
    expect(mod.SandboxTools).toBeDefined();
  });
});
