/**
 * Base Finance Data Provider Interface
 *
 * All finance data adapters must implement this interface
 */

import type {
  StockQuote,
  StockQuoteRequest,
  StockHistory,
  StockHistoryRequest,
  StockFinancial,
  StockFinancialRequest,
  StockInfo,
  StockInfoRequest,
} from './types';

export abstract class FinanceDataProvider {
  abstract name: string;

  /**
   * Check if this provider is properly configured
   */
  abstract isConfigured(): boolean;

  // ============================================================================
  // Stock Quote (Real-time)
  // ============================================================================

  /**
   * Get real-time stock quotes
   */
  async getQuote(_request: StockQuoteRequest): Promise<StockQuote[]> {
    throw new Error(`${this.name} does not support getQuote`);
  }

  // ============================================================================
  // Stock History (K-line)
  // ============================================================================

  /**
   * Get historical stock data (K-line)
   */
  async getHistory(_request: StockHistoryRequest): Promise<StockHistory> {
    throw new Error(`${this.name} does not support getHistory`);
  }

  // ============================================================================
  // Financial Data
  // ============================================================================

  /**
   * Get financial statements
   */
  async getFinancial(_request: StockFinancialRequest): Promise<StockFinancial> {
    throw new Error(`${this.name} does not support getFinancial`);
  }

  // ============================================================================
  // Company Info
  // ============================================================================

  /**
   * Get company information
   */
  async getInfo(_request: StockInfoRequest): Promise<StockInfo> {
    throw new Error(`${this.name} does not support getInfo`);
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Normalize stock symbol to standard format
   * Input: 600000, sh600000, sh.600000, 600000.SH
   * Output: 600000 (without prefix/suffix)
   */
  protected normalizeSymbol(symbol: string): string {
    // Remove common prefixes
    let normalized = symbol.replace(/^(sh\.?|sz\.?|bj\.?)/i, '');
    // Remove common suffixes
    normalized = normalized.replace(/\.(SH|SZ|BJ)$/i, '');
    return normalized.toUpperCase();
  }

  /**
   * Get market code from symbol
   * Returns: SH, SZ, or BJ
   */
  protected getMarket(symbol: string): string {
    const code = this.normalizeSymbol(symbol);

    // Shanghai Stock Exchange
    if (code.startsWith('6') || code.startsWith('5') || code.startsWith('9')) {
      return 'SH';
    }

    // Shenzhen Stock Exchange
    if (code.startsWith('0') || code.startsWith('3') || code.startsWith('2')) {
      return 'SZ';
    }

    // Beijing Stock Exchange
    if (code.startsWith('4') || code.startsWith('8')) {
      return 'BJ';
    }

    // Default to SH
    return 'SH';
  }

  /**
   * Format symbol with market prefix (e.g., sh600000)
   */
  protected formatSymbolWithMarket(symbol: string): string {
    const code = this.normalizeSymbol(symbol);
    const market = this.getMarket(code);
    return `${market.toLowerCase()}${code}`;
  }

  /**
   * Format symbol with dot separator (e.g., sh.600000)
   */
  protected formatSymbolWithDot(symbol: string): string {
    const code = this.normalizeSymbol(symbol);
    const market = this.getMarket(code);
    return `${market.toLowerCase()}.${code}`;
  }
}
