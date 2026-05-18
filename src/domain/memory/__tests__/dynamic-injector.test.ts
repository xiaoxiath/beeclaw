import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../hybrid-search', () => ({
  hybridSearch: vi.fn(async () => ({ items: [], searchTimeMs: 0 })),
  SEARCH_PROFILES: {
    precise: { keywordWeight: 0.7, vectorWeight: 0.3, timeDecay: 0.1, maxResults: 10 },
    semantic: { keywordWeight: 0.3, vectorWeight: 0.7, timeDecay: 0.1, maxResults: 10 },
    recent: { keywordWeight: 0.2, vectorWeight: 0.3, timeDecay: 0.5, maxResults: 10 },
    balanced: { keywordWeight: 0.5, vectorWeight: 0.5, timeDecay: 0.2, maxResults: 10 },
  },
}));

vi.mock('../store', () => ({
  getMemoryStore: vi.fn(() => ({
    grep: vi.fn(() => ({ success: true, data: '' })),
    stat: vi.fn(() => ({ success: true, mtime: new Date('2024-01-01') })),
  })),
}));

vi.mock('../vector-store', () => ({
  getVectorStore: vi.fn(() => ({
    search: vi.fn(async () => []),
  })),
  getEmbeddingProvider: vi.fn(() => null),
}));

const mockJudgeFn = vi.fn(async (opts: any) => ({
  result: opts.defaultValue,
  failed: false,
}));

vi.mock('../../agent/fast-llm-judge', () => ({
  getFastLLMJudge: vi.fn(() => ({
    judge: mockJudgeFn,
  })),
}));

vi.mock('../../agent/judgment-stats', () => ({
  JudgmentStatsTracker: class {
    incrementLlmCalls() {}
    incrementErrors() {}
    getStats() { return { llmCalls: 0, errors: 0 }; }
  },
}));

vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

import {
  DynamicMemoryInjector,
  getDynamicMemoryInjector,
  resetDynamicMemoryInjector,
} from '../dynamic-injector';
import type { InjectorConfig } from '../dynamic-injector';
import { hybridSearch } from '../hybrid-search';

// ── Helpers ────────────────────────────────────────────────────────────────

const fakeProvider: any = { type: 'openai', model: 'gpt-4o-mini' };

// ── Tests ──────────────────────────────────────────────────────────────────

