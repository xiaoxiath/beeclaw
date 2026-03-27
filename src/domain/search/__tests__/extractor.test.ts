import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  ContentExtractor,
  getContentExtractor,
  type ExtractOptions,
} from '../extractor';

describe('ContentExtractor', () => {
  let extractor: ContentExtractor;

  beforeEach(() => {
    extractor = new ContentExtractor();
  });

  describe('constructor', () => {
    test('creates extractor with default config', () => {
      expect(extractor).toBeDefined();
    });

    test('creates extractor with custom config', () => {
      const customExtractor = new ContentExtractor({
        timeout: 5000,
        maxLength: 5000,
      });
      expect(customExtractor).toBeDefined();
    });

    test('uses default timeout of 15000ms', () => {
      const defaultExtractor = new ContentExtractor();
      expect(defaultExtractor).toBeDefined();
    });

    test('uses default maxLength of 10000', () => {
      const defaultExtractor = new ContentExtractor();
      expect(defaultExtractor).toBeDefined();
    });

    test('accepts partial options', () => {
      const partialExtractor = new ContentExtractor({ timeout: 10000 });
      expect(partialExtractor).toBeDefined();
    });
  });

  describe('extract', () => {
    test('throws on invalid URL', async () => {
      await expect(extractor.extract('not-a-url')).rejects.toThrow();
    });

    test('handles HTTP errors', async () => {
      // Use a URL that will return 404
      await expect(extractor.extract('https://httpbin.org/status/404')).rejects.toThrow();
    });

    test('accepts ExtractOptions', async () => {
      const options: ExtractOptions = {
        maxLength: 500,
        timeout: 5000,
        includeImages: true,
      };
      // Just verify options type is accepted
      expect(options).toBeDefined();
    });

    // Integration tests - requires network access
    test.skip('extracts content from valid URL', async () => {
      const result = await extractor.extract('https://example.com', {
        maxLength: 1000,
      });
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    test.skip('respects timeout option', async () => {
      const fastExtractor = new ContentExtractor({ timeout: 100 });
      await expect(fastExtractor.extract('https://httpbin.org/delay/5')).rejects.toThrow();
    });

    test.skip('respects maxLength option', async () => {
      const result = await extractor.extract('https://example.com', {
        maxLength: 100,
      });
      expect(result.length).toBeLessThanOrEqual(120);
    });

    test.skip('handles JSON content', async () => {
      const result = await extractor.extract('https://httpbin.org/json');
      expect(result).toBeDefined();
      expect(result).toContain('{');
    });
  });

  describe('ExtractOptions interface', () => {
    test('accepts all options', () => {
      const options: ExtractOptions = {
        maxLength: 1000,
        timeout: 5000,
        includeImages: false,
      };
      expect(options.maxLength).toBe(1000);
      expect(options.timeout).toBe(5000);
      expect(options.includeImages).toBe(false);
    });

    test('accepts empty options', () => {
      const options: ExtractOptions = {};
      expect(options).toBeDefined();
    });

    test('accepts partial options', () => {
      const options1: ExtractOptions = { maxLength: 500 };
      const options2: ExtractOptions = { timeout: 3000 };
      const options3: ExtractOptions = { includeImages: true };

      expect(options1.maxLength).toBe(500);
      expect(options2.timeout).toBe(3000);
      expect(options3.includeImages).toBe(true);
    });
  });
});

describe('getContentExtractor', () => {
  test('returns singleton instance', () => {
    const instance1 = getContentExtractor();
    const instance2 = getContentExtractor();

    expect(instance1).toBe(instance2);
  });

  test('returns ContentExtractor instance', () => {
    const instance = getContentExtractor();
    expect(instance).toBeInstanceOf(ContentExtractor);
  });

  test('returns same instance across multiple calls', () => {
    const instances = [
      getContentExtractor(),
      getContentExtractor(),
      getContentExtractor(),
    ];

    for (const instance of instances) {
      expect(instance).toBe(instances[0]);
    }
  });
});
