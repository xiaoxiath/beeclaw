import { describe, it, expect, vi } from 'vitest';

describe('adapter/plugins/sdk-shim/index exports', () => {
  it('should be importable', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
  });
});
