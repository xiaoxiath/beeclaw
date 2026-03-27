import { describe, it, expect, vi } from 'vitest';

describe('adapter/plugins/hook-runner/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    expect(typeof mod.createHookRunner).toBe('function');
  });
});
