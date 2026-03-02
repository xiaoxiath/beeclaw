/**
 * Finance Data System
 *
 * Multi-provider finance data with orchestration, fallback, and caching
 */

export * from './types';
export { FinanceDataProvider } from './base';
export { TushareProvider } from './providers/tushare';
export { SinaProvider } from './providers/sina';
export { EastmoneyProvider } from './providers/eastmoney';
export {
  FinanceOrchestrator,
  getFinanceOrchestrator,
  initFinanceFromEnv,
} from './orchestrator';

// Re-export commonly used types
import type {
  StockQuote,
  StockQuoteRequest,
  StockHistory,
  StockHistoryRequest,
  StockFinancial,
  StockFinancialRequest,
  StockInfo,
  StockInfoRequest,
  FinanceDataSource,
  FinanceConfig,
} from './types';
import { getFinanceOrchestrator, initFinanceFromEnv } from './orchestrator';

/**
 * Quick function to get stock quote
 */
export async function getStockQuote(
  symbol: string,
  options?: { symbols?: string[] }
): Promise<StockQuote[]> {
  const orchestrator = getFinanceOrchestrator();
  return orchestrator.getQuote({
    symbol,
    symbols: options?.symbols,
  });
}

/**
 * Quick function to get stock history
 */
export async function getStockHistory(
  symbol: string,
  options?: {
    period?: 'daily' | 'weekly' | 'monthly';
    adjust?: 'none' | 'hfq' | 'qfq';
    limit?: number;
    start_date?: string;
    end_date?: string;
  }
): Promise<StockHistory> {
  const orchestrator = getFinanceOrchestrator();
  return orchestrator.getHistory({
    symbol,
    ...options,
  });
}

/**
 * Initialize finance system from environment variables
 *
 * Set these environment variables:
 * - TUSHARE_TOKEN for Tushare (professional data)
 */
export function initFinance(): void {
  initFinanceFromEnv();
}
