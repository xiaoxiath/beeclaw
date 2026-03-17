import { describe, test, expect, beforeEach } from 'bun:test';
import { BingProvider } from '../providers/bing';
import { BraveProvider } from '../providers/brave';
import { GoogleProvider } from '../providers/google';
import { DuckDuckGoProvider } from '../providers/duckduckgo';
import { SearchRegion } from '../types';

describe('BingProvider', () => {
  let provider: BingProvider;

  beforeEach(() => {
    provider = new BingProvider();
  });

  describe('constructor', () => {
    test('creates provider with default config', () => {
      expect(provider.name).toBe('bing');
      expect(provider.supportedRegions).toContain(SearchRegion.GLOBAL);
      expect(provider.supportedRegions).toContain(SearchRegion.CN);
      expect(provider.supportedRegions).toContain(SearchRegion.US);
    });

    test('creates provider with custom config', () => {
      const customProvider = new BingProvider({
        apiKey: 'test-key',
        timeout: 10000,
      });
      expect(customProvider.isConfigured()).toBe(true);
    });

    test('creates provider with custom timeout', () => {
      const customProvider = new BingProvider({
        timeout: 5000,
      });
      expect(customProvider.timeout).toBe(5000);
    });
  });

  describe('isConfigured', () => {
    test('returns false when API key is not set', () => {
      expect(provider.isConfigured()).toBe(false);
    });

    test('returns true when API key is set', () => {
      const configuredProvider = new BingProvider({ apiKey: 'tvly-test-key' });
      expect(configuredProvider.isConfigured()).toBe(true);
    });
  });

  describe('supportedRegions', () => {
    test('supports GLOBAL region', () => {
      expect(provider.supportedRegions).toContain(SearchRegion.GLOBAL);
    });

    test('supports CN region', () => {
      expect(provider.supportedRegions).toContain(SearchRegion.CN);
    });

    test('supports US region', () => {
      expect(provider.supportedRegions).toContain(SearchRegion.US);
    });
  });

  describe('search', () => {
    test('throws error when not configured', async () => {
      await expect(provider.search({ query: 'test' })).rejects.toThrow('Bing API key not configured');
    });

    // Integration tests would require actual API key
    test.skip('returns search results when configured', async () => {
      const configuredProvider = new BingProvider({ apiKey: process.env.BING_API_KEY });
      const results = await configuredProvider.search({
        query: 'latest AI news',
        numResults: 5,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toBeDefined();
      expect(results[0].url).toBeDefined();
      expect(results[0].snippet).toBeDefined();
      expect(results[0].source).toBe('bing');
    });

    test.skip('handles time range filters', async () => {
      const configuredProvider = new BingProvider({ apiKey: process.env.BING_API_KEY });
      const results = await configuredProvider.search({
        query: 'breaking news',
        timeRange: 'week',
      });

      expect(Array.isArray(results)).toBe(true);
    });

    test.skip('handles region parameter', async () => {
      const configuredProvider = new BingProvider({ apiKey: process.env.BING_API_KEY });
      const results = await configuredProvider.search({
        query: 'test',
        region: SearchRegion.CN,
        numResults: 10,
      });

      expect(results.length).toBe(10);
      expect(results[0].title).toBeDefined();
      expect(results[0].url).toBeDefined();
      expect(results[0].snippet).toBeDefined();
      expect(results[0].source).toBe('bing');
    });
  });
});

describe('BraveProvider', () => {
  let provider: BraveProvider;

  beforeEach(() => {
    provider = new BraveProvider();
  });

  describe('constructor', () => {
    test('creates provider with default config', () => {
      expect(provider.name).toBe('brave');
      expect(provider.supportedRegions).toContain(SearchRegion.GLOBAL);
      expect(provider.supportedRegions).toContain(SearchRegion.US);
    });

    test('creates provider with custom config', () => {
      const customProvider = new BraveProvider({
        apiKey: 'test-key',
        timeout: 10000,
      });
      expect(customProvider.isConfigured()).toBe(true);
    });

    test('creates provider with custom timeout', () => {
      const customProvider = new BraveProvider({
        timeout: 5000,
      });
      expect(customProvider.timeout).toBe(5000);
    });
  });

  describe('isConfigured', () => {
    test('returns false when API key is not set', () => {
      expect(provider.isConfigured()).toBe(false);
    });

    test('returns true when API key is set', () => {
      const configuredProvider = new BraveProvider({ apiKey: 'test-key' });
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

    test('does not support CN region', () => {
      expect(provider.supportedRegions).not.toContain(SearchRegion.CN);
    });
  });

  describe('search', () => {
    test('throws error when not configured', async () => {
      await expect(provider.search({ query: 'test' })).rejects.toThrow('Brave API key not configured');
    });

    // Integration tests would require actual API key
    test.skip('returns search results when configured', async () => {
      const configuredProvider = new BraveProvider({ apiKey: process.env.BRAVE_API_KEY });
      const results = await configuredProvider.search({
        query: 'latest AI news',
        numResults: 5,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toBeDefined();
      expect(results[0].url).toBeDefined();
      expect(results[0].snippet).toBeDefined();
      expect(results[0].source).toBe('brave');
    });

    test.skip('handles time range filters', async () => {
      const configuredProvider = new BraveProvider({ apiKey: process.env.BRAVE_API_KEY });
      const results = await configuredProvider.search({
        query: 'breaking news',
        timeRange: 'day',
      });

      expect(Array.isArray(results)).toBe(true);
    });

    test.skip('handles region parameter', async () => {
      const configuredProvider = new BraveProvider({ apiKey: process.env.BRAVE_API_KEY });
      const results = await configuredProvider.search({
        query: 'test',
        region: SearchRegion.US,
        numResults: 10,
      });

      expect(results.length).toBe(10);
      expect(results[0].title).toBeDefined();
      expect(results[0].url).toBeDefined();
      expect(results[0].snippet).toBeDefined();
      expect(results[0].source).toBe('brave');
    });
  });
});

describe('GoogleProvider', () => {
  let provider: GoogleProvider;

  beforeEach(() => {
    provider = new GoogleProvider();
  });

  describe('constructor', () => {
    test('creates provider with default config', () => {
      expect(provider.name).toBe('google');
      expect(provider.supportedRegions).toContain(SearchRegion.GLOBAL);
      expect(provider.supportedRegions).toContain(SearchRegion.US);
    });

    test('creates provider with custom config', () => {
      const customProvider = new GoogleProvider({
        apiKey: 'test-key',
        cx: 'test-cx',
        timeout: 10000,
      });
      expect(customProvider.isConfigured()).toBe(true);
    });

    test('requires both apiKey and cx', () => {
      const partialProvider = new GoogleProvider({ apiKey: 'test-key' });
      expect(partialProvider.isConfigured()).toBe(false);

      const partialProvider2 = new GoogleProvider({ cx: 'test-cx' });
      expect(partialProvider2.isConfigured()).toBe(false);
    });

    test('returns true when both set', () => {
      const configuredProvider = new GoogleProvider({
        apiKey: 'test-key',
        cx: 'test-cx',
      });
      expect(configuredProvider.isConfigured()).toBe(true);
    });

    test('creates provider with custom timeout', () => {
      const customProvider = new GoogleProvider({
        timeout: 5000,
      });
      expect(customProvider.timeout).toBe(5000);
    });
  });

  describe('isConfigured', () => {
    test('returns false when API key is not set', () => {
      expect(provider.isConfigured()).toBe(false);
    });

    test('returns false when CX is not set', () => {
      const partialProvider = new GoogleProvider({ apiKey: 'test-key' });
      expect(partialProvider.isConfigured()).toBe(false);
    });

    test('returns false when only CX is set', () => {
      const partialProvider = new GoogleProvider({ cx: 'test-cx' });
      expect(partialProvider.isConfigured()).toBe(false);
    });

    test('returns true when both set', () => {
      const configuredProvider = new GoogleProvider({
        apiKey: 'test-key',
        cx: 'test-cx',
      });
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

    test('does not support CN region', () => {
      expect(provider.supportedRegions).not.toContain(SearchRegion.CN);
    });
  });

  describe('search', () => {
    test('throws error when not configured', async () => {
      await expect(provider.search({ query: 'test' })).rejects.toThrow('Google API key and CX');
    });

    // Integration tests would require actual API key
    test.skip('returns search results when configured', async () => {
      const configuredProvider = new GoogleProvider({
        apiKey: process.env.GOOGLE_SEARCH_API_KEY,
        cx: process.env.GOOGLE_SEARCH_CX,
      });
      const results = await configuredProvider.search({
        query: 'latest AI news',
        numResults: 5,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toBeDefined();
      expect(results[0].url).toBeDefined();
      expect(results[0].snippet).toBeDefined();
      expect(results[0].source).toBe('google');
    });

    test.skip('handles language parameter', async () => {
      const configuredProvider = new GoogleProvider({
        apiKey: process.env.GOOGLE_SEARCH_API_KEY,
        cx: process.env.GOOGLE_SEARCH_CX,
      });
      const results = await configuredProvider.search({
        query: 'test query',
        language: 'en',
      });

      expect(Array.isArray(results)).toBe(true);
    });
  });
});

describe('DuckDuckGoProvider', () => {
  let provider: DuckDuckGoProvider;

  beforeEach(() => {
    provider = new DuckDuckGoProvider();
  });

  describe('constructor', () => {
    test('creates provider with default config', () => {
      expect(provider.name).toBe('duckduckgo');
      expect(provider.supportedRegions).toContain(SearchRegion.GLOBAL);
      expect(provider.supportedRegions).toContain(SearchRegion.CN);
      expect(provider.supportedRegions).toContain(SearchRegion.US);
    });

    test('creates provider with custom config', () => {
      const customProvider = new DuckDuckGoProvider({
        timeout: 10000,
      });
      expect(customProvider.isConfigured()).toBe(true);
    });
  });

  describe('isConfigured', () => {
    test('returns true (no API key required)', () => {
      // DuckDuckGo doesn't require an API key
      expect(provider.isConfigured()).toBe(true);
    });
  });

  describe('supportedRegions', () => {
    test('supports all regions', () => {
      expect(provider.supportedRegions.length).toBe(3);
    });
  });

  describe('search', () => {
    // DuckDuckGo doesn't require configuration, so no "not configured" test
    test.skip('returns search results', async () => {
      const results = await provider.search({
        query: 'test query',
        numResults: 10,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toBeDefined();
      expect(results[0].url).toBeDefined();
      expect(results[0].snippet).toBeDefined();
      expect(results[0].source).toBe('duckduckgo');
    });
  });
});
