/**
 * Tests for search/providers/bocha.ts
 *
 * Mocks globalThis.fetch to test BochaProvider search behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { BochaProvider } from '../bocha';
import { SearchRegion } from '../../types';

describe('BochaProvider', () => {
  let provider: BochaProvider;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    provider = new BochaProvider({ apiKey: 'bocha-test-key', timeout: 5000 });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('constructor', () => {
    it('should create with config', () => {
      expect(provider.name).toBe('bocha');
    });

    it('should create without config', () => {
      const p = new BochaProvider();
      expect(p.isConfigured()).toBe(false);
    });
  });

  describe('supportedRegions', () => {
    it('should support GLOBAL and CN', () => {
      expect(provider.supportedRegions).toContain(SearchRegion.GLOBAL);
      expect(provider.supportedRegions).toContain(SearchRegion.CN);
    });
  });

  describe('search', () => {
    it('should throw if API key not configured', async () => {
      const p = new BochaProvider();
      await expect(p.search({ query: 'test' })).rejects.toThrow('Bocha API key not configured');
    });

    it('should make POST request and parse results', async () => {
      let capturedBody: any;
      globalThis.fetch = async (_url: any, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({
          data: {
            webPages: {
              value: [
                { name: 'Bocha Result', url: 'https://bocha.com/1', snippet: 'Found' },
              ],
            },
          },
        }), { status: 200 });
      };

      const results = await provider.search({ query: 'test query', numResults: 5 });
      expect(capturedBody.query).toBe('test query');
      expect(capturedBody.count).toBe(5);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Bocha Result');
      expect(results[0].source).toBe('bocha');
    });

    it('should throw on API error', async () => {
      globalThis.fetch = async () => new Response('Bad request', { status: 400 });
      await expect(provider.search({ query: 'test' })).rejects.toThrow('Bocha API error: 400');
    });

    it('should handle timeout', async () => {
      globalThis.fetch = async (_url: any, init: any) => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      };

      await expect(provider.search({ query: 'test' })).rejects.toThrow('Bocha search timeout');
    });

    it('should map timeRange to freshness', async () => {
      let capturedBody: any;
      globalThis.fetch = async (_url: any, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ data: { webPages: { value: [] } } }), { status: 200 });
      };

      await provider.search({ query: 'test', timeRange: 'week' });
      expect(capturedBody.freshness).toBe('oneWeek');
    });

    it('should handle alternative response format', async () => {
      globalThis.fetch = async () => new Response(JSON.stringify({
        webPages: {
          value: [
            { title: 'Alt', link: 'https://alt.com', summary: 'Alt snippet' },
          ],
        },
      }), { status: 200 });

      const results = await provider.search({ query: 'alt' });
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Alt');
      expect(results[0].url).toBe('https://alt.com');
    });
  });
});
