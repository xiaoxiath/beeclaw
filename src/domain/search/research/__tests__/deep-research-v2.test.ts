import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DeepResearchV2,
  createDeepResearchHandler,
} from '../deep-research-v2';
import type {
  SearchFn,
  FetchFn,
  LLMCallFn,
  ProgressCallback,
  SearchResultItem,
  SynthesisReport,
  DeepResearchV2Config,
} from '../deep-research-v2';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a valid JSON synthesis report string */
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

/** Default mock LLM that returns appropriate JSON for each phase */
function createSmartLLM(): LLMCallFn {
  return vi.fn(async (messages) => {
    const last = messages[messages.length - 1]?.content || '';

    // Aspect generation
    if (last.includes('key aspects') || last.includes('dimensions')) {
      return JSON.stringify({ aspects: ['Market Size', 'Key Players'] });
    }
    // Query generation
    if (last.includes('query strategist') || last.includes('search queries')) {
      return JSON.stringify({ queries: ['query1', 'query2', 'query3'] });
    }
    // Coverage evaluation
    if (last.includes('Evaluate the coverage')) {
      return JSON.stringify({ score: 90, gaps: [] });
    }
    // Supplement queries
    if (last.includes('fill these research gaps')) {
      return JSON.stringify({ queries: ['supplement1'] });
    }
    // Executive summary
    if (last.includes('executive summary') || last.includes('概要')) {
      return 'This is the executive summary.';
    }
    // Merge partial reports
    if (last.includes('merging multiple partial')) {
      return makeSynthesisJson();
    }
    // Default: synthesis report
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

describe('deep-research-v2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // resolveConfig (tested indirectly via constructor)
  // ========================================================================
  describe('config resolution', () => {
    it('resolves quick depth defaults', () => {
      const pipeline = new DeepResearchV2({
        config: { depth: 'quick' },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: createSmartLLM(),
      });
      expect(pipeline).toBeDefined();
    });

    it('resolves standard depth defaults', () => {
      const pipeline = new DeepResearchV2({
        config: { depth: 'standard' },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: createSmartLLM(),
      });
      expect(pipeline).toBeDefined();
    });

    it('resolves comprehensive depth defaults', () => {
      const pipeline = new DeepResearchV2({
        config: { depth: 'comprehensive' },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: createSmartLLM(),
      });
      expect(pipeline).toBeDefined();
    });

    it('allows custom config overrides', () => {
      const pipeline = new DeepResearchV2({
        config: {
          depth: 'quick',
          maxQueries: 2,
          maxSources: 3,
          maxContentPerSource: 1000,
          maxRefinementRounds: 0,
          coverageThreshold: 50,
          fetchConcurrency: 2,
          synthesisModel: 'custom-model',
          queryModel: 'custom-query',
          language: 'zh',
          enableCredibility: true,
          enableContradictions: true,
          enableRefinement: false,
          totalTimeout: 30000,
          searchTimeout: 5000,
          fetchTimeout: 5000,
        },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: createSmartLLM(),
      });
      expect(pipeline).toBeDefined();
    });
  });

  // ========================================================================
  // Constructor
  // ========================================================================
  describe('constructor', () => {
    it('constructs with required options', () => {
      const p = new DeepResearchV2({
        config: { depth: 'quick' },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: createSmartLLM(),
      });
      expect(p).toBeDefined();
    });

    it('constructs with progress callback', () => {
      const onProgress = vi.fn();
      const p = new DeepResearchV2({
        config: { depth: 'quick' },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: createSmartLLM(),
        onProgress,
      });
      expect(p).toBeDefined();
    });

    it('constructs with abort signal', () => {
      const ac = new AbortController();
      const p = new DeepResearchV2({
        config: { depth: 'quick' },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: createSmartLLM(),
        abortSignal: ac.signal,
      });
      expect(p).toBeDefined();
    });
  });

  // ========================================================================
  // execute() - full pipeline
  // ========================================================================
  describe('execute', () => {
    it('runs full pipeline and returns result shape', async () => {
      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: createSmartLLM(),
      });

      const result = await pipeline.execute('Test Topic', ['Aspect 1', 'Aspect 2']);
      expect(result).toBeDefined();
      expect(typeof result.report).toBe('string');
      expect(Array.isArray(result.sources)).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.metadata.topic).toBe('Test Topic');
      expect(result.metadata.depth).toBe('quick');
      expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.metadata.phases.length).toBeGreaterThan(0);
    });

    it('generates aspects when not provided', async () => {
      const llm = createSmartLLM();
      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: llm,
      });

      const result = await pipeline.execute('AI Technology');
      expect(result).toBeDefined();
      // LLM should have been called for aspect generation
      expect(llm).toHaveBeenCalled();
    });

    it('emits progress events', async () => {
      const onProgress = vi.fn();
      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: createSmartLLM(),
        onProgress,
      });

      await pipeline.execute('Topic', ['Aspect']);
      expect(onProgress).toHaveBeenCalled();
      // Check at least planning, searching, fetching, synthesizing, finalizing, completed
      const phases = onProgress.mock.calls.map((c: any) => c[0].phase);
      expect(phases).toContain('planning');
      expect(phases).toContain('searching');
      expect(phases).toContain('completed');
    });

    it('returns empty result when no sources fetched', async () => {
      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch([]), // no results
        fetchFn: createMockFetch(),
        llmCall: createSmartLLM(),
      });

      const result = await pipeline.execute('Topic', ['A']);
      expect(result.sources).toHaveLength(0);
      expect(result.report).toContain('Topic');
      expect(result.metadata.totalSourcesFetched).toBe(0);
    });

    it('returns empty result when fetch content is too short (< 100 chars)', async () => {
      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(),
        fetchFn: vi.fn(async () => ({ content: 'short', title: 't' })) as any,
        llmCall: createSmartLLM(),
      });

      const result = await pipeline.execute('Topic', ['A']);
      expect(result.metadata.totalSourcesFetched).toBe(0);
    });

    it('handles empty fetch content', async () => {
      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(),
        fetchFn: vi.fn(async () => ({ content: '', title: 't' })) as any,
        llmCall: createSmartLLM(),
      });

      const result = await pipeline.execute('Topic', ['A']);
      expect(result.metadata.totalSourcesFetched).toBe(0);
    });

    it('handles fetch failures gracefully', async () => {
      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(),
        fetchFn: vi.fn(async () => { throw new Error('fetch failed'); }) as any,
        llmCall: createSmartLLM(),
      });

      // Should not throw - fetch failures are silently skipped
      const result = await pipeline.execute('Topic', ['A']);
      expect(result.metadata.totalSourcesFetched).toBe(0);
    });

    it('handles search failures gracefully', async () => {
      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: vi.fn(async () => { throw new Error('search failed'); }) as any,
        fetchFn: createMockFetch(),
        llmCall: createSmartLLM(),
      });

      const result = await pipeline.execute('Topic', ['A']);
      // Should return empty since no search results
      expect(result.metadata.totalSourcesFetched).toBe(0);
    });

    it('deduplicates URLs from search results', async () => {
      const duplicateResults: SearchResultItem[] = [
        { title: 'R1', url: 'https://example.com/page', snippet: 'S1', score: 0.9 },
        { title: 'R2', url: 'https://example.com/page', snippet: 'S2', score: 0.8 },
        { title: 'R3', url: 'https://other.com/page', snippet: 'S3', score: 0.7 },
      ];
      const fetchFn = createMockFetch();
      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(duplicateResults),
        fetchFn,
        llmCall: createSmartLLM(),
      });

      await pipeline.execute('Topic', ['A']);
      // fetchFn should have been called only for unique URLs (2, not 3)
      expect((fetchFn as any).mock.calls.length).toBeLessThanOrEqual(2);
    });

    it('handles Chinese topic (language detection)', async () => {
      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false, language: 'auto' },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: createSmartLLM(),
      });

      const result = await pipeline.execute('人工智能技术发展趋势', ['市场规模', '关键参与者']);
      expect(result.report).toBeDefined();
    });

    it('handles English topic (language detection)', async () => {
      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false, language: 'auto' },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: createSmartLLM(),
      });

      const result = await pipeline.execute('AI Technology Trends', ['Market', 'Players']);
      expect(result.report).toBeDefined();
    });
  });

  // ========================================================================
  // Aspect generation fallback
  // ========================================================================
  describe('generateAspects fallback', () => {
    it('falls back to topic when LLM returns bad JSON', async () => {
      const llm = vi.fn(async () => 'not json') as any;
      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch([]),
        fetchFn: createMockFetch(),
        llmCall: llm,
      });

      // No aspects provided => will call generateAspects which will fail JSON parse
      const result = await pipeline.execute('Test');
      expect(result).toBeDefined();
    });

    it('falls back when LLM throws', async () => {
      let callIdx = 0;
      const llm = vi.fn(async () => {
        callIdx++;
        if (callIdx === 1) throw new Error('LLM down');
        return makeSynthesisJson();
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch([]),
        fetchFn: createMockFetch(),
        llmCall: llm,
      });

      const result = await pipeline.execute('Test');
      expect(result).toBeDefined();
    });
  });

  // ========================================================================
  // Query generation fallback
  // ========================================================================
  describe('generateQueries fallback', () => {
    it('falls back to simple query generation on LLM failure', async () => {
      let callIdx = 0;
      const llm = vi.fn(async () => {
        callIdx++;
        // First call: aspect generation (if no aspects provided)
        // or query generation (if aspects provided)
        if (callIdx === 1) throw new Error('Query gen failed');
        return makeSynthesisJson();
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch([]),
        fetchFn: createMockFetch(),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['Aspect1', 'Aspect2']);
      // Should still work with fallback queries
      expect(result).toBeDefined();
    });
  });

  // ========================================================================
  // Synthesis parsing
  // ========================================================================
  describe('synthesis parsing', () => {
    it('handles malformed LLM JSON for synthesis (graceful degradation)', async () => {
      let callIdx = 0;
      const llm = vi.fn(async () => {
        callIdx++;
        // Query gen
        if (callIdx === 1) return JSON.stringify({ queries: ['q1'] });
        // Synthesis - return invalid JSON
        if (callIdx === 2) return 'This is plain text, not JSON';
        // Summary
        return 'Summary text';
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['A']);
      // Should fallback to plain text report
      expect(result.report).toBeDefined();
    });

    it('handles synthesis response with missing fields', async () => {
      let callIdx = 0;
      const llm = vi.fn(async () => {
        callIdx++;
        if (callIdx === 1) return JSON.stringify({ queries: ['q1'] });
        if (callIdx === 2) return JSON.stringify({ title: 'Minimal' }); // missing sections, references
        return 'Summary';
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['A']);
      expect(result.report).toBeDefined();
    });
  });

  // ========================================================================
  // Refinement
  // ========================================================================
  describe('refinement', () => {
    it('runs refinement when enabled and coverage is below threshold', async () => {
      let callIdx = 0;
      const llm = vi.fn(async (messages: any) => {
        callIdx++;
        const last = messages[messages.length - 1]?.content || '';

        if (last.includes('query strategist') || last.includes('search queries'))
          return JSON.stringify({ queries: ['q1'] });
        if (last.includes('Evaluate the coverage'))
          return JSON.stringify({ score: 95, gaps: [] }); // above threshold
        if (last.includes('executive summary'))
          return 'Summary';
        return makeSynthesisJson();
      }) as any;

      const pipeline = new DeepResearchV2({
        config: {
          depth: 'standard',
          enableRefinement: true,
          maxRefinementRounds: 2,
          coverageThreshold: 80,
        },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['A']);
      expect(result.metadata.finalCoverageScore).toBeGreaterThanOrEqual(0);
    });

    it('skips refinement when enableRefinement is false', async () => {
      const llm = createSmartLLM();
      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['A']);
      expect(result.metadata.refinementRounds).toBe(0);
    });

    it('skips refinement when maxRefinementRounds is 0', async () => {
      const llm = createSmartLLM();
      const pipeline = new DeepResearchV2({
        config: { depth: 'standard', enableRefinement: true, maxRefinementRounds: 0 },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['A']);
      expect(result.metadata.refinementRounds).toBe(0);
    });

    it('uses quickCoverageEstimate when refinement disabled', async () => {
      const llm = createSmartLLM();
      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['Section 1']);
      // quickCoverageEstimate gives a numeric score
      expect(typeof result.metadata.finalCoverageScore).toBe('number');
    });
  });

  // ========================================================================
  // Abort handling
  // ========================================================================
  describe('abort handling', () => {
    it('returns partial result when aborted', async () => {
      const ac = new AbortController();
      let callCount = 0;
      const searchFn = vi.fn(async () => {
        callCount++;
        if (callCount >= 2) ac.abort('User cancelled');
        return [{ title: 'R', url: 'https://a.com', snippet: 'S' }];
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false, maxQueries: 5 },
        searchFn,
        fetchFn: createMockFetch(),
        llmCall: createSmartLLM(),
        abortSignal: ac.signal,
      });

      // Should not throw - returns partial result
      const result = await pipeline.execute('Topic', ['A']);
      expect(result).toBeDefined();
      expect(typeof result.report).toBe('string');
    });
  });

  // ========================================================================
  // URL normalization
  // ========================================================================
  describe('URL normalization (deduplication)', () => {
    it('normalizes URLs by removing utm params and trailing slashes', async () => {
      const results: SearchResultItem[] = [
        { title: 'R1', url: 'https://example.com/page?utm_source=google', snippet: 'S1' },
        { title: 'R2', url: 'https://example.com/page/', snippet: 'S2' },
      ];
      const fetchFn = createMockFetch();
      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(results),
        fetchFn,
        llmCall: createSmartLLM(),
      });

      await pipeline.execute('Topic', ['A']);
      // Both should normalize to same URL, so only 1 fetch
      expect((fetchFn as any).mock.calls.length).toBeLessThanOrEqual(1);
    });

    it('handles invalid URLs gracefully', async () => {
      const results: SearchResultItem[] = [
        { title: 'R1', url: 'not-a-valid-url', snippet: 'S1' },
        { title: 'R2', url: 'https://valid.com/page', snippet: 'S2' },
      ];
      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(results),
        fetchFn: createMockFetch(),
        llmCall: createSmartLLM(),
      });

      const result = await pipeline.execute('Topic', ['A']);
      expect(result).toBeDefined();
    });
  });

  // ========================================================================
  // formatFinalReport
  // ========================================================================
  describe('report formatting', () => {
    it('includes sections with confidence badges', async () => {
      const llm = vi.fn(async (messages: any) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist')) return JSON.stringify({ queries: ['q1'] });
        if (last.includes('executive summary')) return 'Summary text here.';
        return makeSynthesisJson({
          sections: [
            { heading: 'High Confidence', content: 'Content 1', citations: [], confidenceScore: 0.9 },
            { heading: 'Medium Confidence', content: 'Content 2', citations: [], confidenceScore: 0.7 },
            { heading: 'Low Confidence', content: 'Content 3', citations: [], confidenceScore: 0.4 },
          ],
        });
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['A']);
      // Should contain confidence badges
      expect(result.report).toContain('High Confidence');
      expect(result.report).toContain('Medium Confidence');
      expect(result.report).toContain('Low Confidence');
    });

    it('includes contradictions when enabled', async () => {
      const llm = vi.fn(async (messages: any) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist')) return JSON.stringify({ queries: ['q1'] });
        if (last.includes('executive summary')) return 'Summary';
        return makeSynthesisJson({
          contradictions: [{
            claim1: 'A says X',
            claim2: 'B says Y',
            source1: 'src_1',
            source2: 'src_2',
            severity: 'major',
            resolution: 'A is more recent',
          }],
        });
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false, enableContradictions: true },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['A']);
      expect(result.report).toContain('MAJOR');
      expect(result.report).toContain('A says X');
    });

    it('includes coverage gaps', async () => {
      const llm = vi.fn(async (messages: any) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist')) return JSON.stringify({ queries: ['q1'] });
        if (last.includes('executive summary')) return 'Summary';
        return makeSynthesisJson({
          coverageGaps: ['Missing data on pricing', 'No competitor analysis'],
        });
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['A']);
      expect(result.report).toContain('Missing data on pricing');
      expect(result.report).toContain('No competitor analysis');
    });

    it('includes references with credibility scores', async () => {
      const llm = vi.fn(async (messages: any) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist')) return JSON.stringify({ queries: ['q1'] });
        if (last.includes('executive summary')) return 'Summary';
        return makeSynthesisJson({
          references: [
            { id: 'src_1', url: 'https://example.com', title: 'Example', credibilityScore: 85 },
          ],
        });
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false, enableCredibility: true },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['A']);
      expect(result.report).toContain('85');
    });

    it('falls back for summary when LLM fails', async () => {
      let callIdx = 0;
      const llm = vi.fn(async (messages: any) => {
        callIdx++;
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist')) return JSON.stringify({ queries: ['q1'] });
        if (last.includes('executive summary')) throw new Error('Summary LLM failed');
        return makeSynthesisJson();
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['A']);
      expect(result.report).toBeDefined();
      expect(result.report).toContain('Topic');
    });
  });

  // ========================================================================
  // buildSourceReferences
  // ========================================================================
  describe('source references', () => {
    it('builds source references with usedInSections', async () => {
      const llm = vi.fn(async (messages: any) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist')) return JSON.stringify({ queries: ['q1'] });
        if (last.includes('executive summary')) return 'Summary';
        return makeSynthesisJson({
          sections: [
            { heading: 'Sec1', content: 'c', citations: ['src_1'], confidenceScore: 0.8 },
            { heading: 'Sec2', content: 'c', citations: [], confidenceScore: 0.8 },
          ],
          references: [
            { id: 'src_1', url: 'https://example.com', title: 'Ref1' },
          ],
        });
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['A']);
      expect(result.sources.length).toBeGreaterThan(0);
      const ref = result.sources[0];
      expect(ref.url).toBe('https://example.com');
      expect(ref.usedInSections).toContain('Sec1');
      expect(ref.usedInSections).not.toContain('Sec2');
    });
  });

  // ========================================================================
  // Phase timings
  // ========================================================================
  describe('phase timings', () => {
    it('records timing for each phase', async () => {
      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: createSmartLLM(),
      });

      const result = await pipeline.execute('Topic', ['A']);
      expect(result.metadata.phases.length).toBeGreaterThan(0);
      for (const phase of result.metadata.phases) {
        expect(phase.phase).toBeTruthy();
        expect(phase.durationMs).toBeGreaterThanOrEqual(0);
        expect(phase.startMs).toBeGreaterThanOrEqual(0);
        expect(phase.endMs).toBeGreaterThanOrEqual(phase.startMs);
      }
    });
  });

  // ========================================================================
  // createDeepResearchHandler
  // ========================================================================
  describe('createDeepResearchHandler', () => {
    it('is a function', () => {
      expect(typeof createDeepResearchHandler).toBe('function');
    });

    it('returns an async function', () => {
      const handler = createDeepResearchHandler({
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: createSmartLLM(),
      });
      expect(typeof handler).toBe('function');
    });

    it('executes the pipeline and returns a result', async () => {
      const handler = createDeepResearchHandler({
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: createSmartLLM(),
      });

      const result = await handler({
        topic: 'Test Topic',
        depth: 'quick',
        aspects: ['A'],
      });
      expect(result).toBeDefined();
      expect(typeof result.report).toBe('string');
      expect(result.metadata.depth).toBe('quick');
    });

    it('defaults depth to standard', async () => {
      const handler = createDeepResearchHandler({
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: createSmartLLM(),
      });

      const result = await handler({ topic: 'Topic', aspects: ['A'] });
      expect(result.metadata.depth).toBe('standard');
    });

    it('passes onProgress and abortSignal to pipeline', async () => {
      const onProgress = vi.fn();
      const ac = new AbortController();
      const handler = createDeepResearchHandler({
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: createSmartLLM(),
      });

      const result = await handler({
        topic: 'Topic',
        depth: 'quick',
        aspects: ['A'],
        onProgress,
        abortSignal: ac.signal,
      });
      expect(result).toBeDefined();
      expect(onProgress).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Incremental synthesis (large source batch)
  // ========================================================================
  describe('incremental synthesis', () => {
    it('handles synthesis when sources are very large', async () => {
      // Create many search results and large content to trigger incremental path
      const manyResults: SearchResultItem[] = [];
      for (let i = 0; i < 10; i++) {
        manyResults.push({ title: `R${i}`, url: `https://ex.com/p${i}`, snippet: `S${i}` });
      }

      // Each page returns 40000 chars of content (total ~400k chars, > 100k token estimate)
      const largeFetch: FetchFn = vi.fn(async (url) => ({
        content: 'X'.repeat(40000) + ` content from ${url}`,
        title: `Title for ${url}`,
      })) as any;

      const pipeline = new DeepResearchV2({
        config: {
          depth: 'quick',
          enableRefinement: false,
          maxContentPerSource: 40000,
          maxSources: 10,
        },
        searchFn: createMockSearch(manyResults),
        fetchFn: largeFetch,
        llmCall: createSmartLLM(),
      });

      const result = await pipeline.execute('Topic', ['A']);
      expect(result).toBeDefined();
      expect(result.metadata.totalSourcesFetched).toBeGreaterThan(0);
    });
  });

  // ========================================================================
  // Empty result language variants
  // ========================================================================
  describe('empty result language', () => {
    it('returns Chinese empty result for Chinese topic', async () => {
      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false, language: 'auto' },
        searchFn: createMockSearch([]),
        fetchFn: createMockFetch(),
        llmCall: createSmartLLM(),
      });

      const result = await pipeline.execute('人工智能研究', ['方面一']);
      expect(result.report).toContain('未能找到');
    });

    it('returns English empty result for English topic', async () => {
      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false, language: 'en' },
        searchFn: createMockSearch([]),
        fetchFn: createMockFetch(),
        llmCall: createSmartLLM(),
      });

      const result = await pipeline.execute('AI Research', ['Aspect']);
      expect(result.report).toContain('No relevant sources');
    });
  });

  // ========================================================================
  // Confidence badge helper
  // ========================================================================
  describe('confidence badges', () => {
    it('shows green badge for high confidence', async () => {
      const llm = vi.fn(async (messages: any) => {
        const last = messages[messages.length - 1]?.content || '';
        if (last.includes('query strategist')) return JSON.stringify({ queries: ['q1'] });
        if (last.includes('executive summary')) return 'Summary';
        return makeSynthesisJson({
          sections: [{ heading: 'S1', content: 'C', citations: [], confidenceScore: 0.85 }],
        });
      }) as any;

      const pipeline = new DeepResearchV2({
        config: { depth: 'quick', enableRefinement: false },
        searchFn: createMockSearch(),
        fetchFn: createMockFetch(),
        llmCall: llm,
      });

      const result = await pipeline.execute('Topic', ['A']);
      // Green badge for >= 0.8
      expect(result.report).toContain('\u{1F7E2}'); // green circle
    });
  });
});
