/**
 * Tushare Finance Data Provider
 *
 * Professional financial data platform in China
 * API Documentation: https://tushare.pro/document/2
 */

import { FinanceDataProvider } from '../base';
import type {
  FinanceDataSource,
  StockQuote,
  StockQuoteRequest,
  StockHistory,
  StockHistoryRequest,
  StockHistoryItem,
  StockFinancial,
  StockFinancialRequest,
  StockFinancialItem,
  StockInfo,
  StockInfoRequest,
  TushareConfig,
  HistoryPeriod,
  AdjustType,
  ReportType,
  ReportPeriod,
} from '../types';

export class TushareProvider extends FinanceDataProvider {
  name: FinanceDataSource = 'tushare';

  private token?: string;
  private timeout: number;
  private baseUrl = 'https://api.tushare.pro';

  constructor(config?: TushareConfig) {
    super();
    this.token = config?.token;
    this.timeout = config?.timeout || 15000;
  }

  isConfigured(): boolean {
    return !!this.token;
  }

  /**
   * Set token (can be set after initialization)
   */
  setToken(token: string): void {
    this.token = token;
  }

  // ============================================================================
  // API Request
  // ============================================================================

  private async request<T>(
    apiName: string,
    params: Record<string, unknown> = {},
    fields?: string
  ): Promise<T> {
    if (!this.token) {
      throw new Error('Tushare token not configured');
    }

    const body: Record<string, unknown> = {
      api_name: apiName,
      token: this.token,
      params,
    };

    if (fields) {
      body.fields = fields;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Tushare API error: ${response.status}`);
      }

      const result = await response.json() as {
        request_id: string;
        code: number;
        msg: string;
        data?: {
          fields: string[];
          items: unknown[][];
        };
      };

      if (result.code !== 0) {
        throw new Error(`Tushare API error: ${result.msg}`);
      }

      return result.data as T;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Tushare API timeout');
      }
      throw error;
    }
  }

  /**
   * Parse API response into array of objects
   */
  private parseResponse(
    data: { fields: string[]; items: unknown[][] } | undefined
  ): Record<string, unknown>[] {
    if (!data || !data.fields || !data.items) {
      return [];
    }

    return data.items.map(item => {
      const obj: Record<string, unknown> = {};
      data.fields.forEach((field, index) => {
        obj[field] = item[index];
      });
      return obj;
    });
  }

  // ============================================================================
  // Stock Quote
  // ============================================================================

  async getQuote(request: StockQuoteRequest): Promise<StockQuote[]> {
    const symbols = request.symbols || [request.symbol];
    const tsCodes = symbols.map(s => {
      const code = this.normalizeSymbol(s);
      const market = this.getMarket(s);
      return `${code}.${market}`;
    });

    const data = await this.request<{ fields: string[]; items: unknown[][] }>(
      'daily_basic',
      {
        ts_code: tsCodes.join(','),
        trade_date: '',  // Latest data
      },
      'ts_code,trade_date,close,pe,pb,total_mv,circ_mv,turnover_rate'
    );

    const basicData = this.parseResponse(data);

    // Also get real-time price from daily endpoint
    const dailyData = await this.request<{ fields: string[]; items: unknown[][] }>(
      'daily',
      {
        ts_code: tsCodes.join(','),
      },
      'ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount'
    );

    const dailyRows = this.parseResponse(dailyData);

    // Group by ts_code and get the latest
    const latestDaily: Record<string, Record<string, unknown>> = {};
    for (const row of dailyRows) {
      const code = row.ts_code as string;
      if (!latestDaily[code] || (row.trade_date as string) > (latestDaily[code].trade_date as string)) {
        latestDaily[code] = row;
      }
    }

    // Merge data
    const quotes: StockQuote[] = [];
    for (const tsCode of tsCodes) {
      const basic = basicData.find(b => b.ts_code === tsCode);
      const daily = latestDaily[tsCode];

      if (!daily) continue;

      const [code] = tsCode.split('.');

      quotes.push({
        symbol: code,
        name: '',  // Tushare requires separate call for name
        price: this.toNumber(daily.close),
        open: this.toNumber(daily.open),
        high: this.toNumber(daily.high),
        low: this.toNumber(daily.low),
        preClose: this.toNumber(daily.pre_close),
        volume: this.toNumber(daily.vol) * 10000,  // Tushare returns in 10k
        amount: this.toNumber(daily.amount) * 10000,
        change: this.toNumber(daily.change),
        changePercent: this.toNumber(daily.pct_chg),
        turnoverRate: this.toNumber(basic?.turnover_rate),
        peRatio: this.toNumber(basic?.pe),
        pbRatio: this.toNumber(basic?.pb),
        totalMarketValue: this.toNumber(basic?.total_mv) * 10000,
        circulatingMarketValue: this.toNumber(basic?.circ_mv) * 10000,
        time: daily.trade_date as string,
        source: 'tushare',
      });
    }

    return quotes;
  }

  // ============================================================================
  // Stock History
  // ============================================================================

  async getHistory(request: StockHistoryRequest): Promise<StockHistory> {
    const code = this.normalizeSymbol(request.symbol);
    const market = this.getMarket(request.symbol);
    const tsCode = `${code}.${market}`;

    const period = request.period || 'daily';
    const adjust = request.adjust || 'none';
    const limit = Math.min(request.limit || 30, 365);

    // Map period to API name
    const apiName = period === 'daily' ? 'daily' :
                    period === 'weekly' ? 'weekly' : 'monthly';

    // Map adjust type
    const adj = adjust === 'qfq' ? 'qfq' :
                adjust === 'hfq' ? 'hfq' : null;

    const params: Record<string, unknown> = {
      ts_code: tsCode,
      start_date: request.start_date?.replace(/-/g, '') || '',
      end_date: request.end_date?.replace(/-/g, '') || '',
    };

    if (adj) {
      params.adj = adj;
    }

    const data = await this.request<{ fields: string[]; items: unknown[][] }>(
      apiName,
      params,
      'ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount'
    );

    const rows = this.parseResponse(data);

    // Sort by date descending and limit
    rows.sort((a, b) =>
      (b.trade_date as string).localeCompare(a.trade_date as string)
    );

    const items: StockHistoryItem[] = rows.slice(0, limit).map(row => ({
      date: this.formatDate(row.trade_date as string),
      open: this.toNumber(row.open),
      high: this.toNumber(row.high),
      low: this.toNumber(row.low),
      close: this.toNumber(row.close),
      volume: this.toNumber(row.vol) * 10000,
      amount: this.toNumber(row.amount) * 10000,
      turnoverRate: this.toNumber(row.turnover_rate),
    }));

    return {
      symbol: code,
      name: '',
      period,
      adjust,
      items,
      source: 'tushare',
    };
  }

  // ============================================================================
  // Financial Data
  // ============================================================================

  async getFinancial(request: StockFinancialRequest): Promise<StockFinancial> {
    const code = this.normalizeSymbol(request.symbol);
    const market = this.getMarket(request.symbol);
    const tsCode = `${code}.${market}`;

    const reportType = request.report_type;
    const period = request.period || 'annual';
    const limit = Math.min(request.limit || 4, 8);

    // Map report type to API name
    const apiName = reportType === 'income' ? 'income' :
                    reportType === 'balance' ? 'balancesheet' : 'cashflow';

    const fields = reportType === 'income'
      ? 'ts_code,ann_date,f_ann_date,end_date,revenue,nprofit,n_income,opt_profit,total_profit,income_tax,int_income'
      : reportType === 'balance'
      ? 'ts_code,ann_date,end_date,total_assets,total_liab,total_hldr_eqy_exc_min_int,total_hldr_eqy_inc_min_int,cap_rese,undistr_porfit,money_cap,trad_asset,notes_receiv,accounts_receiv'
      : 'ts_code,ann_date,end_date,n_cashflow_act,n_cashflow_inv_act,n_cash_flows_fnc_act,c_fr_sale_sg,c_pay_for_tax';

    const data = await this.request<{ fields: string[]; items: unknown[][] }>(
      apiName,
      {
        ts_code: tsCode,
        period_type: period === 'annual' ? '1' : '2',  // 1=annual, 2=quarterly
      },
      fields
    );

    const rows = this.parseResponse(data);

    // Sort by end_date descending and limit
    rows.sort((a, b) =>
      (b.end_date as string).localeCompare(a.end_date as string)
    );

    const items: StockFinancialItem[] = rows.slice(0, limit).map(row => {
      const item: StockFinancialItem = {
        reportDate: this.formatDate(row.ann_date as string),
        endDate: this.formatDate(row.end_date as string),
        raw: row,
      };

      if (reportType === 'income') {
        item.revenue = this.toNumber(row.revenue);
        item.netProfit = this.toNumber(row.nprofit || row.n_income);
        item.operatingProfit = this.toNumber(row.opt_profit);
      } else if (reportType === 'balance') {
        item.totalAssets = this.toNumber(row.total_assets);
        item.totalLiabilities = this.toNumber(row.total_liab);
        item.totalEquity = this.toNumber(row.total_hldr_eqy_exc_min_int);
      } else {
        item.operatingCashFlow = this.toNumber(row.n_cashflow_act);
        item.investingCashFlow = this.toNumber(row.n_cashflow_inv_act);
        item.financingCashFlow = this.toNumber(row.n_cash_flows_fnc_act);
      }

      return item;
    });

    return {
      symbol: code,
      name: '',
      reportType,
      period,
      items,
      source: 'tushare',
    };
  }

  // ============================================================================
  // Company Info
  // ============================================================================

  async getInfo(request: StockInfoRequest): Promise<StockInfo> {
    const code = this.normalizeSymbol(request.symbol);
    const market = this.getMarket(request.symbol);
    const tsCode = `${code}.${market}`;

    const data = await this.request<{ fields: string[]; items: unknown[][] }>(
      'stock_basic',
      {
        ts_code: tsCode,
        list_status: 'L',  // Listed stocks
      },
      'ts_code,symbol,name,area,industry,market,list_date,exchange,chairman,employees,main_business,website'
    );

    const rows = this.parseResponse(data);
    const row = rows[0];

    if (!row) {
      throw new Error(`Stock not found: ${request.symbol}`);
    }

    return {
      symbol: code,
      name: row.name as string || '',
      fullName: row.name as string,
      industry: row.industry as string,
      market: row.market as string,
      listDate: this.formatDate(row.list_date as string),
      exchange: row.exchange as string,
      chairman: row.chairman as string,
      employees: this.toNumber(row.employees),
      mainBusiness: row.main_business as string,
      website: row.website as string,
      province: row.area as string,
      source: 'tushare',
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private toNumber(value: unknown): number {
    if (value === null || value === undefined || value === '') {
      return 0;
    }
    const num = Number(value);
    return isNaN(num) ? 0 : num;
  }

  private formatDate(date: string): string {
    if (!date || date.length !== 8) return date;
    return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  }
}
