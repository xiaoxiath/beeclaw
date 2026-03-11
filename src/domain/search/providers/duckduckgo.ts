/**
 * DuckDuckGo Search Provider
 *
 * Free search provider using HTML scraping - no API key required
 */

import { SearchProvider } from '../base';
import { SearchRegion } from '../types';
import type { SearchRequest, SearchResult } from '../types';

export class DuckDuckGoProvider extends SearchProvider {
  name = 'duckduckgo';
  supportedRegions: SearchRegion[] = [
    SearchRegion.GLOBAL,
    SearchRegion.CN,
    SearchRegion.US,
  ];

  private timeout: number;

  constructor(config?: { timeout?: number }) {
    super();
    this.timeout = config?.timeout || 15000;
  }

  isConfigured(): boolean {
    return true; // No API key required
  }

  async search(request: SearchRequest): Promise<SearchResult[]> {
    const query = request.query;
    const numResults = request.numResults || 10;
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Beeclaw/1.0)',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }

      const html = await response.text();
      return this.parseResults(html, numResults);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('DuckDuckGo search timeout');
      }
      throw error;
    }
  }

  private parseResults(html: string, numResults: number): SearchResult[] {
    const results: SearchResult[] = [];

    // Match result links with snippets
    const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

    let match;
    let count = 0;
    while ((match = resultRegex.exec(html)) !== null && count < numResults) {
      let url = match[1];
      const title = match[2].trim();
      const snippet = match[3]
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num)))
        .trim();

      // Extract actual URL from DuckDuckGo redirect
      const uddgMatch = url.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        try {
          url = decodeURIComponent(uddgMatch[1]);
        } catch {
          // Keep original if decode fails
        }
      }

      // Skip internal DuckDuckGo URLs
      if (url && !url.startsWith('/') && !url.includes('duckduckgo.com/?')) {
        results.push({
          title,
          url,
          snippet,
          source: this.name,
        });
        count++;
      }
    }

    return results;
  }
}
