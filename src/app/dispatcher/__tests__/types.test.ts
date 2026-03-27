import { describe, it, expect, vi } from 'vitest';

describe('app/dispatcher/types', () => {
  it('should be importable', async () => {
    const mod = await import('../types');
    expect(mod).toBeDefined();
  });
});
