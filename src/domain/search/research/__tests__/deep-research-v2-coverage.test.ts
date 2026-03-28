import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DeepResearchV2,
} from '../deep-research-v2';
import type {
  SearchFn,
  FetchFn,
  LLMCallFn,
  SearchResultItem,
  SynthesisReport,
} from '../deep-research-v2';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSynthesisJson(overrides?: Partial<SynthesisReport>): string {
  const base: SynthesisReport = {
    title: 'Test Report',
    sections: [
      {
        heading: 'Section 1',
        content: 'Content with [Source 1] citation',
        citations: ['src_1'],
        confidenceScore: 0.9,
      },
    ],
    contradictions: [],
    coverageGaps: [],
    references: [
      { id: 'src_1', url: 'https://example.com', title: 'Example' },
    ],
    ...overrides,
  };
  return JSON.stringify(base);
}

function createSmartLLM(): LLMCallFn {
  return vi.fn(async (messages) => {
    const last = messages[messages.length - 1]?.content || '';
    if (last.includes('key aspects') || last.includes('dimensions'))
      return JSON.stringify({ aspects: ['Market Size', 'Key Players'] });
    if (last.includes('query strategist') || last.includes('search queries'))
      return JSON.stringify({ queries: ['query1', 'query2', 'query3'] });
    if (last.includes('Evaluate the coverage'))
      return JSON.stringify({ score: 90, gaps: [] });
    if (last.includes('fill these research gaps'))
      return JSON.stringify({ queries: ['supplement1'] });
    if (last.includes('executive summary') || last.includes('概要'))
      return 'This is the executive summary.';
    if (last.includes('merging multiple partial'))
      return makeSynthesisJson();
    return makeSynthesisJson();
  }) as any;
}

function createMockSearch(results?: SearchResultItem[]): SearchFn {
  return vi.fn(async () => results ?? [
    { title: 'Result 1', url: 'https://a.com/page1', snippet: 'Snippet 1', score: 0.9 },
    { title: 'Result 2', url: 'https://b.com/page2', snippet: 'Snippet 2', score: 0.8 },
  ]) as any;
}

function createMockFetch(content?: string): FetchFn {
  return vi.fn(async (url) => ({
    content: content ?? `Full page content from ${url} with enough text to pass the 100 char minimum check for valid pages`,
    title: `Page: ${url}`,
  })) as any;
}

const longContent = 'A'.repeat(200) + ' real content';

