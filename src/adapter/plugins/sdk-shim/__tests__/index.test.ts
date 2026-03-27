import { describe, it, expect } from 'bun:test';

describe('adapter/plugins/sdk-shim/index exports', () => {
  it('should be importable', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
  });
});
