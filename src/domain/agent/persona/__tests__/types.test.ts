import { describe, it, expect, vi } from 'vitest';

describe('domain/agent/persona/types', () => {
  it('should export zod schemas and constants', async () => {
    const mod = await import('../types');
    expect(mod).toBeDefined();
    expect(mod.MBTI_TYPES).toBeDefined();
    expect(mod.MBTISchema).toBeDefined();
    expect(mod.OCEANSchema).toBeDefined();
    expect(mod.LinguisticStyleSchema).toBeDefined();
    expect(mod.MotivationSchema).toBeDefined();
    expect(mod.TraitsProfileSchema).toBeDefined();
    expect(mod.IdentitySchema).toBeDefined();
    expect(mod.SoulSchema).toBeDefined();
    expect(mod.AgentGuidelinesSchema).toBeDefined();
    expect(mod.UserProfileSchema).toBeDefined();
    expect(mod.PersonaPackageSchema).toBeDefined();
    expect(mod.ExportOptionsSchema).toBeDefined();
    expect(mod.ImportOptionsSchema).toBeDefined();
  });
});
