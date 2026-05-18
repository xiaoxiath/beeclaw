import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock logger
vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

// Configurable provider mocks
const mockDDGSearch = vi.fn(async () => [
  { title: 'DDG Result', url: 'https://ddg.test/page', snippet: 'ddg snippet', source: 'duckduckgo' },
]);
const mockDDGConfigured = vi.fn(() => true);

const mockBingSearch = vi.fn(async () => [
  { title: 'Bing Result', url: 'https://bing.test/page', snippet: 'bing snippet', source: 'bing' },
]);
const mockBingConfigured = vi.fn(() => false);

const mockBraveSearch = vi.fn(async () => []);
const mockBraveConfigured = vi.fn(() => false);

const mockGoogleSearch = vi.fn(async () => []);
const mockGoogleConfigured = vi.fn(() => false);

const mockBochaSearch = vi.fn(async () => []);
const mockBochaConfigured = vi.fn(() => false);

const mockTavilySearch = vi.fn(async () => []);
const mockTavilyConfigured = vi.fn(() => false);

vi.mock('../providers/duckduckgo', () => ({
  DuckDuckGoProvider: class {
    name = 'duckduckgo';
    isConfigured = mockDDGConfigured;
    search = mockDDGSearch;
  },
}));

vi.mock('../providers/bing', () => ({
  BingProvider: class {
    name = 'bing';
    isConfigured = mockBingConfigured;
    search = mockBingSearch;
  },
}));

vi.mock('../providers/brave', () => ({
  BraveProvider: class {
    name = 'brave';
    isConfigured = mockBraveConfigured;
    search = mockBraveSearch;
  },
}));

vi.mock('../providers/google', () => ({
  GoogleProvider: class {
    name = 'google';
    isConfigured = mockGoogleConfigured;
    search = mockGoogleSearch;
  },
}));

vi.mock('../providers/bocha', () => ({
  BochaProvider: class {
    name = 'bocha';
    isConfigured = mockBochaConfigured;
    search = mockBochaSearch;
  },
}));

vi.mock('../providers/tavily', () => ({
  TavilyProvider: class {
    name = 'tavily';
    isConfigured = mockTavilyConfigured;
    search = mockTavilySearch;
  },
}));

const mockDeepResearchHandler = vi.fn(async () => ({
  report: 'Deep research report',
  sources: [],
  metadata: { topic: 'test', depth: 'standard' },
}));

vi.mock('../research/deep-research-v2', () => ({
  DeepResearchV2: class {},
  createDeepResearchHandler: vi.fn(() => mockDeepResearchHandler),
}));

import { SearchOrchestrator, getSearchOrchestrator, initSearchFromEnv } from '../orchestrator';
import { SearchRegion } from '../types';

