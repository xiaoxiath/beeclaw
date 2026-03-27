import { describe, it, expect, vi } from 'vitest';

describe('infra/db/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    // From schema
    expect(mod.sessions).toBeDefined();
    expect(mod.tasks).toBeDefined();
    // From connection
    expect(typeof mod.initDataConnection).toBe('function');
    expect(typeof mod.getDataConnection).toBe('function');
    expect(typeof mod.closeDataConnection).toBe('function');
  });
});
