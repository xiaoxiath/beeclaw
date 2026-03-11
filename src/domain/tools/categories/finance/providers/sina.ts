/**
 * Sina Finance Data Provider
 *
 * Free real-time stock quotes from Sina Finance
 * Note: Sina doesn't provide historical K-line or financial data via public API
 */

import { FinanceDataProvider } from '../base';
import type {
  FinanceDataSource,
  StockQuote,
  StockQuoteRequest,
  StockHistory,
  StockHistoryRequest,
  StockInfo,
  StockInfoRequest,
} from '../types';

export class SinaProvider extends FinanceDataProvider {
  name: FinanceDataSource = 'sina';

  private timeout: number;

  constructor(config?: { timeout?: number }) {
    super();
    this.timeout = config?.timeout || 10000;
  }

  isConfigured(): boolean {
    return true;  // No API key required
  }

  // ============================================================================
  // Stock Quote
  // ============================================================================

  async getQuote(request: StockQuoteRequest): Promise<StockQuote[]> {
    const symbols = request.symbols || [request.symbol];
    const sinaCodes = symbols.map(s => this.formatSymbolWithMarket(s));

    // Sina Finance API for real-time quotes
    const url = `https://hq.sinajs.cn/list=${sinaCodes.join(',')}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        headers: {
          'Referer': 'https://finance.sina.com.cn',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Sina API error: ${response.status}`);
      }

      const text = await response.text();
      return this.parseQuotes(text, symbols);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Sina API timeout');
      }
      throw error;
    }
  }

  private parseQuotes(responseText: string, symbols: string[]): StockQuote[] {
    const quotes: StockQuote[] = [];

    // Parse Sina's response format:
    // var hq_str_sh600000="浦发银行,7.85,7.81,7.90,7.95,7.80,7.89,7.90,45678900,359876543,..."
    const lines = responseText.split('\n').filter(line => line.trim());

    for (const line of lines) {
      const match = line.match(/var hq_str_(\w+)="(.*)"/);
      if (!match) continue;

      const [, code, data] = match;
      if (!data) continue;  // Empty data means market closed or invalid

      const parts = data.split(',');
      if (parts.length < 32) continue;  // Invalid format

      // Extract symbol from the code (remove market prefix)
      const symbol = this.normalizeSymbol(code);

      quotes.push({
        symbol,
        name: parts[0],
        open: this.toNumber(parts[1]),
        preClose: this.toNumber(parts[2]),
        price: this.toNumber(parts[3]),
        high: this.toNumber(parts[4]),
        low: this.toNumber(parts[5]),
        volume: this.toNumber(parts[8]),
        amount: this.toNumber(parts[9]),
        change: this.toNumber(parts[3]) - this.toNumber(parts[2]),
        changePercent: this.calculateChangePercent(parts[3], parts[2]),
        time: `${parts[30]} ${parts[31]}`,
        source: 'sina',
      });
    }

    return quotes;
  }

  // ============================================================================
  // Stock History (Not supported by Sina)
  // ============================================================================

  async getHistory(request: StockHistoryRequest): Promise<StockHistory> {
    // Sina doesn't provide historical K-line data via public API
    throw new Error('Sina does not support historical K-line data');
  }

  // ============================================================================
  // Company Info (Limited support)
  // ============================================================================

  async getInfo(request: StockInfoRequest): Promise<StockInfo> {
    // Get basic info from quote
    const quotes = await this.getQuote(request);

    if (quotes.length === 0) {
      throw new Error(`Stock not found: ${request.symbol}`);
    }

    const quote = quotes[0];
    const market = this.getMarket(request.symbol);

    return {
      symbol: quote.symbol,
      name: quote.name,
      market,
      source: 'sina',
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private toNumber(value: string): number {
    if (!value || value === '') return 0;
    const num = parseFloat(value);
    return isNaN(num) ? 0 : num;
  }

  private calculateChangePercent(current: string, previous: string): number {
    const curr = this.toNumber(current);
    const prev = this.toNumber(previous);
    if (prev === 0) return 0;
    return ((curr - prev) / prev) * 100;
  }
}
