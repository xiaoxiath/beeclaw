/**
 * Tests for search/providers/bing.ts
 *
 * Mocks globalThis.fetch to test BingProvider search behavior.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BingProvider } from '../bing';
import { SearchRegion } from '../../types';

describe('BingProvider', () => {
  let provider: BingProvider;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    provider = new BingProvider({ apiKey: 'test-key', timeout: 5000 });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('constructor', () => {
    it('should create with config', () => {
      expect(provider.name).toBe('bing');
    });

    it('should create without config', () => {
      const p = new BingProvider();
      expect(p.name).toBe('bing');
      expect(p.isConfigured()).toBe(false);
    });
  });

  describe('isConfigured', () => {
    it('should return true when API key is set', () => {
      expect(provider.isConfigured()).toBe(true);
    });

    it('should return false when no API key', () => {
      const p = new BingProvider();
      expect(p.isConfigured()).toBe(false);
    });
  });

  describe('supportedRegions', () => {
    it('should support GLOBAL, CN, US', () => {
      expect(provider.supportedRegions).toContain(SearchRegion.GLOBAL);
      expect(provider.supportedRegions).toContain(SearchRegion.CN);
      expect(provider.supportedRegions).toContain(SearchRegion.US);
    });
  });

  describe('search', () => {
    it('should throw if API key not configured', async () => {
      const p = new BingProvider();
      await expect(p.search({ query: 'test' })).rejects.toThrow('Bing API key not configured');
    });

    it('should make fetch request and parse results', async () => {
      globalThis.fetch = async (url: any, init: any) => {
        expect(String(url)).toContain('api.bing.microsoft.com');
        expect(init.headers['Ocp-Apim-Subscription-Key']).toBe('test-key');
        return new Response(JSON.stringify({
          webPages: {
            value: [
              { name: 'Result 1', url: 'https://example.com', snippet: 'Snippet 1' },
              { name: 'Result 2', url: 'https://example2.com', snippet: 'Snippet 2' },
            ],
          },
        }), { status: 200 });
      };

      const results = await provider.search({ query: 'test query' });
      expect(results).toHaveLength(2);
      expect(results[0].title).toBe('Result 1');
      expect(results[0].url).toBe('https://example.com');
      expect(results[0].source).toBe('bing');
    });

    it('should throw on API error', async () => {
      globalThis.fetch = async () => new Response('Error', { status: 403 });
      await expect(provider.search({ query: 'test' })).rejects.toThrow('Bing API error: 403');
    });

    it('should handle timeout (abort)', async () => {
      globalThis.fetch = async (_url: any, init: any) => {
        // Simulate abort
        if (init?.signal) {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          throw err;
        }
        return new Response('{}', { status: 200 });
      };

      await expect(provider.search({ query: 'test' })).rejects.toThrow('Bing search timeout');
    });

    it('should pass timeRange as freshness param', async () => {
      let capturedUrl = '';
      globalThis.fetch = async (url: any) => {
        capturedUrl = String(url);
        return new Response(JSON.stringify({ webPages: { value: [] } }), { status: 200 });
      };

      await provider.search({ query: 'test', timeRange: 'week' });
      expect(capturedUrl).toContain('freshness=Week');
    });

    it('should handle empty results', async () => {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ webPages: { value: [] } }), { status: 200 });

      const results = await provider.search({ query: 'empty' });
      expect(results).toEqual([]);
    });

    it('should handle missing webPages', async () => {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({}), { status: 200 });

      const results = await provider.search({ query: 'no pages' });
      expect(results).toEqual([]);
    });
  });
});
