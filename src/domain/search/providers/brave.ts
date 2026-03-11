/**
 * Brave Search Provider
 *
 * Uses Brave Search API - 2000 free searches/month
 */

import { SearchProvider } from '../../base';
import { SearchRegion } from '../../types';
import type { SearchRequest, SearchResult } from '../../types';

export class BraveProvider extends SearchProvider {
  name = 'brave';
  supportedRegions: SearchRegion[] = [
    SearchRegion.GLOBAL,
    SearchRegion.US,
  ];

  private apiKey: string | undefined;
  private timeout: number;

  private readonly API_URL = 'https://api.search.brave.com/res/v1/web/search';

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
      throw new Error('Brave API key not configured');
    }

    const params: Record<string, string> = {
      q: request.query,
      count: String(request.numResults || 10),
    };

    if (request.safeSearch !== false) {
      params.safesearch = 'strict';
    }

    if (request.timeRange) {
      const timeMap: Record<string, string> = {
        day: 'pd',
        week: 'pw',
        month: 'pm',
        year: 'py',
      };
      params.freshness = timeMap[request.timeRange] || '';
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.API_URL}?${new URLSearchParams(params)}`, {
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': this.apiKey,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Brave API error: ${response.status}`);
      }

      const data = await response.json();
      return this.parseResults(data);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Brave search timeout');
      }
      throw error;
    }
  }

  private parseResults(data: Record<string, unknown>): SearchResult[] {
    const results: SearchResult[] = [];
    const webResults = (data.web as { results?: Array<Record<string, unknown>> })?.results || [];

    for (const item of webResults) {
      results.push({
        title: (item.title as string) || '',
        url: (item.url as string) || '',
        snippet: (item.description as string) || '',
        source: this.name,
        publishedDate: item.page_age as string | undefined,
        raw: item,
      });
    }

    return results;
  }
}
