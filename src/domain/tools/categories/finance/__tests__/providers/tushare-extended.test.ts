import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TushareProvider } from '../../providers/tushare';

describe('TushareProvider - extended coverage', () => {
  let provider: TushareProvider;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new TushareProvider({ token: 'test-token', timeout: 5000 });
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetchResponse(data: any, ok = true, status = 200) {
    fetchSpy.mockResolvedValue({
      ok,
      status,
      json: () => Promise.resolve(data),
    });
  }

  function mockFetchSequence(...responses: any[]) {
    for (const resp of responses) {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(resp),
      });
    }
  }

  // ─── request() private method via public API ─────────────
  describe('request error handling', () => {
    it('throws when no token configured', async () => {
      const noTokenProvider = new TushareProvider();
      await expect(noTokenProvider.getQuote({ symbol: '600000' })).rejects.toThrow(
        'Tushare token not configured'
      );
    });

    it('throws on HTTP error response', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });
      await expect(provider.getQuote({ symbol: '600000' })).rejects.toThrow(
        'Tushare API error: 500'
      );
    });

    it('throws on API error code != 0', async () => {
      mockFetchResponse({ code: -1, msg: 'Rate limit exceeded', data: null });
      await expect(provider.getQuote({ symbol: '600000' })).rejects.toThrow(
        'Tushare API error: Rate limit exceeded'
      );
    });

    it('throws timeout error on AbortError', async () => {
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      fetchSpy.mockRejectedValue(abortError);
      await expect(provider.getQuote({ symbol: '600000' })).rejects.toThrow(
        'Tushare API timeout'
      );
    });

    it('re-throws non-abort errors', async () => {
      fetchSpy.mockRejectedValue(new Error('Network failure'));
      await expect(provider.getQuote({ symbol: '600000' })).rejects.toThrow(
        'Network failure'
      );
    });
  });

  // ─── parseResponse ───────────────────────────────────────
  describe('parseResponse (via public API)', () => {
    it('handles empty/null data gracefully', async () => {
      mockFetchSequence(
        { code: 0, data: null },     // daily_basic returns null
        { code: 0, data: { fields: ['ts_code'], items: [] } }  // daily returns empty
      );
      const result = await provider.getQuote({ symbol: '600000' });
      expect(result).toEqual([]);
    });

    it('handles data with no fields', async () => {
      mockFetchSequence(
        { code: 0, data: { items: [[1]] } },   // no fields
        { code: 0, data: { fields: ['ts_code'], items: [] } }
      );
      const result = await provider.getQuote({ symbol: '600000' });
      expect(result).toEqual([]);
    });

    it('handles data with no items', async () => {
      mockFetchSequence(
        { code: 0, data: { fields: ['ts_code'], items: null } },
        { code: 0, data: { fields: ['ts_code'], items: [] } }
      );
      const result = await provider.getQuote({ symbol: '600000' });
      expect(result).toEqual([]);
    });
  });

  // ─── getQuote ────────────────────────────────────────────
  describe('getQuote', () => {
    it('returns quotes with merged basic and daily data', async () => {
      mockFetchSequence(
        {
          code: 0,
          data: {
            fields: ['ts_code', 'trade_date', 'close', 'pe', 'pb', 'total_mv', 'circ_mv', 'turnover_rate'],
            items: [['600000.SH', '20240101', 10.5, 8.2, 1.1, 500000, 300000, 1.5]],
          },
        },
        {
          code: 0,
          data: {
            fields: ['ts_code', 'trade_date', 'open', 'high', 'low', 'close', 'pre_close', 'change', 'pct_chg', 'vol', 'amount'],
            items: [['600000.SH', '20240101', 10.0, 11.0, 9.5, 10.5, 10.0, 0.5, 5.0, 100, 1000]],
          },
        }
      );

      const result = await provider.getQuote({ symbol: '600000' });
      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('600000');
      expect(result[0].price).toBe(10.5);
      expect(result[0].open).toBe(10.0);
      expect(result[0].high).toBe(11.0);
      expect(result[0].low).toBe(9.5);
      expect(result[0].preClose).toBe(10.0);
      expect(result[0].volume).toBe(100 * 10000);
      expect(result[0].amount).toBe(1000 * 10000);
      expect(result[0].change).toBe(0.5);
      expect(result[0].changePercent).toBe(5.0);
      expect(result[0].turnoverRate).toBe(1.5);
      expect(result[0].peRatio).toBe(8.2);
      expect(result[0].source).toBe('tushare');
    });

    it('handles multiple symbols', async () => {
      mockFetchSequence(
        {
          code: 0,
          data: {
            fields: ['ts_code', 'trade_date', 'close', 'pe', 'pb', 'total_mv', 'circ_mv', 'turnover_rate'],
            items: [
              ['600000.SH', '20240101', 10.5, 8.2, 1.1, 500, 300, 1.5],
              ['000001.SZ', '20240101', 20.0, 10.0, 2.0, 800, 600, 2.0],
            ],
          },
        },
        {
          code: 0,
          data: {
            fields: ['ts_code', 'trade_date', 'open', 'high', 'low', 'close', 'pre_close', 'change', 'pct_chg', 'vol', 'amount'],
            items: [
              ['600000.SH', '20240101', 10.0, 11.0, 9.5, 10.5, 10.0, 0.5, 5.0, 100, 1000],
              ['000001.SZ', '20240101', 19.0, 21.0, 18.5, 20.0, 19.0, 1.0, 5.26, 200, 2000],
            ],
          },
        }
      );

      const result = await provider.getQuote({ symbol: '600000', symbols: ['600000', '000001'] });
      expect(result).toHaveLength(2);
      expect(result[0].symbol).toBe('600000');
      expect(result[1].symbol).toBe('000001');
    });

    it('skips ts_code with no daily data', async () => {
      mockFetchSequence(
        {
          code: 0,
          data: { fields: ['ts_code'], items: [['600000.SH']] },
        },
        {
          code: 0,
          data: { fields: ['ts_code', 'trade_date', 'open', 'high', 'low', 'close', 'pre_close', 'change', 'pct_chg', 'vol', 'amount'], items: [] },
        }
      );

      const result = await provider.getQuote({ symbol: '600000' });
      expect(result).toEqual([]);
    });

    it('picks latest daily row when multiple dates returned', async () => {
      mockFetchSequence(
        { code: 0, data: { fields: [], items: [] } },
        {
          code: 0,
          data: {
            fields: ['ts_code', 'trade_date', 'open', 'high', 'low', 'close', 'pre_close', 'change', 'pct_chg', 'vol', 'amount'],
            items: [
              ['600000.SH', '20240101', 10, 11, 9, 10.5, 10, 0.5, 5, 100, 1000],
              ['600000.SH', '20240102', 10.5, 12, 10, 11.0, 10.5, 0.5, 4.76, 120, 1200],
            ],
          },
        }
      );

      const result = await provider.getQuote({ symbol: '600000' });
      expect(result).toHaveLength(1);
      expect(result[0].price).toBe(11.0); // latest date (20240102)
    });

    it('handles null/undefined basic data fields', async () => {
      mockFetchSequence(
        {
          code: 0,
          data: { fields: ['ts_code'], items: [['600000.SH']] },
        },
        {
          code: 0,
          data: {
            fields: ['ts_code', 'trade_date', 'open', 'high', 'low', 'close', 'pre_close', 'change', 'pct_chg', 'vol', 'amount'],
            items: [['600000.SH', '20240101', null, null, null, null, null, null, null, null, null]],
          },
        }
      );

      const result = await provider.getQuote({ symbol: '600000' });
      expect(result).toHaveLength(1);
      expect(result[0].price).toBe(0);
      expect(result[0].volume).toBe(0);
    });
  });

  // ─── getHistory ──────────────────────────────────────────
  describe('getHistory', () => {
    it('returns daily history sorted descending and limited', async () => {
      mockFetchResponse({
        code: 0,
        data: {
          fields: ['ts_code', 'trade_date', 'open', 'high', 'low', 'close', 'pre_close', 'change', 'pct_chg', 'vol', 'amount'],
          items: [
            ['600000.SH', '20240103', 10, 11, 9, 10.5, 10, 0.5, 5, 100, 1000],
            ['600000.SH', '20240101', 9, 10, 8, 9.5, 9, 0.5, 5.6, 80, 800],
            ['600000.SH', '20240102', 9.5, 10.5, 9, 10, 9.5, 0.5, 5.3, 90, 900],
          ],
        },
      });

      const result = await provider.getHistory({ symbol: '600000', limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.items[0].date).toBe('2024-01-03');
      expect(result.items[1].date).toBe('2024-01-02');
      expect(result.period).toBe('daily');
      expect(result.adjust).toBe('none');
      expect(result.source).toBe('tushare');
    });

    it('uses weekly API name for weekly period', async () => {
      mockFetchResponse({
        code: 0,
        data: {
          fields: ["ts_code", "symbol", "name", "area", "industry", "market", "list_date", "exchange", "chairman", "employees", "main_business", "website"],
          items: [["600000.SH", "600000", "Test", "SH", "Bank", "SSE", "19991110", "SSE", "CEO", 100, "banking", "http://test.com"]],
        },
      });
      await provider.getHistory({ symbol: '600000', period: 'weekly' });
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.api_name).toBe('weekly');
    });

    it('uses monthly API name for monthly period', async () => {
      mockFetchResponse({
        code: 0,
        data: {
          fields: ["ts_code", "symbol", "name", "area", "industry", "market", "list_date", "exchange", "chairman", "employees", "main_business", "website"],
          items: [["600000.SH", "600000", "Test", "SH", "Bank", "SSE", "19991110", "SSE", "CEO", 100, "banking", "http://test.com"]],
        },
      });
      await provider.getHistory({ symbol: '600000', period: 'monthly' });
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.api_name).toBe('monthly');
    });

    it('passes qfq adjust parameter', async () => {
      mockFetchResponse({
        code: 0,
        data: {
          fields: ["ts_code", "symbol", "name", "area", "industry", "market", "list_date", "exchange", "chairman", "employees", "main_business", "website"],
          items: [["600000.SH", "600000", "Test", "SH", "Bank", "SSE", "19991110", "SSE", "CEO", 100, "banking", "http://test.com"]],
        },
      });
      await provider.getHistory({ symbol: '600000', adjust: 'qfq' });
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.params.adj).toBe('qfq');
    });

    it('passes hfq adjust parameter', async () => {
      mockFetchResponse({
        code: 0,
        data: {
          fields: ["ts_code", "symbol", "name", "area", "industry", "market", "list_date", "exchange", "chairman", "employees", "main_business", "website"],
          items: [["600000.SH", "600000", "Test", "SH", "Bank", "SSE", "19991110", "SSE", "CEO", 100, "banking", "http://test.com"]],
        },
      });
      await provider.getHistory({ symbol: '600000', adjust: 'hfq' });
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.params.adj).toBe('hfq');
    });

    it('does not pass adj for none', async () => {
      mockFetchResponse({
        code: 0,
        data: {
          fields: ["ts_code", "symbol", "name", "area", "industry", "market", "list_date", "exchange", "chairman", "employees", "main_business", "website"],
          items: [["600000.SH", "600000", "Test", "SH", "Bank", "SSE", "19991110", "SSE", "CEO", 100, "banking", "http://test.com"]],
        },
      });
      await provider.getHistory({ symbol: '600000', adjust: 'none' });
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.params.adj).toBeUndefined();
    });

    it('strips dashes from dates', async () => {
      mockFetchResponse({
        code: 0,
        data: {
          fields: ["ts_code", "symbol", "name", "area", "industry", "market", "list_date", "exchange", "chairman", "employees", "main_business", "website"],
          items: [["600000.SH", "600000", "Test", "SH", "Bank", "SSE", "19991110", "SSE", "CEO", 100, "banking", "http://test.com"]],
        },
      });
      await provider.getHistory({ symbol: '600000', start_date: '2024-01-01', end_date: '2024-06-01' });
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.params.start_date).toBe('20240101');
      expect(body.params.end_date).toBe('20240601');
    });

    it('caps limit at 365', async () => {
      mockFetchResponse({
        code: 0,
        data: {
          fields: ['ts_code', 'trade_date', 'open', 'high', 'low', 'close', 'pre_close', 'change', 'pct_chg', 'vol', 'amount'],
          items: Array(400).fill(null).map((_, i) => ['600000.SH', `2024${String(i).padStart(4, '0')}01`, 10, 11, 9, 10, 10, 0, 0, 100, 1000]),
        },
      });

      const result = await provider.getHistory({ symbol: '600000', limit: 999 });
      expect(result.items.length).toBeLessThanOrEqual(365);
    });
  });

  // ─── getFinancial ────────────────────────────────────────
  describe('getFinancial', () => {
    it('fetches income data', async () => {
      mockFetchResponse({
        code: 0,
        data: {
          fields: ['ts_code', 'ann_date', 'f_ann_date', 'end_date', 'revenue', 'nprofit', 'n_income', 'opt_profit', 'total_profit', 'income_tax', 'int_income'],
          items: [['600000.SH', '20240301', '20240301', '20231231', 5000000, 1000000, 900000, 1200000, 1300000, 300000, 50000]],
        },
      });

      const result = await provider.getFinancial({ symbol: '600000', report_type: 'income' });
      expect(result.reportType).toBe('income');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].revenue).toBe(5000000);
      expect(result.items[0].netProfit).toBe(1000000);
      expect(result.items[0].operatingProfit).toBe(1200000);
      expect(result.items[0].endDate).toBe('2023-12-31');
    });

    it('uses n_income when nprofit is null', async () => {
      mockFetchResponse({
        code: 0,
        data: {
          fields: ['ts_code', 'ann_date', 'f_ann_date', 'end_date', 'revenue', 'nprofit', 'n_income', 'opt_profit', 'total_profit', 'income_tax', 'int_income'],
          items: [['600000.SH', '20240301', '20240301', '20231231', 5000000, null, 900000, 1200000, 0, 0, 0]],
        },
      });

      const result = await provider.getFinancial({ symbol: '600000', report_type: 'income' });
      expect(result.items[0].netProfit).toBe(900000);
    });

    it('fetches balance sheet data', async () => {
      mockFetchResponse({
        code: 0,
        data: {
          fields: ['ts_code', 'ann_date', 'end_date', 'total_assets', 'total_liab', 'total_hldr_eqy_exc_min_int', 'total_hldr_eqy_inc_min_int', 'cap_rese', 'undistr_porfit', 'money_cap', 'trad_asset', 'notes_receiv', 'accounts_receiv'],
          items: [['600000.SH', '20240301', '20231231', 10000000, 6000000, 4000000, 4100000, 100000, 200000, 300000, 0, 50000, 80000]],
        },
      });

      const result = await provider.getFinancial({ symbol: '600000', report_type: 'balance' });
      expect(result.items[0].totalAssets).toBe(10000000);
      expect(result.items[0].totalLiabilities).toBe(6000000);
      expect(result.items[0].totalEquity).toBe(4000000);
    });

    it('fetches cashflow data', async () => {
      mockFetchResponse({
        code: 0,
        data: {
          fields: ['ts_code', 'ann_date', 'end_date', 'n_cashflow_act', 'n_cashflow_inv_act', 'n_cash_flows_fnc_act', 'c_fr_sale_sg', 'c_pay_for_tax'],
          items: [['600000.SH', '20240301', '20231231', 2000000, -500000, -300000, 8000000, 400000]],
        },
      });

      const result = await provider.getFinancial({ symbol: '600000', report_type: 'cashflow' });
      expect(result.items[0].operatingCashFlow).toBe(2000000);
      expect(result.items[0].investingCashFlow).toBe(-500000);
      expect(result.items[0].financingCashFlow).toBe(-300000);
    });

    it('uses quarterly period_type for non-annual', async () => {
      mockFetchResponse({
        code: 0,
        data: {
          fields: ["ts_code", "symbol", "name", "area", "industry", "market", "list_date", "exchange", "chairman", "employees", "main_business", "website"],
          items: [["600000.SH", "600000", "Test", "SH", "Bank", "SSE", "19991110", "SSE", "CEO", 100, "banking", "http://test.com"]],
        },
      });
      await provider.getFinancial({ symbol: '600000', report_type: 'income', period: 'Q1' });
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.params.period_type).toBe('2');
    });

    it('uses annual period_type by default', async () => {
      mockFetchResponse({
        code: 0,
        data: {
          fields: ["ts_code", "symbol", "name", "area", "industry", "market", "list_date", "exchange", "chairman", "employees", "main_business", "website"],
          items: [["600000.SH", "600000", "Test", "SH", "Bank", "SSE", "19991110", "SSE", "CEO", 100, "banking", "http://test.com"]],
        },
      });
      await provider.getFinancial({ symbol: '600000', report_type: 'income' });
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.params.period_type).toBe('1');
    });

    it('caps limit at 8', async () => {
      const items = Array(10).fill(null).map((_, i) =>
        ['600000.SH', `2024030${i}`, `2023123${i}`, 100, 50, 50, 0, 0, 0, 0, 0]
      );
      mockFetchResponse({
        code: 0,
        data: {
          fields: ['ts_code', 'ann_date', 'end_date', 'revenue', 'nprofit', 'n_income', 'opt_profit', 'total_profit', 'income_tax', 'int_income'],
          items,
        },
      });

      const result = await provider.getFinancial({ symbol: '600000', report_type: 'income', limit: 20 });
      expect(result.items.length).toBeLessThanOrEqual(8);
    });

    it('maps balancesheet API name', async () => {
      mockFetchResponse({
        code: 0,
        data: {
          fields: ["ts_code", "symbol", "name", "area", "industry", "market", "list_date", "exchange", "chairman", "employees", "main_business", "website"],
          items: [["600000.SH", "600000", "Test", "SH", "Bank", "SSE", "19991110", "SSE", "CEO", 100, "banking", "http://test.com"]],
        },
      });
      await provider.getFinancial({ symbol: '600000', report_type: 'balance' });
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.api_name).toBe('balancesheet');
    });

    it('maps cashflow API name', async () => {
      mockFetchResponse({
        code: 0,
        data: {
          fields: ["ts_code", "symbol", "name", "area", "industry", "market", "list_date", "exchange", "chairman", "employees", "main_business", "website"],
          items: [["600000.SH", "600000", "Test", "SH", "Bank", "SSE", "19991110", "SSE", "CEO", 100, "banking", "http://test.com"]],
        },
      });
      await provider.getFinancial({ symbol: '600000', report_type: 'cashflow' });
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.api_name).toBe('cashflow');
    });
  });

  // ─── getInfo ─────────────────────────────────────────────
  describe('getInfo', () => {
    it('returns company info from first row', async () => {
      mockFetchResponse({
        code: 0,
        data: {
          fields: ['ts_code', 'symbol', 'name', 'area', 'industry', 'market', 'list_date', 'exchange', 'chairman', 'employees', 'main_business', 'website'],
          items: [['600000.SH', '600000', '浦发银行', '上海', '银行', 'SSE', '19991110', 'SSE', '张三', 50000, '银行业务', 'www.spdb.com']],
        },
      });

      const result = await provider.getInfo({ symbol: '600000' });
      expect(result.symbol).toBe('600000');
      expect(result.name).toBe('浦发银行');
      expect(result.industry).toBe('银行');
      expect(result.listDate).toBe('1999-11-10');
      expect(result.employees).toBe(50000);
      expect(result.source).toBe('tushare');
    });

    it('throws when stock not found', async () => {
      mockFetchResponse({
        code: 0,
        data: { fields: ['ts_code'], items: [] },
      });

      await expect(provider.getInfo({ symbol: '999999' })).rejects.toThrow(
        'Stock not found: 999999'
      );
    });

    it('handles null name gracefully', async () => {
      mockFetchResponse({
        code: 0,
        data: {
          fields: ['ts_code', 'symbol', 'name', 'area', 'industry', 'market', 'list_date', 'exchange', 'chairman', 'employees', 'main_business', 'website'],
          items: [['600000.SH', '600000', null, null, null, null, null, null, null, null, null, null]],
        },
      });

      const result = await provider.getInfo({ symbol: '600000' });
      expect(result.name).toBe('');
    });
  });

  // ─── toNumber helper ─────────────────────────────────────
  describe('toNumber (via public API)', () => {
    it('converts NaN to 0', async () => {
      mockFetchSequence(
        { code: 0, data: { fields: [], items: [] } },
        {
          code: 0,
          data: {
            fields: ['ts_code', 'trade_date', 'open', 'high', 'low', 'close', 'pre_close', 'change', 'pct_chg', 'vol', 'amount'],
            items: [['600000.SH', '20240101', 'NaN', 'abc', '', null, undefined, 0, 0, 0, 0]],
          },
        }
      );

      const result = await provider.getQuote({ symbol: '600000' });
      expect(result).toHaveLength(1);
      expect(result[0].open).toBe(0);  // 'NaN' -> NaN -> 0
      expect(result[0].high).toBe(0);  // 'abc' -> NaN -> 0
    });
  });

  // ─── formatDate helper ───────────────────────────────────
  describe('formatDate (via getHistory)', () => {
    it('formats 8-digit date to YYYY-MM-DD', async () => {
      mockFetchResponse({
        code: 0,
        data: {
          fields: ['ts_code', 'trade_date', 'open', 'high', 'low', 'close', 'pre_close', 'change', 'pct_chg', 'vol', 'amount'],
          items: [['600000.SH', '20240315', 10, 11, 9, 10.5, 10, 0.5, 5, 100, 1000]],
        },
      });

      const result = await provider.getHistory({ symbol: '600000' });
      expect(result.items[0].date).toBe('2024-03-15');
    });

    it('returns non-8-digit dates unchanged', async () => {
      mockFetchResponse({
        code: 0,
        data: {
          fields: ['ts_code', 'trade_date', 'open', 'high', 'low', 'close', 'pre_close', 'change', 'pct_chg', 'vol', 'amount'],
          items: [['600000.SH', '2024-03', 10, 11, 9, 10.5, 10, 0.5, 5, 100, 1000]],
        },
      });

      const result = await provider.getHistory({ symbol: '600000' });
      expect(result.items[0].date).toBe('2024-03');
    });
  });

  // ─── request fields parameter ────────────────────────────
  describe('request with fields parameter', () => {
    it('includes fields in request body when specified', async () => {
      mockFetchResponse({
        code: 0,
        data: {
          fields: ["ts_code", "symbol", "name", "area", "industry", "market", "list_date", "exchange", "chairman", "employees", "main_business", "website"],
          items: [["600000.SH", "600000", "Test", "SH", "Bank", "SSE", "19991110", "SSE", "CEO", 100, "banking", "http://test.com"]],
        },
      });
      await provider.getInfo({ symbol: '600000' });
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.fields).toBeDefined();
      expect(body.fields).toContain('ts_code');
    });
  });
});
