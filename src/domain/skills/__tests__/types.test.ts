import { describe, it, expect, vi } from 'vitest';

describe('domain/skills/types', () => {
  it('should export zod schemas', async () => {
    const mod = await import('../types');
    expect(mod).toBeDefined();
    expect(mod.SkillFrontmatterSchema).toBeDefined();
    expect(mod.SkillEvolutionConfigSchema).toBeDefined();
  });
});
