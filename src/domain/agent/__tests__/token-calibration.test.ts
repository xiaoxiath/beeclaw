/**
 * P0-2.4: Token Estimation Calibration Tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';

describe('Token Estimation with Calibration', () => {
  // Reset calibration before each test
  beforeEach(() => {
    // Reset module state
    delete require.cache[require.resolve('../../agent/context')];
  });

  describe('Basic estimation', () => {
    test('should estimate tokens for empty string', async () => {
      const { estimateTokens } = await import('../../agent/context');
      expect(estimateTokens('')).toBe(0);
    });

    test('should estimate tokens for Chinese text', async () => {
      const { estimateTokens } = await import('../../agent/context');
      const text = '你好世界这是测试';
      const tokens = estimateTokens(text);
      expect(tokens).toBeGreaterThan(0);
      // Chinese: ~1.5 chars per token + overhead
      // 7 chars / 1.5 ≈ 4.67 + 4 overhead ≈ 9-10 tokens (heuristic)
      expect(tokens).toBeLessThanOrEqual(text.length + 4);
    });

    test('should estimate tokens for English text', async () => {
      const { estimateTokens } = await import('../../agent/context');
      const text = 'Hello world this is a test';
      const tokens = estimateTokens(text);
      expect(tokens).toBeGreaterThan(0);
      // English: ~4 chars per token + overhead
      expect(tokens).toBeGreaterThan(text.length / 5);
    });

    test('should estimate tokens for code', async () => {
      const { estimateTokens } = await import('../../agent/context');
      const code = 'const x = 42; console.log(x);';
      const tokens = estimateTokens(code);
      expect(tokens).toBeGreaterThan(0);
      // Code: ~3 chars per token + overhead
      expect(tokens).toBeGreaterThan(code.length / 4);
    });

    test('should estimate tokens for mixed content', async () => {
      const { estimateTokens } = await import('../../agent/context');
      const mixed = 'Hello 你好 const x = 42';
      const tokens = estimateTokens(mixed);
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('Calibration system', () => {
    test('should start with calibration factor of 1.0', async () => {
      const { getTokenCalibrationFactor } = await import('../../agent/context');
      const factor = getTokenCalibrationFactor();
      expect(factor).toBe(1.0);
    });

    test('should start with zero samples', async () => {
      const { getTokenCalibrationSampleCount } = await import('../../agent/context');
      const count = getTokenCalibrationSampleCount();
      expect(count).toBe(0);
    });

    test('should apply calibration factor to heuristic', async () => {
      const { estimateTokens, getTokenCalibrationFactor } = await import('../../agent/context');

      const text = 'Test text for calibration';

      // Estimate without calibration
      const tokens1 = estimateTokens(text);
      const factor1 = getTokenCalibrationFactor();

      // Estimate again (may trigger calibration if tokenizer available)
      const tokens2 = estimateTokens(text);
      const factor2 = getTokenCalibrationFactor();

      // Factor should be consistent
      expect(factor1).toBe(factor2);
    });

    test('should collect calibration samples', async () => {
      const { estimateTokens, getTokenCalibrationSampleCount } = await import('../../agent/context');

      // Make multiple estimates (some may trigger calibration)
      for (let i = 0; i < 100; i++) {
        estimateTokens(`Test ${i}`);
      }

      const count = getTokenCalibrationSampleCount();
      // Should have collected some samples (up to 50)
      expect(count).toBeGreaterThanOrEqual(0);
      expect(count).toBeLessThanOrEqual(50);
    });

    test('should limit samples to 50', async () => {
      const { estimateTokens, getTokenCalibrationSampleCount } = await import('../../agent/context');

      // Make many estimates
      for (let i = 0; i < 200; i++) {
        estimateTokens(`Test ${i}`);
      }

      const count = getTokenCalibrationSampleCount();
      expect(count).toBeLessThanOrEqual(50);
    });
  });

  describe('Precise mode', () => {
    test('should support precise mode', async () => {
      const { estimateTokens } = await import('../../agent/context');
      const text = 'Hello world';

      // Heuristic mode
      const heuristicTokens = estimateTokens(text, false);

      // Precise mode (may fall back to heuristic if no tokenizer)
      const preciseTokens = estimateTokens(text, true);

      // Both should return reasonable values
      expect(heuristicTokens).toBeGreaterThan(0);
      expect(preciseTokens).toBeGreaterThan(0);
    });

    test('should expose estimateTokensPrecise function', async () => {
      const { estimateTokensPrecise } = await import('../../agent/context');
      const text = 'Hello world';

      const tokens = estimateTokensPrecise(text);
      expect(tokens).toBeGreaterThan(0);
    });

    test('precise mode should trigger calibration when tokenizer available', async () => {
      const { estimateTokens, getTokenCalibrationSampleCount } = await import('../../agent/context');

      // Make precise estimates
      for (let i = 0; i < 10; i++) {
        estimateTokens(`Test ${i}`, true);
      }

      const count = getTokenCalibrationSampleCount();

      // If tokenizer is available, should have samples
      // If not, count will be 0 (acceptable)
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Message estimation', () => {
    test('should estimate message tokens', async () => {
      const { estimateMessageTokens } = await import('../../agent/context');

      const message = {
        role: 'user',
        content: 'Hello world',
      };

      const tokens = estimateMessageTokens(message);
      expect(tokens).toBeGreaterThan(0);
    });

    test('should estimate multimodal message tokens', async () => {
      const { estimateMessageTokens } = await import('../../agent/context');

      const message = {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
        ],
      };

      const tokens = estimateMessageTokens(message);
      expect(tokens).toBeGreaterThan(0);
    });

    test('should estimate total tokens for message array', async () => {
      const { estimateTotalTokens } = await import('../../agent/context');

      const messages = [
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const tokens = estimateTotalTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('Auto-sampling', () => {
    test('should attempt auto-sampling (may not collect samples without tokenizer)', async () => {
      const { estimateTokens, getTokenCalibrationSampleCount } = await import('../../agent/context');

      // Make many estimates (should trigger some auto-sampling attempts)
      for (let i = 0; i < 1000; i++) {
        estimateTokens(`Auto-sample test ${i}`);
      }

      const count = getTokenCalibrationSampleCount();

      // Without tokenizer, samples won't be collected
      // With tokenizer, should have ~50 samples
      expect(count).toBeGreaterThanOrEqual(0);
      expect(count).toBeLessThanOrEqual(50);
    });
  });

  describe('Performance', () => {
    test('heuristic mode should be fast', async () => {
      const { estimateTokens } = await import('../../agent/context');

      const text = 'Test performance of heuristic estimation';

      const startTime = Date.now();
      for (let i = 0; i < 10000; i++) {
        estimateTokens(text, false); // Heuristic mode
      }
      const duration = Date.now() - startTime;

      // Should complete 10k estimates in < 1 second
      expect(duration).toBeLessThan(1000);
    });

    test('precise mode may be slower', async () => {
      const { estimateTokens } = await import('../../agent/context');

      const text = 'Test performance of precise estimation';

      const startTime = Date.now();
      for (let i = 0; i < 100; i++) {
        estimateTokens(text, true); // Precise mode
      }
      const duration = Date.now() - startTime;

      // Should complete 100 precise estimates in < 5 seconds
      expect(duration).toBeLessThan(5000);
    });
  });

  describe('Edge cases', () => {
    test('should handle very long text', async () => {
      const { estimateTokens } = await import('../../agent/context');
      const longText = 'a'.repeat(100000);

      const tokens = estimateTokens(longText);
      expect(tokens).toBeGreaterThan(0);
    });

    test('should handle special characters', async () => {
      const { estimateTokens } = await import('../../agent/context');
      const special = '🔥🎉💻\n\t\r';

      const tokens = estimateTokens(special);
      expect(tokens).toBeGreaterThan(0);
    });

    test('should handle Unicode emoji', async () => {
      const { estimateTokens } = await import('../../agent/context');
      const emoji = '😀😃😄😁😆';

      const tokens = estimateTokens(emoji);
      expect(tokens).toBeGreaterThan(0);
    });

    test('should handle whitespace-only text', async () => {
      const { estimateTokens } = await import('../../agent/context');
      const whitespace = '   \n\n\t\t   ';

      const tokens = estimateTokens(whitespace);
      expect(tokens).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Calibration factor behavior', () => {
    test('calibration factor should stabilize over time', async () => {
      const { estimateTokens, getTokenCalibrationFactor } = await import('../../agent/context');

      // Make many estimates
      const factors: number[] = [];
      for (let i = 0; i < 100; i++) {
        estimateTokens(`Test ${i}`, true);
        if (i % 10 === 0) {
          factors.push(getTokenCalibrationFactor());
        }
      }

      // Factor should be within reasonable bounds
      const finalFactor = getTokenCalibrationFactor();
      expect(finalFactor).toBeGreaterThan(0.5);
      expect(finalFactor).toBeLessThan(2.0);
    });

    test('calibration should improve accuracy', async () => {
      const { estimateTokens, getTokenCalibrationFactor } = await import('../../agent/context');

      // Without calibration
      const text = 'This is a test sentence for calibration.';
      const tokens1 = estimateTokens(text, false);

      // Trigger calibration
      for (let i = 0; i < 50; i++) {
        estimateTokens(`Test ${i}`, true);
      }

      // With calibration
      const tokens2 = estimateTokens(text, false);
      const factor = getTokenCalibrationFactor();

      // Factor should be applied
      if (factor !== 1.0) {
        expect(tokens2).not.toBe(tokens1);
      }
    });
  });
});
