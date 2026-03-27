import { describe, it, expect } from 'bun:test';

describe('adapter/plugins/discovery/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    expect(typeof mod.validatePluginSecurity).toBe('function');
    expect(typeof mod.discoverPlugins).toBe('function');
  });
});
