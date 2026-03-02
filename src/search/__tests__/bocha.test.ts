import { describe, test, expect, beforeEach } from 'bun:test';
import { BochaProvider } from '../providers/bocha';
import { SearchRegion } from '../types';

describe('BochaProvider', () => {
  let provider: BochaProvider;

  beforeEach(() => {
    provider = new BochaProvider();
  });

  describe('constructor', () => {
    test('creates provider with default config', () => {
      expect(provider.name).toBe('bocha');
      expect(provider.supportedRegions).toContain(SearchRegion.GLOBAL);
      expect(provider.supportedRegions).toContain(SearchRegion.CN);
    });

    test('creates provider with custom config', () => {
      const customProvider = new BochaProvider({
        apiKey: 'test-key',
        timeout: 5000,
      });
      expect(customProvider.isConfigured()).toBe(true);
    });
  });

  describe('isConfigured', () => {
    test('returns false when API key is not set', () => {
      expect(provider.isConfigured()).toBe(false);
    });

    test('returns true when API key is set', () => {
      const configuredProvider = new BochaProvider({ apiKey: 'test-key' });
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
  });

  describe('search', () => {
    test('throws error when not configured', async () => {
      await expect(provider.search({ query: 'test' })).rejects.toThrow('Bocha API key not configured');
    });

    // Integration tests would require actual API key
    test.skip('returns search results when configured', async () => {
      const configuredProvider = new BochaProvider({ apiKey: process.env.BOCHA_API_KEY });
      const results = await configuredProvider.search({
        query: '测试查询',
        numResults: 5,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toBeDefined();
      expect(results[0].url).toBeDefined();
      expect(results[0].snippet).toBeDefined();
      expect(results[0].source).toBe('bocha');
    });

    test.skip('handles time range filters', async () => {
      const configuredProvider = new BochaProvider({ apiKey: process.env.BOCHA_API_KEY });
      const results = await configuredProvider.search({
        query: '最新新闻',
        timeRange: 'day',
      });

      expect(Array.isArray(results)).toBe(true);
    });
  });
});
