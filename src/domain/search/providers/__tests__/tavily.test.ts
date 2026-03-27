/**
 * Tests for search/providers/tavily.ts
 *
 * Mocks globalThis.fetch to test TavilyProvider search behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { TavilyProvider } from '../tavily';
import { SearchRegion } from '../../types';

describe('TavilyProvider', () => {
  let provider: TavilyProvider;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    provider = new TavilyProvider({ apiKey: 'tavily-test-key', timeout: 5000 });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('constructor', () => {
    it('should create with config', () => {
      expect(provider.name).toBe('tavily');
    });

    it('should create without config', () => {
      const p = new TavilyProvider();
      expect(p.isConfigured()).toBe(false);
    });
  });

  describe('supportedRegions', () => {
    it('should support GLOBAL and US', () => {
      expect(provider.supportedRegions).toContain(SearchRegion.GLOBAL);
      expect(provider.supportedRegions).toContain(SearchRegion.US);
    });
  });

  describe('search', () => {
    it('should throw if API key not configured', async () => {
      const p = new TavilyProvider();
      await expect(p.search({ query: 'test' })).rejects.toThrow('Tavily API key not configured');
    });

    it('should make POST request and parse results', async () => {
      let capturedBody: any;
      globalThis.fetch = async (_url: any, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({
          results: [
            { title: 'Tavily Result', url: 'https://tavily.com/1', content: 'Found it', score: 0.95 },
          ],
        }), { status: 200 });
      };

      const results = await provider.search({ query: 'test query', numResults: 5 });
      expect(capturedBody.query).toBe('test query');
      expect(capturedBody.max_results).toBe(5);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Tavily Result');
      expect(results[0].source).toBe('tavily');
      expect(results[0].score).toBe(0.95);
    });

    it('should throw on API error', async () => {
      globalThis.fetch = async () => new Response('Unauthorized', { status: 401 });
      await expect(provider.search({ query: 'test' })).rejects.toThrow('Tavily API error: 401');
    });

    it('should handle timeout', async () => {
      globalThis.fetch = async (_url: any, init: any) => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      };

      await expect(provider.search({ query: 'test' })).rejects.toThrow('Tavily search timeout');
    });

    it('should pass days parameter for timeRange', async () => {
      let capturedBody: any;
      globalThis.fetch = async (_url: any, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      };

      await provider.search({ query: 'test', timeRange: 'month' });
      expect(capturedBody.days).toBe(30);
    });

    it('should handle empty results', async () => {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ results: [] }), { status: 200 });

      const results = await provider.search({ query: 'empty' });
      expect(results).toEqual([]);
    });

    it('should handle missing results key', async () => {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({}), { status: 200 });

      const results = await provider.search({ query: 'no results' });
      expect(results).toEqual([]);
    });

    it('should re-throw non-abort errors', async () => {
      globalThis.fetch = async () => {
        throw new Error('Network failure');
      };

      await expect(provider.search({ query: 'test' })).rejects.toThrow('Network failure');
    });
  });
});
