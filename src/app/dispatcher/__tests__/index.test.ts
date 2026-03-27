import { describe, it, expect, vi } from 'vitest';

describe('app/dispatcher/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    expect(typeof mod.TaskDispatcher).toBe('function');
    expect(typeof mod.getTaskDispatcher).toBe('function');
    expect(typeof mod.resetTaskDispatcher).toBe('function');
  });
});
