import { describe, it, expect, vi } from 'vitest';

describe('domain/search/types', () => {
  it('should export SearchRegion enum', async () => {
    const mod = await import('../types');
    expect(mod).toBeDefined();
    expect(mod.SearchRegion).toBeDefined();
    expect(mod.SearchRegion.GLOBAL).toBe('global');
    expect(mod.SearchRegion.CN).toBe('cn');
    expect(mod.SearchRegion.US).toBe('us');
    expect(mod.SearchRegion.AUTO).toBe('auto');
  });
});
