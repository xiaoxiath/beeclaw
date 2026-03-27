import { describe, it, expect } from 'bun:test';

describe('infra/entry/types', () => {
  it('should be importable', async () => {
    const mod = await import('../types');
    expect(mod).toBeDefined();
  });
});
