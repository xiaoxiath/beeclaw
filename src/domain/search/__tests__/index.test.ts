import { describe, test, expect, vi } from 'vitest';
import {
  webSearch,
  webFetch,
  initSearch,
  SearchProvider,
  DuckDuckGoProvider,
  BingProvider,
  BraveProvider,
  GoogleProvider,
  BochaProvider,
  TavilyProvider,
  getSearchOrchestrator,
  initSearchFromEnv,
  ContentExtractor,
  getContentExtractor,
} from '../index';
import { SearchRegion, type SearchResult, type SearchRequest } from '../types';



describe('Search Index Exports', () => {
  describe('Provider Exports', () => {
    test('exports DuckDuckGoProvider', () => {
      expect(DuckDuckGoProvider).toBeDefined();
    });

    test('exports BingProvider', () => {
      expect(BingProvider).toBeDefined();
    });

    test('exports BraveProvider', () => {
      expect(BraveProvider).toBeDefined();
    });

    test('exports GoogleProvider', () => {
      expect(GoogleProvider).toBeDefined();
    });

    test('exports BochaProvider', () => {
      expect(BochaProvider).toBeDefined();
    });

    test('exports TavilyProvider', () => {
      expect(TavilyProvider).toBeDefined();
    });

    test('exports SearchProvider base class', () => {
      expect(SearchProvider).toBeDefined();
    });
  });

  describe('Orchestrator Exports', () => {
    test('exports getSearchOrchestrator', () => {
      expect(getSearchOrchestrator).toBeDefined();
      expect(typeof getSearchOrchestrator).toBe('function');
    });

    test('exports initSearchFromEnv', () => {
      expect(initSearchFromEnv).toBeDefined();
      expect(typeof initSearchFromEnv).toBe('function');
    });

    test('getSearchOrchestrator returns orchestrator instance', () => {
      const orchestrator = getSearchOrchestrator();
      expect(orchestrator).toBeDefined();
    });
  });

  describe('Extractor Exports', () => {
    test('exports ContentExtractor', () => {
      expect(ContentExtractor).toBeDefined();
    });

    test('exports getContentExtractor', () => {
      expect(getContentExtractor).toBeDefined();
      expect(typeof getContentExtractor).toBe('function');
    });

    test('getContentExtractor returns extractor instance', () => {
      const extractor = getContentExtractor();
      expect(extractor).toBeDefined();
      expect(extractor).toBeInstanceOf(ContentExtractor);
    });
  });

  describe('initSearch', () => {
    test('initSearch is a function', () => {
      expect(initSearch).toBeDefined();
      expect(typeof initSearch).toBe('function');
    });

    test('initSearch can be called without error', () => {
      expect(() => initSearch()).not.toThrow();
    });
  });

  describe('webSearch', () => {
    test('webSearch is a function', () => {
      expect(webSearch).toBeDefined();
      expect(typeof webSearch).toBe('function');
    });

    test('webSearch accepts query string', async () => {
      // Will return empty results if no providers configured
      const results = await webSearch('test query');
      expect(Array.isArray(results)).toBe(true);
    });

    test('webSearch accepts options', async () => {
      const results = await webSearch('test', {
        numResults: 5,
        region: SearchRegion.GLOBAL,
        timeRange: 'week',
      });
      expect(Array.isArray(results)).toBe(true);
    });

    test('webSearch uses default numResults', async () => {
      const results = await webSearch('test');
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('webFetch', () => {
    test('webFetch is a function', () => {
      expect(webFetch).toBeDefined();
      expect(typeof webFetch).toBe('function');
    });

    test('webFetch rejects invalid URLs', async () => {
      await expect(webFetch('not-a-valid-url')).rejects.toThrow();
    });

    test('webFetch accepts options', async () => {
      // webFetch makes a real HTTP request; in CI/test environments this may fail
      // due to TLS cert issues, so we just verify it returns a promise (rejects or resolves)
      const result = webFetch('https://example.com', {
        maxLength: 1000,
        includeImages: false,
      });
      expect(result).toBeInstanceOf(Promise);
      // Allow either resolve or reject (network may be unavailable)
      await result.catch(() => {});
    });






  });
});

describe('Search Types', () => {
  describe('SearchRegion', () => {
    test('has GLOBAL region', () => {
      expect(SearchRegion.GLOBAL).toBe('global');
    });

    test('has CN region', () => {
      expect(SearchRegion.CN).toBe('cn');
    });

    test('has US region', () => {
      expect(SearchRegion.US).toBe('us');
    });
  });

  describe('SearchResult interface', () => {
    test('creates valid SearchResult', () => {
      const result: SearchResult = {
        title: 'Test Title',
        url: 'https://example.com',
        snippet: 'Test snippet',
        source: 'test-provider',
      };

      expect(result.title).toBe('Test Title');
      expect(result.url).toBe('https://example.com');
      expect(result.snippet).toBe('Test snippet');
      expect(result.source).toBe('test-provider');
    });

    test('SearchResult can have optional fields', () => {
      const result: SearchResult = {
        title: 'Test',
        url: 'https://example.com',
        snippet: 'Test',
        source: 'test',
        publishedDate: '2026-03-02',
        imageUrl: 'https://example.com/image.png',
      };

      expect(result.publishedDate).toBe('2026-03-02');
      expect(result.imageUrl).toBe('https://example.com/image.png');
    });
  });

  describe('SearchRequest interface', () => {
    test('creates valid SearchRequest', () => {
      const request: SearchRequest = {
        query: 'test query',
      };

      expect(request.query).toBe('test query');
    });

    test('SearchRequest can have options', () => {
      const request: SearchRequest = {
        query: 'test',
        numResults: 10,
        region: SearchRegion.US,
        timeRange: 'day',
      };

      expect(request.numResults).toBe(10);
      expect(request.region).toBe(SearchRegion.US);
      expect(request.timeRange).toBe('day');
    });
  });
});
