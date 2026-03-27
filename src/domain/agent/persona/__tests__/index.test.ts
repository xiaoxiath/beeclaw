import { describe, it, expect } from 'bun:test';

describe('domain/agent/persona/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    // Schemas
    expect(mod.MBTISchema).toBeDefined();
    expect(mod.OCEANSchema).toBeDefined();
    expect(mod.LinguisticStyleSchema).toBeDefined();
    expect(mod.TraitsProfileSchema).toBeDefined();
    expect(mod.IdentitySchema).toBeDefined();
    expect(mod.SoulSchema).toBeDefined();
    expect(mod.PersonaPackageSchema).toBeDefined();
    // Trait utilities
    expect(mod.MBTI_DIMENSIONS).toBeDefined();
    expect(typeof mod.parseMBTI).toBe('function');
    expect(typeof mod.getMBTIDescription).toBe('function');
    expect(mod.DEFAULT_OCEAN).toBeDefined();
    expect(typeof mod.traitsToPromptModifier).toBe('function');
    expect(mod.DEFAULT_TRAITS_PROFILE).toBeDefined();
    // Store
    expect(typeof mod.PersonaStore).toBe('function');
    expect(typeof mod.getPersonaStore).toBe('function');
    expect(typeof mod.resetPersonaStore).toBe('function');
    // Tools
    expect(mod.personaTools).toBeDefined();
    expect(typeof mod.executePersonaTool).toBe('function');
    expect(typeof mod.getPersonaToolsForAI).toBe('function');
  });
});
