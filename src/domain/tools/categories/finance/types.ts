/**
 * Finance Data Types
 *
 * Unified data models for the multi-provider finance system
 */

// Data source enum
export type FinanceDataSource = 'tushare' | 'sina' | 'eastmoney';

// ============================================================================
// Stock Quote (Real-time)
// ============================================================================

export interface StockQuote {
  symbol: string;           // Stock code (e.g., '600000')
  name: string;             // Company name
  price: number;            // Current price
  open: number;             // Opening price
  high: number;             // Highest price today
  low: number;              // Lowest price today
  preClose: number;         // Previous close price
  volume: number;           // Trading volume (shares)
  amount: number;           // Trading amount (yuan)
  turnoverRate?: number;    // Turnover rate %
  peRatio?: number;         // P/E ratio
  pbRatio?: number;         // P/B ratio
  totalMarketValue?: number; // Total market value
  circulatingMarketValue?: number; // Circulating market value
  change: number;           // Price change
  changePercent: number;    // Price change percent
  time: string;             // Quote time
  source: FinanceDataSource;
}

export interface StockQuoteRequest {
  symbol: string;           // Stock code or array of codes
  symbols?: string[];       // Batch query
}

// ============================================================================
// Stock History (K-line)
// ============================================================================

export type HistoryPeriod = 'daily' | 'weekly' | 'monthly';
export type AdjustType = 'none' | 'hfq' | 'qfq';  // No adjust, post-adjust, pre-adjust

export interface StockHistoryItem {
  date: string;             // Trading date YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;           // Trading volume (shares)
  amount: number;           // Trading amount (yuan)
  turnoverRate?: number;    // Turnover rate %
}

export interface StockHistory {
  symbol: string;
  name: string;
  period: HistoryPeriod;
  adjust: AdjustType;
  items: StockHistoryItem[];
  source: FinanceDataSource;
}

export interface StockHistoryRequest {
  symbol: string;
  start_date?: string;      // YYYY-MM-DD
  end_date?: string;        // YYYY-MM-DD
  period?: HistoryPeriod;
  adjust?: AdjustType;
  limit?: number;           // Max items to return (default 30, max 365)
}

// ============================================================================
// Stock Financial Data
// ============================================================================

export type ReportType = 'income' | 'balance' | 'cashflow';
export type ReportPeriod = 'annual' | 'quarterly';

export interface StockFinancialItem {
  reportDate: string;       // Report date YYYY-MM-DD
  endDate: string;          // Period end date

  // Income statement
  revenue?: number;         // Operating revenue
  netProfit?: number;       // Net profit
  netProfitAttrib?: number; // Net profit attributable to shareholders
  grossProfit?: number;     // Gross profit
  operatingProfit?: number; // Operating profit
  eps?: number;             // Earnings per share
  roe?: number;             // Return on equity %

  // Balance sheet
  totalAssets?: number;     // Total assets
  totalLiabilities?: number; // Total liabilities
  totalEquity?: number;     // Total shareholders' equity
  currentAssets?: number;   // Current assets
  currentLiabilities?: number; // Current liabilities

  // Cash flow
  operatingCashFlow?: number; // Cash from operations
  investingCashFlow?: number; // Cash from investing
  financingCashFlow?: number; // Cash from financing
  freeCashFlow?: number;    // Free cash flow

  raw?: Record<string, unknown>; // Original data
}

export interface StockFinancial {
  symbol: string;
  name: string;
  reportType: ReportType;
  period: ReportPeriod;
  items: StockFinancialItem[];
  source: FinanceDataSource;
}

export interface StockFinancialRequest {
  symbol: string;
  report_type: ReportType;
  period?: ReportPeriod;
  limit?: number;           // Max items to return (default 4, max 8)
}

// ============================================================================
// Stock Company Info
// ============================================================================

export interface StockInfo {
  symbol: string;
  name: string;
  fullName?: string;
  industry?: string;
  sector?: string;
  listDate?: string;        // Listing date
  market?: string;          // Market (SH, SZ, BJ)
  exchange?: string;        // Exchange
  chairman?: string;        // Chairman
  employees?: number;       // Number of employees
  mainBusiness?: string;    // Main business description
  website?: string;         // Company website
  province?: string;        // Province
  city?: string;            // City
  source: FinanceDataSource;
}

export interface StockInfoRequest {
  symbol: string;
}

// ============================================================================
// Provider Config
// ============================================================================

export interface FinanceProviderConfig {
  enabled?: boolean;
  timeout?: number;
}

export interface TushareConfig extends FinanceProviderConfig {
  token?: string;
}

export interface FinanceConfig {
  tushareToken?: string;
  defaultSource?: FinanceDataSource | 'auto';
  cacheEnabled?: boolean;
  providers?: {
    tushare?: TushareConfig;
    sina?: FinanceProviderConfig;
    eastmoney?: FinanceProviderConfig;
  };
}
