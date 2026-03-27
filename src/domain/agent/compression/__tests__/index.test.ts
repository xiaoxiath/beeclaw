import { describe, it, expect } from 'bun:test';

describe('domain/agent/compression/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    expect(mod.DEFAULT_AGE_ZONES).toBeDefined();
    // L1
    expect(typeof mod.L1FormatCompressor).toBe('function');
    expect(typeof mod.getL1Compressor).toBe('function');
    // L2
    expect(typeof mod.L2ExtractiveCompressor).toBe('function');
    expect(typeof mod.getL2Compressor).toBe('function');
    // L3
    expect(typeof mod.L3AbstractiveCompressor).toBe('function');
    expect(typeof mod.getL3Compressor).toBe('function');
    // Tiered
    expect(typeof mod.TieredCompressor).toBe('function');
    expect(typeof mod.getTieredCompressor).toBe('function');
    expect(typeof mod.configureTieredCompressor).toBe('function');
    // Progressive
    expect(typeof mod.ProgressiveCompactor).toBe('function');
    expect(typeof mod.getProgressiveCompactor).toBe('function');
    // Agent integration
    expect(typeof mod.compressMessages).toBe('function');
    expect(typeof mod.shouldCompress).toBe('function');
    // Legacy
    expect(typeof mod.hybridCompress).toBe('function');
  });
});
