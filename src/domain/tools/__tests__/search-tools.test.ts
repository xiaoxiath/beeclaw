import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the search module
const mockSearch = vi.fn(() => Promise.resolve([]));
const mockExtract = vi.fn(() => Promise.resolve('extracted content'));

vi.mock('../../search', () => ({
  getSearchOrchestrator: () => ({
    search: mockSearch,
  }),
  getContentExtractor: () => ({
    extract: mockExtract,
  }),
  SearchRegion: {
    GLOBAL: 'global',
    CN: 'cn',
    US: 'us',
    AUTO: 'auto',
  },
}));

vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../builtin', () => ({
  cleanText: (t: string) => t.trim(),
}));

import {
  webSearchTool,
  executeWebSearch,
  webFetchTool,
  executeWebFetch,
  WebSearchSchema,
  WebFetchSchema,
} from '../search-tools';

describe('search-tools', () => {
  beforeEach(() => {
    mockSearch.mockClear();
    mockExtract.mockClear();
  });

  describe('webSearchTool', () => {
    it('has correct name', () => {
      expect(webSearchTool.name).toBe('web_search');
    });

    it('requires query parameter', () => {
      expect(webSearchTool.parameters.required).toContain('query');
    });

    it('has region enum options', () => {
      expect(webSearchTool.parameters.properties.region.enum).toEqual(['global', 'cn', 'us', 'auto']);
    });
  });

  describe('WebSearchSchema', () => {
    it('validates valid params', () => {
      const result = WebSearchSchema.safeParse({ query: 'test' });
      expect(result.success).toBe(true);
    });

    it('rejects missing query', () => {
      const result = WebSearchSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('defaults num_results to 10', () => {
      const result = WebSearchSchema.safeParse({ query: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.num_results).toBe(10);
      }
    });
  });

  describe('executeWebSearch', () => {
    it('returns error for invalid params', async () => {
      const result = await executeWebSearch({});
      expect(result.success).toBe(false);
    });

    it('returns no results message when empty', async () => {
      mockSearch.mockResolvedValueOnce([]);
      const result = await executeWebSearch({ query: 'nonexistent' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('No results found');
    });

    it('formats search results', async () => {
      mockSearch.mockResolvedValueOnce([
        { title: 'Result 1', url: 'https://example.com', snippet: 'Some snippet', source: 'google' },
        { title: 'Result 2', url: 'https://other.com', snippet: 'Another snippet' },
      ]);
      const result = await executeWebSearch({ query: 'test query' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('Result 1');
      expect(result.data).toContain('https://example.com');
      expect(result.data).toContain('[google]');
      expect(result.data).toContain('Result 2');
    });

    it('handles search error', async () => {
      mockSearch.mockRejectedValueOnce(new Error('Network failure'));
      const result = await executeWebSearch({ query: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Network failure');
    });
  });

  describe('webFetchTool', () => {
    it('has correct name', () => {
      expect(webFetchTool.name).toBe('web_fetch');
    });

    it('requires url parameter', () => {
      expect(webFetchTool.parameters.required).toContain('url');
    });
  });

  describe('WebFetchSchema', () => {
    it('validates valid URL', () => {
      const result = WebFetchSchema.safeParse({ url: 'https://example.com' });
      expect(result.success).toBe(true);
    });

    it('rejects invalid URL', () => {
      const result = WebFetchSchema.safeParse({ url: 'not-a-url' });
      expect(result.success).toBe(false);
    });

    it('defaults format to markdown', () => {
      const result = WebFetchSchema.safeParse({ url: 'https://example.com' });
      if (result.success) {
        expect(result.data.format).toBe('markdown');
      }
    });
  });

  describe('executeWebFetch', () => {
    it('returns error for invalid params', async () => {
      const result = await executeWebFetch({ url: 'not-valid' });
      expect(result.success).toBe(false);
    });

    it('fetches and returns markdown content', async () => {
      mockExtract.mockResolvedValueOnce('# Hello World\nSome content');
      const result = await executeWebFetch({ url: 'https://example.com' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('Hello World');
    });

    it('strips markdown for text format', async () => {
      mockExtract.mockResolvedValueOnce('**bold** and [link](url)');
      const result = await executeWebFetch({ url: 'https://example.com', format: 'text' });
      expect(result.success).toBe(true);
      // Should have markdown chars stripped
      expect(result.data).not.toContain('**');
    });

    it('handles fetch error', async () => {
      mockExtract.mockRejectedValueOnce(new Error('Timeout'));
      const result = await executeWebFetch({ url: 'https://example.com' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Timeout');
    });
  });
});
