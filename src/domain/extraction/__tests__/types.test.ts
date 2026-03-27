import { describe, it, expect, vi } from 'vitest';

describe('domain/extraction/types', () => {
  it('should export runtime constants', async () => {
    const mod = await import('../types');
    expect(mod).toBeDefined();
    expect(mod.DEFAULT_EXTRACTION_CONFIG).toBeDefined();
    expect(mod.DEFAULT_EXTRACTION_CONFIG.enabled).toBe(true);
    expect(mod.DEFAULT_EXTRACTION_CONFIG.periodicInterval).toBe(10);
    expect(mod.DEFAULT_EXTRACTION_CONFIG.confidenceThreshold).toBe(0.9);
  });
});
