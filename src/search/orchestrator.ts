/**
 * Search Orchestrator
 *
 * Core orchestration layer: routing, fallback, merging, dedup, ranking
 */

import { SearchRegion } from './types';
import type { SearchRequest, SearchResult, SearchConfig } from './types';
import { SearchProvider } from './base';
import { DuckDuckGoProvider } from './providers/duckduckgo';
import { BingProvider } from './providers/bing';
import { BraveProvider } from './providers/brave';
import { GoogleProvider } from './providers/google';
import { BochaProvider } from './providers/bocha';
import { TavilyProvider } from './providers/tavily';

export class SearchOrchestrator {
  private providers: SearchProvider[] = [];
  private fallbackChain: Map<string, string[]> = new Map();
  private config: SearchConfig;

  constructor(config?: SearchConfig) {
    this.config = config || { providers: {} };
    this.initializeProviders();
  }

  private initializeProviders(): void {
    const { providers: providerConfigs } = this.config;

    // Register providers in priority order
    // New providers (Bocha for CN, Tavily for Global) have highest priority

    // Bocha AI (博查) - Best for Chinese queries, high quality in China
    if (providerConfigs.bocha?.apiKey) {
      this.registerProvider(
        new BochaProvider(providerConfigs.bocha),
        ['bing', 'duckduckgo']
      );
    }

    // Tavily - Best for global/English queries, AI-optimized
    if (providerConfigs.tavily?.apiKey) {
      this.registerProvider(
        new TavilyProvider(providerConfigs.tavily),
        ['brave', 'duckduckgo']
      );
    }

    // Google (highest quality, but requires API key + CX)
    if (providerConfigs.google?.apiKey && providerConfigs.google?.cx) {
      this.registerProvider(
        new GoogleProvider(providerConfigs.google),
        ['bing', 'brave', 'duckduckgo']
      );
    }

    // Bing (works in China, good quality)
    if (providerConfigs.bing?.apiKey) {
      this.registerProvider(
        new BingProvider(providerConfigs.bing),
        ['brave', 'duckduckgo']
      );
    }

    // Brave (good free tier)
    if (providerConfigs.brave?.apiKey) {
      this.registerProvider(
        new BraveProvider(providerConfigs.brave),
        ['duckduckgo']
      );
    }

    // DuckDuckGo (always available as fallback, no API key needed)
    if (providerConfigs.duckduckgo?.enabled !== false) {
      this.registerProvider(new DuckDuckGoProvider(providerConfigs.duckduckgo));
    }
  }

  private registerProvider(provider: SearchProvider, fallbacks: string[] = []): void {
    this.providers.push(provider);
    this.fallbackChain.set(provider.name, fallbacks);
  }

  /**
   * Execute search with automatic routing, fallback, and result processing
   */
  async search(request: SearchRequest): Promise<SearchResult[]> {
    // Step 1: Auto-detect region if needed
    if (request.region === SearchRegion.AUTO || !request.region) {
      request.region = this.detectRegion(request.query);
    }

    // Step 2: Select best provider based on region
    const candidates = this.selectProvidersForRegion(request.region);

    if (candidates.length === 0) {
      throw new Error('No search providers configured');
    }

    console.log(`[Search] Region: ${request.region}, Providers: ${candidates.map(p => p.name).join(', ')}`);

    // Step 3: Execute search with fallback
    const results = await this.executeWithFallback(candidates, request);

    // Step 4: Post-processing
    let processed = results;

    if (this.config.enableDedup !== false) {
      processed = this.deduplicate(processed);
    }

    if (this.config.enableRanking !== false) {
      processed = this.rank(processed, request.query);
    }

    return processed.slice(0, request.numResults || 10);
  }

  /**
   * Select providers based on region
   * Prioritize providers that are optimized for the detected region
   */
  private selectProvidersForRegion(region: SearchRegion): SearchProvider[] {
    const configured = this.providers.filter(p => p.isConfigured());

    if (configured.length === 0) {
      return [];
    }

    // Define priority order based on region
    const priorityMap: Record<SearchRegion, string[]> = {
      [SearchRegion.CN]: ['bocha', 'bing', 'brave', 'google', 'tavily', 'duckduckgo'],
      [SearchRegion.US]: ['tavily', 'google', 'brave', 'bing', 'bocha', 'duckduckgo'],
      [SearchRegion.GLOBAL]: ['tavily', 'google', 'brave', 'bing', 'bocha', 'duckduckgo'],
      [SearchRegion.AUTO]: ['tavily', 'bocha', 'google', 'brave', 'bing', 'duckduckgo'],
    };

    const priorities = priorityMap[region] || priorityMap[SearchRegion.GLOBAL];

    // Sort configured providers by priority
    return configured.sort((a, b) => {
      const aIndex = priorities.indexOf(a.name);
      const bIndex = priorities.indexOf(b.name);
      // If provider not in priority list, put it at the end
      const aPriority = aIndex === -1 ? Infinity : aIndex;
      const bPriority = bIndex === -1 ? Infinity : bIndex;
      return aPriority - bPriority;
    });
  }

