import { describe, it, expect } from 'bun:test';

describe('types/message-controller', () => {
  it('should be importable', async () => {
    const mod = await import('../message-controller');
    expect(mod).toBeDefined();
  });
});
