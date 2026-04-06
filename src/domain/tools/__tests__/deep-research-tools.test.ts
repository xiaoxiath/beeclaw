import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock all heavy dependencies
const mockSearch = vi.fn(() => Promise.resolve([]));
const mockExtract = vi.fn(() => Promise.resolve('content'));

vi.mock('../../search', () => ({
  getSearchOrchestrator: () => ({
    search: mockSearch,
  }),
  getContentExtractor: () => ({
    extract: mockExtract,
  }),
}));

vi.mock('../../search/research/deep-research-v2', () => ({
  createDeepResearchHandler: vi.fn((deps: any) => {
    // Return an async function that simulates deep research
    return async (params: any) => ({
      report: `Research report on: ${params.topic}`,
      sources: [],
    });
  }),
}));

vi.mock('../../../infra/bee-adapter', () => ({
  getBeeAIClient: () => ({
    callAI: vi.fn(() => Promise.resolve({
      choices: [{ message: { content: 'AI response' } }],
    })),
  }),
  toProviderConfig: (p: any) => p,
}));

vi.mock('../../../app', () => ({
  getProvider: () => 'openai',
  getModel: () => 'gpt-4',
}));

vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../builtin', () => ({
  cleanText: (t: string) => t.trim(),
}));

import {
  deepResearchTool,
  executeDeepResearch,
  DeepResearchSchema,
} from '../deep-research-tools';

describe('deep-research-tools', () => {
  beforeEach(() => {
    mockSearch.mockClear();
    mockExtract.mockClear();
  });

  describe('deepResearchTool', () => {
    it('has correct name', () => {
      expect(deepResearchTool.name).toBe('deep_research');
    });

    it('requires topic parameter', () => {
      expect(deepResearchTool.parameters.required).toContain('topic');
    });

    it('has depth enum options', () => {
      expect(deepResearchTool.parameters.properties.depth.enum).toEqual([
        'quick', 'standard', 'comprehensive',
      ]);
    });
  });

  describe('DeepResearchSchema', () => {
    it('validates valid params', () => {
      const result = DeepResearchSchema.safeParse({ topic: 'AI trends' });
      expect(result.success).toBe(true);
    });

    it('rejects missing topic', () => {
      const result = DeepResearchSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('defaults depth to standard', () => {
      const result = DeepResearchSchema.safeParse({ topic: 'test' });
      if (result.success) {
        expect(result.data.depth).toBe('standard');
      }
    });

    it('accepts aspects array', () => {
      const result = DeepResearchSchema.safeParse({
        topic: 'AI',
        aspects: ['safety', 'ethics'],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('executeDeepResearch', () => {
    it('returns error for invalid params', async () => {
      const result = await executeDeepResearch({});
      expect(result.success).toBe(false);
    });

    it('returns research report on success', async () => {
      const result = await executeDeepResearch({ topic: 'TypeScript best practices' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('TypeScript best practices');
    });

    it('handles research error', async () => {
      // Re-mock to throw
      const { createDeepResearchHandler } = await import('../../search/research/deep-research-v2');
      (createDeepResearchHandler as any).mockReturnValueOnce(async () => {
        throw new Error('Search quota exceeded');
      });
      const result = await executeDeepResearch({ topic: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Search quota exceeded');
    });
  });
});
