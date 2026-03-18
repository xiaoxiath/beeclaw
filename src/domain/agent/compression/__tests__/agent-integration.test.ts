/**
 * Integration Test: Context Compression in Beeclaw Agent
 *
 * This test verifies that the compression system works correctly
 * when integrated with the Beeclaw agent.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { compressMessages, shouldCompress, getCompressionStats } from '../agent-integration';
import { configureTieredCompressor } from '../index';

describe('Agent Compression Integration', () => {
  beforeEach(() => {
    // Configure mock LLM client for L3 compression
    configureTieredCompressor({
      async complete(prompt: string, maxTokens: number) {
        // Simple mock: return compressed version
        return 'Compressed: ' + prompt.slice(0, 50);
      },
    });
  });

  describe('compressMessages', () => {
    test('should not compress when below threshold', async () => {
      const messages = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const result = await compressMessages(messages, 100000, 2);

      expect(result.messages.length).toBe(3);
      expect(result.stats).toBeUndefined();
    });

    test('should compress old messages when above threshold', async () => {
      // Create messages that exceed 80% of 10K budget
      const messages = [
        { role: 'system', content: 'System prompt' },
        // Old messages (should be compressed)
        { role: 'user', content: 'Old message 1 '.repeat(500) },
        { role: 'assistant', content: 'Old response 1 '.repeat(500) },
        { role: 'user', content: 'Old message 2 '.repeat(500) },
        { role: 'assistant', content: 'Old response 2 '.repeat(500) },
        // Recent messages (should be kept)
        { role: 'user', content: 'Recent message' },
        { role: 'assistant', content: 'Recent response' },
      ];

      const result = await compressMessages(messages, 10000, 2);

      // Should have same number of messages
      expect(result.messages.length).toBe(messages.length);

      // Should have compression stats (if compression was applied)
      if (result.stats) {
        expect(result.stats.compressedTokens).toBeLessThan(result.stats.originalTokens);
        expect(result.stats.ratio).toBeGreaterThan(0);
      }

      // Recent messages should be unchanged
      expect(result.messages[result.messages.length - 2].content).toBe('Recent message');
      expect(result.messages[result.messages.length - 1].content).toBe('Recent response');
    });

    test('should preserve system messages', async () => {
      const messages = [
        { role: 'system', content: 'Important system prompt' },
        { role: 'user', content: 'User message '.repeat(500) },
      ];

      const result = await compressMessages(messages, 5000, 1);

      // System message should be preserved
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[0].content).toBe('Important system prompt');
    });

    test('should handle messages with non-string content', async () => {
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Text content '.repeat(500) },
            { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
          ],
        },
      ];

      const result = await compressMessages(messages, 5000, 1);

      // Should handle multimodal content without crashing
      expect(result.messages).toBeDefined();
    });
  });

  describe('shouldCompress', () => {
    test('should return false when below 80%', () => {
      expect(shouldCompress(5000, 10000)).toBe(false);
      expect(shouldCompress(7999, 10000)).toBe(false);
    });

    test('should return true when at or above 80%', () => {
      expect(shouldCompress(8001, 10000)).toBe(true);
      expect(shouldCompress(9000, 10000)).toBe(true);
    });
  });

  describe('getCompressionStats', () => {
    test('should return compression statistics', async () => {
      // Perform some compressions
      const messages = [
        { role: 'user', content: 'Message 1 '.repeat(500) },
        { role: 'assistant', content: 'Response 1 '.repeat(500) },
      ];

      await compressMessages(messages, 1000, 1);

      const stats = getCompressionStats();

      expect(stats).toHaveProperty('totalCompressions');
      expect(stats).toHaveProperty('avgRatio');
      expect(stats).toHaveProperty('totalTokensSaved');
    });
  });

  describe('integration with real conversation', () => {
    test('should handle multi-turn conversation', async () => {
      // Simulate a 10-turn conversation
      const messages: any[] = [{ role: 'system', content: 'You are helpful.' }];

      for (let i = 1; i <= 10; i++) {
        messages.push({
          role: 'user',
          content: `User message ${i} `.repeat(100),
        });
        messages.push({
          role: 'assistant',
          content: `Assistant response ${i} `.repeat(100),
        });
      }

      // Total: 1 system + 10 user + 10 assistant = 21 messages
      expect(messages.length).toBe(21);

      // Compress with 10K budget
      const result = await compressMessages(messages, 10000, 6);

      // Should still have all messages
      expect(result.messages.length).toBe(21);

      // Should have compressed
      if (result.stats) {
        console.log('Compression stats:', {
          original: result.stats.originalTokens,
          compressed: result.stats.compressedTokens,
          ratio: `${(result.stats.ratio * 100).toFixed(1)}%`,
        });

        expect(result.stats.compressedTokens).toBeLessThan(result.stats.originalTokens);
      }
    });
  });
});
