import { describe, it, expect, vi } from 'vitest';

describe('adapter/plugins/runtime-shim/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    expect(typeof mod.createPluginRuntimeCore).toBe('function');
    expect(typeof mod.createChannelRuntimeStub).toBe('function');
    expect(typeof mod.createPluginRuntimeShim).toBe('function');
  });
});