  /**
   * Execute search with fallback chain
   */
  private async executeWithFallback(
    providers: SearchProvider[],
    request: SearchRequest
  ): Promise<SearchResult[]> {
    const allResults: SearchResult[] = [];
    const errors: Error[] = [];

    // Try each provider
    for (const provider of providers) {
      try {
        const results = await Promise.race([
          provider.search(request),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), this.config.timeout || 15000)
          ),
        ]);

        if (results.length > 0) {
          allResults.push(...results);
          // If we got good results, we can stop trying more providers
          // (or continue to merge results from multiple providers)
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`[Search] ${provider.name} failed: ${errorMsg}`);
        errors.push(error instanceof Error ? error : new Error(errorMsg));

        // Try fallback providers
        const fallbacks = this.fallbackChain.get(provider.name) || [];
        for (const fallbackName of fallbacks) {
          const fallbackProvider = this.providers.find(p => p.name === fallbackName);
          if (fallbackProvider && fallbackProvider.isConfigured()) {
            try {
              const fallbackResults = await fallbackProvider.search(request);
              if (fallbackResults.length > 0) {
                allResults.push(...fallbackResults);
                break;
              }
            } catch (fallbackError) {
              console.warn(`[Search] Fallback ${fallbackName} also failed`);
            }
          }
        }
      }
    }

    // If all providers failed, throw the first error
    if (allResults.length === 0 && errors.length > 0) {
      throw errors[0];
    }

    return allResults;
  }

  /**
   * Detect region based on query content
   */
  private detectRegion(query: string): SearchRegion {
    // Count Chinese characters
    const chineseChars = query.match(/[\u4e00-\u9fff]/g);
    const chineseRatio = chineseChars ? chineseChars.length / query.length : 0;

    if (chineseRatio > 0.3) {
      return SearchRegion.CN;
    }

    return SearchRegion.GLOBAL;
  }

  /**
   * Deduplicate results by normalized URL
   */
  private deduplicate(results: SearchResult[]): SearchResult[] {
    const seen = new Set<string>();
    const deduped: SearchResult[] = [];

    for (const result of results) {
      // Normalize URL: remove trailing slash, query params, lowercase
      const normalized = result.url
        .toLowerCase()
        .split('?')[0]
        .replace(/\/$/, '');

      if (!seen.has(normalized)) {
        seen.add(normalized);
        deduped.push(result);
      }
    }

    return deduped;
  }

  /**
   * Rank results by relevance
   */
  private rank(results: SearchResult[], query: string): SearchResult[] {
    const queryTerms = query.toLowerCase().split(/\s+/);

    for (const result of results) {
      const text = `${result.title} ${result.snippet}`.toLowerCase();

      // Calculate term hit ratio
      const hitCount = queryTerms.filter(term => text.includes(term)).length;
      const hitRatio = hitCount / Math.max(queryTerms.length, 1);

      // Source quality bonus
      const sourceBonus: Record<string, number> = {
        bocha: 0.18,      // 博查AI - high quality for CN
        tavily: 0.16,     // Tavily - AI optimized
        google: 0.15,
        bing: 0.12,
        brave: 0.08,
        duckduckgo: 0.05,
      };

      result.score = hitRatio + (sourceBonus[result.source] || 0);
    }

    // Sort by score descending
    return results.sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  /**
   * Get list of configured providers
   */
  getConfiguredProviders(): string[] {
    return this.providers
      .filter(p => p.isConfigured())
      .map(p => p.name);
  }
}

// Singleton instance
let orchestratorInstance: SearchOrchestrator | null = null;

/**
 * Get or create the search orchestrator singleton
 */
export function getSearchOrchestrator(config?: SearchConfig): SearchOrchestrator {
  if (!orchestratorInstance || config) {
    orchestratorInstance = new SearchOrchestrator(config);
  }
  return orchestratorInstance;
}

/**
 * Initialize search with environment variables (uses unified config)
 */
export function initSearchFromEnv(): SearchOrchestrator {
  // Lazy import to avoid circular dependency
  // Config should be loaded before calling this function
  const searchConfig = {
    bochaApiKey: process.env.BOCHA_API_KEY,
    tavilyApiKey: process.env.TAVILY_API_KEY,
    googleApiKey: process.env.GOOGLE_SEARCH_API_KEY,
    googleCx: process.env.GOOGLE_SEARCH_CX,
    bingApiKey: process.env.BING_SEARCH_API_KEY,
    braveApiKey: process.env.BRAVE_SEARCH_API_KEY,
  };

  const config: SearchConfig = {
    providers: {
      // New providers (recommended)
      bocha: {
        apiKey: searchConfig.bochaApiKey,
      },
      tavily: {
        apiKey: searchConfig.tavilyApiKey,
      },
      // Legacy providers
      google: {
        apiKey: searchConfig.googleApiKey,
        cx: searchConfig.googleCx,
      },
      bing: {
        apiKey: searchConfig.bingApiKey,
      },
      brave: {
        apiKey: searchConfig.braveApiKey,
      },
      duckduckgo: {
        enabled: true,
      },
    },
  };

  return getSearchOrchestrator(config);
}
