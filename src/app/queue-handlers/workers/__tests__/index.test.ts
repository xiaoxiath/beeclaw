import { describe, it, expect, vi } from 'vitest';

describe('app/queue-handlers/workers/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    expect(typeof mod.initWorkers).toBe('function');
    expect(typeof mod.createJobProcessor).toBe('function');
  });
});
