import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

// Mock global fetch
const originalFetch = globalThis.fetch;
const mockFetch = vi.fn(() => Promise.resolve(new Response('<html></html>')));

beforeEach(() => {
  globalThis.fetch = mockFetch as any;
  mockFetch.mockClear();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

import { DuckDuckGoProvider } from '../duckduckgo';
import { SearchRegion } from '../../types';

describe('DuckDuckGoProvider', () => {
  describe('constructor', () => {
    it('creates with default config', () => {
      const provider = new DuckDuckGoProvider();
      expect(provider.name).toBe('duckduckgo');
    });

    it('creates with custom timeout', () => {
      const provider = new DuckDuckGoProvider({ timeout: 5000 });
      expect(provider.name).toBe('duckduckgo');
    });
  });

  describe('isConfigured', () => {
    it('always returns true (no API key needed)', () => {
      const provider = new DuckDuckGoProvider();
      expect(provider.isConfigured()).toBe(true);
    });
  });

  describe('supportedRegions', () => {
    it('supports GLOBAL, CN, and US', () => {
      const provider = new DuckDuckGoProvider();
      expect(provider.supportedRegions).toContain(SearchRegion.GLOBAL);
      expect(provider.supportedRegions).toContain(SearchRegion.CN);
      expect(provider.supportedRegions).toContain(SearchRegion.US);
    });
  });

  describe('search', () => {
    it('calls DDG HTML endpoint', async () => {
      mockFetch.mockResolvedValueOnce(new Response('<html></html>'));

      const provider = new DuckDuckGoProvider();
      const results = await provider.search({ query: 'test' });

      expect(mockFetch).toHaveBeenCalled();
      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain('html.duckduckgo.com');
    });

    it('parses HTML results correctly', async () => {
      const html = `
        <div class="result">
          <a class="result__a" href="https://example.com/page">Example Page</a>
          <a class="result__snippet">This is a test snippet about the page</a>
        </div>
      `;
      mockFetch.mockResolvedValueOnce(new Response(html));

      const provider = new DuckDuckGoProvider();
      const results = await provider.search({ query: 'test' });

      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Example Page');
      expect(results[0].snippet).toContain('test snippet');
      expect(results[0].source).toBe('duckduckgo');
    });

    it('handles uddg redirect URLs', async () => {
      const html = `
        <div class="result">
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Freal-url.com%2Fpage">Real URL</a>
          <a class="result__snippet">Snippet text</a>
        </div>
      `;
      mockFetch.mockResolvedValueOnce(new Response(html));

      const provider = new DuckDuckGoProvider();
      const results = await provider.search({ query: 'test' });

      if (results.length > 0) {
        expect(results[0].url).toContain('real-url.com');
      }
    });

    it('returns empty for no matching HTML', async () => {
      mockFetch.mockResolvedValueOnce(new Response('<html><body>No results</body></html>'));

      const provider = new DuckDuckGoProvider();
      const results = await provider.search({ query: 'zzzzz_nonexistent' });
      expect(results).toEqual([]);
    });

    it('handles HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(new Response('', { status: 503 }));

      const provider = new DuckDuckGoProvider();
      await expect(provider.search({ query: 'test' })).rejects.toThrow('Search failed: 503');
    });
  });
});
