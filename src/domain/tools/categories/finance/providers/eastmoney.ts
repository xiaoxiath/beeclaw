/**
 * Eastmoney Finance Data Provider
 *
 * Free financial data from Eastmoney (东方财富)
 * Provides real-time quotes, historical K-lines, and financial statements
 */

import { FinanceDataProvider } from '../base';
import { logger } from '../../../../../infra/observability/logger';
import type {
  FinanceDataSource,
  StockQuote,
  StockQuoteRequest,
  StockHistory,
  StockHistoryRequest,
  StockHistoryItem,
  StockFinancial,
  StockFinancialRequest,
  StockInfo,
  StockInfoRequest,
  ReportType
} from '../types';

export class EastmoneyProvider extends FinanceDataProvider {
  name: FinanceDataSource = 'eastmoney';

  private timeout: number;

  constructor(config?: { timeout?: number }) {
    super();
    this.timeout = config?.timeout || 15000;
  }

  isConfigured(): boolean {
    return true;  // No API key required
  }

  // ============================================================================
  // Stock Quote
  // ============================================================================

  async getQuote(request: StockQuoteRequest): Promise<StockQuote[]> {
    const symbols = request.symbols || [request.symbol];
    const quotes: StockQuote[] = [];

    for (const symbol of symbols) {
      const code = this.normalizeSymbol(symbol);
      const market = this.getMarket(symbol);
      const secid = `${market === 'SH' ? '1' : '0'}.${code}`;

      try {
        const quote = await this.fetchQuote(secid, code);
        if (quote) {
          quotes.push(quote);
        }
      } catch (error) {
        logger.warn(`[Eastmoney] Failed to fetch quote for ${symbol}:`, error);
      }
    }

    return quotes;
  }

