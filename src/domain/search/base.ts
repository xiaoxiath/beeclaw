/**
 * Base Search Provider Interface
 *
 * All search engine adapters must implement this interface
 */

import type { SearchRequest, SearchResult } from './types';
import { SearchRegion } from './types';

export abstract class SearchProvider {
  abstract name: string;
  abstract supportedRegions: SearchRegion[];

  /**
   * Execute search and return standardized results
   */
  abstract search(request: SearchRequest): Promise<SearchResult[]>;

  /**
   * Check if this provider supports the given region
   */
  supportsRegion(region: SearchRegion): boolean {
    return this.supportedRegions.includes(region) ||
           this.supportedRegions.includes(SearchRegion.GLOBAL);
  }

  /**
   * Check if this provider is properly configured
   */
  abstract isConfigured(): boolean;
}
