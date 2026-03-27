import { describe, it, expect, vi } from 'vitest';

describe('adapter/plugins/loader/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    expect(typeof mod.loadPlugins).toBe('function');
  });
});
