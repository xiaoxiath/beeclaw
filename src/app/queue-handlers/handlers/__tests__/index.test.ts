import { describe, it, expect } from 'bun:test';

describe('app/queue-handlers/handlers/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    expect(typeof mod.handleProactiveJob).toBe('function');
  });
});
