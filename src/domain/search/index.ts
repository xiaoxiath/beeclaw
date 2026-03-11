/**
 * Web Search System
 *
 * Multi-provider web search with orchestration, fallback, and content extraction
 */

export * from './types';
export { SearchProvider } from './base';
export { DuckDuckGoProvider } from './providers/duckduckgo';
export { BingProvider } from './providers/bing';
export { BraveProvider } from './providers/brave';
export { GoogleProvider } from './providers/google';
export { BochaProvider } from './providers/bocha';
export { TavilyProvider } from './providers/tavily';
export {
  SearchOrchestrator,
  getSearchOrchestrator,
  initSearchFromEnv,
} from './orchestrator';
export {
  ContentExtractor,
  getContentExtractor,
  type ExtractOptions,
} from './extractor';

// Re-export commonly used types
import type { SearchResult, SearchRequest, SearchRegion, SearchConfig } from './types';
import { getSearchOrchestrator, initSearchFromEnv } from './orchestrator';
import { getContentExtractor } from './extractor';

/**
 * Quick search function for simple use cases
 */
export async function webSearch(
  query: string,
  options?: {
    numResults?: number;
    region?: SearchRegion;
    timeRange?: 'day' | 'week' | 'month' | 'year';
  }
): Promise<SearchResult[]> {
  const orchestrator = getSearchOrchestrator();
  return orchestrator.search({
    query,
    numResults: options?.numResults || 10,
    region: options?.region,
    timeRange: options?.timeRange,
  });
}

/**
 * Quick fetch function for extracting content from a URL
 */
export async function webFetch(
  url: string,
  options?: {
    maxLength?: number;
    includeImages?: boolean;
  }
): Promise<string> {
  const extractor = getContentExtractor();
  return extractor.extract(url, {
    maxLength: options?.maxLength || 10000,
    includeImages: options?.includeImages,
  });
}

/**
 * Initialize search system from environment variables
 *
 * Set these environment variables:
 * - GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_CX for Google
 * - BING_SEARCH_API_KEY for Bing
 * - BRAVE_SEARCH_API_KEY for Brave
 */
export function initSearch(): void {
  initSearchFromEnv();
}
