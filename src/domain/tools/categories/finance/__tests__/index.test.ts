import { describe, it, expect, mock } from 'bun:test';

// Mock all downstream modules to avoid real initialization
mock.module('../types', () => ({
  default: {},
}));

mock.module('../base', () => ({
  FinanceDataProvider: class {},
}));

mock.module('../providers/tushare', () => ({
  TushareProvider: class {},
}));

mock.module('../providers/sina', () => ({
  SinaProvider: class {},
}));

mock.module('../providers/eastmoney', () => ({
  EastmoneyProvider: class {},
}));

mock.module('../orchestrator', () => ({
  FinanceOrchestrator: class {},
  getFinanceOrchestrator: mock(() => ({})),
  initFinanceFromEnv: mock(),
}));

import {
  FinanceOrchestrator,
  getFinanceOrchestrator,
  initFinanceFromEnv,
  getStockQuote,
  getStockHistory,
  initFinance,
} from '../index';

describe('categories/finance/index re-exports', () => {
  it('exports FinanceOrchestrator', () => {
    expect(FinanceOrchestrator).toBeDefined();
  });

  it('exports getFinanceOrchestrator as function', () => {
    expect(typeof getFinanceOrchestrator).toBe('function');
  });

  it('exports initFinanceFromEnv as function', () => {
    expect(typeof initFinanceFromEnv).toBe('function');
  });

  it('exports getStockQuote as function', () => {
    expect(typeof getStockQuote).toBe('function');
  });

  it('exports getStockHistory as function', () => {
    expect(typeof getStockHistory).toBe('function');
  });

  it('exports initFinance as function', () => {
    expect(typeof initFinance).toBe('function');
  });
});
