import { describe, it, expect } from 'bun:test';

describe('domain/tools/categories/finance/providers/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    expect(typeof mod.TushareProvider).toBe('function');
    expect(typeof mod.SinaProvider).toBe('function');
    expect(typeof mod.EastmoneyProvider).toBe('function');
  });
});
