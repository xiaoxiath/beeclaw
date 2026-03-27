import { describe, it, expect, vi } from 'vitest';

describe('domain/sandbox/types', () => {
  it('should be importable', async () => {
    const mod = await import('../types');
    expect(mod).toBeDefined();
    expect(mod.SandboxConfigSchema).toBeDefined();
  });
});
