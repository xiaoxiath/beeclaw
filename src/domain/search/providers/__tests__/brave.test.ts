import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mock global fetch
const originalFetch = globalThis.fetch;
const mockFetch = mock(() => Promise.resolve(new Response(JSON.stringify({
  web: { results: [] },
}))));

beforeEach(() => {
  globalThis.fetch = mockFetch as any;
  mockFetch.mockClear();
});

import { BraveProvider } from '../brave';
import { SearchRegion } from '../../types';

describe('BraveProvider', () => {
  describe('constructor', () => {
    it('creates without config', () => {
      const provider = new BraveProvider();
      expect(provider.name).toBe('brave');
    });

    it('creates with API key', () => {
      const provider = new BraveProvider({ apiKey: 'test-key' });
      expect(provider.name).toBe('brave');
    });
  });

  describe('isConfigured', () => {
    it('returns false without API key', () => {
      const provider = new BraveProvider();
      expect(provider.isConfigured()).toBe(false);
    });

    it('returns true with API key', () => {
      const provider = new BraveProvider({ apiKey: 'test-key' });
      expect(provider.isConfigured()).toBe(true);
    });
  });

  describe('supportedRegions', () => {
    it('supports GLOBAL and US', () => {
      const provider = new BraveProvider();
      expect(provider.supportedRegions).toContain(SearchRegion.GLOBAL);
      expect(provider.supportedRegions).toContain(SearchRegion.US);
    });
  });

  describe('search', () => {
    it('throws without API key', async () => {
      const provider = new BraveProvider();
      await expect(provider.search({ query: 'test' })).rejects.toThrow('API key not configured');
    });

    it('calls Brave API with correct parameters', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
        web: {
          results: [
            { title: 'Test Result', url: 'https://example.com', description: 'A test result' },
          ],
        },
      })));

      const provider = new BraveProvider({ apiKey: 'test-key' });
      const results = await provider.search({ query: 'test query', numResults: 5 });

      expect(mockFetch).toHaveBeenCalled();
      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain('api.search.brave.com');
      expect(callUrl).toContain('test+query');

      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Test Result');
      expect(results[0].source).toBe('brave');
    });

    it('handles time range parameter', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ web: { results: [] } })));

      const provider = new BraveProvider({ apiKey: 'test-key' });
      await provider.search({ query: 'test', timeRange: 'week' });

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain('freshness=pw');
    });

    it('handles API error response', async () => {
      mockFetch.mockResolvedValueOnce(new Response('', { status: 429 }));

      const provider = new BraveProvider({ apiKey: 'test-key' });
      await expect(provider.search({ query: 'test' })).rejects.toThrow('Brave API error: 429');
    });

    it('returns empty array for no results', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ web: { results: [] } })));

      const provider = new BraveProvider({ apiKey: 'test-key' });
      const results = await provider.search({ query: 'noresults' });
      expect(results).toEqual([]);
    });
  });
});

// Restore fetch
afterAll(() => {
  globalThis.fetch = originalFetch;
});

function afterAll(fn: () => void) {
  // Bun test afterAll
  fn();
}
