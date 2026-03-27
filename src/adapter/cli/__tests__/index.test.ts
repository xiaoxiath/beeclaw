import { describe, it, expect } from 'bun:test';

describe('adapter/cli/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    expect(typeof mod.LoadingIndicator).toBe('function');
    expect(typeof mod.ProgressIndicator).toBe('function');
    expect(typeof mod.InputHandler).toBe('function');
    expect(typeof mod.formatElapsed).toBe('function');
    expect(typeof mod.withSpinner).toBe('function');
    expect(typeof mod.typeText).toBe('function');
    expect(typeof mod.rewriteLine).toBe('function');
    expect(typeof mod.showTemporaryMessage).toBe('function');
  });
});
