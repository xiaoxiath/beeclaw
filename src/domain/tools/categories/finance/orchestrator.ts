/**
 * Finance Data Orchestrator
 *
 * Core orchestration layer: routing, fallback, and caching
 */

import { FinanceDataProvider } from './base';
import { TushareProvider } from './providers/tushare';
import { SinaProvider } from './providers/sina';
import { EastmoneyProvider } from './providers/eastmoney';
import type {
  FinanceDataSource,
  FinanceConfig,
  StockQuote,
  StockQuoteRequest,
  StockHistory,
  StockHistoryRequest,
  StockFinancial,
  StockFinancialRequest,
  StockInfo,
  StockInfoRequest,
} from './types';

// Fallback chain for different data types
const FALLBACK_CHAIN: Record<string, FinanceDataSource[]> = {
  quote: ['tushare', 'sina', 'eastmoney'],
  history: ['tushare', 'eastmoney'],
  financial: ['tushare'],  // Only Tushare has complete financial data
  info: ['tushare', 'eastmoney', 'sina'],
};

// Cache entry with TTL
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export class FinanceOrchestrator {
  private providers: Map<FinanceDataSource, FinanceDataProvider> = new Map();
  private config: FinanceConfig;
  private cache: Map<string, CacheEntry<unknown>> = new Map();

  // Default TTL in milliseconds
  private defaultTTL = {
    quote: 60 * 1000,      // 1 minute for real-time quotes
    history: 60 * 60 * 1000, // 1 hour for historical data
    financial: 24 * 60 * 60 * 1000, // 24 hours for financial data
    info: 24 * 60 * 60 * 1000, // 24 hours for company info
  };

  constructor(config?: FinanceConfig) {
    this.config = config || {};
    this.initializeProviders();
  }

  private initializeProviders(): void {
    const { providers } = this.config;

    // Register providers
    if (this.config.tushareToken || providers?.tushare?.token) {
      this.providers.set('tushare', new TushareProvider({
        token: this.config.tushareToken || providers?.tushare?.token,
        timeout: providers?.tushare?.timeout,
      }));
    }

    if (providers?.sina?.enabled !== false) {
      this.providers.set('sina', new SinaProvider({
        timeout: providers?.sina?.timeout,
      }));
    }

    if (providers?.eastmoney?.enabled !== false) {
      this.providers.set('eastmoney', new EastmoneyProvider({
        timeout: providers?.eastmoney?.timeout,
      }));
    }
  }

  // ============================================================================
  // Cache Methods
  // ============================================================================

  private getCacheKey(type: string, params: Record<string, unknown>): string {
    return `${type}:${JSON.stringify(params)}`;
  }

  private getFromCache<T>(key: string): T | null {
    if (this.config.cacheEnabled === false) {
      return null;
    }

    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      return null;
    }

    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  private setCache<T>(key: string, data: T, ttl: number): void {
    if (this.config.cacheEnabled === false) {
      return;
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
  }

  // ============================================================================
  // Fallback Execution
  // ============================================================================

  private async executeWithFallback<T>(
    type: string,
    sources: FinanceDataSource[],
    executor: (provider: FinanceDataProvider) => Promise<T>,
    cacheKey: string,
    ttl: number
  ): Promise<T> {
    // Check cache first
    const cached = this.getFromCache<T>(cacheKey);
    if (cached !== null) {
      console.log(`[Finance] Cache hit for ${cacheKey}`);
      return cached;
    }

    // Determine which sources to try
    let sourcesToTry = sources;

    if (this.config.defaultSource && this.config.defaultSource !== 'auto') {
      // Use specified source only
      sourcesToTry = [this.config.defaultSource as FinanceDataSource];
    }

    const errors: Error[] = [];

    for (const source of sourcesToTry) {
      const provider = this.providers.get(source);
      if (!provider || !provider.isConfigured()) {
        continue;
      }

      try {
        console.log(`[Finance] Trying ${source} for ${type}`);
        const result = await executor(provider);

        // Cache the result
        this.setCache(cacheKey, result, ttl);

        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        // Log as info since fallback is expected and working as designed
        // Common errors: socket closed, timeout, rate limit - all handled by fallback chain
        console.log(`[Finance] ${source} unavailable (${errorMsg}), trying next source...`);
        errors.push(error instanceof Error ? error : new Error(errorMsg));
      }
    }

    // All sources failed
    throw new Error(
      `All finance data sources failed for ${type}: ${errors.map(e => e.message).join(', ')}`
    );
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Get real-time stock quotes
   */
  async getQuote(request: StockQuoteRequest): Promise<StockQuote[]> {
    const symbols = request.symbols || [request.symbol];
    const cacheKey = this.getCacheKey('quote', { symbols });

    return this.executeWithFallback(
      'quote',
      FALLBACK_CHAIN.quote,
      async (provider) => provider.getQuote(request),
      cacheKey,
      this.defaultTTL.quote
    );
  }

  /**
   * Get historical stock data
   */
  async getHistory(request: StockHistoryRequest): Promise<StockHistory> {
    const cacheKey = this.getCacheKey('history', {
      symbol: request.symbol,
      period: request.period,
      adjust: request.adjust,
      start_date: request.start_date,
      end_date: request.end_date,
    });

    return this.executeWithFallback(
      'history',
      FALLBACK_CHAIN.history,
      async (provider) => provider.getHistory(request),
      cacheKey,
      this.defaultTTL.history
    );
  }

  /**
   * Get financial statements
   */
  async getFinancial(request: StockFinancialRequest): Promise<StockFinancial> {
    const cacheKey = this.getCacheKey('financial', {
      symbol: request.symbol,
      report_type: request.report_type,
      period: request.period,
    });

    return this.executeWithFallback(
      'financial',
      FALLBACK_CHAIN.financial,
      async (provider) => provider.getFinancial(request),
      cacheKey,
      this.defaultTTL.financial
    );
  }

  /**
   * Get company information
   */
  async getInfo(request: StockInfoRequest): Promise<StockInfo> {
    const cacheKey = this.getCacheKey('info', { symbol: request.symbol });

    return this.executeWithFallback(
      'info',
      FALLBACK_CHAIN.info,
      async (provider) => provider.getInfo(request),
      cacheKey,
      this.defaultTTL.info
    );
  }

  /**
   * Get list of configured providers
   */
  getConfiguredProviders(): string[] {
    return Array.from(this.providers.entries())
      .filter(([, provider]) => provider.isConfigured())
      .map(([name]) => name);
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// Singleton instance
let orchestratorInstance: FinanceOrchestrator | null = null;

/**
 * Get or create the finance orchestrator singleton
 */
export function getFinanceOrchestrator(config?: FinanceConfig): FinanceOrchestrator {
  if (!orchestratorInstance || config) {
    orchestratorInstance = new FinanceOrchestrator(config);
  }
  return orchestratorInstance;
}

/**
 * Initialize finance system from environment variables
 */
export function initFinanceFromEnv(): FinanceOrchestrator {
  const config: FinanceConfig = {
    tushareToken: process.env.TUSHARE_TOKEN,
    cacheEnabled: process.env.FINANCE_CACHE_ENABLED !== 'false',
    defaultSource: (process.env.FINANCE_DEFAULT_SOURCE as FinanceDataSource | 'auto') || 'auto',
  };

  return getFinanceOrchestrator(config);
}
