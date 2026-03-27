import { describe, it, expect } from 'bun:test';

describe('domain/subagent/orchestration-types', () => {
  it('should be importable', async () => {
    const mod = await import('../orchestration-types');
    expect(mod).toBeDefined();
  });
});
