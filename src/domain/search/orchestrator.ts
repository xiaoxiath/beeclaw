/**
 * Search Orchestrator
 *
 * Core orchestration layer: routing, fallback, merging, dedup, ranking
 */

import { logger } from '../../infra/observability/logger';
import { SearchRegion } from './types';
import type { SearchRequest, SearchResult, SearchConfig } from './types';
import { SearchProvider } from './base';
import { DuckDuckGoProvider } from './providers/duckduckgo';
import { BingProvider } from './providers/bing';
import { BraveProvider } from './providers/brave';
import { GoogleProvider } from './providers/google';
import { BochaProvider } from './providers/bocha';
import { TavilyProvider } from './providers/tavily';
import { DeepResearchV2, createDeepResearchHandler, type DeepResearchV2Config, type ResearchDepth, type SearchFn, type FetchFn, type LLMCallFn, type ProgressCallback, type DeepResearchResult } from './research/deep-research-v2';

// ============================================================================
// TTL-based LRU Cache for search results
// ============================================================================

interface CacheEntry<T> {
  value: T;
  createdAt: number;
}

class SearchCache {
  private cache = new Map<string, CacheEntry<SearchResult[]>>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize = 50, ttlMs = 5 * 60 * 1000) { // default: 50 entries, 5 min TTL
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /** Generate a cache key from search request */
  static key(request: SearchRequest): string {
    return `${request.query}|${request.region || 'auto'}|${request.numResults || 10}|${request.timeRange || ''}`;
  }

  get(key: string): SearchResult[] | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    // Move to end (LRU)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: SearchResult[]): void {
    // Evict oldest if full
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { value, createdAt: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

export class SearchOrchestrator {
  private providers: SearchProvider[] = [];
  private fallbackChain: Map<string, string[]> = new Map();
  private config: SearchConfig;
  private cache: SearchCache;

  constructor(config?: SearchConfig) {
    this.config = config || { providers: {} };
    this.cache = new SearchCache(
      config?.cacheMaxSize ?? 50,
      config?.cacheTtlMs ?? 5 * 60 * 1000
    );
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
    // Step 0: Check cache
    const cacheKey = SearchCache.key(request);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      logger.debug(`[Search] Cache hit for: "${request.query.substring(0, 50)}..." (${cached.length} results)`);
      return cached;
    }

    // Step 1: Auto-detect region if needed
    if (request.region === SearchRegion.AUTO || !request.region) {
      request.region = this.detectRegion(request.query);
    }

    // Step 2: Select best provider based on region
    const candidates = this.selectProvidersForRegion(request.region);

    if (candidates.length === 0) {
      throw new Error('No search providers configured');
    }

    logger.debug(`[Search] Region: ${request.region}, Providers: ${candidates.map(p => p.name).join(', ')}`);

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

    const finalResults = processed.slice(0, request.numResults || 10);

    // Cache results
    this.cache.set(cacheKey, finalResults);

    return finalResults;
  }

  /**
   * Clear search cache (useful after config changes)
   */
  clearCache(): void {
    this.cache.clear();
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
        logger.warn(`[Search] ${provider.name} failed: ${errorMsg}`);
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
            } catch (_fallbackError) {
              logger.warn(`[Search] Fallback provider ${fallbackName} also failed for query: "${request.query.substring(0, 50)}"`);
            }
          }
        }
      }
    }

    // If all providers failed, throw an aggregate error
    if (allResults.length === 0 && errors.length > 0) {
      throw new AggregateError(errors, `All search providers failed (${errors.length} errors)`);
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
   * Deduplicate results by normalized URL + title similarity
   *
   * Handles: trailing slashes, query params, www prefix, protocol, fragments,
   * and near-identical titles pointing to different URL variants.
   */
  private deduplicate(results: SearchResult[]): SearchResult[] {
    const seen = new Map<string, SearchResult>(); // normalized URL → best result
    const titleIndex = new Map<string, string>(); // normalized title → URL key

    for (const result of results) {
      // Normalize URL: protocol, www, trailing slash, query params, fragment
      const normalized = result.url
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .split('?')[0]
        .split('#')[0]
        .replace(/\/+$/, '');

      // Normalize title for fuzzy matching
      const normalizedTitle = result.title
        .toLowerCase()
        .replace(/[\s\-_]+/g, ' ')
        .trim();

      // Check URL dedup
      if (seen.has(normalized)) {
        // Keep the one with higher score or longer snippet
        const existing = seen.get(normalized)!;
        if ((result.score || 0) > (existing.score || 0) ||
            (result.snippet?.length || 0) > (existing.snippet?.length || 0)) {
          seen.set(normalized, result);
        }
        continue;
      }

      // Check title dedup (same title from different providers = likely same page)
      if (normalizedTitle.length > 10 && titleIndex.has(normalizedTitle)) {
        const existingUrl = titleIndex.get(normalizedTitle)!;
        const existing = seen.get(existingUrl);
        if (existing && (result.score || 0) <= (existing.score || 0)) {
          continue; // Skip lower-scored duplicate
        }
      }

      seen.set(normalized, result);
      if (normalizedTitle.length > 10) {
        titleIndex.set(normalizedTitle, normalized);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Rank results by multi-factor relevance scoring
   *
   * Factors:
   *   1. Query term coverage (0-0.4) — how many query terms appear in title+snippet
   *   2. Title relevance bonus (0-0.15) — extra weight for terms in title
   *   3. Snippet quality (0-0.15) — longer snippets get small bonus (more context)
   *   4. Source quality (0-0.18) — provider trust scores
   *   5. Freshness signal (0-0.12) — recency indicators in snippet/title
   */
  private rank(results: SearchResult[], query: string): SearchResult[] {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);

    for (const result of results) {
      const title = (result.title || '').toLowerCase();
      const snippet = (result.snippet || '').toLowerCase();
      const fullText = `${title} ${snippet}`;

      // Factor 1: Query term coverage (max 0.4)
      const hitCount = queryTerms.filter(term => fullText.includes(term)).length;
      const termCoverage = (hitCount / Math.max(queryTerms.length, 1)) * 0.4;

      // Factor 2: Title relevance bonus (max 0.15)
      const titleHits = queryTerms.filter(term => title.includes(term)).length;
      const titleBonus = (titleHits / Math.max(queryTerms.length, 1)) * 0.15;

      // Factor 3: Snippet quality (max 0.15)
      const snippetLen = snippet.length;
      const snippetQuality = Math.min(snippetLen / 500, 1) * 0.15;

      // Factor 4: Source quality
      const sourceBonus: Record<string, number> = {
        bocha: 0.18,
        tavily: 0.16,
        google: 0.15,
        bing: 0.12,
        brave: 0.08,
        duckduckgo: 0.05,
      };
      const srcScore = sourceBonus[result.source] || 0.03;

      // Factor 5: Freshness signal (max 0.12)
      const currentYear = new Date().getFullYear();
      const freshnessPatterns = [
        String(currentYear),
        String(currentYear - 1),
        '最新', 'latest', 'updated', '更新',
      ];
      const hasFreshness = freshnessPatterns.some(p => fullText.includes(p.toLowerCase()));
      const freshnessScore = hasFreshness ? 0.12 : 0;

      result.score = termCoverage + titleBonus + snippetQuality + srcScore + freshnessScore;
    }

    return results.sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  // ===========================================================================
  // [P1] Deep Research V2 Integration
  // ===========================================================================

  /**
   * Execute a deep research pipeline using the configured search providers.
   *
   * This is a high-level orchestration method that combines:
   * - Multi-query search via this orchestrator's providers
   * - Page content fetching
   * - LLM-powered synthesis and refinement
   *
   * @param topic - The research topic
   * @param options - Research configuration
   * @returns Deep research result with report, sources, and metadata
   */
  async deepResearch(
    topic: string,
    options: {
      depth?: ResearchDepth;
      aspects?: string[];
      fetchFn: FetchFn;
      llmCall: LLMCallFn;
      onProgress?: ProgressCallback;
      abortSignal?: AbortSignal;
    }
  ): Promise<DeepResearchResult> {
    const searchFn: SearchFn = async (query, opts) => {
      const results = await this.search({
        query,
        numResults: opts?.maxResults || 10,
      });
      return results.map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        provider: r.source,
        score: r.score,
      }));
    };

    const handler = createDeepResearchHandler({
      searchFn,
      fetchFn: options.fetchFn,
      llmCall: options.llmCall,
    });

    return handler({
      topic,
      depth: options.depth ?? 'standard',
      aspects: options.aspects,
      onProgress: options.onProgress,
      abortSignal: options.abortSignal,
    });
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
