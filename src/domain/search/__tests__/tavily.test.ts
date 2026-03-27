import { describe, test, expect, beforeEach, vi } from 'vitest';
import { TavilyProvider } from '../providers/tavily';
import { SearchRegion } from '../types';

describe('TavilyProvider', () => {
  let provider: TavilyProvider;

  beforeEach(() => {
    provider = new TavilyProvider();
  });

  describe('constructor', () => {
    test('creates provider with default config', () => {
      expect(provider.name).toBe('tavily');
      expect(provider.supportedRegions).toContain(SearchRegion.GLOBAL);
      expect(provider.supportedRegions).toContain(SearchRegion.US);
    });

    test('creates provider with custom config', () => {
      const customProvider = new TavilyProvider({
        apiKey: 'tvly-test-key',
        timeout: 10000,
      });
      expect(customProvider.isConfigured()).toBe(true);
    });
  });

  describe('isConfigured', () => {
    test('returns false when API key is not set', () => {
      expect(provider.isConfigured()).toBe(false);
    });

    test('returns true when API key is set', () => {
      const configuredProvider = new TavilyProvider({ apiKey: 'tvly-test-key' });
      expect(configuredProvider.isConfigured()).toBe(true);
    });
  });

  describe('supportedRegions', () => {
    test('supports GLOBAL region', () => {
      expect(provider.supportedRegions).toContain(SearchRegion.GLOBAL);
    });

    test('supports US region', () => {
      expect(provider.supportedRegions).toContain(SearchRegion.US);
    });
  });

  describe('search', () => {
    test('throws error when not configured', async () => {
      await expect(provider.search({ query: 'test' })).rejects.toThrow('Tavily API key not configured');
    });

    // Integration tests would require actual API key
    test.skip('returns search results when configured', async () => {
      const configuredProvider = new TavilyProvider({ apiKey: process.env.TAVILY_API_KEY });
      const results = await configuredProvider.search({
        query: 'latest AI news',
        numResults: 5,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toBeDefined();
      expect(results[0].url).toBeDefined();
      expect(results[0].snippet).toBeDefined();
      expect(results[0].source).toBe('tavily');
    });

    test.skip('handles time range filters', async () => {
      const configuredProvider = new TavilyProvider({ apiKey: process.env.TAVILY_API_KEY });
      const results = await configuredProvider.search({
        query: 'breaking news',
        timeRange: 'week',
      });

      expect(Array.isArray(results)).toBe(true);
    });

    test.skip('returns score for results', async () => {
      const configuredProvider = new TavilyProvider({ apiKey: process.env.TAVILY_API_KEY });
      const results = await configuredProvider.search({
        query: 'test query',
      });

      // Tavily provides relevance scores
      if (results.length > 0 && results[0].score !== undefined) {
        expect(typeof results[0].score).toBe('number');
      }
    });
  });
});
