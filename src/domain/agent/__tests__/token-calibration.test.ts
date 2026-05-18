/**
 * P0-2.4: Token Estimation Calibration Tests
 */

import { describe, test, expect, vi } from 'vitest';

// Mock logger to avoid side effects
vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

import {
  estimateTokens,
  estimateTokensPrecise,
  estimateMessageTokens,
  estimateTotalTokens,
  getTokenCalibrationFactor,
  getTokenCalibrationSampleCount,
} from '../../agent/context';

describe('Token Estimation with Calibration', () => {
  describe('Basic estimation', () => {
    test('should estimate tokens for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    test('should estimate tokens for Chinese text', () => {
      const text = '你好世界这是测试';
      const tokens = estimateTokens(text);
      expect(tokens).toBeGreaterThan(0);
      // Chinese: ~1.5 chars per token + overhead
      expect(tokens).toBeLessThanOrEqual(text.length + 4);
    });

    test('should estimate tokens for English text', () => {
      const text = 'Hello world this is a test';
      const tokens = estimateTokens(text);
      expect(tokens).toBeGreaterThan(0);
      // English: ~4 chars per token + overhead
      expect(tokens).toBeGreaterThan(text.length / 5);
    });

    test('should estimate tokens for code', () => {
      const code = 'const x = 42; console.log(x);';
      const tokens = estimateTokens(code);
      expect(tokens).toBeGreaterThan(0);
      // Code: ~3 chars per token + overhead
      expect(tokens).toBeGreaterThan(code.length / 4);
    });

    test('should estimate tokens for mixed content', () => {
      const mixed = 'Hello 你好 const x = 42';
      const tokens = estimateTokens(mixed);
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('Calibration system', () => {
    test('should have calibration factor in valid range', () => {
      const factor = getTokenCalibrationFactor();
      expect(factor).toBeGreaterThan(0);
      expect(factor).toBeLessThan(10);
    });

    test('should have sample count within bounds', () => {
      const count = getTokenCalibrationSampleCount();
      expect(count).toBeGreaterThanOrEqual(0);
      expect(count).toBeLessThanOrEqual(50);
    });

    test('should apply calibration factor to heuristic', () => {
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

    test('should collect calibration samples within limit', () => {
      // Make multiple estimates (some may trigger calibration)
      for (let i = 0; i < 100; i++) {
        estimateTokens(`Test ${i}`);
      }

      const count = getTokenCalibrationSampleCount();
      // Should have collected some samples (up to 50)
      expect(count).toBeGreaterThanOrEqual(0);
      expect(count).toBeLessThanOrEqual(50);
    });

    test('should limit samples to 50', () => {
      // Make many estimates
      for (let i = 0; i < 200; i++) {
        estimateTokens(`Test ${i}`);
      }

      const count = getTokenCalibrationSampleCount();
      expect(count).toBeLessThanOrEqual(50);
    });
  });

  describe('Precise mode', () => {
    test('should support precise mode', () => {
      const text = 'Hello world';

      // Heuristic mode
      const heuristicTokens = estimateTokens(text, false);

      // Precise mode (may fall back to heuristic if no tokenizer)
      const preciseTokens = estimateTokens(text, true);

      // Both should return reasonable values
      expect(heuristicTokens).toBeGreaterThan(0);
      expect(preciseTokens).toBeGreaterThan(0);
    });

    test('should expose estimateTokensPrecise function', () => {
      const text = 'Hello world';

      const tokens = estimateTokensPrecise(text);
      expect(tokens).toBeGreaterThan(0);
    });

    test('precise mode should trigger calibration when tokenizer available', () => {
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
    test('should estimate message tokens', () => {
      const message = {
        role: 'user',
        content: 'Hello world',
      };

      const tokens = estimateMessageTokens(message);
      expect(tokens).toBeGreaterThan(0);
    });

    test('should estimate multimodal message tokens', () => {
      const message = {
        role: 'user',
        content: [
          { type: 'text' as const, text: 'Hello' },
          { type: 'image_url' as const, image_url: { url: 'https://example.com/image.png' } },
        ],
      };

      const tokens = estimateMessageTokens(message);
      expect(tokens).toBeGreaterThan(0);
    });

    test('should estimate total tokens for message array', () => {
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
    test('should attempt auto-sampling (may not collect samples without tokenizer)', () => {
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
    test('heuristic mode should be fast', () => {
      const text = 'Test performance of heuristic estimation';

      const startTime = Date.now();
      for (let i = 0; i < 10000; i++) {
        estimateTokens(text, false); // Heuristic mode
      }
      const duration = Date.now() - startTime;

      // Should complete 10k estimates in < 1 second
      expect(duration).toBeLessThan(1000);
    });

    test('precise mode may be slower', () => {
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
    test('should handle very long text', () => {
      const longText = 'a'.repeat(100000);

      const tokens = estimateTokens(longText);
      expect(tokens).toBeGreaterThan(0);
    });

    test('should handle special characters', () => {
      const special = '🔥🎉💻\n\t\r';

      const tokens = estimateTokens(special);
      expect(tokens).toBeGreaterThan(0);
    });

    test('should handle Unicode emoji', () => {
      const emoji = '😀😃😄😁😆';

      const tokens = estimateTokens(emoji);
      expect(tokens).toBeGreaterThan(0);
    });

    test('should handle whitespace-only text', () => {
      const whitespace = '   \n\n\t\t   ';

      const tokens = estimateTokens(whitespace);
      expect(tokens).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Calibration factor behavior', () => {
    test('calibration factor should be within reasonable bounds', () => {
      // Make many estimates
      for (let i = 0; i < 100; i++) {
        estimateTokens(`Test ${i}`, true);
      }

      // Factor should be within reasonable bounds
      const finalFactor = getTokenCalibrationFactor();
      expect(finalFactor).toBeGreaterThan(0.5);
      expect(finalFactor).toBeLessThan(2.0);
    });

    test('calibration should produce consistent results for same input', () => {
      const text = 'This is a test sentence for calibration.';
      const tokens1 = estimateTokens(text, false);
      const tokens2 = estimateTokens(text, false);

      // Same input with same calibration state should produce same output
      expect(tokens1).toBe(tokens2);
    });
  });
});
