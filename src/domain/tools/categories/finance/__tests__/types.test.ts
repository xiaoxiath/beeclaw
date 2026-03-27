/**
 * Finance Types Tests
 */

import { describe, it, expect, vi } from 'vitest';
import type {
  StockQuote,
  StockHistory,
  StockFinancial,
  StockInfo
} from '../types';

describe('Finance Types', () => {
  it('should define StockQuote type correctly', () => {
    const quote: StockQuote = {
      symbol: '600000',
      name: '浦发银行',
      price: 10.5,
      open: 10.2,
      high: 10.8,
      low: 10.1,
      preClose: 10.0,
      volume: 1000000,
      amount: 10500000,
      change: 0.5,
      changePercent: 5.0,
      time: '2024-01-01 15:00:00',
      source: 'sina',
    };

    expect(quote.symbol).toBe('600000');
    expect(quote.price).toBe(10.5);
    expect(quote.source).toBe('sina');
  });

  it('should define StockHistory type correctly', () => {
    const history: StockHistory = {
      symbol: '600000',
      name: '浦发银行',
      period: 'daily',
      adjust: 'none',
      items: [
        {
          date: '2024-01-01',
          open: 10.0,
          high: 10.5,
          low: 9.9,
          close: 10.2,
          volume: 1000000,
          amount: 10200000,
        },
      ],
      source: 'tushare',
    };

    expect(history.items).toHaveLength(1);
    expect(history.period).toBe('daily');
  });

  it('should define StockFinancial type correctly', () => {
    const financial: StockFinancial = {
      symbol: '600000',
      name: '浦发银行',
      reportType: 'income',
      period: 'annual',
      items: [
        {
          reportDate: '2024-03-31',
          endDate: '2023-12-31',
          revenue: 1000000000,
          netProfit: 100000000,
        },
      ],
      source: 'tushare',
    };

    expect(financial.reportType).toBe('income');
    expect(financial.items[0].revenue).toBe(1000000000);
  });

  it('should define StockInfo type correctly', () => {
    const info: StockInfo = {
      symbol: '600000',
      name: '浦发银行',
      industry: '银行',
      market: 'SH',
      listDate: '1999-11-10',
      source: 'tushare',
    };

    expect(info.symbol).toBe('600000');
    expect(info.industry).toBe('银行');
  });
});