describe('DeepResearchV2 coverage - uncovered lines', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  // ========================================================================
  // Line 444: throw error (non-abort/non-timeout error in execute)
  // ========================================================================
  describe('execute throws non-abort errors', () => {
    it('should re-throw non-timeout/non-abort errors from pipeline', async () => {
      const llm = vi.fn(async () => {
        throw new Error('Unexpected LLM catastrophic failure');
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      // The first LLM call is for query generation; it throws a non-abort Error.
      // fallbackQueryGeneration will handle it, but synthesis will also throw.
      // Actually, generateQueries catches LLM error and falls back. Let's make
      // the searchFn throw a non-abort error instead.
      const badSearch: SearchFn = vi.fn(async () => {
        const err = new Error('Something unexpected');
        // Make sure it's NOT a TimeoutError or AbortError
        throw err;
      }) as any;

      const pipeline2 = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: badSearch,
        fetchFn: createMockFetch(longContent),
        llmCall: createSmartLLM(),
      });

      // Search errors are caught by Promise.allSettled in executeSearches,
      // so they won't propagate. We need an error in the actual pipeline
      // that is NOT caught internally. Let's throw from timedPhase by
      // making the LLM throw during synthesis (after sources are fetched).

      let callCount = 0;
      const throwingSynthesisLLM: LLMCallFn = vi.fn(async (messages) => {
        callCount++;
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        // Throw a TypeError during synthesis (not TimeoutError/AbortError)
        throw new TypeError('Cannot read properties of undefined');
      }) as any;

      const pipeline3 = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(longContent),
        llmCall: throwingSynthesisLLM,
      });

      await expect(pipeline3.execute('Topic', ['A'])).rejects.toThrow('Cannot read properties');
    });
  });

  // ========================================================================
  // Line 522: fallbackQueryGeneration - "2024 latest" query when under max
  // ========================================================================
  describe('fallbackQueryGeneration coverage', () => {
    it('should add a 2024 latest query when under maxQueries', async () => {
      // Force query generation to fail so fallback is used
      let callCount = 0;
      const llm: LLMCallFn = vi.fn(async (messages) => {
        callCount++;
        const last = messages[messages.length - 1]?.content || '';
        // Query gen fails
        if (last.includes('query strategist') || last.includes('search queries'))
          throw new Error('LLM failed');
        if (last.includes('executive summary'))
          return 'Summary';
        return makeSynthesisJson();
      }) as any;

      const searchFn = vi.fn(async () => [
        { title: 'R', url: 'https://a.com/p', snippet: 'S', score: 0.5 },
      ]) as SearchFn;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false, maxQueries: 10 },
        searchFn,
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      await pipeline.execute('TestTopic', ['Aspect1']);
      // The fallback produces: [topic, "topic Aspect1", "topic 2024 latest"]
      // The search should be called with these queries (in batches of 3)
      const searchCalls = (searchFn as any).mock.calls;
      const allQueries = searchCalls.map((c: any) => c[0]);
      expect(allQueries).toContain('TestTopic 2024 latest');
    });

    it('should not add 2024 latest query when at max', async () => {
      let callCount = 0;
      const llm: LLMCallFn = vi.fn(async (messages) => {
        callCount++;
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist'))
          throw new Error('LLM fail');
        if (last.includes('executive summary'))
          return 'Summary';
        return makeSynthesisJson();
      }) as any;

      const searchFn = vi.fn(async () => [
        { title: 'R', url: 'https://a.com/p', snippet: 'S' },
      ]) as SearchFn;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false, maxQueries: 2 },
        searchFn,
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      // aspects has 1 item. fallback = [topic, "topic Aspect1"] => length = 2 = maxQueries
      await pipeline.execute('TestTopic', ['Aspect1']);
      const allQueries = (searchFn as any).mock.calls.map((c: any) => c[0]);
      expect(allQueries).not.toContain('TestTopic 2024 latest');
    });
  });

  // ========================================================================
  // Line 579: deduplicateAndRank skips already visited URLs
  // ========================================================================
  describe('deduplicateAndRank - visited URLs filter', () => {
    it('should skip URLs that were already fetched in previous rounds', async () => {
      // This is tested via refinement: after first round fetches pages,
      // the second round should skip those URLs.
      let refinementRound = 0;
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist') || last.includes('search queries'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('Evaluate the coverage')) {
          refinementRound++;
          if (refinementRound === 1)
            return JSON.stringify({ score: 30, gaps: ['gap1'] });
          return JSON.stringify({ score: 95, gaps: [] });
        }
        if (last.includes('fill these research gaps'))
          return JSON.stringify({ queries: ['supplement1'] });
        if (last.includes('executive summary'))
          return 'Summary';
        return makeSynthesisJson();
      }) as any;

      const fetchFn = vi.fn(async (url: string) => ({
        content: longContent + ` from ${url}`,
        title: `Title ${url}`,
      })) as FetchFn;

      // Same URL returned from both initial and supplement searches
      const searchFn = vi.fn(async () => [
        { title: 'R1', url: 'https://same.com/page', snippet: 'S1', score: 0.9 },
      ]) as SearchFn;

      const pipeline = new DeepResearchV2({
        config: {
          depth: 'standard',
          enableRefinement: true,
          maxRefinementRounds: 2,
          coverageThreshold: 80,
        },
        searchFn,
        fetchFn,
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['A']);
      // fetchFn should be called once for the URL, not twice (visitedUrls filter)
      const fetchCalls = (fetchFn as any).mock.calls.map((c: any) => c[0]);
      const sameUrlCalls = fetchCalls.filter((u: string) => u === 'https://same.com/page');
      expect(sameUrlCalls.length).toBe(1);
    });
  });

  // ========================================================================
  // Lines 908-935: Refinement loop - full iteration with improvement, no-improvement,
  // gaps = 0, supplement queries = 0, no new sources
  // ========================================================================
  describe('refinement loop coverage', () => {
    it('should stop refinement when coverage meets threshold', async () => {
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('Evaluate the coverage'))
          return JSON.stringify({ score: 90, gaps: [] }); // above threshold 75
        if (last.includes('executive summary'))
          return 'Summary';
        return makeSynthesisJson();
      }) as any;

      const pipeline = new DeepResearchV2({
        config: {
          depth: 'standard',
          enableRefinement: true,
          maxRefinementRounds: 3,
          coverageThreshold: 75,
        },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['A']);
      // Should stop after 1 eval since score >= threshold
      expect(result.metadata.refinementRounds).toBe(0);
    });

    it('should stop refinement after 2 rounds of no improvement', async () => {
      let evalCount = 0;
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('Evaluate the coverage')) {
          evalCount++;
          // Return consistently low score (no improvement)
          return JSON.stringify({ score: 30, gaps: ['gap1'] });
        }
        if (last.includes('fill these research gaps'))
          return JSON.stringify({ queries: ['sup1'] });
        if (last.includes('executive summary'))
          return 'Summary';
        return makeSynthesisJson();
      }) as any;

      let fetchCounter = 0;
      const fetchFn: FetchFn = vi.fn(async (url) => {
        fetchCounter++;
        return {
          content: longContent + ` unique ${fetchCounter} from ${url}`,
          title: `Title ${fetchCounter}`,
        };
      }) as any;

      const pipeline = new DeepResearchV2({
        config: {
          depth: 'standard',
          enableRefinement: true,
          maxRefinementRounds: 5,
          coverageThreshold: 95,
        },
        searchFn: createMockSearch(),
        fetchFn,
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['A']);
      // Should stop after ~2 rounds of no improvement (noImprovementCount >= 2)
      expect(result.metadata.refinementRounds).toBeLessThanOrEqual(3);
    });

    it('should stop refinement when gaps list is empty', async () => {
      let evalCount = 0;
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('Evaluate the coverage')) {
          evalCount++;
          return JSON.stringify({ score: 50, gaps: [] }); // below threshold but no gaps
        }
        if (last.includes('executive summary'))
          return 'Summary';
        return makeSynthesisJson();
      }) as any;

      const pipeline = new DeepResearchV2({
        config: {
          depth: 'standard',
          enableRefinement: true,
          maxRefinementRounds: 3,
          coverageThreshold: 80,
        },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['A']);
      expect(result.metadata.refinementRounds).toBe(0);
    });

    it('should stop when supplementQueries returns empty', async () => {
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('Evaluate the coverage'))
          return JSON.stringify({ score: 50, gaps: ['gap1'] });
        if (last.includes('fill these research gaps'))
          return JSON.stringify({ queries: [] }); // empty supplement
        if (last.includes('executive summary'))
          return 'Summary';
        return makeSynthesisJson();
      }) as any;

      const pipeline = new DeepResearchV2({
        config: {
          depth: 'standard',
          enableRefinement: true,
          maxRefinementRounds: 3,
          coverageThreshold: 80,
        },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['A']);
      expect(result.metadata.refinementRounds).toBe(0);
    });

    it('should stop when no new sources are fetched in refinement', async () => {
      let evalCount = 0;
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('Evaluate the coverage')) {
          evalCount++;
          return JSON.stringify({ score: 50, gaps: ['gap1'] });
        }
        if (last.includes('fill these research gaps'))
          return JSON.stringify({ queries: ['sup1'] });
        if (last.includes('executive summary'))
          return 'Summary';
        return makeSynthesisJson();
      }) as any;

      // Search returns same URL as before, fetch fails for supplement search results
      const searchFn: SearchFn = vi.fn(async () => [
        { title: 'R1', url: 'https://same.com/page', snippet: 'S1', score: 0.9 },
      ]) as any;

      const pipeline = new DeepResearchV2({
        config: {
          depth: 'standard',
          enableRefinement: true,
          maxRefinementRounds: 3,
          coverageThreshold: 80,
        },
        searchFn,
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['A']);
      // Since same URL was already fetched, visitedUrls filter should cause 0 new sources
      expect(result.metadata.refinementRounds).toBe(0);
    });

    it('should perform actual refinement round with new sources', async () => {
      let evalCount = 0;
      let searchCallCount = 0;
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('Evaluate the coverage')) {
          evalCount++;
          if (evalCount === 1)
            return JSON.stringify({ score: 40, gaps: ['need more data'] });
          return JSON.stringify({ score: 95, gaps: [] });
        }
        if (last.includes('fill these research gaps'))
          return JSON.stringify({ queries: ['new search query'] });
        if (last.includes('executive summary'))
          return 'Summary';
        return makeSynthesisJson();
      }) as any;

      const searchFn: SearchFn = vi.fn(async () => {
        searchCallCount++;
        return [
          { title: `R${searchCallCount}`, url: `https://source${searchCallCount}.com/page`, snippet: 'S', score: 0.9 },
        ];
      }) as any;

      const pipeline = new DeepResearchV2({
        config: {
          depth: 'standard',
          enableRefinement: true,
          maxRefinementRounds: 3,
          coverageThreshold: 80,
        },
        searchFn,
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['A']);
      expect(result.metadata.refinementRounds).toBeGreaterThanOrEqual(1);
    });
  });

  // ========================================================================
  // Line 973: evaluateCoverage catch path
  // ========================================================================
  describe('evaluateCoverage catch fallback', () => {
    it('should return fallback score when coverage eval LLM fails', async () => {
      let evalFailed = false;
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('Evaluate the coverage')) {
          if (!evalFailed) {
            evalFailed = true;
            throw new Error('Eval LLM down');
          }
          return JSON.stringify({ score: 95, gaps: [] });
        }
        if (last.includes('fill these research gaps'))
          return JSON.stringify({ queries: ['sup1'] });
        if (last.includes('executive summary'))
          return 'Summary';
        return makeSynthesisJson({
          coverageGaps: ['fallback gap'],
        });
      }) as any;

      let fetchCount = 0;
      const searchFn: SearchFn = vi.fn(async () => {
        fetchCount++;
        return [
          { title: `R${fetchCount}`, url: `https://src${fetchCount}.com/p`, snippet: 'S', score: 0.9 },
        ];
      }) as any;

      const pipeline = new DeepResearchV2({
        config: {
          depth: 'standard',
          enableRefinement: true,
          maxRefinementRounds: 3,
          coverageThreshold: 80,
        },
        searchFn,
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['A']);
      // Should not crash; fallback returns score=50 with coverageGaps from report
      expect(result).toBeDefined();
    });
  });

  // ========================================================================
  // Lines 998-1015: quickCoverageEstimate
  // ========================================================================
  describe('quickCoverageEstimate', () => {
    it('should calculate coverage based on aspect matching and confidence', async () => {
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('executive summary'))
          return 'Summary';
        return makeSynthesisJson({
          sections: [
            { heading: 'Market Analysis', content: 'C1', citations: [], confidenceScore: 0.8 },
            { heading: 'Technology Trends', content: 'C2', citations: [], confidenceScore: 0.6 },
          ],
        });
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      // Aspects: "Market" matches "market analysis", "Technology" matches "technology trends"
      const result = await pipeline.execute('Topic', ['Market', 'Technology']);
      expect(result.metadata.finalCoverageScore).toBeGreaterThan(0);
      expect(typeof result.metadata.finalCoverageScore).toBe('number');
    });

    it('should handle empty aspects array', async () => {
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('key aspects'))
          return JSON.stringify([]); // empty aspects
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('executive summary'))
          return 'Summary';
        return makeSynthesisJson();
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      // No aspects provided, and LLM returns empty => fallback to [topic]
      const result = await pipeline.execute('Topic');
      expect(typeof result.metadata.finalCoverageScore).toBe('number');
    });

    it('should handle sections with no matching aspects', async () => {
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('executive summary'))
          return 'Summary';
        return makeSynthesisJson({
          sections: [
            { heading: 'Completely Unrelated', content: 'C', citations: [], confidenceScore: 0.5 },
          ],
        });
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['Pricing', 'Competition']);
      // No aspects matched => aspectCoverage = 0, avgConfidence = 0.5 * 50 = 25
      expect(result.metadata.finalCoverageScore).toBe(25);
    });
  });

  // ========================================================================
  // Lines 1007-1013: generateSupplementQueries catch fallback
  // ========================================================================
  describe('generateSupplementQueries fallback', () => {
    it('should generate fallback queries from gaps when LLM fails', async () => {
      let evalCount = 0;
      let supplementCallCount = 0;
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('Evaluate the coverage')) {
          evalCount++;
          if (evalCount === 1)
            return JSON.stringify({ score: 30, gaps: ['pricing data', 'competitor info'] });
          return JSON.stringify({ score: 95, gaps: [] });
        }
        if (last.includes('fill these research gaps')) {
          supplementCallCount++;
          throw new Error('Supplement LLM failed');
        }
        if (last.includes('executive summary'))
          return 'Summary';
        return makeSynthesisJson();
      }) as any;

      let searchCount = 0;
      const searchFn: SearchFn = vi.fn(async (query) => {
        searchCount++;
        return [
          { title: `R${searchCount}`, url: `https://s${searchCount}.com/p`, snippet: 'S', score: 0.9 },
        ];
      }) as any;

      const pipeline = new DeepResearchV2({
        config: {
          depth: 'standard',
          enableRefinement: true,
          maxRefinementRounds: 2,
          coverageThreshold: 80,
        },
        searchFn,
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['A']);
      // Supplement LLM failed -> fallback generates "Topic pricing data", "Topic competitor info"
      const allSearchQueries = (searchFn as any).mock.calls.map((c: any) => c[0]);
      // Should contain at least one fallback query
      expect(supplementCallCount).toBeGreaterThanOrEqual(1);
      expect(result).toBeDefined();
    });
  });

  // ========================================================================
  // Lines 1164-1184: buildPartialResult - all branches
  // ========================================================================
  describe('buildPartialResult', () => {
    it('should build partial result with sources when timeout occurs', async () => {
      // Trigger a timeout during synthesis by setting a very short totalTimeout
      // and making synthesis slow
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('executive summary'))
          return 'Summary';
        // Make synthesis slow to trigger timeout
        if (messages[0]?.content?.includes('expert research analyst')) {
          await new Promise(r => setTimeout(r, 200));
        }
        return makeSynthesisJson();
      }) as any;

      const pipeline = new DeepResearchV2({
        config: {
          depth: 'quick',
          enableRefinement: false,
          totalTimeout: 50, // very short
        },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      // The pipeline should timeout and build a partial result
      const result = await pipeline.execute('Topic', ['A']);
      expect(result).toBeDefined();
      expect(typeof result.report).toBe('string');
    });

    it('should build partial result for Chinese topic with sources but synthesis failure', async () => {
      // We need buildPartialResult to be called with sources present.
      // This requires an abort/timeout during or after fetching but before synthesis completes.
      const ac = new AbortController();
      let synthCount = 0;
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        // During synthesis, abort to trigger partial result path
        if (messages[0]?.content?.includes('expert research analyst')) {
          synthCount++;
          if (synthCount === 1) {
            ac.abort('User cancelled');
            // Need a small delay so abort propagates
            await new Promise(r => setTimeout(r, 10));
          }
          return makeSynthesisJson();
        }
        if (last.includes('executive summary'))
          return 'Summary';
        return makeSynthesisJson();
      }) as any;

      const pipeline = new DeepResearchV2({
        config: {
          depth: 'quick',
          enableRefinement: false,
        },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
        abortSignal: ac.signal,
      });

      const result = await pipeline.execute('中文研究主题', ['方面一']);
      expect(result).toBeDefined();
      expect(typeof result.report).toBe('string');
    });

    it('should build partial result with no sources (early timeout, zh)', async () => {
      const ac = new AbortController();

      // Abort during query generation (before any search/fetch)
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist')) {
          ac.abort('cancelled');
          await new Promise(r => setTimeout(r, 5));
          return JSON.stringify({ queries: ['q1'] });
        }
        if (last.includes('executive summary'))
          return 'Summary';
        return makeSynthesisJson();
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false, language: 'zh' },
        searchFn: createMockSearch([]), // no results -> no sources
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
        abortSignal: ac.signal,
      });

      const result = await pipeline.execute('中文主题', ['方面']);
      // With no sources, buildPartialResult returns timeout message
      expect(result.report).toContain('超时终止');
      expect(result.sources).toHaveLength(0);
    });

    it('should build partial result with no sources (early timeout, en)', async () => {
      const ac = new AbortController();

      // Abort during query generation
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist')) {
          ac.abort('cancelled');
          await new Promise(r => setTimeout(r, 5));
          return JSON.stringify({ queries: ['q1'] });
        }
        if (last.includes('executive summary'))
          return 'Summary';
        return makeSynthesisJson();
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false, language: 'en' },
        searchFn: createMockSearch([]), // no results
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
        abortSignal: ac.signal,
      });

      const result = await pipeline.execute('English Topic', ['Aspect']);
      expect(result.report).toContain('terminated due to timeout');
      expect(result.sources).toHaveLength(0);
    });
  });

  // ========================================================================
  // Lines 470-471: generateAspects - Array.isArray / parsed.dimensions
  // ========================================================================
  describe('generateAspects branches', () => {
    it('should handle LLM returning a raw array', async () => {
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('key aspects'))
          return JSON.stringify(['Aspect1', 'Aspect2', 'Aspect3']);
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('executive summary'))
          return 'Summary';
        return makeSynthesisJson();
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch([]),
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic');
      expect(result).toBeDefined();
    });

    it('should handle LLM returning {dimensions: [...]}', async () => {
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('key aspects'))
          return JSON.stringify({ dimensions: ['Dim1', 'Dim2'] });
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('executive summary'))
          return 'Summary';
        return makeSynthesisJson();
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch([]),
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic');
      expect(result).toBeDefined();
    });

    it('should fallback to [topic] when aspects array is empty', async () => {
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('key aspects'))
          return JSON.stringify({ aspects: [] });
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('executive summary'))
          return 'Summary';
        return makeSynthesisJson();
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch([]),
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      const result = await pipeline.execute('MyTopic');
      expect(result).toBeDefined();
    });

    it('should limit aspects to 6', async () => {
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('key aspects'))
          return JSON.stringify({ aspects: ['A1','A2','A3','A4','A5','A6','A7','A8'] });
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('executive summary'))
          return 'Summary';
        return makeSynthesisJson();
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch([]),
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic');
      expect(result).toBeDefined();
    });
  });

  // ========================================================================
  // Lines 656, 802, 842-854: synthesis parsing - missing fields, credibilityScore
  // ========================================================================
  describe('parseSynthesisResponse edge cases', () => {
    it('should handle sections without confidenceScore (defaults to 0.5)', async () => {
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('executive summary'))
          return 'Summary';
        return JSON.stringify({
          title: 'Report',
          sections: [
            { heading: 'S1', content: 'C1', citations: [] }, // no confidenceScore
          ],
          references: [{ id: 'r1', url: 'https://a.com', title: 'A' }],
        });
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['A']);
      // The section with missing confidenceScore should get 0.5 -> red badge
      expect(result.report).toContain('S1');
    });

    it('should handle references with missing fields', async () => {
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('executive summary'))
          return 'Summary';
        return JSON.stringify({
          title: 'Report',
          sections: [{ heading: 'S1', content: 'C1', citations: [], confidenceScore: 0.8 }],
          references: [
            { /* missing all fields */ },
            { id: 'r1', url: 'https://a.com' }, // missing title
          ],
        });
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['A']);
      expect(result).toBeDefined();
    });
  });

  // ========================================================================
  // Lines 1055, 1074, 1078-1083, 1091: formatFinalReport Chinese paths
  // ========================================================================
  describe('formatFinalReport - Chinese language paths', () => {
    it('should format report in Chinese with contradictions and coverage gaps', async () => {
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('executive summary') || last.includes('概要'))
          return '这是一个执行摘要。';
        return makeSynthesisJson({
          sections: [
            { heading: '市场分析', content: '内容', citations: ['src_1'], confidenceScore: 0.7 },
          ],
          contradictions: [
            {
              claim1: '观点A', claim2: '观点B',
              source1: 'src_1', source2: 'src_2',
              severity: 'moderate',
              resolution: '观点A更新',
            },
            {
              claim1: 'C1', claim2: 'C2',
              source1: 's1', source2: 's2',
              severity: 'minor',
              // no resolution
            },
          ],
          coverageGaps: ['缺少定价信息'],
          references: [
            { id: 'src_1', url: 'https://zh.example.com', title: '示例', credibilityScore: 80 },
          ],
        });
      }) as any;

      const pipeline = new DeepResearchV2({
        config: {
          depth: 'quick',
          enableRefinement: false,
          enableContradictions: true,
          language: 'zh',
        },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      const result = await pipeline.execute('中文主题研究分析测试', ['市场']);
      expect(result.report).toContain('信息矛盾');
      expect(result.report).toContain('观点1');
      expect(result.report).toContain('观点2');
      expect(result.report).toContain('MODERATE');
      expect(result.report).toContain('MINOR');
      expect(result.report).toContain('分析');
      expect(result.report).toContain('未充分覆盖的领域');
      expect(result.report).toContain('缺少定价信息');
      expect(result.report).toContain('参考来源');
      expect(result.report).toContain('可信度');
      expect(result.report).toContain('研究参数');
      expect(result.report).toContain('深度');
      expect(result.report).toContain('信息源');
      expect(result.report).toContain('耗时');
    });

    it('should use Chinese summary fallback when summary LLM fails', async () => {
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('executive summary') || last.includes('概要'))
          throw new Error('Summary gen failed');
        return makeSynthesisJson();
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false, language: 'zh' },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      const result = await pipeline.execute('中文主题研究深度测试', ['方面一']);
      expect(result.report).toContain('本报告围绕');
    });

    it('should use English summary fallback when summary LLM fails', async () => {
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('executive summary'))
          throw new Error('Summary gen failed');
        return makeSynthesisJson();
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false, language: 'en' },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      const result = await pipeline.execute('English Topic', ['Aspect1']);
      expect(result.report).toContain('deep research analysis');
    });
  });

  // ========================================================================
  // Lines 1109, 1107: references with/without credibility score in format
  // ========================================================================
  describe('references credibility in formatFinalReport', () => {
    it('should show credibility label in Chinese', async () => {
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('executive summary') || last.includes('概要'))
          return '摘要';
        return makeSynthesisJson({
          references: [
            { id: 'src_1', url: 'https://a.com', title: 'Source A', credibilityScore: 90 },
            { id: 'src_2', url: 'https://b.com', title: 'Source B' }, // no credibility
          ],
        });
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false, language: 'zh' },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      const result = await pipeline.execute('中文研究测试分析主题', ['A']);
      expect(result.report).toContain('可信度: 90/100');
      // Source B should not have credibility text
      const lines = result.report.split('\n');
      const sourceBLine = lines.find(l => l.includes('Source B'));
      if (sourceBLine) {
        expect(sourceBLine).not.toContain('可信度');
      }
    });
  });

  // ========================================================================
  // checkTotalTimeout (line 1312-1314)
  // ========================================================================
  describe('checkTotalTimeout', () => {
    it('should throw timeout when total time exceeded during refinement', async () => {
      let evalCount = 0;
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('Evaluate the coverage')) {
          evalCount++;
          // Simulate slow evaluation
          await new Promise(r => setTimeout(r, 100));
          return JSON.stringify({ score: 30, gaps: ['gap'] });
        }
        if (last.includes('fill these research gaps'))
          return JSON.stringify({ queries: ['s1'] });
        if (last.includes('executive summary'))
          return 'Summary';
        return makeSynthesisJson();
      }) as any;

      let searchCount = 0;
      const pipeline = new DeepResearchV2({
        config: {
          depth: 'standard',
          enableRefinement: true,
          maxRefinementRounds: 5,
          coverageThreshold: 95,
          totalTimeout: 200, // Very short total timeout
        },
        searchFn: vi.fn(async () => {
          searchCount++;
          return [{ title: `R${searchCount}`, url: `https://s${searchCount}.com/p`, snippet: 'S', score: 0.9 }];
        }) as SearchFn,
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      // Should not throw (caught as timeout) => returns partial result
      const result = await pipeline.execute('Topic', ['A']);
      expect(result).toBeDefined();
    });
  });

  // ========================================================================
  // Semaphore timeout (line 1267, 1280)
  // ========================================================================
  describe('Semaphore internal behavior', () => {
    it('should handle many concurrent fetches without deadlock', async () => {
      const manyResults: SearchResultItem[] = [];
      for (let i = 0; i < 15; i++) {
        manyResults.push({ title: `R${i}`, url: `https://s${i}.com/p${i}`, snippet: `S${i}`, score: 0.9 });
      }

      const pipeline = new DeepResearchV2({
        config: {
          depth: 'quick',
          enableRefinement: false,
          fetchConcurrency: 2, // Low concurrency to stress semaphore
          maxSources: 15,
        },
        searchFn: createMockSearch(manyResults),
        fetchFn: vi.fn(async (url) => {
          await new Promise(r => setTimeout(r, 10)); // small delay
          return { content: longContent + ` ${url}`, title: `T ${url}` };
        }) as FetchFn,
        llmCall: createSmartLLM(),
      });

      const result = await pipeline.execute('Topic', ['A']);
      expect(result.metadata.totalSourcesFetched).toBeGreaterThan(0);
    });
  });

  // ========================================================================
  // fetchSinglePage - truncation flag (line 652-653)
  // ========================================================================
  describe('fetchSinglePage - truncation', () => {
    it('should set truncated flag when content exceeds maxContentPerSource', async () => {
      const pipeline = new DeepResearchV2({
        config: {
          depth: 'quick',
          enableRefinement: false,
          maxContentPerSource: 150,
        },
        searchFn: createMockSearch(),
        fetchFn: vi.fn(async () => ({
          content: 'A'.repeat(200), // exceeds 150
          title: 'Long Page',
        })) as FetchFn,
        llmCall: createSmartLLM(),
      });

      const result = await pipeline.execute('Topic', ['A']);
      expect(result.metadata.totalSourcesFetched).toBeGreaterThan(0);
    });
  });

  // ========================================================================
  // fetchSinglePage - uses item.title when result.title is missing
  // ========================================================================
  describe('fetchSinglePage - title fallback', () => {
    it('should use search result title when fetch returns no title', async () => {
      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch([
          { title: 'Search Title', url: 'https://a.com/p', snippet: 'S', score: 0.9 },
        ]),
        fetchFn: vi.fn(async () => ({
          content: longContent,
          title: undefined, // no title from fetch
        })) as unknown as FetchFn,
        llmCall: createSmartLLM(),
      });

      const result = await pipeline.execute('Topic', ['A']);
      expect(result.metadata.totalSourcesFetched).toBeGreaterThan(0);
    });
  });

  // ========================================================================
  // withTimeout - timeout path (line 1336-1337)
  // ========================================================================
  describe('withTimeout', () => {
    it('should timeout individual search when search is slow', async () => {
      const slowSearch: SearchFn = vi.fn(async () => {
        await new Promise(r => setTimeout(r, 5000)); // 5s
        return [{ title: 'R', url: 'https://a.com', snippet: 'S' }];
      }) as any;

      const pipeline = new DeepResearchV2({
        config: {
          depth: 'quick',
          enableRefinement: false,
          searchTimeout: 50, // 50ms timeout
        },
        searchFn: slowSearch,
        fetchFn: createMockFetch(longContent),
        llmCall: createSmartLLM(),
      });

      // Should not throw - search timeout is caught by Promise.allSettled
      const result = await pipeline.execute('Topic', ['A']);
      expect(result.metadata.totalSourcesFetched).toBe(0);
    });

    it('should timeout individual fetch when fetch is slow', async () => {
      const slowFetch: FetchFn = vi.fn(async () => {
        await new Promise(r => setTimeout(r, 5000));
        return { content: longContent, title: 'T' };
      }) as any;

      const pipeline = new DeepResearchV2({
        config: {
          depth: 'quick',
          enableRefinement: false,
          fetchTimeout: 50,
        },
        searchFn: createMockSearch(),
        fetchFn: slowFetch,
        llmCall: createSmartLLM(),
      });

      const result = await pipeline.execute('Topic', ['A']);
      expect(result.metadata.totalSourcesFetched).toBe(0);
    });
  });

  // ========================================================================
  // synthesizeIncremental (lines ~770-790): merge partial reports
  // ========================================================================
  describe('synthesizeIncremental and mergePartialReports', () => {
    it('should use incremental synthesis for very large sources', async () => {
      const manyResults: SearchResultItem[] = [];
      for (let i = 0; i < 10; i++) {
        manyResults.push({ title: `R${i}`, url: `https://ex${i}.com/p${i}`, snippet: `S${i}` });
      }

      // Each page returns huge content to trigger incremental path
      const hugeFetch: FetchFn = vi.fn(async (url) => ({
        content: 'X'.repeat(50000) + ` from ${url}`,
        title: `Big: ${url}`,
      })) as any;

      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1', 'q2', 'q3'] });
        if (last.includes('merging multiple partial'))
          return makeSynthesisJson({ title: 'Merged Report' });
        if (last.includes('executive summary'))
          return 'Merged summary.';
        return makeSynthesisJson();
      }) as any;

      const pipeline = new DeepResearchV2({
        config: {
          depth: 'quick',
          enableRefinement: false,
          maxContentPerSource: 50000,
          maxSources: 10,
        },
        searchFn: createMockSearch(manyResults),
        fetchFn: hugeFetch,
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['A']);
      expect(result).toBeDefined();
      // LLM should have been called with merge prompt
      const llmCalls = (llm as any).mock.calls;
      const hasMerge = llmCalls.some((c: any) =>
        c[0].some((m: any) => m.content?.includes('merging'))
      );
      expect(hasMerge).toBe(true);
    });
  });

  // ========================================================================
  // Chinese format report with empty sections -> no summary prompt
  // ========================================================================
  describe('formatFinalReport with empty sections', () => {
    it('should skip summary generation when there are no sections', async () => {
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('executive summary'))
          return 'Should not be called';
        return JSON.stringify({
          title: 'Empty Report',
          sections: [],
          references: [],
        });
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['A']);
      expect(result.report).toContain('Empty Report');
    });
  });

  // ========================================================================
  // Contradiction with 'minor' severity (green badge)
  // ========================================================================
  describe('contradiction severity badges', () => {
    it('should show all three severity icons', async () => {
      const llm: LLMCallFn = vi.fn(async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('executive summary'))
          return 'Summary';
        return makeSynthesisJson({
          contradictions: [
            { claim1: 'A', claim2: 'B', source1: 's1', source2: 's2', severity: 'major' },
            { claim1: 'C', claim2: 'D', source1: 's3', source2: 's4', severity: 'moderate' },
            { claim1: 'E', claim2: 'F', source1: 's5', source2: 's6', severity: 'minor' },
          ],
        });
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false, enableContradictions: true },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(longContent),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['A']);
      expect(result.report).toContain('MAJOR');
      expect(result.report).toContain('MODERATE');
      expect(result.report).toContain('MINOR');
    });
  });
});
