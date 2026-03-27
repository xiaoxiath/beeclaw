import { describe, it, expect, vi } from 'vitest';

describe('adapter/feishu/card-v2/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    // From types
    expect(mod.CardSchema).toBeDefined();
    expect(mod.ElementSchema).toBeDefined();
    expect(mod.Color).toBeDefined();
    // From tool-icon-registry
    expect(typeof mod.ToolIconRegistry).toBe('function');
    expect(mod.toolIconRegistry).toBeDefined();
    // From message-renderer
    expect(typeof mod.renderMessageCard).toBe('function');
    expect(typeof mod.renderStepsPanel).toBe('function');
    // From streaming-controller
    expect(typeof mod.StreamingMessageController).toBe('function');
  });
});
