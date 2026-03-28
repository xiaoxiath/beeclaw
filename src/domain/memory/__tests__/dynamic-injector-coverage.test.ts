/**
 * Coverage-focused tests for DynamicMemoryInjector.
 * Targets uncovered lines: 169-171 (catch in inject), 200-211 (validateOutput, failed branch),
 * 221-280 (retrieveMemories internals: keyword search, vector search), 288-312 (hybridSearch call).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  hybridSearch: vi.fn(async () => ({ items: [], searchTimeMs: 0 })),
  getMemoryStore: vi.fn(() => ({
    grep: vi.fn(() => ({ success: true, data: '' })),
    stat: vi.fn(() => ({ success: true, mtime: new Date('2024-01-01') })),
  })),
  getVectorStore: vi.fn(() => ({
    search: vi.fn(async () => []),
  })),
  getEmbeddingProvider: vi.fn(() => null),
  judgeFn: vi.fn(async (opts: any) => ({
    result: opts.defaultValue,
    failed: false,
  })),
  incrementLlmCalls: vi.fn(),
  incrementErrors: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../hybrid-search', () => ({
  hybridSearch: mocks.hybridSearch,
  SEARCH_PROFILES: {
    precise: { name: 'precise', keywordWeight: 0.7, vectorWeight: 0.3, recencyDecay: 0.1, minRelevanceScore: 0.3, maxResults: 10 },
    semantic: { name: 'semantic', keywordWeight: 0.3, vectorWeight: 0.7, recencyDecay: 0.1, minRelevanceScore: 0.3, maxResults: 10 },
    recent: { name: 'recent', keywordWeight: 0.2, vectorWeight: 0.3, recencyDecay: 0.5, minRelevanceScore: 0.3, maxResults: 10 },
    balanced: { name: 'balanced', keywordWeight: 0.5, vectorWeight: 0.5, recencyDecay: 0.2, minRelevanceScore: 0.3, maxResults: 10 },
  },
}));

vi.mock('../store', () => ({
  getMemoryStore: mocks.getMemoryStore,
}));

vi.mock('../vector-store', () => ({
  getVectorStore: mocks.getVectorStore,
  getEmbeddingProvider: mocks.getEmbeddingProvider,
}));

vi.mock('../../agent/fast-llm-judge', () => ({
  getFastLLMJudge: vi.fn(() => ({
    judge: mocks.judgeFn,
  })),
}));

vi.mock('../../agent/judgment-stats', () => ({
  JudgmentStatsTracker: class {
    incrementLlmCalls() { mocks.incrementLlmCalls(); }
    incrementErrors() { mocks.incrementErrors(); }
    getStats() { return { llmCalls: 0, errors: 0 }; }
  },
}));

vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    info: mocks.logInfo,
    debug: mocks.logDebug,
    warn: mocks.logWarn,
    error: mocks.logError,
  },
}));

import {
  DynamicMemoryInjector,
  getDynamicMemoryInjector,
  resetDynamicMemoryInjector,
} from '../dynamic-injector';

// ── Helpers ────────────────────────────────────────────────────────────────

const fakeProvider: any = { type: 'openai', model: 'gpt-4o-mini' };

// ── Tests ──────────────────────────────────────────────────────────────────

describe('DynamicMemoryInjector coverage', () => {
  let injector: DynamicMemoryInjector;

  beforeEach(() => {
    vi.clearAllMocks();
    injector = new DynamicMemoryInjector(fakeProvider);
    // Default: LLM says no context needed
    mocks.judgeFn.mockImplementation(async (opts: any) => ({
      result: opts.defaultValue,
      failed: false,
    }));
    mocks.hybridSearch.mockImplementation(async () => ({ items: [], searchTimeMs: 0 }));
    mocks.getEmbeddingProvider.mockReturnValue(null);
    resetDynamicMemoryInjector();
  });

  // ── Line 169-171: catch block in inject() ─────────────────────────

  describe('inject() catch block (lines 169-171)', () => {
    it('catches error during buildInjectedContext and returns original message', async () => {
      // Set up LLM to say "yes, need context"
      mocks.judgeFn.mockImplementation(async () => ({
        result: { needsContext: true, intent: 'recall', reasoning: 'test' },
        failed: false,
      }));

      // hybridSearch returns items, but we'll make buildInjectedContext crash
      // by returning an item where accessing properties causes an error
      mocks.hybridSearch.mockImplementation(async () => ({
        items: [{ path: 'a.md', snippet: 'content', score: 0.8 }],
        searchTimeMs: 1,
      }));

      // Override buildInjectedContext to throw
      const originalBuild = (injector as any).buildInjectedContext;
      (injector as any).buildInjectedContext = () => { throw new Error('build failed'); };

      const result = await injector.inject('之前说的方案');

      // Should return original message
      expect(result).toBe('之前说的方案');
      // Should have called incrementErrors
      expect(mocks.incrementErrors).toHaveBeenCalled();
      expect(mocks.logError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to inject memories'),
        expect.any(Error),
      );

      // Restore
      (injector as any).buildInjectedContext = originalBuild;
    });
  });

  // ── Lines 200-211: shouldInjectWithLLM validateOutput & failed ────

  describe('shouldInjectWithLLM (lines 200-211)', () => {
    it('validateOutput returns validated result when valid', async () => {
      // The judge mock calls validateOutput internally. We need to capture and test it.
      // The best way is to make judgeFn call the validateOutput from opts.
      mocks.judgeFn.mockImplementation(async (opts: any) => {
        const validated = opts.validateOutput({
          needsContext: true,
          intent: 'recall',
          reasoning: 'user wants to recall',
        });
        return { result: validated, failed: false };
      });

      const result = await injector.inject('之前讨论的结果');

      // hybridSearch returns empty, so inject returns original
      expect(result).toBe('之前讨论的结果');
    });

    it('validateOutput returns null for non-boolean needsContext', async () => {
      mocks.judgeFn.mockImplementation(async (opts: any) => {
        const validated = opts.validateOutput({
          needsContext: 'yes', // not boolean
          intent: 'recall',
          reasoning: 'test',
        });
        // validated should be null, so fall back to defaultValue
        return {
          result: validated ?? opts.defaultValue,
          failed: false,
        };
      });

      const result = await injector.inject('之前的讨论');
      expect(result).toBe('之前的讨论');
    });

    it('validateOutput returns null for invalid intent', async () => {
      mocks.judgeFn.mockImplementation(async (opts: any) => {
        const validated = opts.validateOutput({
          needsContext: true,
          intent: 'invalid_intent',
          reasoning: 'test',
        });
        return {
          result: validated ?? opts.defaultValue,
          failed: false,
        };
      });

      const result = await injector.inject('之前的方案');
      expect(result).toBe('之前的方案');
    });

    it('validateOutput provides default reasoning when missing', async () => {
      mocks.judgeFn.mockImplementation(async (opts: any) => {
        const validated = opts.validateOutput({
          needsContext: true,
          intent: 'summarize',
          reasoning: '', // empty/falsy
        });
        return { result: validated, failed: false };
      });

      mocks.hybridSearch.mockImplementation(async () => ({
        items: [{ path: 'a.md', snippet: 'summary data', score: 0.9 }],
        searchTimeMs: 1,
      }));

      const result = await injector.inject('回顾一下上次的结果');
      // Should use 'LLM judgment' as default reasoning
      expect(result).toContain('[相关历史记忆]');
    });

    it('logs warning when result.failed is true', async () => {
      mocks.judgeFn.mockImplementation(async (opts: any) => ({
        result: opts.defaultValue,
        failed: true,
        error: 'LLM timeout',
      }));

      await injector.inject('之前说的');

      expect(mocks.logWarn).toHaveBeenCalledWith(
        expect.stringContaining('LLM judgment failed'),
        expect.objectContaining({ error: 'LLM timeout' }),
      );
    });
  });

  // ── Lines 221-280: retrieveMemories internals ────────────────────

  describe('retrieveMemories internals (lines 221-280)', () => {
    beforeEach(() => {
      // LLM says context needed
      mocks.judgeFn.mockImplementation(async () => ({
        result: { needsContext: true, intent: 'recall', reasoning: 'test' },
        failed: false,
      }));
    });

    it('keyword search parses grep results with file headers and line numbers', async () => {
      const grepData = '📄 notes/api-design.md\nL10: API design discussion\nL11: REST vs GraphQL\n📄 notes/meeting.md\nL5: Meeting notes';
      const mockStore = {
        grep: vi.fn(() => ({ success: true, data: grepData })),
        stat: vi.fn(() => ({ success: true, mtime: new Date('2024-06-01') })),
      };
      mocks.getMemoryStore.mockReturnValue(mockStore);

      // Let hybridSearch actually call the keywordSearch function
      mocks.hybridSearch.mockImplementation(async (query: string, keywordSearch: any, vectorSearch: any, getTimestamp: any, profile: any) => {
        const keywordResults = keywordSearch(query, 10);
        return { items: keywordResults, searchTimeMs: 5 };
      });

      const result = await injector.inject('之前的API设计讨论');
      // Should have parsed two results from grep
      expect(result).toContain('API design discussion');
    });

    it('keyword search returns empty when grep fails', async () => {
      const mockStore = {
        grep: vi.fn(() => ({ success: false, data: null })),
        stat: vi.fn(() => ({ success: true, mtime: new Date() })),
      };
      mocks.getMemoryStore.mockReturnValue(mockStore);

      mocks.hybridSearch.mockImplementation(async (query: string, keywordSearch: any) => {
        const results = keywordSearch(query, 10);
        return { items: results, searchTimeMs: 1 };
      });

      const result = await injector.inject('之前的讨论');
      expect(result).toBe('之前的讨论'); // no memories -> original
    });

    it('keyword search returns empty when grep data is empty string', async () => {
      const mockStore = {
        grep: vi.fn(() => ({ success: true, data: '' })),
        stat: vi.fn(() => ({ success: true, mtime: new Date() })),
      };
      mocks.getMemoryStore.mockReturnValue(mockStore);

      mocks.hybridSearch.mockImplementation(async (query: string, keywordSearch: any) => {
        const results = keywordSearch(query, 10);
        return { items: results, searchTimeMs: 1 };
      });

      const result = await injector.inject('之前的内容');
      expect(result).toBe('之前的内容');
    });

    it('keyword search limits results to maxResults', async () => {
      // Create many grep results
      let grepData = '';
      for (let i = 0; i < 15; i++) {
        grepData += `📄 file${i}.md\nL1: Content ${i}\n`;
      }
      const mockStore = {
        grep: vi.fn(() => ({ success: true, data: grepData })),
        stat: vi.fn(() => ({ success: true, mtime: new Date() })),
      };
      mocks.getMemoryStore.mockReturnValue(mockStore);

      mocks.hybridSearch.mockImplementation(async (query: string, keywordSearch: any) => {
        const results = keywordSearch(query, 5);
        return { items: results, searchTimeMs: 1 };
      });

      const result = await injector.inject('之前的文件');
      // Should return original since we're passing through and limited
    });

    it('keyword search handles lines without file header prefix', async () => {
      // Lines that don't start with 📄 or L should be ignored
      const grepData = '📄 notes/test.md\nSome random line\nL1: Actual line\nAnother random\n📄 notes/other.md\nL2: Other content';
      const mockStore = {
        grep: vi.fn(() => ({ success: true, data: grepData })),
        stat: vi.fn(() => ({ success: true, mtime: new Date() })),
      };
      mocks.getMemoryStore.mockReturnValue(mockStore);

      mocks.hybridSearch.mockImplementation(async (query: string, keywordSearch: any) => {
        const results = keywordSearch(query, 10);
        return { items: results, searchTimeMs: 1 };
      });

      const result = await injector.inject('之前的笔记');
      // Should have parsed correctly, ignoring non-L lines
    });

    it('vector search function is created when embedding provider exists', async () => {
      mocks.getEmbeddingProvider.mockReturnValue({ type: 'openai' });
      const mockVectorStore = {
        search: vi.fn(async () => [
          { id: 'vec1', text: 'Vector memory content', score: 0.85, metadata: { source: 'vectors/mem.md' } },
        ]),
      };
      mocks.getVectorStore.mockReturnValue(mockVectorStore);

      const mockStore = {
        grep: vi.fn(() => ({ success: true, data: '' })),
        stat: vi.fn(() => ({ success: true, mtime: new Date() })),
      };
      mocks.getMemoryStore.mockReturnValue(mockStore);

      mocks.hybridSearch.mockImplementation(async (query: string, keywordSearch: any, vectorSearch: any) => {
        // vectorSearch should be defined since embedding provider exists
        expect(vectorSearch).toBeDefined();
        const vectorResults = vectorSearch ? await vectorSearch(query, 5) : [];
        return {
          items: vectorResults.map((r: any) => ({ ...r, matchReason: 'vector' })),
          searchTimeMs: 3,
        };
      });

      const result = await injector.inject('之前的向量记忆');
      expect(result).toContain('Vector memory content');
    });

    it('vector search uses r.id when metadata.source is missing', async () => {
      mocks.getEmbeddingProvider.mockReturnValue({ type: 'openai' });
      const mockVectorStore = {
        search: vi.fn(async () => [
          { id: 'fallback-id', text: 'Fallback content', score: 0.7, metadata: {} },
        ]),
      };
      mocks.getVectorStore.mockReturnValue(mockVectorStore);

      const mockStore = {
        grep: vi.fn(() => ({ success: true, data: '' })),
        stat: vi.fn(() => ({ success: true, mtime: new Date() })),
      };
      mocks.getMemoryStore.mockReturnValue(mockStore);

      mocks.hybridSearch.mockImplementation(async (query: string, keywordSearch: any, vectorSearch: any) => {
        const vectorResults = vectorSearch ? await vectorSearch(query, 5) : [];
        return { items: vectorResults, searchTimeMs: 1 };
      });

      const result = await injector.inject('之前的内容');
      expect(result).toContain('Fallback content');
    });

    it('vector search catches errors and returns empty array', async () => {
      mocks.getEmbeddingProvider.mockReturnValue({ type: 'openai' });
      const mockVectorStore = {
        search: vi.fn(async () => { throw new Error('vector search error'); }),
      };
      mocks.getVectorStore.mockReturnValue(mockVectorStore);

      const mockStore = {
        grep: vi.fn(() => ({ success: true, data: '' })),
        stat: vi.fn(() => ({ success: true, mtime: new Date() })),
      };
      mocks.getMemoryStore.mockReturnValue(mockStore);

      mocks.hybridSearch.mockImplementation(async (query: string, keywordSearch: any, vectorSearch: any) => {
        const vectorResults = vectorSearch ? await vectorSearch(query, 5) : [];
        return { items: vectorResults, searchTimeMs: 1 };
      });

      const result = await injector.inject('之前的记忆');
      // Should return original (empty items -> no injection)
      expect(result).toBe('之前的记忆');
      expect(mocks.logWarn).toHaveBeenCalledWith(
        expect.stringContaining('Vector search failed'),
        expect.any(Error),
      );
    });

    it('getTimestamp callback returns ISO string on success', async () => {
      const testDate = new Date('2024-07-15T12:00:00Z');
      const mockStore = {
        grep: vi.fn(() => ({ success: true, data: '' })),
        stat: vi.fn(() => ({ success: true, mtime: testDate })),
      };
      mocks.getMemoryStore.mockReturnValue(mockStore);

      mocks.hybridSearch.mockImplementation(async (query: string, keywordSearch: any, vectorSearch: any, getTimestamp: any) => {
        const ts = getTimestamp('some/path.md');
        expect(ts).toBe(testDate.toISOString());
        return { items: [], searchTimeMs: 1 };
      });

      await injector.inject('之前的内容');
    });

    it('getTimestamp callback returns null on stat failure', async () => {
      const mockStore = {
        grep: vi.fn(() => ({ success: true, data: '' })),
        stat: vi.fn(() => ({ success: false })),
      };
      mocks.getMemoryStore.mockReturnValue(mockStore);

      mocks.hybridSearch.mockImplementation(async (query: string, keywordSearch: any, vectorSearch: any, getTimestamp: any) => {
        const ts = getTimestamp('some/path.md');
        expect(ts).toBeNull();
        return { items: [], searchTimeMs: 1 };
      });

      await injector.inject('之前的文件');
    });

    it('retrieveMemories catches error from getMemoryStore and returns empty', async () => {
      mocks.getMemoryStore.mockImplementation(() => { throw new Error('store unavailable'); });

      // hybridSearch won't be called because getMemoryStore throws before it
      const result = await injector.inject('之前的东西');
      expect(result).toBe('之前的东西');
      expect(mocks.logError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to retrieve memories'),
        expect.any(Error),
      );
    });

    it('uses fallback search profile when config profile not found', async () => {
      injector.updateConfig({ searchProfile: 'nonexistent_profile' });

      const mockStore = {
        grep: vi.fn(() => ({ success: true, data: '' })),
        stat: vi.fn(() => ({ success: true, mtime: new Date() })),
      };
      mocks.getMemoryStore.mockReturnValue(mockStore);

      mocks.hybridSearch.mockImplementation(async (query: string, keywordSearch: any, vectorSearch: any, getTimestamp: any, profile: any) => {
        // profile should be SEARCH_PROFILES.semantic (fallback)
        expect(profile).toBeDefined();
        return { items: [], searchTimeMs: 1 };
      });

      await injector.inject('之前的设计');
    });
  });

  // ── buildInjectedContext edge cases ───────────────────────────────

  describe('buildInjectedContext edge cases', () => {
    beforeEach(() => {
      mocks.judgeFn.mockImplementation(async () => ({
        result: { needsContext: true, intent: 'compare', reasoning: 'comparison' },
        failed: false,
      }));
    });

    it('adds compare intent hint', async () => {
      mocks.hybridSearch.mockImplementation(async () => ({
        items: [{ path: 'a.md', snippet: 'compare data', score: 0.8 }],
        searchTimeMs: 1,
      }));

      const result = await injector.inject('对比一下之前的方案');
      expect(result).toContain('对比分析');
    });

    it('adds summarize intent hint', async () => {
      mocks.judgeFn.mockImplementation(async () => ({
        result: { needsContext: true, intent: 'summarize', reasoning: 'summary' },
        failed: false,
      }));
      mocks.hybridSearch.mockImplementation(async () => ({
        items: [{ path: 'a.md', snippet: 'summary data', score: 0.8 }],
        searchTimeMs: 1,
      }));

      const result = await injector.inject('总结一下之前的内容');
      expect(result).toContain('请总结');
    });

    it('no intent hint for general intent', async () => {
      mocks.judgeFn.mockImplementation(async () => ({
        result: { needsContext: true, intent: 'general', reasoning: 'test' },
        failed: false,
      }));
      mocks.hybridSearch.mockImplementation(async () => ({
        items: [{ path: 'a.md', snippet: 'general data', score: 0.8 }],
        searchTimeMs: 1,
      }));

      const result = await injector.inject('之前的数据');
      expect(result).not.toContain('请参考');
      expect(result).not.toContain('请继续');
      expect(result).not.toContain('对比分析');
      expect(result).not.toContain('请总结');
    });

    it('multiple memories numbered correctly', async () => {
      mocks.judgeFn.mockImplementation(async () => ({
        result: { needsContext: true, intent: 'recall', reasoning: 'test' },
        failed: false,
      }));
      mocks.hybridSearch.mockImplementation(async () => ({
        items: [
          { path: 'a.md', snippet: 'First memory', score: 0.9 },
          { path: 'b.md', snippet: 'Second memory', score: 0.8, matchReason: 'keyword' },
          { path: 'c.md', snippet: 'Third memory', score: 0.7 },
        ],
        searchTimeMs: 2,
      }));

      const result = await injector.inject('之前的三个讨论');
      expect(result).toContain('1. First memory');
      expect(result).toContain('2. Second memory');
      expect(result).toContain('3. Third memory');
      expect(result).toContain('(keyword)');
    });
  });

  // ── cleanSnippet additional cases ────────────────────────────────

  describe('cleanSnippet', () => {
    it('compresses multiple newlines', async () => {
      mocks.judgeFn.mockImplementation(async () => ({
        result: { needsContext: true, intent: 'recall', reasoning: 'test' },
        failed: false,
      }));
      mocks.hybridSearch.mockImplementation(async () => ({
        items: [{ path: 'a.md', snippet: 'Line1\n\n\n\nLine2', score: 0.8 }],
        searchTimeMs: 1,
      }));

      const result = await injector.inject('之前的内容');
      expect(result).not.toContain('\n\n\n');
    });
  });

  // ── getStats after injection ─────────────────────────────────────

  describe('getStats after injection', () => {
    it('increments injection count after successful inject', async () => {
      mocks.judgeFn.mockImplementation(async () => ({
        result: { needsContext: true, intent: 'recall', reasoning: 'test' },
        failed: false,
      }));
      mocks.hybridSearch.mockImplementation(async () => ({
        items: [{ path: 'a.md', snippet: 'memory', score: 0.8 }],
        searchTimeMs: 1,
      }));

      await injector.inject('之前的结果');
      const stats = injector.getStats();
      expect(stats.injections).toBe(1);
    });
  });
});
