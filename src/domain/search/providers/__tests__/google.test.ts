import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';

// Mock global fetch
const originalFetch = globalThis.fetch;
const mockFetch = mock(() => Promise.resolve(new Response(JSON.stringify({ items: [] }))));

beforeEach(() => {
  globalThis.fetch = mockFetch as any;
  mockFetch.mockClear();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

import { GoogleProvider } from '../google';
import { SearchRegion } from '../../types';

describe('GoogleProvider', () => {
  describe('constructor', () => {
    it('creates without config', () => {
      const provider = new GoogleProvider();
      expect(provider.name).toBe('google');
    });

    it('creates with API key and CX', () => {
      const provider = new GoogleProvider({ apiKey: 'key', cx: 'cx-id' });
      expect(provider.name).toBe('google');
    });
  });

  describe('isConfigured', () => {
    it('returns false without API key', () => {
      expect(new GoogleProvider().isConfigured()).toBe(false);
    });

    it('returns false with only API key', () => {
      expect(new GoogleProvider({ apiKey: 'key' }).isConfigured()).toBe(false);
    });

    it('returns false with only CX', () => {
      expect(new GoogleProvider({ cx: 'cx-id' }).isConfigured()).toBe(false);
    });

    it('returns true with both API key and CX', () => {
      expect(new GoogleProvider({ apiKey: 'key', cx: 'cx-id' }).isConfigured()).toBe(true);
    });
  });

  describe('supportedRegions', () => {
    it('supports GLOBAL and US', () => {
      const provider = new GoogleProvider();
      expect(provider.supportedRegions).toContain(SearchRegion.GLOBAL);
      expect(provider.supportedRegions).toContain(SearchRegion.US);
    });
  });

  describe('search', () => {
    it('throws without API key and CX', async () => {
      const provider = new GoogleProvider();
      await expect(provider.search({ query: 'test' })).rejects.toThrow('API key and CX');
    });

    it('calls Google API with correct params', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
        items: [
          { title: 'Google Result', link: 'https://google.test', snippet: 'Google snippet' },
        ],
      })));

      const provider = new GoogleProvider({ apiKey: 'key', cx: 'cx-id' });
      const results = await provider.search({ query: 'search term', numResults: 5 });

      expect(mockFetch).toHaveBeenCalled();
      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain('googleapis.com/customsearch');
      expect(callUrl).toContain('key=key');
      expect(callUrl).toContain('cx=cx-id');

      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Google Result');
      expect(results[0].url).toBe('https://google.test');
      expect(results[0].source).toBe('google');
    });

    it('handles API error response', async () => {
      mockFetch.mockResolvedValueOnce(new Response('', { status: 403 }));

      const provider = new GoogleProvider({ apiKey: 'key', cx: 'cx-id' });
      await expect(provider.search({ query: 'test' })).rejects.toThrow('Google API error: 403');
    });

    it('returns empty for no items', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({})));

      const provider = new GoogleProvider({ apiKey: 'key', cx: 'cx-id' });
      const results = await provider.search({ query: 'noresults' });
      expect(results).toEqual([]);
    });

    it('caps numResults at 10', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ items: [] })));

      const provider = new GoogleProvider({ apiKey: 'key', cx: 'cx-id' });
      await provider.search({ query: 'test', numResults: 20 });

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain('num=10');
    });
  });
});
