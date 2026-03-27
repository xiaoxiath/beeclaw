import { describe, it, expect, vi } from 'vitest';

describe('adapter/plugins/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    // Discovery
    expect(typeof mod.discoverPlugins).toBe('function');
    expect(typeof mod.validatePluginSecurity).toBe('function');
    // Manifest
    expect(typeof mod.loadPluginManifest).toBe('function');
    expect(typeof mod.validatePluginConfig).toBe('function');
    // Registry
    expect(typeof mod.getOrCreatePluginRegistry).toBe('function');
    expect(typeof mod.getPluginRegistry).toBe('function');
    expect(typeof mod.resetPluginRegistry).toBe('function');
    // Hook Runner
    expect(typeof mod.createHookRunner).toBe('function');
    // Loader
    expect(typeof mod.loadPlugins).toBe('function');
    // Runtime Shim
    expect(typeof mod.createPluginRuntimeShim).toBe('function');
  });
});
