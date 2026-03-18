/**
 * L1 Format Compressor Tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { L1FormatCompressor, getL1Compressor, resetL1Compressor } from '../l1-format-compressor';

describe('L1FormatCompressor', () => {
  let compressor: L1FormatCompressor;

  beforeEach(() => {
    resetL1Compressor();
    compressor = getL1Compressor();
  });

  describe('compress', () => {
    test('should collapse multiple newlines', () => {
      const text = 'Line 1\n\n\n\nLine 2';
      const result = compressor.compress(text);

      expect(result.compressed).toBe('Line 1\n\nLine 2');
      // Ratio might be small or 0 for very short text due to token estimation
      expect(result.ratio).toBeGreaterThanOrEqual(0);
      expect(result.infoRetention).toBe(0.99);
    });

    test('should trim trailing whitespace', () => {
      const text = 'Line 1   \nLine 2\t\nLine 3  ';
      const result = compressor.compress(text);

      expect(result.compressed).toBe('Line 1\nLine 2\nLine 3');
    });

    test('should collapse multiple spaces', () => {
      const text = 'Word1     Word2   Word3';
      const result = compressor.compress(text);

      expect(result.compressed).toBe('Word1 Word2 Word3');
    });

    test('should remove HTML comments', () => {
      const text = 'Before <!-- this is a comment --> After';
      const result = compressor.compress(text);

      expect(result.compressed).toBe('Before  After');
    });

    test('should remove empty list items', () => {
      const text = '- Item 1\n-\n- Item 2\n*\n- Item 3';
      const result = compressor.compress(text);

      // Empty items are removed but leave blank lines that get collapsed
      expect(result.compressed).toContain('- Item 1');
      expect(result.compressed).toContain('- Item 2');
      expect(result.compressed).toContain('- Item 3');
      expect(result.compressed).not.toMatch(/^-\s*$/m); // No empty items
      expect(result.compressed).not.toMatch(/^\*\s*$/m); // No empty items
    });

    test('should normalize bullet points', () => {
      const text = '* Item 1\n+ Item 2\n- Item 3';
      const result = compressor.compress(text);

      expect(result.compressed).toBe('- Item 1\n- Item 2\n- Item 3');
    });

    test('should strip zero-width characters', () => {
      const text = 'Hello\u200bWorld\u200cTest\ufeff';
      const result = compressor.compress(text);

      expect(result.compressed).toBe('HelloWorldTest');
    });

    test('should handle mixed content', () => {
      const text = `
Line 1


Line 2




Line 3  `;
      const result = compressor.compress(text);

      expect(result.compressed).not.toContain('\n\n\n');
      expect(result.compressed).not.toMatch(/[ \t]$/m);
    });

    test('should track applied rules', () => {
      const text = 'Test\n\n\n\nTest   ';
      const result = compressor.compress(text);

      expect(result.method).toContain('collapse_newlines');
      expect(result.method).toContain('trim_trailing_whitespace');
    });

    test('should measure latency', () => {
      const text = 'Test content';
      const result = compressor.compress(text);

      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.latencyMs).toBeLessThan(10); // Should be very fast
    });

    test('should return original tokens and compressed tokens', () => {
      const text = 'This is a test with multiple words';
      const result = compressor.compress(text);

      expect(result.originalTokens).toBeGreaterThan(0);
      expect(result.compressedTokens).toBeGreaterThan(0);
      expect(result.compressedTokens).toBeLessThanOrEqual(result.originalTokens);
    });

    test('should handle empty text', () => {
      const result = compressor.compress('');

      expect(result.compressed).toBe('');
      expect(result.ratio).toBe(0);
    });

    test('should preserve code blocks', () => {
      const text = '```typescript\nconst x = 1;\nconst y = 2;\n```\n\n\nParagraph';
      const result = compressor.compress(text);

      expect(result.compressed).toContain('```typescript');
      expect(result.compressed).not.toContain('\n\n\n');
    });
  });

  describe('getRules', () => {
    test('should return list of rules', () => {
      const rules = compressor.getRules();

      expect(rules.length).toBeGreaterThan(0);
      expect(rules[0]).toHaveProperty('name');
      expect(rules[0]).toHaveProperty('description');
    });
  });

  describe('addRule', () => {
    test('should add custom rule', () => {
      compressor.addRule({
        name: 'custom_rule',
        pattern: /CUSTOM/g,
        replacement: 'REPLACED',
        description: 'Test rule',
      });

      const result = compressor.compress('Hello CUSTOM World');
      expect(result.compressed).toBe('Hello REPLACED World');
    });
  });

  describe('removeRule', () => {
    test('should remove rule by name', () => {
      const removed = compressor.removeRule('collapse_newlines');
      expect(removed).toBe(true);

      const result = compressor.compress('Line 1\n\n\n\nLine 2');
      // Without collapse_newlines, should keep multiple newlines
      // But final cleanup in compress() still collapses 3+ to 2
      expect(result.compressed).toContain('Line 1');
      expect(result.compressed).toContain('Line 2');
    });

    test('should return false for non-existent rule', () => {
      const removed = compressor.removeRule('non_existent_rule');
      expect(removed).toBe(false);
    });
  });

  describe('singleton', () => {
    test('should return same instance', () => {
      const instance1 = getL1Compressor();
      const instance2 = getL1Compressor();

      expect(instance1).toBe(instance2);
    });

    test('should create new instance after reset', () => {
      const instance1 = getL1Compressor();
      resetL1Compressor();
      const instance2 = getL1Compressor();

      expect(instance1).not.toBe(instance2);
    });
  });
});
