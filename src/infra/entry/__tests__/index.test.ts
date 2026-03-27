import { describe, it, expect, vi } from 'vitest';

describe('infra/entry/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    expect(mod.adapterRegistry).toBeDefined();
  });
});
