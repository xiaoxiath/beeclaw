import { describe, it, expect, vi } from 'vitest';

describe('domain/skills/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    // Store
    expect(typeof mod.SkillStore).toBe('function');
    expect(typeof mod.getSkillStore).toBe('function');
    expect(typeof mod.resetSkillStore).toBe('function');
    // Tools
    expect(typeof mod.executeSkillTool).toBe('function');
    expect(typeof mod.getSkillToolsForAI).toBe('function');
    expect(mod.skillTools).toBeDefined();
    expect(mod.SKILL_TOOL_NAMES).toBeDefined();
    // Loader
    expect(typeof mod.readMetadata).toBe('function');
    expect(typeof mod.writeMetadata).toBe('function');
    expect(typeof mod.emptyMetadata).toBe('function');
    expect(typeof mod.calculateMaturity).toBe('function');
    expect(typeof mod.hasSecurityIssues).toBe('function');
    // Recommender
    expect(typeof mod.recommendSkillsStandalone).toBe('function');
    expect(typeof mod.calculateRecommendationScore).toBe('function');
  });
});
