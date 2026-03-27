import { describe, it, expect } from 'bun:test';

describe('adapter/plugins/manifest/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    expect(typeof mod.loadPluginManifest).toBe('function');
    expect(typeof mod.validatePluginConfig).toBe('function');
  });
});
