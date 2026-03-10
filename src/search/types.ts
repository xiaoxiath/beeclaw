/**
 * Web Search System Models
 *
 * Unified data models for the multi-provider search system
 */

export enum SearchRegion {
  GLOBAL = 'global',
  CN = 'cn',      // China mainland
  US = 'us',
  AUTO = 'auto',  // Auto-detect based on query
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;              // Provider name
  score?: number;              // Relevance score
  publishedDate?: string;
  raw?: Record<string, unknown>;
}

export interface SearchRequest {
  query: string;
  region?: SearchRegion;
  numResults?: number;
  language?: string;           // zh-CN, en-US, ...
  safeSearch?: boolean;
  timeRange?: 'day' | 'week' | 'month' | 'year';
}

export interface SearchProviderConfig {
  apiKey?: string;
  cx?: string;                 // Google Custom Search Engine ID
  enabled?: boolean;
  timeout?: number;
}

export interface SearchConfig {
  providers: {
    duckduckgo?: SearchProviderConfig;
    bing?: SearchProviderConfig;
    brave?: SearchProviderConfig;
    google?: SearchProviderConfig;
    baidu?: SearchProviderConfig;
    bocha?: SearchProviderConfig;      // 博查AI (国内)
    tavily?: SearchProviderConfig;     // Tavily (国外)
  };
  defaultRegion?: SearchRegion;
  defaultNumResults?: number;
  timeout?: number;
  enableDedup?: boolean;
  enableRanking?: boolean;
  cacheMaxSize?: number;
  cacheTtlMs?: number;
}
