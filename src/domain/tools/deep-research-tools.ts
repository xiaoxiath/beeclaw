/**
 * Deep Research Tool
 *
 * Extracted from builtin.ts for modular organization.
 */

import { z } from 'zod';
import {
  getSearchOrchestrator,
  getContentExtractor,
} from '../search';
import { createDeepResearchHandler, type ResearchDepth } from '../search/research/deep-research-v2';
import { callAI } from '../agent/api';
import { getProvider, getModel } from '../../app';
import type { BuiltinToolResult } from './builtin';
import { cleanText } from './builtin';

// ============================================================================
// Deep Research Tool
// ============================================================================

export const DeepResearchSchema = z.object({
  topic: z.string().describe('The main topic or question to research'),
  aspects: z.array(z.string()).optional().describe('Specific aspects or angles to investigate (optional, will auto-discover if not provided)'),
  depth: z.enum(['quick', 'standard', 'comprehensive']).optional().default('standard').describe('Research depth: quick (3 searches), standard (5 searches), comprehensive (8+ searches)'),
  time_range: z.enum(['day', 'week', 'month', 'year']).optional().describe('Time range filter for results'),
});

export const deepResearchTool = {
  name: 'deep_research',
  description: 'Conduct systematic multi-angle research on a topic. Performs parallel searches, fetches key sources, and synthesizes findings into a comprehensive report. Use this when you need thorough research beyond a simple web search.',
  parameters: {
    type: 'object' as const,
    properties: {
      topic: {
        type: 'string',
        description: 'The main topic or question to research',
      },
      aspects: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific aspects to investigate (optional)',
      },
      depth: {
        type: 'string',
        enum: ['quick', 'standard', 'comprehensive'],
        description: 'Research depth (default: standard)',
      },
      time_range: {
        type: 'string',
        enum: ['day', 'week', 'month', 'year'],
        description: 'Time range filter for results',
      },
    },
    required: ['topic'],
  },
};

export async function executeDeepResearch(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = DeepResearchSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { topic, aspects, depth, time_range } = parsed.data;

  try {
    const orchestrator = getSearchOrchestrator();
    const extractor = getContentExtractor();

    // Create Deep Research V2 handler with dependencies
    const deepResearchHandler = createDeepResearchHandler({
      searchFn: async (query, opts) => {
        const results = await orchestrator.search({
          query,
          numResults: opts?.maxResults || 5,
          timeRange: time_range,
        });
        return results.map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
          source: r.source,
        }));
      },
      fetchFn: async (url, opts) => {
        const content = await extractor.extract(url, {
          maxLength: opts?.maxLength || 15000,
          includeImages: false,
        });
        return { content: cleanText(content) };
      },
      llmCall: async (messages, opts) => {
        // Get provider and model from app context
        const provider = getProvider();
        const model = opts?.model || getModel();

        // Convert CoreMessage to the format expected by callAI
        const apiMessages = messages.map(msg => ({
          role: msg.role,
          content: msg.content,
        }));

        const response = await callAI({
          provider,
          model,
          messages: apiMessages,
          temperature: opts?.temperature,
          maxTokens: opts?.maxTokens,
        });

        return response.choices[0].message?.content || '';
      },
    });

    // Execute Deep Research V2
    const result = await deepResearchHandler({
      topic,
      depth: depth as ResearchDepth,
      aspects,
    });

    return {
      success: true,
      data: result.report,
    };
  } catch (error) {
    return {
      success: false,
      error: `Deep research error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}
