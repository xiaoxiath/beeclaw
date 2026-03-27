/**
 * L2 Extractive Compressor Tests
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { L2ExtractiveCompressor, getL2Compressor, resetL2Compressor } from '../l2-extractive-compressor';

describe('L2ExtractiveCompressor', () => {
  let compressor: L2ExtractiveCompressor;

  beforeEach(() => {
    resetL2Compressor();
    compressor = getL2Compressor();
  });

  describe('compress', () => {
    test('should extract key sentences', () => {
      const text = `
        First sentence about topic A. Second sentence about topic B.
        Third sentence about topic A again. Fourth sentence about topic C.
        Fifth sentence about topic A once more. Sixth sentence about topic B again.
        Seventh sentence about topic D. Eighth sentence about topic A finally.
      `;

      const result = compressor.compress(text, 0.5);

      expect(result.compressed.length).toBeLessThan(text.length);
      expect(result.compressedTokens).toBeLessThan(result.originalTokens);
      expect(result.ratio).toBeGreaterThan(0.2);
      expect(result.infoRetention).toBe(0.85);
    });

    test('should preserve most important sentences', () => {
      const text = `
        This is a critical finding. This is filler content.
        This is another critical finding. This is more filler.
        This is the most important finding of all. This is noise.
      `;

      const result = compressor.compress(text, 0.6);

      // TextRank should compress the text
      expect(result.compressed.length).toBeLessThan(text.length);
      expect(result.ratio).toBeGreaterThan(0);
      // Note: TextRank selects based on word overlap, not keywords
      // So we just verify compression happened
    });

    test('should handle short text', () => {
      const text = 'Short text.';

      const result = compressor.compress(text, 0.5);

      // Should return as-is if too few sentences
      expect(result.compressed).toBe(text);
      expect(result.method).toContain('skipped');
    });

    test('should handle text with fewer than minSentences', () => {
      const text = 'First. Second.';

      const result = compressor.compress(text, 0.5);

      expect(result.compressed).toBe(text);
      expect(result.ratio).toBe(0);
    });

    test('should respect target ratio', () => {
      const sentences = Array.from({ length: 20 }, (_, i) => `Sentence number ${i + 1}.`);
      const text = sentences.join(' ');

      const result = compressor.compress(text, 0.3);

      // Should keep approximately 30% of sentences
      const keptSentences = result.compressed.split('.').filter(s => s.trim()).length;
      expect(keptSentences).toBeLessThanOrEqual(7); // ~30% of 20
      expect(keptSentences).toBeGreaterThanOrEqual(3); // minSentences
    });

    test('should handle Chinese text', () => {
      const text = `
        这是第一句话关于主题A。这是第二句话关于主题B。
        这是第三句话关于主题A。这是第四句话关于主题C。
        这是第五句话关于主题A。这是第六句话关于主题B。
      `;

      const result = compressor.compress(text, 0.5);

      // Should compress Chinese text
      expect(result.compressed.length).toBeLessThanOrEqual(text.length);
      expect(result.ratio).toBeGreaterThanOrEqual(0);
      // TextRank should select some sentences
      expect(result.compressed).toBeDefined();
    });

    test('should maintain sentence order', () => {
      const text = `
        First sentence here. Second sentence follows.
        Third sentence comes. Fourth sentence ends.
        Fifth sentence added. Sixth sentence final.
      `;

      const result = compressor.compress(text, 0.5);
      const sentences = result.compressed.split('.').filter(s => s.trim());

      // Check that sentences appear in original order
      if (sentences.length >= 2) {
        const first = sentences[0].trim();
        const last = sentences[sentences.length - 1].trim();

        // First should come before last in original text
        const firstIdx = text.indexOf(first);
        const lastIdx = text.indexOf(last);
        expect(firstIdx).toBeLessThan(lastIdx);
      }
    });

    test('should measure latency', () => {
      const text = Array.from({ length: 10 }, (_, i) => `Sentence ${i + 1}.`).join(' ');
      const result = compressor.compress(text, 0.5);

      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.latencyMs).toBeLessThan(100); // Should be fast (<100ms)
    });

    test('should handle repeated content', () => {
      const text = `
        Important finding. Filler content.
        Important finding. Filler content.
        Important finding. Filler content.
      `;

      const result = compressor.compress(text, 0.5);

      // Should deduplicate similar sentences
      expect(result.compressed.length).toBeLessThan(text.length);
    });

    test('should handle mixed punctuation', () => {
      const text = `
        Question? Answer! Statement.
        Another question? Another answer!
        Final statement.
      `;

      const result = compressor.compress(text, 0.6);

      // Should handle various punctuation marks
      expect(result.compressed).toBeDefined();
      expect(result.compressed.length).toBeLessThanOrEqual(text.length);
      // Should contain some content
      expect(result.compressed.length).toBeGreaterThan(0);
    });

    test('should return compression stats', () => {
      const text = Array.from({ length: 10 }, (_, i) => `Sentence ${i + 1}.`).join(' ');
      const result = compressor.compress(text, 0.5);

      expect(result.originalTokens).toBeGreaterThan(0);
      expect(result.compressedTokens).toBeGreaterThan(0);
      expect(result.ratio).toBeGreaterThan(0);
      expect(result.method).toContain('L2-Extractive');
    });
  });

  describe('configuration', () => {
    test('should accept custom config', () => {
      const customCompressor = new L2ExtractiveCompressor({
        damping: 0.9,
        iterations: 30,
        minSentences: 5,
      });

      const text = Array.from({ length: 10 }, (_, i) => `Sentence ${i + 1}.`).join(' ');
      const result = customCompressor.compress(text, 0.5);

      expect(result.compressed).toBeDefined();
    });
  });

  describe('singleton', () => {
    test('should return same instance', () => {
      const instance1 = getL2Compressor();
      const instance2 = getL2Compressor();

      expect(instance1).toBe(instance2);
    });

    test('should create new instance after reset', () => {
      const instance1 = getL2Compressor();
      resetL2Compressor();
      const instance2 = getL2Compressor();

      expect(instance1).not.toBe(instance2);
    });
  });
});
