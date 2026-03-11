import { describe, test, expect } from 'bun:test';
import { SearchProvider } from '../base';
import { SearchRegion } from '../types';
import type { SearchRequest, SearchResult } from '../types';

// Create a concrete implementation for testing
class TestSearchProvider extends SearchProvider {
  name = 'test-provider';
  supportedRegions: SearchRegion[] = [SearchRegion.GLOBAL, SearchRegion.US];

  async search(request: SearchRequest): Promise<SearchResult[]> {
    return [
      {
        title: 'Test Result',
        url: 'https://example.com',
        snippet: 'Test snippet',
        source: this.name,
      },
    ];
  }

  isConfigured(): boolean {
    return true;
  }
}

// Provider that only supports CN region
class CNOnlyProvider extends SearchProvider {
  name = 'cn-provider';
  supportedRegions: SearchRegion[] = [SearchRegion.CN];

  async search(request: SearchRequest): Promise<SearchResult[]> {
    return [];
  }

  isConfigured(): boolean {
    return true;
  }
}

// Provider that supports all regions via GLOBAL
class GlobalProvider extends SearchProvider {
  name = 'global-provider';
  supportedRegions: SearchRegion[] = [SearchRegion.GLOBAL];

  async search(request: SearchRequest): Promise<SearchResult[]> {
    return [];
  }

  isConfigured(): boolean {
    return true;
  }
}

describe('SearchProvider', () => {
  describe('supportsRegion', () => {
    test('returns true for explicitly supported region', () => {
      const provider = new TestSearchProvider();

      expect(provider.supportsRegion(SearchRegion.US)).toBe(true);
      expect(provider.supportsRegion(SearchRegion.GLOBAL)).toBe(true);
    });

    test('returns true for unsupported region if GLOBAL is supported', () => {
      // The supportsRegion method returns true for any region if GLOBAL is supported
      // This is by design - GLOBAL means the provider works everywhere
      const provider = new TestSearchProvider();

      // Provider supports GLOBAL, so CN should also be supported
      expect(provider.supportsRegion(SearchRegion.CN)).toBe(true);
    });

    test('GLOBAL provider supports all regions', () => {
      const provider = new GlobalProvider();

      // A provider that only lists GLOBAL should support all regions
      expect(provider.supportsRegion(SearchRegion.US)).toBe(true);
      expect(provider.supportsRegion(SearchRegion.CN)).toBe(true);
      expect(provider.supportsRegion(SearchRegion.GLOBAL)).toBe(true);
    });

    test('CN-only provider supports only CN', () => {
      const provider = new CNOnlyProvider();

      expect(provider.supportsRegion(SearchRegion.CN)).toBe(true);
      expect(provider.supportsRegion(SearchRegion.US)).toBe(false);
      expect(provider.supportsRegion(SearchRegion.GLOBAL)).toBe(false);
    });
  });

  describe('abstract properties', () => {
    test('has name property', () => {
      const provider = new TestSearchProvider();
      expect(provider.name).toBe('test-provider');
    });

    test('has supportedRegions property', () => {
      const provider = new TestSearchProvider();
      expect(provider.supportedRegions).toContain(SearchRegion.GLOBAL);
      expect(provider.supportedRegions).toContain(SearchRegion.US);
    });
  });

  describe('abstract methods', () => {
    test('search returns results', async () => {
      const provider = new TestSearchProvider();
      const results = await provider.search({ query: 'test' });

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Test Result');
      expect(results[0].source).toBe('test-provider');
    });

    test('isConfigured returns boolean', () => {
      const provider = new TestSearchProvider();
      expect(provider.isConfigured()).toBe(true);
    });
  });
});
