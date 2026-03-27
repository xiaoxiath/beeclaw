import { describe, it, expect } from 'bun:test';
import { deepMerge, cosineSimilarity, sanitizeForCard, safeJsonParse } from '../index';

describe('utils/index', () => {
  describe('deepMerge', () => {
    it('should merge flat objects', () => {
      const result = deepMerge({ a: 1, b: 2 }, { b: 3, c: 4 });
      expect(result).toEqual({ a: 1, b: 3, c: 4 });
    });

    it('should deep merge nested objects', () => {
      const result = deepMerge(
        { server: { port: 3000, host: '0.0.0.0' } },
        { server: { port: 8080 } },
      );
      expect(result).toEqual({ server: { port: 8080, host: '0.0.0.0' } });
    });

    it('should replace arrays (not concatenate)', () => {
      const result = deepMerge(
        { items: [1, 2, 3] },
        { items: [4, 5] },
      );
      expect(result.items).toEqual([4, 5]);
    });

    it('should skip undefined values in source', () => {
      const result = deepMerge({ a: 1, b: 2 }, { a: undefined, b: 3 });
      expect(result).toEqual({ a: 1, b: 3 });
    });

    it('should handle null source gracefully', () => {
      const result = deepMerge({ a: 1 }, null as any);
      expect(result).toEqual({ a: 1 });
    });

    it('should merge multiple sources', () => {
      const result = deepMerge({ a: 1 }, { b: 2 }, { c: 3 });
      expect(result).toEqual({ a: 1, b: 2, c: 3 });
    });

    it('should not mutate the target', () => {
      const target = { a: 1, b: { c: 2 } };
      const result = deepMerge(target, { b: { c: 3 } });
      expect(target.b.c).toBe(2);
      expect(result.b.c).toBe(3);
    });

    it('should replace objects with arrays', () => {
      const result = deepMerge(
        { data: { nested: true } } as any,
        { data: [1, 2, 3] } as any,
      );
      expect(result.data).toEqual([1, 2, 3]);
    });

    it('should replace arrays with objects', () => {
      const result = deepMerge(
        { data: [1, 2, 3] } as any,
        { data: { nested: true } } as any,
      );
      expect(result.data).toEqual({ nested: true });
    });

    it('should handle deeply nested structures', () => {
      const result = deepMerge(
        { a: { b: { c: { d: 1 } } } },
        { a: { b: { c: { e: 2 } } } },
      );
      expect(result).toEqual({ a: { b: { c: { d: 1, e: 2 } } } });
    });
  });

  describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      const result = cosineSimilarity([1, 2, 3], [1, 2, 3]);
      expect(result).toBeCloseTo(1.0, 5);
    });

    it('should return -1 for opposite vectors', () => {
      const result = cosineSimilarity([1, 0], [-1, 0]);
      expect(result).toBeCloseTo(-1.0, 5);
    });

    it('should return 0 for orthogonal vectors', () => {
      const result = cosineSimilarity([1, 0], [0, 1]);
      expect(result).toBeCloseTo(0.0, 5);
    });

    it('should return 0 for different length vectors', () => {
      const result = cosineSimilarity([1, 2], [1, 2, 3]);
      expect(result).toBe(0);
    });

    it('should return 0 for zero vector', () => {
      const result = cosineSimilarity([0, 0, 0], [1, 2, 3]);
      expect(result).toBe(0);
    });

    it('should handle empty vectors', () => {
      const result = cosineSimilarity([], []);
      // Both zero magnitude
      expect(result).toBe(0);
    });

    it('should compute correct similarity for known values', () => {
      const result = cosineSimilarity([1, 1], [1, 0]);
      expect(result).toBeCloseTo(1 / Math.sqrt(2), 5);
    });
  });

  describe('sanitizeForCard', () => {
    it('should escape HTML entities', () => {
      expect(sanitizeForCard('<script>')).toBe('&lt;script&gt;');
    });

    it('should escape ampersands', () => {
      expect(sanitizeForCard('a & b')).toBe('a &amp; b');
    });

    it('should escape quotes', () => {
      expect(sanitizeForCard('"hello"')).toBe('&quot;hello&quot;');
    });

    it('should escape single quotes', () => {
      expect(sanitizeForCard("it's")).toBe('it&#x27;s');
    });

    it('should escape slashes', () => {
      expect(sanitizeForCard('a/b')).toBe('a&#x2F;b');
    });

    it('should return empty string for empty input', () => {
      expect(sanitizeForCard('')).toBe('');
    });

    it('should handle complex injection attempts', () => {
      const input = '<img src="x" onerror="alert(1)">';
      const result = sanitizeForCard(input);
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
      expect(result).not.toContain('"');
    });
  });

  describe('safeJsonParse', () => {
    it('should parse valid JSON', () => {
      const result = safeJsonParse('{"key":"value"}');
      expect(result).toEqual({ key: 'value' });
    });

    it('should parse JSON arrays', () => {
      const result = safeJsonParse('[1, 2, 3]');
      expect(result).toEqual([1, 2, 3]);
    });

    it('should return fallback for invalid JSON', () => {
      const result = safeJsonParse('not json', { default: true });
      expect(result).toEqual({ default: true });
    });

    it('should extract JSON from markdown code blocks', () => {
      const text = 'Here is the result:\n```json\n{"key":"value"}\n```\nDone.';
      const result = safeJsonParse(text);
      expect(result).toEqual({ key: 'value' });
    });

    it('should extract JSON from code blocks without language tag', () => {
      const text = '```\n{"key":"value"}\n```';
      const result = safeJsonParse(text);
      expect(result).toEqual({ key: 'value' });
    });

    it('should extract first JSON object from text', () => {
      const text = 'Some text before {"key":"value"} and after';
      const result = safeJsonParse(text);
      expect(result).toEqual({ key: 'value' });
    });

    it('should extract first JSON array from text', () => {
      const text = 'Result: [1, 2, 3] done.';
      const result = safeJsonParse(text);
      expect(result).toEqual([1, 2, 3]);
    });

    it('should return undefined when nothing matches and no fallback', () => {
      const result = safeJsonParse('completely invalid');
      expect(result).toBeUndefined();
    });

    it('should handle empty string', () => {
      const result = safeJsonParse('', { fallback: true });
      expect(result).toEqual({ fallback: true });
    });

    it('should handle numbers', () => {
      const result = safeJsonParse('42');
      expect(result).toBe(42);
    });

    it('should handle boolean', () => {
      const result = safeJsonParse('true');
      expect(result).toBe(true);
    });

    it('should handle null', () => {
      const result = safeJsonParse('null');
      expect(result).toBeNull();
    });
  });
});
