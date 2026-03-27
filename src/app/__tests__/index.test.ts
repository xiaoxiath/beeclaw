import { describe, it, expect, vi } from 'vitest';

describe('app/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    expect(typeof mod.initApp).toBe('function');
    expect(typeof mod.getAgent).toBe('function');
    expect(typeof mod.getProvider).toBe('function');
    expect(typeof mod.getModel).toBe('function');
    expect(typeof mod.switchModel).toBe('function');
    expect(typeof mod.resetApp).toBe('function');
    expect(typeof mod.isInitialized).toBe('function');
    expect(typeof mod.getTokenStatsConfig).toBe('function');
    // Re-exported session functions
    expect(typeof mod.getOrCreateSession).toBe('function');
    expect(typeof mod.listSessions).toBe('function');
    expect(typeof mod.deleteSession).toBe('function');
  });
});
