import { describe, it, expect, vi } from 'vitest';

describe('domain/agent/types', () => {
  it('should export runtime values', async () => {
    const mod = await import('../types');
    expect(mod).toBeDefined();
    expect(typeof mod.stripMessageMetadata).toBe('function');
    expect(mod.DEFAULT_VISION_CONFIG).toBeDefined();
    expect(mod.DEFAULT_VISION_CONFIG.visionModel).toBe('glm-4.6v');
    expect(mod.PROACTIVE_DEFAULT_BLOCKED_TOOLS).toBeDefined();
    expect(Array.isArray(mod.PROACTIVE_DEFAULT_BLOCKED_TOOLS)).toBe(true);
  });
});
