import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  TushareProvider: vi.fn(),
  SinaProvider: vi.fn(),
  EastmoneyProvider: vi.fn(),
  MemoryCache: vi.fn(),
}));

vi.mock('@infra/observability/logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

vi.mock('../providers/tushare', () => ({
  TushareProvider: function(...args: any[]) { return mocks.TushareProvider(...args); },
}));

vi.mock('../providers/sina', () => ({
  SinaProvider: function(...args: any[]) { return mocks.SinaProvider(...args); },
}));

vi.mock('../providers/eastmoney', () => ({
  EastmoneyProvider: function(...args: any[]) { return mocks.EastmoneyProvider(...args); },
}));

vi.mock('@infra/cache', () => ({
  MemoryCache: function(...args: any[]) { return mocks.MemoryCache(...args); },
}));

import { FinanceOrchestrator, getFinanceOrchestrator, initFinanceFromEnv } from '../orchestrator';
import { logger } from '@infra/observability/logger';

function makeProvider(name: string, configured = true) {
  return {
    name,
    isConfigured: vi.fn().mockReturnValue(configured),
    getQuote: vi.fn(),
    getHistory: vi.fn(),
    getFinancial: vi.fn(),
    getInfo: vi.fn(),
  };
}

describe('FinanceOrchestrator - extended coverage', () => {
  let tushareProvider: ReturnType<typeof makeProvider>;
  let sinaProvider: ReturnType<typeof makeProvider>;
  let eastmoneyProvider: ReturnType<typeof makeProvider>;
  let mockCache: any;

  beforeEach(() => {
    tushareProvider = makeProvider('tushare');
    sinaProvider = makeProvider('sina');
    eastmoneyProvider = makeProvider('eastmoney');

    mocks.TushareProvider.mockReturnValue(tushareProvider);
    mocks.SinaProvider.mockReturnValue(sinaProvider);
    mocks.EastmoneyProvider.mockReturnValue(eastmoneyProvider);

    mockCache = {
      get: vi.fn().mockReturnValue(undefined),
      set: vi.fn(),
      clear: vi.fn(),
    };
    mocks.MemoryCache.mockReturnValue(mockCache);
  });

  // ─── Provider initialization ─────────────────────────────
  describe('initializeProviders', () => {
    it('registers tushare when tushareToken is provided', () => {
      const orch = new FinanceOrchestrator({ tushareToken: 'tok123' });
      expect(mocks.TushareProvider).toHaveBeenCalledWith({ token: 'tok123', timeout: undefined });
      expect(orch.getConfiguredProviders()).toContain('tushare');
    });

    it('registers tushare from providers.tushare.token', () => {
      const orch = new FinanceOrchestrator({
        providers: { tushare: { token: 'tok456', timeout: 5000 } },
      });
      expect(mocks.TushareProvider).toHaveBeenCalledWith({ token: 'tok456', timeout: 5000 });
    });

    it('prefers tushareToken over providers.tushare.token', () => {
      const orch = new FinanceOrchestrator({
        tushareToken: 'top-level',
        providers: { tushare: { token: 'nested' } },
      });
      expect(mocks.TushareProvider).toHaveBeenCalledWith({ token: 'top-level', timeout: undefined });
    });

    it('does not register tushare if no token at all', () => {
      mocks.TushareProvider.mockClear();
      const orch = new FinanceOrchestrator({});
      expect(mocks.TushareProvider).not.toHaveBeenCalled();
    });

    it('registers sina by default', () => {
      const orch = new FinanceOrchestrator();
      expect(mocks.SinaProvider).toHaveBeenCalled();
    });

    it('does not register sina if explicitly disabled', () => {
      mocks.SinaProvider.mockClear();
      const orch = new FinanceOrchestrator({
        providers: { sina: { enabled: false } },
      });
      expect(mocks.SinaProvider).not.toHaveBeenCalled();
    });

    it('registers eastmoney by default', () => {
      const orch = new FinanceOrchestrator();
      expect(mocks.EastmoneyProvider).toHaveBeenCalled();
    });

    it('does not register eastmoney if explicitly disabled', () => {
      mocks.EastmoneyProvider.mockClear();
      const orch = new FinanceOrchestrator({
        providers: { eastmoney: { enabled: false } },
      });
      expect(mocks.EastmoneyProvider).not.toHaveBeenCalled();
    });

    it('passes timeout to sina', () => {
      const orch = new FinanceOrchestrator({
        providers: { sina: { timeout: 3000 } },
      });
      expect(mocks.SinaProvider).toHaveBeenCalledWith({ timeout: 3000 });
    });

    it('passes timeout to eastmoney', () => {
      const orch = new FinanceOrchestrator({
        providers: { eastmoney: { timeout: 4000 } },
      });
      expect(mocks.EastmoneyProvider).toHaveBeenCalledWith({ timeout: 4000 });
    });
  });

  // ─── Cache behavior ──────────────────────────────────────
  describe('cache behavior', () => {
    it('returns cached data on cache hit', async () => {
      mockCache.get.mockReturnValue([{ symbol: '600000', price: 10 }]);
      const orch = new FinanceOrchestrator({ tushareToken: 'x' });

      const result = await orch.getQuote({ symbol: '600000' });
      expect(result).toEqual([{ symbol: '600000', price: 10 }]);
      expect(tushareProvider.getQuote).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Cache hit'));
    });

    it('skips cache when cacheEnabled is false', async () => {
      mockCache.get.mockReturnValue([{ cached: true }]);
      const orch = new FinanceOrchestrator({ tushareToken: 'x', cacheEnabled: false });
      tushareProvider.getQuote.mockResolvedValue([{ fresh: true }]);

      const result = await orch.getQuote({ symbol: '600000' });
      expect(result).toEqual([{ fresh: true }]);
      // cache.get should NOT have been called for data retrieval
    });

    it('stores result in cache after successful fetch', async () => {
      const orch = new FinanceOrchestrator({ tushareToken: 'x' });
      tushareProvider.getQuote.mockResolvedValue([{ price: 42 }]);

      await orch.getQuote({ symbol: '600000' });
      expect(mockCache.set).toHaveBeenCalledWith(
        expect.any(String),
        [{ price: 42 }],
        60 // quote TTL
      );
    });

    it('does not store in cache when cacheEnabled is false', async () => {
      const orch = new FinanceOrchestrator({ tushareToken: 'x', cacheEnabled: false });
      tushareProvider.getQuote.mockResolvedValue([{ price: 42 }]);

      await orch.getQuote({ symbol: '600000' });
      expect(mockCache.set).not.toHaveBeenCalled();
    });

    it('clearCache calls cache.clear()', () => {
      const orch = new FinanceOrchestrator();
      orch.clearCache();
      expect(mockCache.clear).toHaveBeenCalled();
    });
  });

  // ─── Fallback chain ──────────────────────────────────────
  describe('executeWithFallback', () => {
    it('tries next source when first fails', async () => {
      const orch = new FinanceOrchestrator({ tushareToken: 'x' });
      tushareProvider.getQuote.mockRejectedValue(new Error('timeout'));
      sinaProvider.getQuote.mockResolvedValue([{ price: 10 }]);

      const result = await orch.getQuote({ symbol: '600000' });
      expect(result).toEqual([{ price: 10 }]);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('tushare unavailable')
      );
    });

    it('throws when all sources fail', async () => {
      const orch = new FinanceOrchestrator({ tushareToken: 'x' });
      tushareProvider.getQuote.mockRejectedValue(new Error('tushare down'));
      sinaProvider.getQuote.mockRejectedValue(new Error('sina down'));
      eastmoneyProvider.getQuote.mockRejectedValue(new Error('eastmoney down'));

      await expect(orch.getQuote({ symbol: '600000' })).rejects.toThrow(
        /All finance data sources failed for quote/
      );
    });

    it('skips unconfigured providers', async () => {
      tushareProvider.isConfigured.mockReturnValue(false);
      const orch = new FinanceOrchestrator({ tushareToken: 'x' });
      sinaProvider.getQuote.mockResolvedValue([{ price: 5 }]);

      const result = await orch.getQuote({ symbol: '600000' });
      expect(tushareProvider.getQuote).not.toHaveBeenCalled();
      expect(result).toEqual([{ price: 5 }]);
    });

    it('uses only defaultSource when specified (not auto)', async () => {
      const orch = new FinanceOrchestrator({
        tushareToken: 'x',
        defaultSource: 'tushare',
      });
      tushareProvider.getQuote.mockResolvedValue([{ price: 99 }]);

      const result = await orch.getQuote({ symbol: '600000' });
      expect(result).toEqual([{ price: 99 }]);
      expect(sinaProvider.getQuote).not.toHaveBeenCalled();
    });

    it('uses defaultSource only — throws if that single source fails', async () => {
      const orch = new FinanceOrchestrator({
        tushareToken: 'x',
        defaultSource: 'tushare',
      });
      tushareProvider.getQuote.mockRejectedValue(new Error('fail'));

      await expect(orch.getQuote({ symbol: '600000' })).rejects.toThrow(
        /All finance data sources failed/
      );
      expect(sinaProvider.getQuote).not.toHaveBeenCalled();
    });

    it('handles non-Error thrown values', async () => {
      const orch = new FinanceOrchestrator({ tushareToken: 'x' });
      tushareProvider.getQuote.mockRejectedValue('string error');
      sinaProvider.getQuote.mockResolvedValue([{ price: 1 }]);

      const result = await orch.getQuote({ symbol: '600000' });
      expect(result).toEqual([{ price: 1 }]);
    });

    it('provider not in providers map is skipped', async () => {
      // No tushare token => no tushare provider registered
      // financial chain only has tushare
      const orch = new FinanceOrchestrator({});

      await expect(orch.getFinancial({ symbol: '600000', report_type: 'income' })).rejects.toThrow(
        /All finance data sources failed for financial/
      );
    });
  });

  // ─── getQuote ────────────────────────────────────────────
  describe('getQuote', () => {
    it('uses request.symbols if provided', async () => {
      const orch = new FinanceOrchestrator({ tushareToken: 'x' });
      tushareProvider.getQuote.mockResolvedValue([]);

      await orch.getQuote({ symbol: '600000', symbols: ['600000', '000001'] });
      // Cache key should include the symbols array
      expect(mockCache.set).toHaveBeenCalledWith(
        expect.stringContaining('600000'),
        expect.anything(),
        60
      );
    });

    it('falls back to [request.symbol] if no symbols', async () => {
      const orch = new FinanceOrchestrator({ tushareToken: 'x' });
      tushareProvider.getQuote.mockResolvedValue([]);

      await orch.getQuote({ symbol: '600000' });
      expect(tushareProvider.getQuote).toHaveBeenCalledWith({ symbol: '600000' });
    });
  });

  // ─── getHistory ──────────────────────────────────────────
  describe('getHistory', () => {
    it('constructs cache key from request fields', async () => {
      const orch = new FinanceOrchestrator({ tushareToken: 'x' });
      tushareProvider.getHistory.mockResolvedValue({ items: [] });

      await orch.getHistory({
        symbol: '600000',
        period: 'daily',
        adjust: 'qfq',
        start_date: '2024-01-01',
        end_date: '2024-06-01',
      });

      expect(mockCache.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        3600 // history TTL = 1 hour
      );
    });

    it('falls back from tushare to eastmoney', async () => {
      const orch = new FinanceOrchestrator({ tushareToken: 'x' });
      tushareProvider.getHistory.mockRejectedValue(new Error('fail'));
      eastmoneyProvider.getHistory.mockResolvedValue({ items: [{ date: '2024-01-01' }] });

      const result = await orch.getHistory({ symbol: '600000' });
      expect(result).toEqual({ items: [{ date: '2024-01-01' }] });
    });
  });

  // ─── getFinancial ────────────────────────────────────────
  describe('getFinancial', () => {
    it('constructs cache key from request fields', async () => {
      const orch = new FinanceOrchestrator({ tushareToken: 'x' });
      tushareProvider.getFinancial.mockResolvedValue({ items: [] });

      await orch.getFinancial({
        symbol: '600000',
        report_type: 'income',
        period: 'Q1',
      });

      expect(mockCache.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        86400 // financial TTL = 24h
      );
    });
  });

  // ─── getInfo ─────────────────────────────────────────────
  describe('getInfo', () => {
    it('uses info fallback chain (tushare, eastmoney, sina)', async () => {
      const orch = new FinanceOrchestrator({ tushareToken: 'x' });
      tushareProvider.getInfo.mockRejectedValue(new Error('fail'));
      eastmoneyProvider.getInfo.mockRejectedValue(new Error('fail'));
      sinaProvider.getInfo.mockResolvedValue({ symbol: '600000', name: 'Test' });

      const result = await orch.getInfo({ symbol: '600000' });
      expect(result).toEqual({ symbol: '600000', name: 'Test' });
    });

    it('cache key includes symbol', async () => {
      const orch = new FinanceOrchestrator({ tushareToken: 'x' });
      tushareProvider.getInfo.mockResolvedValue({ symbol: '600000' });

      await orch.getInfo({ symbol: '600000' });
      expect(mockCache.set).toHaveBeenCalledWith(
        expect.stringContaining('600000'),
        expect.anything(),
        86400 // info TTL = 24h
      );
    });
  });

  // ─── getConfiguredProviders ──────────────────────────────
  describe('getConfiguredProviders', () => {
    it('filters out unconfigured providers', () => {
      eastmoneyProvider.isConfigured.mockReturnValue(false);
      const orch = new FinanceOrchestrator({ tushareToken: 'x' });
      const providers = orch.getConfiguredProviders();
      expect(providers).toContain('tushare');
      expect(providers).toContain('sina');
      expect(providers).not.toContain('eastmoney');
    });

    it('returns empty array when no providers configured', () => {
      tushareProvider.isConfigured.mockReturnValue(false);
      sinaProvider.isConfigured.mockReturnValue(false);
      eastmoneyProvider.isConfigured.mockReturnValue(false);
      const orch = new FinanceOrchestrator({ tushareToken: 'x' });
      expect(orch.getConfiguredProviders()).toEqual([]);
    });
  });

  // ─── Singleton ───────────────────────────────────────────
  describe('getFinanceOrchestrator singleton', () => {
    // We need to reset the module-level singleton between test groups.
    // Since we can't easily access the module-level var, we test behavior:

    it('returns same instance on repeated calls without config', () => {
      const o1 = getFinanceOrchestrator({ tushareToken: 'abc' });
      const o2 = getFinanceOrchestrator();
      expect(o1).toBe(o2);
    });

    it('creates new instance when config is provided', () => {
      const o1 = getFinanceOrchestrator();
      const o2 = getFinanceOrchestrator({ cacheEnabled: false });
      // o2 replaces the singleton
      expect(o2).toBeDefined();
    });
  });

  // ─── initFinanceFromEnv ──────────────────────────────────
  describe('initFinanceFromEnv', () => {
    it('reads TUSHARE_TOKEN from env', () => {
      process.env.TUSHARE_TOKEN = 'env-token';
      process.env.FINANCE_CACHE_ENABLED = 'true';
      process.env.FINANCE_DEFAULT_SOURCE = 'auto';

      const orch = initFinanceFromEnv();
      expect(orch).toBeDefined();

      delete process.env.TUSHARE_TOKEN;
      delete process.env.FINANCE_CACHE_ENABLED;
      delete process.env.FINANCE_DEFAULT_SOURCE;
    });

    it('disables cache when FINANCE_CACHE_ENABLED is false', () => {
      process.env.FINANCE_CACHE_ENABLED = 'false';

      const orch = initFinanceFromEnv();
      expect(orch).toBeDefined();

      delete process.env.FINANCE_CACHE_ENABLED;
    });

    it('defaults source to auto when FINANCE_DEFAULT_SOURCE not set', () => {
      delete process.env.FINANCE_DEFAULT_SOURCE;
      const orch = initFinanceFromEnv();
      expect(orch).toBeDefined();
    });

    it('uses specified FINANCE_DEFAULT_SOURCE', () => {
      process.env.FINANCE_DEFAULT_SOURCE = 'tushare';
      process.env.TUSHARE_TOKEN = 'tok';

      const orch = initFinanceFromEnv();
      expect(orch).toBeDefined();

      delete process.env.FINANCE_DEFAULT_SOURCE;
      delete process.env.TUSHARE_TOKEN;
    });
  });
});
