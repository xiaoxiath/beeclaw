import { describe, it, expect } from 'bun:test';

describe('adapter/feishu/card-v2/types - card, elements, styles', () => {
  it('should export card schemas and helpers', async () => {
    const mod = await import('../card');
    expect(mod).toBeDefined();
    expect(mod.CardConfigSchema).toBeDefined();
    expect(mod.CardHeaderSchema).toBeDefined();
    expect(mod.CardBodySchema).toBeDefined();
    expect(mod.CardSchema).toBeDefined();
    expect(typeof mod.createCard).toBe('function');
    expect(typeof mod.createStreamingConfig).toBe('function');
    expect(typeof mod.createCardBody).toBe('function');
  });

  it('should export element schemas and helpers', async () => {
    const mod = await import('../elements');
    expect(mod).toBeDefined();
    expect(mod.TextSizeSchema).toBeDefined();
    expect(mod.MarkdownElementSchema).toBeDefined();
    expect(mod.StandardIconElementSchema).toBeDefined();
    expect(mod.PlainTextElementSchema).toBeDefined();
    expect(mod.DivElementSchema).toBeDefined();
    expect(mod.CollapsiblePanelSchema).toBeDefined();
    expect(mod.ChartElementSchema).toBeDefined();
    expect(mod.ButtonElementSchema).toBeDefined();
    expect(mod.ElementSchema).toBeDefined();
    expect(typeof mod.createMarkdownElement).toBe('function');
    expect(typeof mod.createStandardIconElement).toBe('function');
    expect(typeof mod.createPlainTextElement).toBe('function');
    expect(typeof mod.createDivElement).toBe('function');
    expect(typeof mod.createCollapsiblePanel).toBe('function');
    expect(typeof mod.createChartElement).toBe('function');
    expect(typeof mod.createButtonElement).toBe('function');
    expect(typeof mod.createHrElement).toBe('function');
  });

  it('should export style constants', async () => {
    const mod = await import('../styles');
    expect(mod).toBeDefined();
    expect(mod.Color).toBeDefined();
    expect(mod.Color.Blue).toBe('blue');
    expect(mod.TextColor).toBeDefined();
    expect(mod.TextColor.Default).toBe('#1f2329');
    expect(mod.IconToken).toBeDefined();
    expect(mod.IconToken.Search).toBe('search_outlined');
    expect(mod.TextSizeValue).toBeDefined();
    expect(mod.ElementSize).toBeDefined();
  });
});
