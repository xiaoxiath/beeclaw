/**
 * Bing Search Provider
 *
 * Uses Bing Web Search API v7 - works in both China and globally
 */

import { SearchProvider } from '../../base';
import { SearchRegion } from '../../types';
import type { SearchRequest, SearchResult } from '../../types';

export class BingProvider extends SearchProvider {
  name = 'bing';
  supportedRegions: SearchRegion[] = [
    SearchRegion.GLOBAL,
    SearchRegion.CN,
    SearchRegion.US,
  ];

  private apiKey: string | undefined;
  private timeout: number;

  private readonly API_URL = 'https://api.bing.microsoft.com/v7.0/search';

  private readonly MARKET_MAP: Record<string, string> = {
    [SearchRegion.CN]: 'zh-CN',
    [SearchRegion.US]: 'en-US',
    [SearchRegion.GLOBAL]: 'en-US',
  };

  private readonly TIME_RANGE_MAP: Record<string, string> = {
    day: 'Day',
    week: 'Week',
    month: 'Month',
  };

  constructor(config?: { apiKey?: string; timeout?: number }) {
    super();
    this.apiKey = config?.apiKey;
    this.timeout = config?.timeout || 15000;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async search(request: SearchRequest): Promise<SearchResult[]> {
    if (!this.apiKey) {
      throw new Error('Bing API key not configured');
    }

    const region = request.region || SearchRegion.GLOBAL;
    const params: Record<string, string> = {
      q: request.query,
      count: String(request.numResults || 10),
      mkt: this.MARKET_MAP[region] || 'en-US',
      safeSearch: request.safeSearch !== false ? 'Strict' : 'Off',
    };

    if (request.timeRange) {
      params.freshness = this.TIME_RANGE_MAP[request.timeRange] || '';
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.API_URL}?${new URLSearchParams(params)}`, {
        headers: {
          'Ocp-Apim-Subscription-Key': this.apiKey,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Bing API error: ${response.status}`);
      }

      const data = await response.json();
      return this.parseResults(data);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Bing search timeout');
      }
      throw error;
    }
  }

  private parseResults(data: Record<string, unknown>): SearchResult[] {
    const results: SearchResult[] = [];
    const webPages = (data.webPages as { value?: Array<Record<string, unknown>> })?.value || [];

    for (const item of webPages) {
      results.push({
        title: (item.name as string) || '',
        url: (item.url as string) || '',
        snippet: (item.snippet as string) || '',
        source: this.name,
        publishedDate: item.dateLastCrawled as string | undefined,
        raw: item,
      });
    }

    return results;
  }
}
