import { describe, it, expect, vi } from 'vitest';

describe('adapter/feishu/card-v2/types/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    // From card.ts
    expect(mod.CardConfigSchema).toBeDefined();
    expect(mod.CardSchema).toBeDefined();
    expect(typeof mod.createCard).toBe('function');
    expect(typeof mod.createStreamingConfig).toBe('function');
    // From elements.ts
    expect(mod.MarkdownElementSchema).toBeDefined();
    expect(mod.ElementSchema).toBeDefined();
    expect(typeof mod.createMarkdownElement).toBe('function');
    // From styles.ts
    expect(mod.Color).toBeDefined();
    expect(mod.TextColor).toBeDefined();
    expect(mod.IconToken).toBeDefined();
  });
});
