/**
 * Progressive Compactor Tests
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { ProgressiveCompactor, getProgressiveCompactor, resetProgressiveCompactor } from '../progressive-compactor';
import type { AgeZone, CompressionLLMClient } from '../types';

describe('ProgressiveCompactor', () => {
  let compactor: ProgressiveCompactor;

  // Mock LLM client
  const mockLLMClient: CompressionLLMClient = {
    complete: vi.fn(async (_prompt: string, _maxTokens: number) => {
      // Return simple compressed content, don't use prompt
      return 'Compressed summary';
    }),
  };

  beforeEach(() => {
    resetProgressiveCompactor();
    compactor = getProgressiveCompactor();

    // Configure L3 with mock client
    const tieredCompressor = compactor['compressor'];
    tieredCompressor.setLLMClient(mockLLMClient);
  });

  describe('compact', () => {
    test('should compact messages by age zone', async () => {
      const messages = [
        { turn: 95, role: 'user', content: 'Old message 1' },
        { turn: 97, role: 'assistant', content: 'Old response 1' },
        { turn: 98, role: 'user', content: 'Recent message 2' },
        { turn: 99, role: 'assistant', content: 'Recent response 2' },
        { turn: 100, role: 'user', content: 'Current message' },
      ];

      const result = await compactor.compact(messages, 100);

      expect(result.messages.length).toBe(5);
      expect(result.originalTokens).toBeGreaterThan(0);
      expect(result.compactedTokens).toBeGreaterThan(0);
      expect(result.ratio).toBeGreaterThanOrEqual(0);
    });

    test('should apply different compression levels by zone', async () => {
      const messages = [
        // Cold zone (>50 turns old)
        { turn: 1, role: 'user', content: 'Very old message with some content' },
        // Cool zone (21-50 turns old)
        { turn: 60, role: 'user', content: 'Old message with content' },
        // Warm zone (6-20 turns old)
        { turn: 85, role: 'user', content: 'Warm message' },
        // Hot zone (0-5 turns old)
        { turn: 98, role: 'user', content: 'Recent message' },
      ];

      const result = await compactor.compact(messages, 100);

      // Check zone breakdown
      expect(result.byZone['hot'].count).toBe(1);
      expect(result.byZone['warm'].count).toBe(1);
      expect(result.byZone['cool'].count).toBe(1);
      expect(result.byZone['cold'].count).toBe(1);

      // Hot zone should not be compressed (ratio = 0)
      expect(result.byZone['hot'].compactedTokens).toBe(result.byZone['hot'].originalTokens);

      // Cold zone should be compressed (different compression level applied)
      expect(result.messages[0]).toContain('[user|cold]');
    });

    test('should not compress hot zone', async () => {
      const messages = [
        { turn: 100, role: 'user', content: 'Current message' },
      ];

      const result = await compactor.compact(messages, 100);

      expect(result.messages[0]).toContain('[user]');
      expect(result.messages[0]).not.toContain('[user|');
      expect(result.byZone['hot'].compactedTokens).toBe(result.byZone['hot'].originalTokens);
    });

    test('should compress cold zone with L1+L2+L3', async () => {
      const longContent = 'Word '.repeat(100);
      const messages = [
        { turn: 1, role: 'user', content: longContent },
      ];

      const result = await compactor.compact(messages, 100);

      expect(result.messages[0]).toContain('[user|cold]');
      expect(result.byZone['cold'].compactedTokens).toBeLessThan(
        result.byZone['cold'].originalTokens
      );
    });

    test('should handle empty messages', async () => {
      const result = await compactor.compact([], 100);

      expect(result.messages).toEqual([]);
      expect(result.originalTokens).toBe(0);
      expect(result.compactedTokens).toBe(0);
      expect(result.ratio).toBe(0);
    });

    test('should handle single message', async () => {
      const messages = [
        { turn: 100, role: 'user', content: 'Single message' },
      ];

      const result = await compactor.compact(messages, 100);

      expect(result.messages.length).toBe(1);
      expect(result.ratio).toBe(0); // Hot zone, no compression
    });

    test('should preserve message order', async () => {
      const messages = [
        { turn: 1, role: 'user', content: 'First message' },
        { turn: 50, role: 'user', content: 'Middle message' },
        { turn: 100, role: 'user', content: 'Last message' },
      ];

      const result = await compactor.compact(messages, 100);

      // Check that all messages are present
      expect(result.messages.length).toBe(3);

      // Check order is preserved by checking zone tags
      // Turn 1 -> age 99 -> cold zone
      expect(result.messages[0]).toContain('cold');
      // Turn 50 -> age 50 -> cool zone
      expect(result.messages[1]).toContain('cool');
      // Turn 100 -> age 0 -> hot zone (recent, no compression)
      // Hot zone messages don't have zone tag, just [user]
      expect(result.messages[2]).toMatch(/\[user\]/);
    });

    test('should calculate zone statistics', async () => {
      const messages = [
        { turn: 1, role: 'user', content: 'Old' },
        { turn: 2, role: 'user', content: 'Old' },
        { turn: 99, role: 'user', content: 'Recent' },
      ];

      const result = await compactor.compact(messages, 100);

      expect(result.byZone['cold'].count).toBe(2);
      expect(result.byZone['hot'].count).toBe(1);
    });

    test('should handle compression errors gracefully', async () => {
      // Create a compactor with failing compressor
      const errorLLMClient: CompressionLLMClient = {
        complete: async () => {
          throw new Error('LLM failed');
        },
      };

      const errorCompactor = new ProgressiveCompactor();
      errorCompactor['compressor'].setLLMClient(errorLLMClient);

      const messages = [
        { turn: 1, role: 'user', content: 'Old message that will fail compression' },
      ];

      // Should not throw, should fallback to original
      const result = await errorCompactor.compact(messages, 100);

      expect(result.messages.length).toBe(1);
      expect(result.messages[0]).toContain('Old message');
    });
  });

  describe('getZoneStats', () => {
    test('should return zone statistics', () => {
      const messages = [
        { turn: 1, role: 'user', content: 'Old' },
        { turn: 50, role: 'user', content: 'Middle' },
        { turn: 99, role: 'user', content: 'Recent' },
      ];

      const stats = compactor.getZoneStats(messages, 100);

      expect(stats['cold'].count).toBe(1);
      expect(stats['cool'].count).toBe(1);
      expect(stats['hot'].count).toBe(1);
      expect(stats['cold'].totalTokens).toBeGreaterThan(0);
    });
  });

  describe('getZones', () => {
    test('should return current zone configuration', () => {
      const zones = compactor.getZones();

      expect(zones.length).toBe(4);
      expect(zones[0].name).toBe('hot');
      expect(zones[3].name).toBe('cold');
    });
  });

  describe('setZones', () => {
    test('should update zone configuration', () => {
      const customZones: AgeZone[] = [
        { name: 'fresh', maxAge: 10, compressionLevel: 'none' },
        { name: 'stale', maxAge: Infinity, compressionLevel: 'L1+L2+L3' },
      ];

      compactor.setZones(customZones);

      const zones = compactor.getZones();
      expect(zones.length).toBe(2);
      expect(zones[0].name).toBe('fresh');
    });
  });

  describe('custom zones', () => {
    test('should accept custom zone configuration', async () => {
      const customZones: AgeZone[] = [
        { name: 'recent', maxAge: 3, compressionLevel: 'none' },
        { name: 'old', maxAge: Infinity, compressionLevel: 'L1+L2+L3' },
      ];

      const customCompactor = new ProgressiveCompactor({ zones: customZones });

      // Configure LLM client
      customCompactor['compressor'].setLLMClient(mockLLMClient);

      const messages = [
        { turn: 100, role: 'user', content: 'Recent message' },
        { turn: 90, role: 'user', content: 'Old message with content' },
      ];

      const result = await customCompactor.compact(messages, 100);

      expect(result.byZone['recent'].count).toBe(1);
      expect(result.byZone['old'].count).toBe(1);
    });
  });

  describe('singleton', () => {
    test('should return same instance', () => {
      const instance1 = getProgressiveCompactor();
      const instance2 = getProgressiveCompactor();

      expect(instance1).toBe(instance2);
    });

    test('should create new instance after reset', () => {
      const instance1 = getProgressiveCompactor();
      resetProgressiveCompactor();
      const instance2 = getProgressiveCompactor();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('integration', () => {
    test('should achieve progressive compression over conversation', async () => {
      // Simulate a 100-turn conversation
      const messages: Array<{ turn: number; role: string; content: string }> = [];

      for (let i = 1; i <= 100; i++) {
        const content = `Turn ${i}: ${'Word '.repeat(10)}`;
        messages.push({
          turn: i,
          role: i % 2 === 0 ? 'assistant' : 'user',
          content,
        });
      }

      const result = await compactor.compact(messages, 100);

      // Should have compressed significantly
      expect(result.ratio).toBeGreaterThan(0.3);

      // Hot zone should be uncompressed
      expect(result.byZone['hot'].compactedTokens).toBe(result.byZone['hot'].originalTokens);

      // Cold zone should be most compressed
      const coldRatio =
        1 - result.byZone['cold'].compactedTokens / result.byZone['cold'].originalTokens;
      expect(coldRatio).toBeGreaterThan(0.5);
    });
  });
});
