import { describe, it, expect, vi } from 'vitest';

// Mock all downstream modules to avoid real initialization
vi.mock('../types', () => ({
  default: {},
}));

vi.mock('../base', () => ({
  FinanceDataProvider: class {},
}));

vi.mock('../providers/tushare', () => ({
  TushareProvider: class {},
}));

vi.mock('../providers/sina', () => ({
  SinaProvider: class {},
}));

vi.mock('../providers/eastmoney', () => ({
  EastmoneyProvider: class {},
}));

vi.mock('../orchestrator', () => ({
  FinanceOrchestrator: class {},
  getFinanceOrchestrator: vi.fn(() => ({})),
  initFinanceFromEnv: vi.fn(),
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