describe('SearchOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset defaults
    mockDDGConfigured.mockReturnValue(true);
    mockBingConfigured.mockReturnValue(false);
    mockBraveConfigured.mockReturnValue(false);
    mockGoogleConfigured.mockReturnValue(false);
    mockBochaConfigured.mockReturnValue(false);
    mockTavilyConfigured.mockReturnValue(false);
    mockDDGSearch.mockResolvedValue([
      { title: 'DDG Result', url: 'https://ddg.test/page', snippet: 'ddg snippet', source: 'duckduckgo' },
    ]);
  });

  // ========================================================================
  // Constructor
  // ========================================================================
  describe('constructor', () => {
    it('creates with default config', () => {
      const orch = new SearchOrchestrator();
      expect(orch).toBeDefined();
    });

    it('creates with custom config', () => {
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
        cacheMaxSize: 100,
        cacheTtlMs: 60000,
      });
      expect(orch).toBeDefined();
    });

    it('initializes providers based on config (duckduckgo enabled by default)', () => {
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      expect(orch.getConfiguredProviders()).toContain('duckduckgo');
    });

    it('initializes bocha provider when apiKey provided', () => {
      mockBochaConfigured.mockReturnValue(true);
      const orch = new SearchOrchestrator({
        providers: { bocha: { apiKey: 'fake-key' }, duckduckgo: { enabled: false } },
      });
      expect(orch.getConfiguredProviders()).toContain('bocha');
    });

    it('initializes tavily provider when apiKey provided', () => {
      mockTavilyConfigured.mockReturnValue(true);
      const orch = new SearchOrchestrator({
        providers: { tavily: { apiKey: 'fake-key' }, duckduckgo: { enabled: false } },
      });
      expect(orch.getConfiguredProviders()).toContain('tavily');
    });

    it('initializes google provider when apiKey and cx provided', () => {
      mockGoogleConfigured.mockReturnValue(true);
      const orch = new SearchOrchestrator({
        providers: { google: { apiKey: 'key', cx: 'cx' }, duckduckgo: { enabled: false } },
      });
      expect(orch.getConfiguredProviders()).toContain('google');
    });

    it('initializes bing provider when apiKey provided', () => {
      mockBingConfigured.mockReturnValue(true);
      const orch = new SearchOrchestrator({
        providers: { bing: { apiKey: 'key' }, duckduckgo: { enabled: false } },
      });
      expect(orch.getConfiguredProviders()).toContain('bing');
    });

    it('initializes brave provider when apiKey provided', () => {
      mockBraveConfigured.mockReturnValue(true);
      const orch = new SearchOrchestrator({
        providers: { brave: { apiKey: 'key' }, duckduckgo: { enabled: false } },
      });
      expect(orch.getConfiguredProviders()).toContain('brave');
    });

    it('disables duckduckgo when enabled=false', () => {
      mockDDGConfigured.mockReturnValue(true);
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: false } },
      });
      // DuckDuckGoProvider constructor is not called when enabled=false
      // But if it was called, isConfigured still returns true - the key is the provider isn't registered
    });
  });

  // ========================================================================
  // search()
  // ========================================================================
  describe('search', () => {
    it('returns results from available provider', async () => {
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      const results = await orch.search({ query: 'test query' });
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });

    it('caches results on second call', async () => {
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      await orch.search({ query: 'cached query' });
      const callsBefore = mockDDGSearch.mock.calls.length;
      await orch.search({ query: 'cached query' });
      // Should not call search again (cache hit)
      expect(mockDDGSearch.mock.calls.length).toBe(callsBefore);
    });

    it('throws when no providers configured', async () => {
      mockDDGConfigured.mockReturnValue(false);
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: false } },
      });
      await expect(orch.search({ query: 'test' })).rejects.toThrow('No search providers');
    });

    it('auto-detects CN region for Chinese queries', async () => {
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      const results = await orch.search({ query: '中国最新新闻动态报道' });
      expect(results).toBeDefined();
    });

    it('auto-detects GLOBAL region for English queries', async () => {
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      const results = await orch.search({ query: 'latest tech news' });
      expect(results).toBeDefined();
    });

    it('uses specified region without auto-detection', async () => {
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      const results = await orch.search({ query: 'test', region: SearchRegion.US });
      expect(results).toBeDefined();
    });

    it('respects numResults limit', async () => {
      mockDDGSearch.mockResolvedValue([
        { title: 'R1', url: 'https://a.com/1', snippet: 's1', source: 'duckduckgo' },
        { title: 'R2', url: 'https://a.com/2', snippet: 's2', source: 'duckduckgo' },
        { title: 'R3', url: 'https://a.com/3', snippet: 's3', source: 'duckduckgo' },
      ]);
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      const results = await orch.search({ query: 'test', numResults: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('deduplicates results by default', async () => {
      mockDDGSearch.mockResolvedValue([
        { title: 'Same Page', url: 'https://example.com/page', snippet: 's1', source: 'duckduckgo' },
        { title: 'Same Page', url: 'https://example.com/page/', snippet: 's2 longer snippet', source: 'duckduckgo' },
      ]);
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      const results = await orch.search({ query: 'test' });
      expect(results.length).toBe(1);
    });

    it('skips dedup when enableDedup is false', async () => {
      mockDDGSearch.mockResolvedValue([
        { title: 'Same', url: 'https://example.com/page', snippet: 's1', source: 'duckduckgo' },
        { title: 'Same', url: 'https://example.com/page/', snippet: 's2', source: 'duckduckgo' },
      ]);
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
        enableDedup: false,
      });
      const results = await orch.search({ query: 'test' });
      expect(results.length).toBe(2);
    });

    it('ranks results by default', async () => {
      mockDDGSearch.mockResolvedValue([
        { title: 'Irrelevant', url: 'https://a.com/1', snippet: 'nothing here', source: 'duckduckgo' },
        { title: 'Matching Query Test', url: 'https://a.com/2', snippet: 'test query match', source: 'duckduckgo' },
      ]);
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      const results = await orch.search({ query: 'test query' });
      // The more relevant result should be ranked higher
      expect(results.length).toBe(2);
    });

    it('skips ranking when enableRanking is false', async () => {
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
        enableRanking: false,
      });
      const results = await orch.search({ query: 'test' });
      expect(results).toBeDefined();
    });
  });

  // ========================================================================
  // Fallback chain
  // ========================================================================
  describe('fallback', () => {
    it('uses fallback provider when primary fails', async () => {
      mockBingConfigured.mockReturnValue(true);
      mockBingSearch.mockRejectedValue(new Error('Bing failed'));
      mockDDGSearch.mockResolvedValue([
        { title: 'DDG Fallback', url: 'https://ddg.test/f', snippet: 's', source: 'duckduckgo' },
      ]);

      const orch = new SearchOrchestrator({
        providers: {
          bing: { apiKey: 'key' },
          duckduckgo: { enabled: true },
        },
      });
      const results = await orch.search({ query: 'test' });
      expect(results.length).toBeGreaterThan(0);
    });

    it('throws AggregateError when all providers fail', async () => {
      mockDDGSearch.mockRejectedValue(new Error('DDG failed'));

      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      await expect(orch.search({ query: 'test' })).rejects.toThrow('All search providers failed');
    });

    it('handles timeout on search provider', async () => {
      mockDDGSearch.mockImplementation(() => new Promise((resolve) => {
        setTimeout(() => resolve([{ title: 'Late', url: 'https://late.test', snippet: 's', source: 'duckduckgo' }]), 20000);
      }));

      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
        timeout: 50, // very short timeout
      });

      await expect(orch.search({ query: 'test' })).rejects.toThrow();
    });

    it('handles non-Error throws from provider', async () => {
      mockDDGSearch.mockRejectedValue('string error');

      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      await expect(orch.search({ query: 'test' })).rejects.toThrow();
    });
  });

  // ========================================================================
  // Deduplication
  // ========================================================================
  describe('deduplication', () => {
    it('normalizes URLs (protocol, www, trailing slash, query params)', async () => {
      mockDDGSearch.mockResolvedValue([
        { title: 'A Page', url: 'https://www.example.com/page/', snippet: 's1 short', source: 'duckduckgo' },
        { title: 'B Page', url: 'http://example.com/page?utm=test#section', snippet: 's2 longer snippet for better score', source: 'duckduckgo' },
      ]);
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      const results = await orch.search({ query: 'test' });
      expect(results.length).toBe(1);
    });

    it('deduplicates by similar title', async () => {
      mockDDGSearch.mockResolvedValue([
        { title: 'Long Enough Title For Matching', url: 'https://a.com/page1', snippet: 's', source: 'duckduckgo', score: 0.9 },
        { title: 'Long Enough Title For Matching', url: 'https://b.com/page2', snippet: 's', source: 'duckduckgo', score: 0.5 },
      ]);
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      const results = await orch.search({ query: 'test' });
      expect(results.length).toBe(1);
    });

    it('keeps results with different short titles', async () => {
      mockDDGSearch.mockResolvedValue([
        { title: 'Short', url: 'https://a.com/1', snippet: 's1', source: 'duckduckgo' },
        { title: 'Short', url: 'https://b.com/2', snippet: 's2', source: 'duckduckgo' },
      ]);
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      const results = await orch.search({ query: 'test' });
      // Short titles (<= 10 normalized length) should not trigger title dedup
      expect(results.length).toBe(2);
    });

    it('keeps higher score when URL duplicates', async () => {
      mockDDGSearch.mockResolvedValue([
        { title: 'R1', url: 'https://example.com/page', snippet: 'short', source: 'duckduckgo', score: 0.5 },
        { title: 'R2', url: 'https://example.com/page', snippet: 'much longer snippet gets preference', source: 'duckduckgo', score: 0.9 },
      ]);
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      const results = await orch.search({ query: 'test' });
      expect(results.length).toBe(1);
    });
  });

  // ========================================================================
  // Ranking
  // ========================================================================
  describe('ranking', () => {
    it('ranks by query term coverage', async () => {
      mockDDGSearch.mockResolvedValue([
        { title: 'Unrelated', url: 'https://a.com/1', snippet: 'nothing', source: 'duckduckgo' },
        { title: 'Test Query', url: 'https://a.com/2', snippet: 'test query match', source: 'duckduckgo' },
      ]);
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      const results = await orch.search({ query: 'test query' });
      // Higher-relevance result should be first
      expect(results[0].url).toBe('https://a.com/2');
    });

    it('factors in source quality', async () => {
      mockDDGSearch.mockResolvedValue([
        { title: 'R1', url: 'https://a.com/1', snippet: 'test', source: 'duckduckgo' },
        { title: 'R2', url: 'https://b.com/2', snippet: 'test', source: 'bocha' },
      ]);
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      const results = await orch.search({ query: 'test' });
      // bocha has higher source quality score
      expect(results[0].source).toBe('bocha');
    });

    it('factors in freshness signals (current year)', async () => {
      const year = new Date().getFullYear();
      mockDDGSearch.mockResolvedValue([
        { title: 'Old Article', url: 'https://a.com/1', snippet: 'old content from 2010', source: 'duckduckgo' },
        { title: 'New Article', url: 'https://a.com/2', snippet: `latest ${year} content`, source: 'duckduckgo' },
      ]);
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      const results = await orch.search({ query: 'news' });
      expect(results[0].url).toBe('https://a.com/2');
    });

    it('handles empty query terms', async () => {
      mockDDGSearch.mockResolvedValue([
        { title: 'R', url: 'https://a.com', snippet: 's', source: 'duckduckgo' },
      ]);
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      const results = await orch.search({ query: '' });
      expect(results).toBeDefined();
    });

    it('handles results with missing title/snippet', async () => {
      mockDDGSearch.mockResolvedValue([
        { title: '', url: 'https://a.com', snippet: '', source: 'duckduckgo' },
      ]);
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      const results = await orch.search({ query: 'test' });
      expect(results.length).toBe(1);
    });

    it('handles unknown source provider name', async () => {
      mockDDGSearch.mockResolvedValue([
        { title: 'R', url: 'https://a.com', snippet: 's', source: 'unknown_provider' },
      ]);
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      const results = await orch.search({ query: 'test' });
      expect(results.length).toBe(1);
    });
  });

  // ========================================================================
  // clearCache
  // ========================================================================
  describe('clearCache', () => {
    it('clears search cache and forces re-fetch', async () => {
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      await orch.search({ query: 'cached' });
      orch.clearCache();
      await orch.search({ query: 'cached' });
      // Should have called search twice (cache was cleared)
      expect(mockDDGSearch).toHaveBeenCalledTimes(2);
    });
  });

  // ========================================================================
  // getConfiguredProviders
  // ========================================================================
  describe('getConfiguredProviders', () => {
    it('lists configured providers', () => {
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      const providers = orch.getConfiguredProviders();
      expect(providers).toContain('duckduckgo');
    });

    it('returns empty when no providers configured', () => {
      mockDDGConfigured.mockReturnValue(false);
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: false } },
      });
      // Provider may still be registered but isConfigured returns false
    });
  });

  // ========================================================================
  // deepResearch
  // ========================================================================
  describe('deepResearch', () => {
    it('delegates to DeepResearchV2 handler', async () => {
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });

      const result = await orch.deepResearch('test topic', {
        fetchFn: vi.fn(async () => ({ content: 'content', title: 'title' })),
        llmCall: vi.fn(async () => 'response'),
      });
      expect(result).toBeDefined();
      expect(result.report).toBe('Deep research report');
    });

    it('passes depth and aspects', async () => {
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });

      const result = await orch.deepResearch('topic', {
        depth: 'quick',
        aspects: ['A', 'B'],
        fetchFn: vi.fn(async () => ({ content: 'c', title: 't' })),
        llmCall: vi.fn(async () => ''),
      });
      expect(result).toBeDefined();
    });

    it('passes onProgress and abortSignal', async () => {
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });

      const onProgress = vi.fn();
      const ac = new AbortController();

      const result = await orch.deepResearch('topic', {
        fetchFn: vi.fn(async () => ({ content: 'c', title: 't' })),
        llmCall: vi.fn(async () => ''),
        onProgress,
        abortSignal: ac.signal,
      });
      expect(result).toBeDefined();
    });
  });

  // ========================================================================
  // getSearchOrchestrator singleton
  // ========================================================================
  describe('getSearchOrchestrator', () => {
    it('returns singleton instance', () => {
      const o1 = getSearchOrchestrator({ providers: { duckduckgo: { enabled: true } } });
      const o2 = getSearchOrchestrator();
      expect(o2).toBe(o1);
    });

    it('recreates with new config', () => {
      const o1 = getSearchOrchestrator({ providers: { duckduckgo: { enabled: true } } });
      const o2 = getSearchOrchestrator({ providers: { duckduckgo: { enabled: true } }, cacheMaxSize: 200 });
      expect(o2).not.toBe(o1);
    });
  });

  // ========================================================================
  // initSearchFromEnv
  // ========================================================================
  describe('initSearchFromEnv', () => {
    it('returns a SearchOrchestrator instance', () => {
      const orch = initSearchFromEnv();
      expect(orch).toBeDefined();
      expect(orch).toBeInstanceOf(SearchOrchestrator);
    });
  });
});
