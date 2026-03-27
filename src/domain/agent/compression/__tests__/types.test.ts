import { describe, it, expect } from 'bun:test';

describe('domain/agent/compression/types', () => {
  it('should export runtime constants and be importable', async () => {
    const mod = await import('../types');
    expect(mod).toBeDefined();
    expect(mod.DEFAULT_AGE_ZONES).toBeDefined();
    expect(Array.isArray(mod.DEFAULT_AGE_ZONES)).toBe(true);
    expect(mod.DEFAULT_AGE_ZONES.length).toBe(4);
    expect(mod.DEFAULT_AGE_ZONES[0].name).toBe('hot');
  });
});