describe('DynamicMemoryInjector', () => {
  let injector: DynamicMemoryInjector;

  beforeEach(() => {
    injector = new DynamicMemoryInjector(fakeProvider);
    // reset mocks
    mockJudgeFn.mockReset();
    mockJudgeFn.mockImplementation(async (opts: any) => ({
      result: opts.defaultValue,
      failed: false,
    }));
    (hybridSearch as any).mockReset();
  });

  // ── inject() ─────────────────────────────────────────────────────────

  describe('inject()', () => {
    it('returns original message when disabled', async () => {
      injector.updateConfig({ enabled: false });
      const result = await injector.inject('之前说的那个方案呢');
      expect(result).toBe('之前说的那个方案呢');
    });

    it('returns original message when no history keywords present', async () => {
      const result = await injector.inject('今天天气怎么样');
      expect(result).toBe('今天天气怎么样');
      // LLM should NOT be called
      expect(mockJudgeFn).not.toHaveBeenCalled();
    });

    it('detects Chinese history keywords', async () => {
      mockJudgeFn.mockImplementation(async (opts: any) => ({
        result: { needsContext: false, intent: 'general', reasoning: 'test' },
        failed: false,
      }));

      const keywords = ['之前', '上次', '继续', '回顾', '对比'];
      for (const kw of keywords) {
        mockJudgeFn.mockClear();
        await injector.inject(`请${kw}处理`);
        expect(mockJudgeFn).toHaveBeenCalled();
      }
    });

    it('detects English history keywords', async () => {
      mockJudgeFn.mockImplementation(async (opts: any) => ({
        result: { needsContext: false, intent: 'general', reasoning: 'test' },
        failed: false,
      }));

      await injector.inject('remember what we discussed last time');
      expect(mockJudgeFn).toHaveBeenCalled();
    });

    it('returns original when LLM says no context needed', async () => {
      mockJudgeFn.mockImplementation(async (opts: any) => ({
        result: { needsContext: false, intent: 'general', reasoning: 'not needed' },
        failed: false,
      }));

      const result = await injector.inject('继续做这个');
      expect(result).toBe('继续做这个');
    });

    it('injects memories when LLM says context needed and memories found', async () => {
      mockJudgeFn.mockImplementation(async () => ({
        result: { needsContext: true, intent: 'recall', reasoning: 'user recalls' },
        failed: false,
      }));

      (hybridSearch as any).mockImplementation(async () => ({
        items: [
          { path: 'memo1.md', snippet: 'Previous discussion about API design', score: 0.8, matchReason: 'keyword match' },
        ],
        searchTimeMs: 12,
      }));

      const result = await injector.inject('之前讨论的API设计');
      expect(result).toContain('[相关历史记忆]');
      expect(result).toContain('Previous discussion about API design');
      expect(result).toContain('[当前问题]');
      expect(result).toContain('之前讨论的API设计');
    });

    it('returns original when memories found is empty', async () => {
      mockJudgeFn.mockImplementation(async () => ({
        result: { needsContext: true, intent: 'recall', reasoning: 'user recalls' },
        failed: false,
      }));

      (hybridSearch as any).mockImplementation(async () => ({
        items: [],
        searchTimeMs: 5,
      }));

      const result = await injector.inject('之前那个设计方案');
      expect(result).toBe('之前那个设计方案');
    });

    it('returns original on retrieval error', async () => {
      mockJudgeFn.mockImplementation(async () => ({
        result: { needsContext: true, intent: 'recall', reasoning: 'test' },
        failed: false,
      }));

      (hybridSearch as any).mockImplementation(async () => {
        throw new Error('search failed');
      });

      const result = await injector.inject('之前的讨论结果');
      expect(result).toBe('之前的讨论结果');
    });
  });

  // ── buildInjectedContext (indirectly via inject) ─────────────────────

  describe('context building', () => {
    beforeEach(() => {
      mockJudgeFn.mockImplementation(async () => ({
        result: { needsContext: true, intent: 'recall', reasoning: 'test' },
        failed: false,
      }));
    });

    it('truncates long snippets to 400 chars', async () => {
      const longSnippet = 'A'.repeat(500);
      (hybridSearch as any).mockImplementation(async () => ({
        items: [{ path: 'a.md', snippet: longSnippet, score: 0.9 }],
        searchTimeMs: 1,
      }));

      const result = await injector.inject('之前的内容');
      // Original is 500 chars, should be truncated to 400 + "..."
      expect(result).toContain('A'.repeat(400) + '...');
    });

    it('includes matchReason in context', async () => {
      (hybridSearch as any).mockImplementation(async () => ({
        items: [
          { path: 'a.md', snippet: 'content', score: 0.8, matchReason: 'vector similarity' },
        ],
        searchTimeMs: 1,
      }));

      const result = await injector.inject('之前的讨论');
      expect(result).toContain('(vector similarity)');
    });

    it('adds intent hint for recall', async () => {
      mockJudgeFn.mockImplementation(async () => ({
        result: { needsContext: true, intent: 'recall', reasoning: 'test' },
        failed: false,
      }));
      (hybridSearch as any).mockImplementation(async () => ({
        items: [{ path: 'a.md', snippet: 'some memory', score: 0.8 }],
        searchTimeMs: 1,
      }));

      const result = await injector.inject('之前说过什么');
      expect(result).toContain('请参考');
    });

    it('adds intent hint for continue', async () => {
      mockJudgeFn.mockImplementation(async () => ({
        result: { needsContext: true, intent: 'continue', reasoning: 'test' },
        failed: false,
      }));
      (hybridSearch as any).mockImplementation(async () => ({
        items: [{ path: 'a.md', snippet: 'work in progress', score: 0.8 }],
        searchTimeMs: 1,
      }));

      const result = await injector.inject('继续上次的工作');
      expect(result).toContain('请继续');
    });

    it('enforces maxContentLength config', async () => {
      injector.updateConfig({ maxContentLength: 50 });
      (hybridSearch as any).mockImplementation(async () => ({
        items: [{ path: 'a.md', snippet: 'A'.repeat(200), score: 0.8 }],
        searchTimeMs: 1,
      }));

      const result = await injector.inject('之前的内容');
      // The context portion should be capped
      const contextPart = result.split('[当前问题]')[0];
      // total context is capped at 50 chars + "\n..."
      expect(contextPart.length).toBeLessThan(200);
    });
  });

  // ── cleanSnippet (indirectly) ────────────────────────────────────────

  describe('snippet cleaning', () => {
    beforeEach(() => {
      mockJudgeFn.mockImplementation(async () => ({
        result: { needsContext: true, intent: 'recall', reasoning: 'test' },
        failed: false,
      }));
    });

    it('removes markdown headings and bold markers', async () => {
      (hybridSearch as any).mockImplementation(async () => ({
        items: [{ path: 'a.md', snippet: '## Title\n**bold text** and `code`', score: 0.8 }],
        searchTimeMs: 1,
      }));

      const result = await injector.inject('之前的笔记');
      expect(result).not.toContain('##');
      expect(result).not.toContain('**');
      expect(result).not.toContain('`');
    });
  });

  // ── getStats / updateConfig ──────────────────────────────────────────

  describe('getStats()', () => {
    it('returns stats with injection count', () => {
      const stats = injector.getStats();
      expect(stats).toHaveProperty('injections');
      expect(stats).toHaveProperty('enabled');
      expect(stats.injections).toBe(0);
      expect(stats.enabled).toBe(true);
    });
  });

  describe('updateConfig()', () => {
    it('merges new config values', () => {
      injector.updateConfig({ maxMemories: 10, minRelevanceScore: 0.5 });
      // We can verify indirectly through stats
      const stats = injector.getStats();
      expect(stats.enabled).toBe(true); // unchanged
    });
  });
});

// ── Singleton ──────────────────────────────────────────────────────────────

describe('getDynamicMemoryInjector / resetDynamicMemoryInjector', () => {
  beforeEach(() => {
    resetDynamicMemoryInjector();
  });

  it('throws if no provider on first call', () => {
    expect(() => getDynamicMemoryInjector()).toThrow('requires provider');
  });

  it('creates singleton with provider', () => {
    const instance = getDynamicMemoryInjector(fakeProvider);
    expect(instance).toBeInstanceOf(DynamicMemoryInjector);
  });

  it('returns same instance on subsequent calls', () => {
    const a = getDynamicMemoryInjector(fakeProvider);
    const b = getDynamicMemoryInjector();
    expect(a).toBe(b);
  });

  it('resets singleton', () => {
    const a = getDynamicMemoryInjector(fakeProvider);
    resetDynamicMemoryInjector();
    const b = getDynamicMemoryInjector(fakeProvider);
    expect(a).not.toBe(b);
  });
});
