import { describe, it, expect } from 'bun:test';

describe('domain/agent/evolution/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    // Reflection trigger
    expect(typeof mod.recordSkillFailure).toBe('function');
    expect(typeof mod.checkConsecutiveFailures).toBe('function');
    expect(typeof mod.clearReflectionTracking).toBe('function');
    expect(typeof mod.shouldTriggerReflection).toBe('function');
    // Preference learning
    expect(typeof mod.detectPreferenceExpressions).toBe('function');
    expect(typeof mod.hasPreferenceExpression).toBe('function');
    expect(typeof mod.checkPreferenceTriggers).toBe('function');
    // Query tracking
    expect(typeof mod.recordQuery).toBe('function');
    expect(typeof mod.detectPatterns).toBe('function');
    expect(typeof mod.getRecentQueries).toBe('function');
    // Self evolution
    expect(typeof mod.initSelfEvolution).toBe('function');
    expect(typeof mod.getSelfEvolutionStatus).toBe('function');
    expect(typeof mod.triggerSelfEvolution).toBe('function');
  });
});
