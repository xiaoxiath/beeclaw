/**
 * Search Tools — Web Search & Web Fetch
 *
 * Extracted from builtin.ts for modular organization.
 */

import { z } from 'zod';
import {
  getSearchOrchestrator,
  getContentExtractor,
  SearchRegion,
} from '../search';
import type { BuiltinToolResult } from './builtin';
import { cleanText } from './builtin';

// ============================================================================
// Web Search Tool (using multi-provider search system)
// ============================================================================

export const WebSearchSchema = z.object({
  query: z.string().describe('Search query'),
  num_results: z.number().min(1).max(20).optional().default(10).describe('Number of results to return'),
  region: z.enum(['global', 'cn', 'us', 'auto']).optional().default('auto').describe('Search region'),
  time_range: z.enum(['day', 'week', 'month', 'year']).optional().describe('Time range filter'),
});

export const webSearchTool = {
  name: 'web_search',
  description: `Search the web for information using multiple search engines. Supports Chinese and English queries with automatic region detection.

IMPORTANT — Time-sensitive queries:
When the user asks for "latest", "recent", "current", "newest", "今年", "最新", "最近", or any time-sensitive information, you MUST set time_range to "week" or "month" to ensure results are fresh. Also consider appending the current year to the query string for time-sensitive topics.`,
  parameters: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search query string',
      },
      num_results: {
        type: 'number',
        description: 'Number of results to return (1-20, default 10)',
      },
      region: {
        type: 'string',
        enum: ['global', 'cn', 'us', 'auto'],
        description: 'Search region (default: auto-detect from query)',
      },
      time_range: {
        type: 'string',
        enum: ['day', 'week', 'month', 'year'],
        description: 'Filter results by time range',
      },
    },
    required: ['query'],
  },
};

export async function executeWebSearch(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = WebSearchSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { query, num_results, region, time_range } = parsed.data;

  try {
    const orchestrator = getSearchOrchestrator();

    const regionMap: Record<string, SearchRegion> = {
      global: SearchRegion.GLOBAL,
      cn: SearchRegion.CN,
      us: SearchRegion.US,
      auto: SearchRegion.AUTO,
    };

    const results = await orchestrator.search({
      query,
      numResults: num_results,
      region: regionMap[region || 'auto'],
      timeRange: time_range,
    });

    if (results.length === 0) {
      return { success: true, data: `No results found for: ${query}` };
    }

    const formatted = results.map((r, i) =>
      `${i + 1}. **${r.title}**\n   URL: ${r.url}\n   ${cleanText(r.snippet)}${r.source ? ` [${r.source}]` : ''}`
    ).join('\n\n');

    return { success: true, data: formatted };
  } catch (error) {
    return {
      success: false,
      error: `Search error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// Web Fetch Tool (using content extractor)
// ============================================================================

export const WebFetchSchema = z.object({
  url: z.string().url().describe('URL to fetch'),
  format: z.enum(['text', 'markdown', 'json']).optional().default('markdown').describe('Output format'),
  max_length: z.number().min(100).max(50000).optional().default(10000).describe('Maximum content length'),
});

export const webFetchTool = {
  name: 'web_fetch',
  description: 'Fetch and read content from a URL. Extracts main content and converts to readable format.',
  parameters: {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch content from',
      },
      format: {
        type: 'string',
        enum: ['text', 'markdown', 'json'],
        description: 'Output format (default: markdown)',
      },
      max_length: {
        type: 'number',
        description: 'Maximum content length in characters (default: 10000)',
      },
    },
    required: ['url'],
  },
};

export async function executeWebFetch(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = WebFetchSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { url, format, max_length } = parsed.data;

  try {
    const extractor = getContentExtractor();

    // Use the content extractor which handles HTML to markdown conversion
    let content = await extractor.extract(url, {
      maxLength: max_length,
      includeImages: false,
    });

    // Apply final cleanup
    content = cleanText(content);

    if (format === 'text') {
      // Strip markdown formatting for plain text
      const text = content
        // eslint-disable-next-line no-useless-escape
        .replace(/[#*`_\[\]]/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/```[\s\S]*?```/g, match => match.replace(/```\n?/g, ''));
      return { success: true, data: cleanText(text) };
    }

    return { success: true, data: content };
  } catch (error) {
    return {
      success: false,
      error: `Fetch error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}
