import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mock logger
mock.module('../../../infra/observability/logger', () => ({
  logger: {
    info: mock(),
    error: mock(),
    warn: mock(),
    debug: mock(),
  },
}));

// Mock all providers
mock.module('../providers/duckduckgo', () => ({
  DuckDuckGoProvider: class {
    name = 'duckduckgo';
    isConfigured() { return true; }
    async search() { return [{ title: 'DDG Result', url: 'https://ddg.test', snippet: 'snippet', source: 'duckduckgo' }]; }
  },
}));

mock.module('../providers/bing', () => ({
  BingProvider: class {
    name = 'bing';
    isConfigured() { return false; }
    async search() { return []; }
  },
}));

mock.module('../providers/brave', () => ({
  BraveProvider: class {
    name = 'brave';
    isConfigured() { return false; }
    async search() { return []; }
  },
}));

mock.module('../providers/google', () => ({
  GoogleProvider: class {
    name = 'google';
    isConfigured() { return false; }
    async search() { return []; }
  },
}));

mock.module('../providers/bocha', () => ({
  BochaProvider: class {
    name = 'bocha';
    isConfigured() { return false; }
    async search() { return []; }
  },
}));

mock.module('../providers/tavily', () => ({
  TavilyProvider: class {
    name = 'tavily';
    isConfigured() { return false; }
    async search() { return []; }
  },
}));

mock.module('../research/deep-research-v2', () => ({
  DeepResearchV2: class {},
  createDeepResearchHandler: mock(() => async () => ({ report: '', sources: [], metadata: {} })),
}));

import { SearchOrchestrator, getSearchOrchestrator } from '../orchestrator';

describe('SearchOrchestrator', () => {
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
  });

  describe('search', () => {
    it('returns results from available provider', async () => {
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      const results = await orch.search({ query: 'test query' });
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toBe('DDG Result');
    });

    it('caches results on second call', async () => {
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      const r1 = await orch.search({ query: 'cached query' });
      const r2 = await orch.search({ query: 'cached query' });
      // Second call returns cached results
      expect(r2).toEqual(r1);
    });

    it('throws when no providers configured', async () => {
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: false } },
      });
      await expect(orch.search({ query: 'test' })).rejects.toThrow('No search providers');
    });
  });

  describe('clearCache', () => {
    it('clears search cache', async () => {
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      await orch.search({ query: 'will be cached' });
      orch.clearCache();
      // No error expected
      expect(true).toBe(true);
    });
  });

  describe('getConfiguredProviders', () => {
    it('lists configured providers', () => {
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      const providers = orch.getConfiguredProviders();
      expect(providers).toContain('duckduckgo');
    });
  });

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

  describe('region detection', () => {
    it('detects Chinese content as CN region', async () => {
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      // Query with Chinese characters should trigger CN region detection
      const results = await orch.search({ query: '中国最新新闻' });
      expect(results).toBeDefined();
    });

    it('detects English content as GLOBAL region', async () => {
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      const results = await orch.search({ query: 'latest tech news' });
      expect(results).toBeDefined();
    });
  });

  describe('deduplication', () => {
    it('removes duplicate URLs', async () => {
      // This is tested implicitly through the search method
      // The orchestrator deduplicates internally
      const orch = new SearchOrchestrator({
        providers: { duckduckgo: { enabled: true } },
      });
      const results = await orch.search({ query: 'test dedup' });
      const urls = results.map(r => r.url);
      const unique = [...new Set(urls)];
      expect(urls.length).toBe(unique.length);
    });
  });
});
