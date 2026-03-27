import { describe, it, expect } from 'bun:test';

describe('adapter/plugins/registry/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    expect(typeof mod.getOrCreatePluginRegistry).toBe('function');
    expect(typeof mod.getPluginRegistry).toBe('function');
    expect(typeof mod.resetPluginRegistry).toBe('function');
  });
});
