import { describe, it, expect } from 'bun:test';

describe('adapter/plugins/hooks/types', () => {
  it('should be importable', async () => {
    const mod = await import('../types');
    expect(mod).toBeDefined();
  });
});
