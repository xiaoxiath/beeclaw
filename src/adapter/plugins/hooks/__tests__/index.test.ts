import { describe, it, expect, vi } from 'vitest';

describe('adapter/plugins/hooks/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    // From runner
    expect(typeof mod.HookRunner).toBe('function');
    expect(typeof mod.getHookRunner).toBe('function');
    expect(typeof mod.resetHookRunner).toBe('function');
    expect(typeof mod.registerHook).toBe('function');
  });
});
