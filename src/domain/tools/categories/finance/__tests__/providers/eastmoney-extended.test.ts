import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EastmoneyProvider } from '../../providers/eastmoney';

describe('EastmoneyProvider - extended coverage', () => {
  let provider: EastmoneyProvider;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new EastmoneyProvider({ timeout: 5000 });
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetchOk(data: any) {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(data),
    });
  }

  function mockFetchError(status = 500) {
    fetchSpy.mockResolvedValue({
      ok: false,
      status,
      json: () => Promise.resolve({}),
    });
  }

  // ─── getQuote ────────────────────────────────────────────
  describe('getQuote', () => {
    it('returns quote from API response', async () => {
      mockFetchOk({
        data: {
          f57: '600000',
          f58: '浦发银行',
          f43: 1050,  // price * 100
          f44: 1100,
          f45: 950,
          f46: 500000,
          f47: 6000000,
          f48: 150,
          f49: 820,
          f50: 110,
          f51: 50,
          f52: 500,
          f55: 1000,
          f60: 1000,
          f170: 200000000,
          f171: 150000000,
        },
      });

      const result = await provider.getQuote({ symbol: '600000' });
      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('600000');
      expect(result[0].name).toBe('浦发银行');
      expect(result[0].price).toBe(10.5);
      expect(result[0].high).toBe(11);
      expect(result[0].low).toBe(9.5);
      expect(result[0].open).toBe(10);
      expect(result[0].preClose).toBe(10);
      expect(result[0].volume).toBe(500000);
      expect(result[0].amount).toBe(6000000);
      expect(result[0].source).toBe('eastmoney');
    });

    it('handles multiple symbols', async () => {
      mockFetchOk({
        data: {
          f57: '600000',
          f58: 'Test',
          f43: 1000,
          f44: 1000,
          f45: 1000,
          f46: 100,
          f47: 100,
          f48: 100,
          f49: 100,
          f50: 100,
          f51: 0,
          f52: 0,
          f55: 1000,
          f60: 1000,
          f170: 100,
          f171: 100,
        },
      });

      const result = await provider.getQuote({ symbol: '600000', symbols: ['600000', '000001'] });
      expect(result).toHaveLength(2);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('returns null when data is missing', async () => {
      mockFetchOk({ data: null });
      const result = await provider.getQuote({ symbol: '600000' });
      expect(result).toHaveLength(0);
    });

    it('catches per-symbol errors and continues', async () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      fetchSpy
        .mockRejectedValueOnce(new Error('network fail'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            data: { f57: '000001', f58: 'Test', f43: 500, f44: 500, f45: 500, f46: 100, f47: 100, f48: 100, f49: 100, f50: 100, f51: 0, f52: 0, f55: 500, f60: 500, f170: 100, f171: 100 },
          }),
        });

      const result = await provider.getQuote({ symbol: '600000', symbols: ['600000', '000001'] });
      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('000001');
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('uses SZ market for 0xxxxx codes', async () => {
      mockFetchOk({ data: { f57: '000001', f58: 'T', f43: 100, f44: 100, f45: 100, f46: 0, f47: 0, f48: 0, f49: 0, f50: 0, f51: 0, f52: 0, f55: 100, f60: 100, f170: 0, f171: 0 } });
      await provider.getQuote({ symbol: '000001' });
      expect(fetchSpy.mock.calls[0][0]).toContain('secid=0.000001');
    });

    it('uses SH market for 6xxxxx codes', async () => {
      mockFetchOk({ data: { f57: '600000', f58: 'T', f43: 100, f44: 100, f45: 100, f46: 0, f47: 0, f48: 0, f49: 0, f50: 0, f51: 0, f52: 0, f55: 100, f60: 100, f170: 0, f171: 0 } });
      await provider.getQuote({ symbol: '600000' });
      expect(fetchSpy.mock.calls[0][0]).toContain('secid=1.600000');
    });

    it('throws on HTTP error', async () => {
      mockFetchError(503);
      await expect(provider.getQuote({ symbol: '600000' })).resolves.toHaveLength(0);
      // Per-symbol errors are caught, so result is empty
    });

    it('throws timeout error on AbortError', async () => {
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      fetchSpy.mockRejectedValue(abortError);
      // Per-symbol errors are caught
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await provider.getQuote({ symbol: '600000' });
      expect(result).toHaveLength(0);
      spy.mockRestore();
    });

    it('handles empty f58 name', async () => {
      mockFetchOk({ data: { f57: '600000', f43: 100, f44: 100, f45: 100, f46: 0, f47: 0, f48: 0, f49: 0, f50: 0, f51: 0, f52: 0, f55: 100, f60: 100, f170: 0, f171: 0 } });
      const result = await provider.getQuote({ symbol: '600000' });
      expect(result[0].name).toBe('');
    });
  });

  // ─── getHistory ──────────────────────────────────────────
  describe('getHistory', () => {
    it('parses klines and returns items sorted descending', async () => {
      mockFetchOk({
        data: {
          klines: [
            '2024-01-01,10.0,10.5,11.0,9.5,100000,1000000',
            '2024-01-03,10.5,11.0,11.5,10.0,120000,1200000',
            '2024-01-02,10.2,10.8,11.2,9.8,110000,1100000',
          ],
        },
      });

      const result = await provider.getHistory({ symbol: '600000' });
      expect(result.items).toHaveLength(3);
      expect(result.items[0].date).toBe('2024-01-03');
      expect(result.items[1].date).toBe('2024-01-02');
      expect(result.items[2].date).toBe('2024-01-01');
      expect(result.items[0].open).toBe(10.5);
      expect(result.items[0].close).toBe(11.0);
      expect(result.source).toBe('eastmoney');
    });

    it('returns empty items when no klines', async () => {
      mockFetchOk({ data: {} });
      const result = await provider.getHistory({ symbol: '600000' });
      expect(result.items).toHaveLength(0);
      expect(result.symbol).toBe('600000');
    });

    it('returns empty items when data is null', async () => {
      mockFetchOk({ data: null });
      const result = await provider.getHistory({ symbol: '600000' });
      expect(result.items).toHaveLength(0);
    });

    it('uses daily klt=101 by default', async () => {
      mockFetchOk({ data: { klines: [] } });
      await provider.getHistory({ symbol: '600000' });
      expect(fetchSpy.mock.calls[0][0]).toContain('klt=101');
    });

    it('uses weekly klt=102', async () => {
      mockFetchOk({ data: { klines: [] } });
      await provider.getHistory({ symbol: '600000', period: 'weekly' });
      expect(fetchSpy.mock.calls[0][0]).toContain('klt=102');
    });

    it('uses monthly klt=103', async () => {
      mockFetchOk({ data: { klines: [] } });
      await provider.getHistory({ symbol: '600000', period: 'monthly' });
      expect(fetchSpy.mock.calls[0][0]).toContain('klt=103');
    });

    it('uses fqt=0 for none adjust', async () => {
      mockFetchOk({ data: { klines: [] } });
      await provider.getHistory({ symbol: '600000', adjust: 'none' });
      expect(fetchSpy.mock.calls[0][0]).toContain('fqt=0');
    });

    it('uses fqt=1 for qfq adjust', async () => {
      mockFetchOk({ data: { klines: [] } });
      await provider.getHistory({ symbol: '600000', adjust: 'qfq' });
      expect(fetchSpy.mock.calls[0][0]).toContain('fqt=1');
    });

    it('uses fqt=2 for hfq adjust', async () => {
      mockFetchOk({ data: { klines: [] } });
      await provider.getHistory({ symbol: '600000', adjust: 'hfq' });
      expect(fetchSpy.mock.calls[0][0]).toContain('fqt=2');
    });

    it('caps limit at 365', async () => {
      mockFetchOk({ data: { klines: [] } });
      await provider.getHistory({ symbol: '600000', limit: 999 });
      expect(fetchSpy.mock.calls[0][0]).toContain('lmt=365');
    });

    it('defaults limit to 30', async () => {
      mockFetchOk({ data: { klines: [] } });
      await provider.getHistory({ symbol: '600000' });
      expect(fetchSpy.mock.calls[0][0]).toContain('lmt=30');
    });

    it('throws on HTTP error', async () => {
      mockFetchError(500);
      await expect(provider.getHistory({ symbol: '600000' })).rejects.toThrow('Eastmoney API error: 500');
    });

    it('throws timeout error on AbortError', async () => {
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      fetchSpy.mockRejectedValue(abortError);
      await expect(provider.getHistory({ symbol: '600000' })).rejects.toThrow('Eastmoney API timeout');
    });

    it('re-throws non-abort errors', async () => {
      fetchSpy.mockRejectedValue(new Error('Network failure'));
      await expect(provider.getHistory({ symbol: '600000' })).rejects.toThrow('Network failure');
    });
  });

  // ─── getFinancial ────────────────────────────────────────
  describe('getFinancial', () => {
    it('returns empty items for income report type', async () => {
      mockFetchOk({ data: {} });
      const result = await provider.getFinancial({ symbol: '600000', report_type: 'income' });
      expect(result.items).toHaveLength(0);
      expect(result.reportType).toBe('income');
      expect(result.source).toBe('eastmoney');
    });

    it('returns empty items for balance report type', async () => {
      mockFetchOk({ data: {} });
      const result = await provider.getFinancial({ symbol: '600000', report_type: 'balance' });
      expect(result.reportType).toBe('balance');
    });

    it('returns empty items for cashflow report type', async () => {
      mockFetchOk({ data: {} });
      const result = await provider.getFinancial({ symbol: '600000', report_type: 'cashflow' });
      expect(result.reportType).toBe('cashflow');
    });

    it('uses annual period by default', async () => {
      mockFetchOk({ data: {} });
      const result = await provider.getFinancial({ symbol: '600000', report_type: 'income' });
      expect(result.period).toBe('annual');
    });

    it('uses specified period', async () => {
      mockFetchOk({ data: {} });
      const result = await provider.getFinancial({ symbol: '600000', report_type: 'income', period: 'Q1' });
      expect(result.period).toBe('Q1');
    });

    it('throws on HTTP error', async () => {
      mockFetchError(500);
      await expect(provider.getFinancial({ symbol: '600000', report_type: 'income' })).rejects.toThrow(
        'Eastmoney API error: 500'
      );
    });

    it('throws timeout error on AbortError', async () => {
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      fetchSpy.mockRejectedValue(abortError);
      await expect(provider.getFinancial({ symbol: '600000', report_type: 'income' })).rejects.toThrow(
        'Eastmoney API timeout'
      );
    });

    it('re-throws non-abort errors', async () => {
      fetchSpy.mockRejectedValue(new Error('Connection refused'));
      await expect(provider.getFinancial({ symbol: '600000', report_type: 'income' })).rejects.toThrow(
        'Connection refused'
      );
    });
  });

  // ─── getInfo ─────────────────────────────────────────────
  describe('getInfo', () => {
    it('returns company info', async () => {
      mockFetchOk({
        data: {
          f57: '600000',
          f58: '浦发银行',
          f127: 'SSE',
        },
      });

      const result = await provider.getInfo({ symbol: '600000' });
      expect(result.symbol).toBe('600000');
      expect(result.name).toBe('浦发银行');
      expect(result.market).toBe('SSE');
      expect(result.source).toBe('eastmoney');
    });

    it('throws when stock not found (null data)', async () => {
      mockFetchOk({ data: null });
      await expect(provider.getInfo({ symbol: '999999' })).rejects.toThrow('Stock not found: 999999');
    });

    it('defaults market from symbol when f127 is missing', async () => {
      mockFetchOk({
        data: { f57: '600000', f58: 'Test' },
      });
      const result = await provider.getInfo({ symbol: '600000' });
      expect(result.market).toBe('SH');
    });

    it('handles empty name', async () => {
      mockFetchOk({
        data: { f57: '600000' },
      });
      const result = await provider.getInfo({ symbol: '600000' });
      expect(result.name).toBe('');
    });

    it('throws on HTTP error', async () => {
      mockFetchError(404);
      await expect(provider.getInfo({ symbol: '600000' })).rejects.toThrow('Eastmoney API error: 404');
    });

    it('throws timeout error on AbortError', async () => {
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      fetchSpy.mockRejectedValue(abortError);
      await expect(provider.getInfo({ symbol: '600000' })).rejects.toThrow('Eastmoney API timeout');
    });

    it('re-throws non-abort errors', async () => {
      fetchSpy.mockRejectedValue(new Error('DNS failure'));
      await expect(provider.getInfo({ symbol: '600000' })).rejects.toThrow('DNS failure');
    });
  });

  // ─── toNumber helper (via API) ───────────────────────────
  describe('toNumber edge cases', () => {
    it('converts null/undefined/empty to 0', async () => {
      mockFetchOk({
        data: {
          f57: '600000',
          f58: null,
          f43: null,
          f44: undefined,
          f45: '',
          f46: 0,
          f47: 0,
          f48: 0,
          f49: 0,
          f50: 0,
          f51: 0,
          f52: 0,
          f55: 0,
          f60: 0,
          f170: 0,
          f171: 0,
        },
      });

      const result = await provider.getQuote({ symbol: '600000' });
      expect(result[0].price).toBe(0);
      expect(result[0].high).toBe(0);
      expect(result[0].low).toBe(0);
    });

    it('converts NaN strings to 0', async () => {
      mockFetchOk({
        data: {
          klines: ['2024-01-01,abc,def,ghi,jkl,mno,pqr'],
        },
      });

      const result = await provider.getHistory({ symbol: '600000' });
      expect(result.items[0].open).toBe(0);
      expect(result.items[0].close).toBe(0);
    });
  });
});
