/**
 * Tavily Search Provider
 *
 * AI-optimized search API for real-time information retrieval
 * https://tavily.com/
 */

import { SearchProvider } from '../base';
import { SearchRegion } from '../types';
import type { SearchRequest, SearchResult } from '../types';

export class TavilyProvider extends SearchProvider {
  name = 'tavily';
  supportedRegions: SearchRegion[] = [
    SearchRegion.GLOBAL,
    SearchRegion.US,
  ];

  private apiKey: string | undefined;
  private timeout: number;
  private endpoint = 'https://api.tavily.com/search';

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
      throw new Error('Tavily API key not configured');
    }

    const numResults = request.numResults || 10;

    // Map time range to Tavily days
    const daysMap: Record<string, number> = {
      day: 1,
      week: 7,
      month: 30,
      year: 365,
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const body: Record<string, any> = {
        query: request.query,
        max_results: numResults,
        include_raw_content: false,
        include_images: false,
        include_image_descriptions: false,
        search_depth: 'basic',  // 'basic' or 'advanced'
      };

      // Add time range if specified
      if (request.timeRange && daysMap[request.timeRange]) {
        body.days = daysMap[request.timeRange];
      }

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Tavily API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return this.parseResults(data);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Tavily search timeout');
      }
      throw error;
    }
  }

  private parseResults(data: any): SearchResult[] {
    const results: SearchResult[] = [];

    // Tavily returns results in 'results' array
    const items = data?.results || [];

    for (const item of items) {
      results.push({
        title: item.title || '',
        url: item.url || '',
        snippet: item.content || item.snippet || '',
        source: this.name,
        score: item.score,
        publishedDate: item.published_date,
      });
    }

    return results;
  }
}
