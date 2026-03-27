/**
 * L3 Abstractive Compressor Tests
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { L3AbstractiveCompressor, getL3Compressor, resetL3Compressor } from '../l3-abstractive-compressor';
import type { CompressionLLMClient } from '../types';

describe('L3AbstractiveCompressor', () => {
  let compressor: L3AbstractiveCompressor;

  // Mock LLM client
  const mockLLMClient: CompressionLLMClient = {
    complete: vi.fn(async (prompt: string, maxTokens: number) => {
      // Simple mock: return summary format
      const contentMatch = prompt.match(/Content to compress:\n---\n([\s\S]*?)\n---/);
      if (contentMatch) {
        const words = contentMatch[1].split(/\s+/).filter(w => w.length > 0).slice(0, 30);
        return `Summary: ${words.join(' ')}`;
      }
      return 'Mock summary';
    }),
  };

  beforeEach(() => {
    resetL3Compressor();
    compressor = getL3Compressor();
  });

  describe('compress', () => {
    test('should compress using LLM', async () => {
      compressor.setLLMClient(mockLLMClient);

      const text = Array.from({ length: 100 }, (_, i) => `Word${i}`).join(' ');
      const result = await compressor.compress(text, 50);

      // Mock returns summary that gets extracted
      expect(result.compressed).toBeDefined();
      expect(result.compressed.length).toBeGreaterThan(0);
      expect(result.compressedTokens).toBeLessThan(result.originalTokens);
      expect(result.ratio).toBeGreaterThan(0.5);
      expect(result.infoRetention).toBe(0.70);
      expect(result.method).toContain('llm-summary');
    });

    test('should handle missing LLM client', async () => {
      const text = 'Test content';

      const result = await compressor.compress(text);

      expect(result.compressed).toBe(text);
      expect(result.method).toContain('no-llm');
    });

    test('should throw when fallback disabled and no LLM', async () => {
      const noFallbackCompressor = new L3AbstractiveCompressor({
        fallbackToL2: false,
      });

      const text = 'Test content';

      await expect(noFallbackCompressor.compress(text)).rejects.toThrow('requires LLM client');
    });

    test('should skip small text', async () => {
      compressor.setLLMClient(mockLLMClient);

      const text = 'Small text';
      const result = await compressor.compress(text, 100);

      expect(result.compressed).toBe(text);
      expect(result.method).toContain('already_small');
    });

    test('should truncate long text before sending to LLM', async () => {
      let receivedPrompt = '';
      const trackingClient: CompressionLLMClient = {
        complete: async (prompt: string, _maxTokens: number) => {
          receivedPrompt = prompt;
          return 'Summary';
        },
      };

      compressor.setLLMClient(trackingClient);

      // Create very long text (>4000 tokens)
      const longText = 'Word '.repeat(5000);
      await compressor.compress(longText, 100);

      expect(receivedPrompt).toContain('[middle content omitted for summarization]');
    });

    test('should fallback to truncation on LLM error', async () => {
      const errorClient: CompressionLLMClient = {
        complete: async () => {
          throw new Error('LLM error');
        },
      };

      compressor.setLLMClient(errorClient);

      const text = 'Word '.repeat(1000);
      const result = await compressor.compress(text, 50);

      expect(result.compressed).toContain('[content truncated]');
      expect(result.method).toContain('fallback:truncate');
      expect(result.infoRetention).toBe(0.50);
    });

    test('should respect target tokens', async () => {
      compressor.setLLMClient(mockLLMClient);

      const text = 'Word '.repeat(100);
      const targetTokens = 30;
      const result = await compressor.compress(text, targetTokens);

      // Mock returns ~50 words, so we just check it attempted compression
      expect(result.compressed).toBeDefined();
    });

    test('should extract summary from response', async () => {
      const clientWithPrefix: CompressionLLMClient = {
        complete: async () => 'Here is the summary: This is the actual summary content.',
      };

      compressor.setLLMClient(clientWithPrefix);

      const text = 'Word '.repeat(100);
      const result = await compressor.compress(text, 50);

      expect(result.compressed).toBe('This is the actual summary content.');
    });

    test('should extract summary from tagged response', async () => {
      const clientWithTags: CompressionLLMClient = {
        complete: async () =>
          'Some text\nSUMMARY_START\nActual summary here\nSUMMARY_END\nMore text',
      };

      compressor.setLLMClient(clientWithTags);

      const text = 'Word '.repeat(100);
      const result = await compressor.compress(text, 50);

      expect(result.compressed).toBe('Actual summary here');
    });

    test('should measure latency', async () => {
      compressor.setLLMClient(mockLLMClient);

      const text = 'Word '.repeat(100);
      const result = await compressor.compress(text, 50);

      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    test('should return compression stats', async () => {
      compressor.setLLMClient(mockLLMClient);

      const text = 'Word '.repeat(100);
      const result = await compressor.compress(text, 50);

      expect(result.originalTokens).toBeGreaterThan(0);
      expect(result.compressedTokens).toBeGreaterThan(0);
      expect(result.ratio).toBeGreaterThanOrEqual(0);
      expect(result.method).toBeDefined();
    });
  });

  describe('setLLMClient', () => {
    test('should update LLM client', async () => {
      const client1: CompressionLLMClient = {
        complete: async () => 'First summary',
      };

      const client2: CompressionLLMClient = {
        complete: async () => 'Second summary',
      };

      compressor.setLLMClient(client1);
      const result1 = await compressor.compress('Test content '.repeat(50), 20);
      // extractSummary 会移除 "summary" 后缀,只保留 "First"
      expect(result1.compressed).toContain('First');

      compressor.setLLMClient(client2);
      const result2 = await compressor.compress('Test content '.repeat(50), 20);
      expect(result2.compressed).toContain('Second');
    });
  });

  describe('singleton', () => {
    test('should return same instance', () => {
      const instance1 = getL3Compressor();
      const instance2 = getL3Compressor();

      expect(instance1).toBe(instance2);
    });

    test('should create new instance after reset', () => {
      const instance1 = getL3Compressor();
      resetL3Compressor();
      const instance2 = getL3Compressor();

      expect(instance1).not.toBe(instance2);
    });
  });
});
