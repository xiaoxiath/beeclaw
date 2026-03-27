import { describe, it, expect } from 'bun:test';

describe('domain/sandbox/types', () => {
  it('should be importable', async () => {
    const mod = await import('../types');
    expect(mod).toBeDefined();
    expect(mod.SandboxConfigSchema).toBeDefined();
  });
});
