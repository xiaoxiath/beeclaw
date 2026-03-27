import { describe, it, expect } from 'bun:test';

describe('domain/memory/types', () => {
  it('should export runtime schemas', async () => {
    const mod = await import('../types');
    expect(mod).toBeDefined();
    expect(mod.MemoryConfigLocalSchema).toBeDefined();
  });
});
