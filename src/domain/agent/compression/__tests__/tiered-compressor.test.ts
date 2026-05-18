/**
 * Tests for compression/tiered-compressor.ts
 *
 * Covers: TieredCompressor — plan, execute, compress, getStats, resetStats
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — target bee package internals (TieredCompressor now comes from bee)
// ---------------------------------------------------------------------------
vi.mock('../../../../infra/observability/logger', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

// Mock bee's dependencies (resolved via @bee alias in vitest.config.ts)
vi.mock('@bee/core/logger', () => ({
  getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

vi.mock('@bee/context/token-estimator', () => ({
  estimateTokens: (text: string) => Math.ceil(text.length / 3),
}));

const mockL1Compress = vi.fn((text: string) => ({
  compressed: text.replace(/\s+/g, ' ').trim(),
  method: 'L1:format',
}));
vi.mock('@bee/context/compression/l1-format-compressor', () => ({
  L1FormatCompressor: class { compress = mockL1Compress; },
}));

const mockL2Compress = vi.fn((text: string, _ratio: number) => ({
  compressed: text.slice(0, Math.ceil(text.length * 0.6)),
  method: 'L2:extractive',
}));
vi.mock('@bee/context/compression/l2-extractive-compressor', () => ({
  L2ExtractiveCompressor: class { compress = mockL2Compress; },
}));

const mockL3Compress = vi.fn(async (text: string, _target: number) => ({
  compressed: text.slice(0, Math.ceil(text.length * 0.3)),
  method: 'L3:abstractive',
}));
const mockL3SetLLMClient = vi.fn(() => {});
const mockL3SetPreviousSummary = vi.fn(() => {});
vi.mock('@bee/context/compression/l3-abstractive-compressor', () => ({
  L3AbstractiveCompressor: class {
    compress = mockL3Compress;
    setLLMClient = mockL3SetLLMClient;
    setPreviousSummary = mockL3SetPreviousSummary;
  },
}));

import { TieredCompressor, getTieredCompressor, resetTieredCompressor } from '../tiered-compressor';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('TieredCompressor', () => {
  let compressor: TieredCompressor;

  beforeEach(() => {
    resetTieredCompressor();
    compressor = new TieredCompressor();
    mockL1Compress.mockClear();
    mockL2Compress.mockClear();
    mockL3Compress.mockClear();

    // Restore default implementations
    mockL1Compress.mockImplementation((text: string) => ({
      compressed: text.replace(/\s+/g, ' ').trim(),
      method: 'L1:format',
    }));
    mockL2Compress.mockImplementation((text: string) => ({
      compressed: text.slice(0, Math.ceil(text.length * 0.6)),
      method: 'L2:extractive',
    }));
    mockL3Compress.mockImplementation(async (text: string) => ({
      compressed: text.slice(0, Math.ceil(text.length * 0.3)),
      method: 'L3:abstractive',
    }));
  });

  describe('plan', () => {
    it('returns L1 for low utilization (<70%)', () => {
      const plan = compressor.plan(500, 1000);
      expect(plan.level).toBe('L1');
    });

    it('returns L1+L2 for medium utilization (70-85%)', () => {
      const plan = compressor.plan(750, 1000);
      expect(plan.level).toBe('L1+L2');
    });

    it('returns L1+L2+L3 for high utilization (>=85%)', () => {
      const plan = compressor.plan(900, 1000);
      expect(plan.level).toBe('L1+L2+L3');
    });

    it('includes reason in plan', () => {
      const plan = compressor.plan(500, 1000);
      expect(plan.reason).toBeTruthy();
      expect(plan.reason).toContain('50%');
    });
  });

  describe('execute', () => {
    it('applies only L1 for L1 plan', async () => {
      const result = await compressor.execute('hello  world', { level: 'L1', estimatedRatio: 0.15, estimatedLatency: '<1ms', reason: '' });
      expect(mockL1Compress).toHaveBeenCalled();
      expect(mockL2Compress).not.toHaveBeenCalled();
      expect(result.infoRetention).toBe(0.99);
    });

    it('applies L1+L2 for L1+L2 plan', async () => {
      const result = await compressor.execute('some text here', { level: 'L1+L2', estimatedRatio: 0.45, estimatedLatency: '~10ms', reason: '' });
      expect(mockL1Compress).toHaveBeenCalled();
      expect(mockL2Compress).toHaveBeenCalled();
      expect(mockL3Compress).not.toHaveBeenCalled();
      expect(result.infoRetention).toBe(0.85);
    });

    it('applies L1+L2+L3 for full plan', async () => {
      const result = await compressor.execute('long text content here', { level: 'L1+L2+L3', estimatedRatio: 0.75, estimatedLatency: '~1s', reason: '' });
      expect(mockL3Compress).toHaveBeenCalled();
      expect(result.infoRetention).toBe(0.70);
    });

    it('falls back to L2 result when L3 fails (G-P1-04)', async () => {
      mockL3Compress.mockRejectedValue(new Error('LLM unavailable'));

      const result = await compressor.execute('text', { level: 'L1+L2+L3', estimatedRatio: 0.75, estimatedLatency: '~1s', reason: '' });
      expect(result.method).toContain('L3_FALLBACK_TO_L2');
      expect(result.infoRetention).toBe(0.85); // L2 retention level
    });

    it('tracks compression ratio correctly', async () => {
      const text = 'a'.repeat(300);
      const result = await compressor.execute(text, { level: 'L1', estimatedRatio: 0.15, estimatedLatency: '<1ms', reason: '' });
      expect(result.originalTokens).toBeGreaterThan(0);
      expect(result.ratio).toBeGreaterThanOrEqual(0);
      expect(result.ratio).toBeLessThanOrEqual(1);
    });

    it('measures latency', async () => {
      const result = await compressor.execute('text', { level: 'L1', estimatedRatio: 0.15, estimatedLatency: '<1ms', reason: '' });
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('compress (convenience)', () => {
    it('plans and executes in one call', async () => {
      const result = await compressor.compress('some text', 500, 1000);
      expect(result.compressed).toBeTruthy();
      expect(result.originalTokens).toBeGreaterThan(0);
    });

    it('uses default budget when not specified', async () => {
      const result = await compressor.compress('some text');
      expect(result.compressed).toBeTruthy();
    });
  });

  describe('stats', () => {
    it('tracks compression statistics', async () => {
      await compressor.execute('text', { level: 'L1', estimatedRatio: 0.15, estimatedLatency: '<1ms', reason: '' });
      const stats = compressor.getStats();
      expect(stats.totalCompressions).toBe(1);
      expect(stats.byLevel.L1.count).toBe(1);
    });

    it('resetStats clears all stats', async () => {
      await compressor.execute('text', { level: 'L1', estimatedRatio: 0.15, estimatedLatency: '<1ms', reason: '' });
      compressor.resetStats();
      const stats = compressor.getStats();
      expect(stats.totalCompressions).toBe(0);
    });
  });

  describe('setLLMClient', () => {
    it('delegates to L3 compressor', () => {
      const client = { compress: async () => 'compressed' } as any;
      compressor.setLLMClient(client);
      expect(mockL3SetLLMClient).toHaveBeenCalledWith(client);
    });
  });

  describe('singleton', () => {
    it('getTieredCompressor returns same instance', () => {
      const a = getTieredCompressor();
      const b = getTieredCompressor();
      expect(a).toBe(b);
    });

    it('resetTieredCompressor clears instance', () => {
      const a = getTieredCompressor();
      resetTieredCompressor();
      const b = getTieredCompressor();
      expect(a).not.toBe(b);
    });
  });
});
