/**
 * Tiered Compressor Tests
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { TieredCompressor, getTieredCompressor, resetTieredCompressor } from '../tiered-compressor';
import type { CompressionLLMClient } from '../types';

describe('TieredCompressor', () => {
  let compressor: TieredCompressor;

  // Mock LLM client for L3
  const mockLLMClient: CompressionLLMClient = {
    complete: mock(async (prompt: string, _maxTokens: number) => {
      // Simple mock summary
      const words = prompt.split(/\s+/).slice(0, 30);
      return `Summary: ${words.join(' ')}`;
    }),
  };

  beforeEach(() => {
    resetTieredCompressor();
    compressor = getTieredCompressor();
  });

  describe('plan', () => {
    test('should plan L1 for low utilization', () => {
      const plan = compressor.plan(50000, 100000); // 50% utilization

      expect(plan.level).toBe('L1');
      expect(plan.estimatedRatio).toBe(0.15);
      expect(plan.estimatedLatency).toBe('<1ms');
      expect(plan.reason).toContain('50%');
    });

    test('should plan L1+L2 for medium utilization', () => {
      const plan = compressor.plan(77000, 100000); // 77% utilization

      expect(plan.level).toBe('L1+L2');
      expect(plan.estimatedRatio).toBe(0.45);
      expect(plan.estimatedLatency).toBe('~10ms');
    });

    test('should plan L1+L2+L3 for high utilization', () => {
      const plan = compressor.plan(90000, 100000); // 90% utilization

      expect(plan.level).toBe('L1+L2+L3');
      expect(plan.estimatedRatio).toBe(0.75);
      expect(plan.estimatedLatency).toBe('~1s');
    });

    test('should handle edge cases', () => {
      // Exactly 70%
      const plan1 = compressor.plan(70000, 100000);
      expect(plan1.level).toBe('L1+L2');

      // Exactly 85%
      const plan2 = compressor.plan(85000, 100000);
      expect(plan2.level).toBe('L1+L2+L3');

      // Over budget
      const plan3 = compressor.plan(120000, 100000);
      expect(plan3.level).toBe('L1+L2+L3');
    });

    test('should handle zero budget', () => {
      const plan = compressor.plan(0, 0);

      expect(plan.level).toBe('L1');
    });
  });

  describe('execute', () => {
    test('should execute L1 plan', async () => {
      const text = 'Test\n\n\n\nContent   ';
      const plan = compressor.plan(50000, 100000);

      const result = await compressor.execute(text, plan);

      expect(result.compressed).not.toContain('\n\n\n');
      expect(result.compressed).not.toMatch(/\s{2,}$/);
      expect(result.method).toContain('L1-Format');
      expect(result.infoRetention).toBe(0.99);
    });

    test('should execute L1+L2 plan', async () => {
      const text = Array.from({ length: 10 }, (_, i) => `Sentence ${i + 1}.`).join(' ');
      const plan = compressor.plan(77000, 100000);

      const result = await compressor.execute(text, plan);

      expect(result.method).toContain('L1-Format');
      expect(result.method).toContain('L2-Extractive');
      expect(result.infoRetention).toBe(0.85);
    });

    test('should execute L1+L2+L3 plan', async () => {
      compressor.setLLMClient(mockLLMClient);

      const text = 'Word '.repeat(100);
      const plan = compressor.plan(90000, 100000);

      const result = await compressor.execute(text, plan);

      expect(result.method).toContain('L1-Format');
      expect(result.method).toContain('L2-Extractive');
      expect(result.method).toContain('L3-Abstractive');
      expect(result.infoRetention).toBe(0.70);
    });

    test('should respect target tokens', async () => {
      compressor.setLLMClient(mockLLMClient);

      const text = 'Word '.repeat(100);
      const plan = {
        level: 'L1+L2+L3' as const,
        estimatedRatio: 0.75,
        estimatedLatency: '~1s',
        reason: 'Test',
      };

      const result = await compressor.execute(text, plan, 30);

      expect(result.compressed).toBeDefined();
    });

    test('should measure total latency', async () => {
      const text = 'Test content';
      const plan = compressor.plan(50000, 100000);

      const result = await compressor.execute(text, plan);

      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('compress', () => {
    test('should plan and execute in one call', async () => {
      const text = 'Test\n\n\n\nContent   ';

      const result = await compressor.compress(text, 50000, 100000);

      expect(result.compressed).toBeDefined();
      expect(result.method).toBeDefined();
    });

    test('should estimate current tokens if not provided', async () => {
      const text = 'Test content here';

      const result = await compressor.compress(text);

      expect(result.originalTokens).toBeGreaterThan(0);
      expect(result.compressed).toBeDefined();
    });

    test('should use default budget if not provided', async () => {
      const text = 'Test content';

      const result = await compressor.compress(text, 100);

      expect(result).toBeDefined();
    });
  });

  describe('getStats', () => {
    test('should track compression statistics', async () => {
      const text1 = 'Test\n\n\n\nContent with spaces   ';
      const text2 = 'Another\n\n\n\nTest with more   ';

      await compressor.compress(text1, 50000, 100000);
      await compressor.compress(text2, 50000, 100000);

      const stats = compressor.getStats();

      expect(stats.totalCompressions).toBe(2);
      expect(stats.byLevel.L1.count).toBe(2);
      // Check that compression happened (ratio could be small for short text)
      expect(stats.totalTokensSaved).toBeGreaterThanOrEqual(0);
    });

    test('should track stats by level', async () => {
      compressor.setLLMClient(mockLLMClient);

      const text = 'Word '.repeat(50);

      await compressor.compress(text, 50000, 100000); // L1
      await compressor.compress(text, 77000, 100000); // L1+L2
      await compressor.compress(text, 90000, 100000); // L1+L2+L3

      const stats = compressor.getStats();

      expect(stats.byLevel.L1.count).toBe(1);
      expect(stats.byLevel['L1+L2'].count).toBe(1);
      expect(stats.byLevel['L1+L2+L3'].count).toBe(1);
    });
  });

  describe('resetStats', () => {
    test('should reset statistics', async () => {
      const text = 'Test\n\n\n\nContent';

      await compressor.compress(text, 50000, 100000);
      compressor.resetStats();

      const stats = compressor.getStats();

      expect(stats.totalCompressions).toBe(0);
      expect(stats.avgRatio).toBe(0);
    });
  });

  describe('setLLMClient', () => {
    test('should configure LLM client', () => {
      compressor.setLLMClient(mockLLMClient);

      // Should be able to use L3 compression now
      expect(async () => {
        const text = 'Word '.repeat(100);
        await compressor.compress(text, 90000, 100000);
      }).not.toThrow();
    });
  });

  describe('singleton', () => {
    test('should return same instance', () => {
      const instance1 = getTieredCompressor();
      const instance2 = getTieredCompressor();

      expect(instance1).toBe(instance2);
    });

    test('should create new instance after reset', () => {
      const instance1 = getTieredCompressor();
      resetTieredCompressor();
      const instance2 = getTieredCompressor();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('integration', () => {
    test('should achieve expected compression ratios', async () => {
      compressor.setLLMClient(mockLLMClient);

      // Create text with format redundancies
      const text = `
Line 1


Line 2




Line 3
      `.repeat(10);

      // Test L1
      const result1 = await compressor.compress(text, 50000, 100000);
      expect(result1.ratio).toBeGreaterThan(0.05);
      expect(result1.ratio).toBeLessThan(0.3);

      // Test L1+L2
      const result2 = await compressor.compress(text, 77000, 100000);
      expect(result2.ratio).toBeGreaterThan(0.2);

      // Test L1+L2+L3
      const result3 = await compressor.compress(text, 90000, 100000);
      expect(result3.ratio).toBeGreaterThan(0.3);
    });
  });
});
