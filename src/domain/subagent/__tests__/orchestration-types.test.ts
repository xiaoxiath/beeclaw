import { describe, it, expect, vi } from 'vitest';

describe('domain/subagent/orchestration-types', () => {
  it('should be importable', async () => {
    const mod = await import('../orchestration-types');
    expect(mod).toBeDefined();
  });
});
