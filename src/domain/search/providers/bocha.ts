/**
 * Bocha AI Search Provider (博查AI)
 *
 * High-quality search API for AI applications in China
 * https://bochaai.com/
 */

import { SearchProvider } from '../base';
import { SearchRegion } from '../types';
import type { SearchRequest, SearchResult } from '../types';

export class BochaProvider extends SearchProvider {
  name = 'bocha';
  supportedRegions: SearchRegion[] = [
    SearchRegion.GLOBAL,
    SearchRegion.CN,
  ];

  private apiKey: string | undefined;
  private timeout: number;
  private endpoint = 'https://api.bochaai.com/v1/web-search';

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
      throw new Error('Bocha API key not configured');
    }

    const numResults = request.numResults || 10;

    // Map time range to Bocha freshness
    const freshnessMap: Record<string, string> = {
      day: 'oneDay',
      week: 'oneWeek',
      month: 'oneMonth',
      year: 'oneYear',
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          query: request.query,
          count: numResults,
          summary: true,  // Return summaries for better context
          freshness: request.timeRange ? freshnessMap[request.timeRange] : 'noLimit',
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Bocha API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return this.parseResults(data);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Bocha search timeout');
      }
      throw error;
    }
  }

  private parseResults(data: any): SearchResult[] {
    const results: SearchResult[] = [];

    // Bocha returns data in webPages.value array
    const items = data?.data?.webPages?.value || data?.webPages?.value || [];

    for (const item of items) {
      results.push({
        title: item.name || item.title || '',
        url: item.url || item.link || '',
        snippet: item.snippet || item.summary || item.description || '',
        source: this.name,
        publishedDate: item.dateLastCrawled || item.datePublished,
      });
    }

    return results;
  }
}
