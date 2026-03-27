import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mock finance orchestrator
const mockGetQuote = mock(() => Promise.resolve([]));
const mockGetHistory = mock(() => Promise.resolve({ items: [], source: 'mock' }));
const mockGetFinancial = mock(() => Promise.resolve({ items: [], source: 'mock' }));
const mockGetInfo = mock(() => Promise.resolve({ symbol: '600000', name: 'Test', source: 'mock' }));

mock.module('../categories/finance', () => ({
  getFinanceOrchestrator: () => ({
    getQuote: mockGetQuote,
    getHistory: mockGetHistory,
    getFinancial: mockGetFinancial,
    getInfo: mockGetInfo,
  }),
}));

import {
  stockQuoteTool,
  executeStockQuote,
  stockHistoryTool,
  executeStockHistory,
  stockFinancialTool,
  executeStockFinancial,
  stockInfoTool,
  executeStockInfo,
  StockQuoteSchema,
  StockHistorySchema,
  StockFinancialSchema,
  StockInfoSchema,
} from '../finance-tools';

describe('finance-tools', () => {
  beforeEach(() => {
    mockGetQuote.mockClear();
    mockGetHistory.mockClear();
    mockGetFinancial.mockClear();
    mockGetInfo.mockClear();
  });

  // ---- Tool Definitions ----
  describe('tool definitions', () => {
    it('stockQuoteTool has correct name', () => {
      expect(stockQuoteTool.name).toBe('stock_quote');
      expect(stockQuoteTool.parameters.required).toContain('symbol');
    });

    it('stockHistoryTool has correct name', () => {
      expect(stockHistoryTool.name).toBe('stock_history');
      expect(stockHistoryTool.parameters.required).toContain('symbol');
    });

    it('stockFinancialTool has correct name', () => {
      expect(stockFinancialTool.name).toBe('stock_financial');
      expect(stockFinancialTool.parameters.required).toContain('symbol');
      expect(stockFinancialTool.parameters.required).toContain('report_type');
    });

    it('stockInfoTool has correct name', () => {
      expect(stockInfoTool.name).toBe('stock_info');
      expect(stockInfoTool.parameters.required).toContain('symbol');
    });
  });

  // ---- Schemas ----
  describe('schemas', () => {
    it('StockQuoteSchema validates symbol', () => {
      expect(StockQuoteSchema.safeParse({ symbol: '600000' }).success).toBe(true);
      expect(StockQuoteSchema.safeParse({}).success).toBe(false);
    });

    it('StockHistorySchema defaults period to daily', () => {
      const result = StockHistorySchema.safeParse({ symbol: '600000' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.period).toBe('daily');
        expect(result.data.limit).toBe(30);
      }
    });

    it('StockFinancialSchema requires report_type', () => {
      expect(StockFinancialSchema.safeParse({ symbol: '600000' }).success).toBe(false);
      expect(StockFinancialSchema.safeParse({ symbol: '600000', report_type: 'income' }).success).toBe(true);
    });

    it('StockInfoSchema validates symbol', () => {
      expect(StockInfoSchema.safeParse({ symbol: '600000' }).success).toBe(true);
    });
  });

  // ---- executeStockQuote ----
  describe('executeStockQuote', () => {
    it('returns error for invalid params', async () => {
      const result = await executeStockQuote({});
      expect(result.success).toBe(false);
    });

    it('returns error when no quotes found', async () => {
      mockGetQuote.mockResolvedValueOnce([]);
      const result = await executeStockQuote({ symbol: '999999' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('999999');
    });

    it('formats quote data', async () => {
      mockGetQuote.mockResolvedValueOnce([{
        symbol: '600000',
        name: '浦发银行',
        price: 10.5,
        change: 0.2,
        changePercent: 1.94,
        open: 10.3,
        preClose: 10.3,
        high: 10.6,
        low: 10.2,
        volume: 500000,
        amount: 5200000,
        source: 'sina',
      }]);
      const result = await executeStockQuote({ symbol: '600000' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('600000');
      expect(result.data).toContain('浦发银行');
      expect(result.data).toContain('sina');
    });

    it('handles orchestrator error', async () => {
      mockGetQuote.mockRejectedValueOnce(new Error('API down'));
      const result = await executeStockQuote({ symbol: '600000' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('API down');
    });
  });

  // ---- executeStockHistory ----
  describe('executeStockHistory', () => {
    it('returns error for invalid params', async () => {
      const result = await executeStockHistory({});
      expect(result.success).toBe(false);
    });

    it('returns error when no history items', async () => {
      mockGetHistory.mockResolvedValueOnce({ items: [], source: 'mock' });
      const result = await executeStockHistory({ symbol: '600000' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('600000');
    });

    it('formats history data with table', async () => {
      mockGetHistory.mockResolvedValueOnce({
        name: '浦发银行',
        items: [{
          date: '2024-01-01',
          open: 10.0,
          high: 10.5,
          low: 9.8,
          close: 10.3,
          volume: 100000,
          amount: 1030000,
        }],
        source: 'eastmoney',
      });
      const result = await executeStockHistory({ symbol: '600000' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('2024-01-01');
      expect(result.data).toContain('日K');
      expect(result.data).toContain('eastmoney');
    });

    it('handles error', async () => {
      mockGetHistory.mockRejectedValueOnce(new Error('Timeout'));
      const result = await executeStockHistory({ symbol: '600000' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Timeout');
    });
  });

  // ---- executeStockFinancial ----
  describe('executeStockFinancial', () => {
    it('returns error for invalid params', async () => {
      const result = await executeStockFinancial({ symbol: '600000' });
      expect(result.success).toBe(false);
    });

    it('returns error when no financial items', async () => {
      mockGetFinancial.mockResolvedValueOnce({ items: [], source: 'mock' });
      const result = await executeStockFinancial({ symbol: '600000', report_type: 'income' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('600000');
    });

    it('formats income report', async () => {
      mockGetFinancial.mockResolvedValueOnce({
        name: 'Test',
        items: [{
          endDate: '2024-12-31',
          revenue: 100000000000,
          netProfit: 50000000000,
          netProfitAttrib: 48000000000,
          roe: 15.5,
        }],
        source: 'tushare',
      });
      const result = await executeStockFinancial({ symbol: '600000', report_type: 'income' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('利润表');
      expect(result.data).toContain('营业收入');
      expect(result.data).toContain('ROE');
    });

    it('formats balance report', async () => {
      mockGetFinancial.mockResolvedValueOnce({
        name: 'Test',
        items: [{
          endDate: '2024-12-31',
          totalAssets: 500000000000,
          totalLiabilities: 300000000000,
          totalEquity: 200000000000,
        }],
        source: 'tushare',
      });
      const result = await executeStockFinancial({ symbol: '600000', report_type: 'balance' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('资产负债表');
      expect(result.data).toContain('总资产');
    });

    it('formats cashflow report', async () => {
      mockGetFinancial.mockResolvedValueOnce({
        name: 'Test',
        items: [{
          endDate: '2024-12-31',
          operatingCashFlow: 10000000000,
          investingCashFlow: -5000000000,
          financingCashFlow: -3000000000,
        }],
        source: 'tushare',
      });
      const result = await executeStockFinancial({ symbol: '600000', report_type: 'cashflow' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('现金流量表');
      expect(result.data).toContain('经营现金流');
    });

    it('handles error', async () => {
      mockGetFinancial.mockRejectedValueOnce(new Error('No token'));
      const result = await executeStockFinancial({ symbol: '600000', report_type: 'income' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No token');
    });
  });

  // ---- executeStockInfo ----
  describe('executeStockInfo', () => {
    it('returns error for invalid params', async () => {
      const result = await executeStockInfo({});
      expect(result.success).toBe(false);
    });

    it('formats company info', async () => {
      mockGetInfo.mockResolvedValueOnce({
        symbol: '600000',
        name: '浦发银行',
        fullName: '上海浦东发展银行股份有限公司',
        industry: '银行',
        market: 'SSE',
        listDate: '1999-11-10',
        mainBusiness: '商业银行业务',
        source: 'tushare',
      });
      const result = await executeStockInfo({ symbol: '600000' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('600000');
      expect(result.data).toContain('浦发银行');
      expect(result.data).toContain('银行');
      expect(result.data).toContain('tushare');
    });

    it('handles error', async () => {
      mockGetInfo.mockRejectedValueOnce(new Error('Not found'));
      const result = await executeStockInfo({ symbol: '999999' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Not found');
    });
  });
});
