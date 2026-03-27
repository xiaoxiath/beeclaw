import { describe, it, expect } from 'bun:test';

describe('domain/skills/types', () => {
  it('should export zod schemas', async () => {
    const mod = await import('../types');
    expect(mod).toBeDefined();
    expect(mod.SkillFrontmatterSchema).toBeDefined();
    expect(mod.SkillEvolutionConfigSchema).toBeDefined();
  });
});
