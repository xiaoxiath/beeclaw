/**
 * Google Custom Search Provider
 *
 * Uses Google Custom Search JSON API - 100 free searches/day
 */

import { SearchProvider } from '../../base';
import { SearchRegion } from '../../types';
import type { SearchRequest, SearchResult } from '../../types';

export class GoogleProvider extends SearchProvider {
  name = 'google';
  supportedRegions: SearchRegion[] = [
    SearchRegion.GLOBAL,
    SearchRegion.US,
  ];

  private apiKey: string | undefined;
  private cx: string | undefined; // Custom Search Engine ID
  private timeout: number;

  private readonly API_URL = 'https://www.googleapis.com/customsearch/v1';

  constructor(config?: { apiKey?: string; cx?: string; timeout?: number }) {
    super();
    this.apiKey = config?.apiKey;
    this.cx = config?.cx;
    this.timeout = config?.timeout || 15000;
  }

  isConfigured(): boolean {
    return !!this.apiKey && !!this.cx;
  }

  async search(request: SearchRequest): Promise<SearchResult[]> {
    if (!this.apiKey || !this.cx) {
      throw new Error('Google API key and CX (Custom Search Engine ID) required');
    }

    const params: Record<string, string> = {
      key: this.apiKey,
      cx: this.cx,
      q: request.query,
      num: String(Math.min(request.numResults || 10, 10)), // Google max 10 per request
    };

    if (request.language) {
      params.lr = `lang_${request.language.slice(0, 2)}`;
    }

    if (request.safeSearch !== false) {
      params.safe = 'active';
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.API_URL}?${new URLSearchParams(params)}`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Google API error: ${response.status}`);
      }

      const data = await response.json();
      return this.parseResults(data);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Google search timeout');
      }
      throw error;
    }
  }

  private parseResults(data: Record<string, unknown>): SearchResult[] {
    const results: SearchResult[] = [];
    const items = (data.items as Array<Record<string, unknown>>) || [];

    for (const item of items) {
      results.push({
        title: (item.title as string) || '',
        url: (item.link as string) || '',
        snippet: (item.snippet as string) || '',
        source: this.name,
        raw: item,
      });
    }

    return results;
  }
}