  private async fetchQuote(secid: string, code: string): Promise<StockQuote | null> {
    const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f57,f58,f43,f44,f45,f46,f47,f48,f49,f50,f51,f52,f55,f60,f170,f171`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        headers: {
          'Referer': 'https://quote.eastmoney.com',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Eastmoney API error: ${response.status}`);
      }

      const result = await response.json() as {
        data?: {
          // Field mappings from Eastmoney
          f57?: string;   // Code
          f58?: string;   // Name
          f43?: number;   // Current price
          f44?: number;   // High
          f45?: number;   // Low
          f46?: number;   // Volume
          f47?: number;   // Amount
          f48?: number;   // Turnover rate
          f49?: number;   // PE
          f50?: number;   // PB
          f51?: number;   // Change
          f52?: number;   // Change percent
          f55?: number;   // Open
          f60?: number;   // Previous close
          f170?: number;  // Market value
          f171?: number;  // Circulating market value
        };
      };

      if (!result.data) {
        return null;
      }

      const d = result.data;

      return {
        symbol: code,
        name: d.f58 || '',
        price: this.toNumber(d.f43) / 100,  // Eastmoney returns price * 100
        open: this.toNumber(d.f55) / 100,
        high: this.toNumber(d.f44) / 100,
        low: this.toNumber(d.f45) / 100,
        preClose: this.toNumber(d.f60) / 100,
        volume: this.toNumber(d.f46),
        amount: this.toNumber(d.f47),
        turnoverRate: this.toNumber(d.f48) / 100,
        peRatio: this.toNumber(d.f49) / 100,
        pbRatio: this.toNumber(d.f50) / 100,
        totalMarketValue: this.toNumber(d.f170),
        circulatingMarketValue: this.toNumber(d.f171),
        change: this.toNumber(d.f51) / 100,
        changePercent: this.toNumber(d.f52) / 100,
        time: new Date().toISOString(),
        source: 'eastmoney',
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Eastmoney API timeout');
      }
      throw error;
    }
  }

  // ============================================================================
  // Stock History
  // ============================================================================

  async getHistory(request: StockHistoryRequest): Promise<StockHistory> {
    const code = this.normalizeSymbol(request.symbol);
    const market = this.getMarket(request.symbol);
    const secid = `${market === 'SH' ? '1' : '0'}.${code}`;

    const period = request.period || 'daily';
    const adjust = request.adjust || 'none';
    const limit = Math.min(request.limit || 30, 365);

    // Map period to Eastmoney code
    // 101=day, 102=week, 103=month
    const klt = period === 'daily' ? 101 :
                period === 'weekly' ? 102 : 103;

    // Map adjust type
    // 0=none, 1=qfq, 2=hfq
    const fqt = adjust === 'qfq' ? 1 :
                adjust === 'hfq' ? 2 : 0;

    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=${klt}&fqt=${fqt}&end=20500101&lmt=${limit}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        headers: {
          'Referer': 'https://quote.eastmoney.com',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Eastmoney API error: ${response.status}`);
      }

      const result = await response.json() as {
        data?: {
          klines?: string[];
        };
      };

      if (!result.data?.klines) {
        return {
          symbol: code,
          name: '',
          period,
          adjust,
          items: [],
          source: 'eastmoney',
        };
      }

      // Parse klines
      // Format: date,open,close,high,low,volume,amount
      const items: StockHistoryItem[] = result.data.klines.map((line: string) => {
        const parts = line.split(',');
        return {
          date: parts[0],
          open: this.toNumber(parts[1]),
          close: this.toNumber(parts[2]),
          high: this.toNumber(parts[3]),
          low: this.toNumber(parts[4]),
          volume: this.toNumber(parts[5]),
          amount: this.toNumber(parts[6]),
        };
      });

      // Sort by date descending
      items.sort((a, b) => b.date.localeCompare(a.date));

      return {
        symbol: code,
        name: '',
        period,
        adjust,
        items,
        source: 'eastmoney',
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Eastmoney API timeout');
      }
      throw error;
    }
  }

  // ============================================================================
  // Financial Data
  // ============================================================================

  async getFinancial(request: StockFinancialRequest): Promise<StockFinancial> {
    const code = this.normalizeSymbol(request.symbol);
    const market = this.getMarket(request.symbol);
    const secid = `${market === 'SH' ? '1' : '0'}.${code}`;

    const reportType = request.report_type;
    const period = request.period || 'annual';

    // Eastmoney financial API
    // Report types: RPT_LICO_FN_CPD (income), RPT_DMSK_FN_BALANCE (balance), RPT_DMSK_FN_CASHFLOW (cashflow)
    const reportTypeMap: Record<ReportType, string> = {
      income: 'RPT_LICO_FN_CPD',
      balance: 'RPT_DMSK_FN_BALANCE',
      cashflow: 'RPT_DMSK_FN_CASHFLOW',
    };

    const url = `https://emweb.eastmoney.com/PC_HF10/NewFinanceAnalysis/Index?type=web&code=${secid}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      // First, get the financial data from the API
      const apiurl = `https://emweb.securities.eastmoney.com/PC_HF10/NewFinanceAnalysis/ZYZBAjaxNew?type=web&code=${secid}&zbtype=${reportTypeMap[reportType]}`;

      const response = await fetch(apiurl, {
        headers: {
          'Referer': url,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Eastmoney API error: ${response.status}`);
      }

      await response.json() as {
        data?: {
          klines?: string[];
          datelist?: string[];
        };
      };

      // Eastmoney's financial API is complex, for now return empty
      // A full implementation would require parsing the response
      return {
        symbol: code,
        name: '',
        reportType,
        period,
        items: [],
        source: 'eastmoney',
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Eastmoney API timeout');
      }
      throw error;
    }
  }

  // ============================================================================
  // Company Info
  // ============================================================================

  async getInfo(request: StockInfoRequest): Promise<StockInfo> {
    const code = this.normalizeSymbol(request.symbol);
    const market = this.getMarket(request.symbol);
    const secid = `${market === 'SH' ? '1' : '0'}.${code}`;

    const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f57,f58,f84,f85,f86,f127,f128,f129,f130,f131`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        headers: {
          'Referer': 'https://quote.eastmoney.com',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Eastmoney API error: ${response.status}`);
      }

      const result = await response.json() as {
        data?: {
          f57?: string;   // Code
          f58?: string;   // Name
          f84?: number;   // Industry
          f85?: number;   // Sector
          f127?: string;  // Market
        };
      };

      if (!result.data) {
        throw new Error(`Stock not found: ${request.symbol}`);
      }

      const d = result.data;

      return {
        symbol: code,
        name: d.f58 || '',
        market: d.f127 || market,
        source: 'eastmoney',
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Eastmoney API timeout');
      }
      throw error;
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private toNumber(value: unknown): number {
    if (value === null || value === undefined || value === '') return 0;
    const num = Number(value);
    return isNaN(num) ? 0 : num;
  }
}
