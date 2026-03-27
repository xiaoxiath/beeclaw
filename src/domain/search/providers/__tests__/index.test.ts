import { describe, it, expect, vi } from 'vitest';

describe('domain/search/providers/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    expect(typeof mod.DuckDuckGoProvider).toBe('function');
    expect(typeof mod.BingProvider).toBe('function');
    expect(typeof mod.BraveProvider).toBe('function');
    expect(typeof mod.GoogleProvider).toBe('function');
    expect(typeof mod.BochaProvider).toBe('function');
    expect(typeof mod.TavilyProvider).toBe('function');
  });
});
