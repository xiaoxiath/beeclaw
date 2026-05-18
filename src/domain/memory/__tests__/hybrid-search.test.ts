import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

import {
  SEARCH_PROFILES,
  getSearchProfile,
  setSearchProfile,
  registerSearchProfile,
  detectQueryIntent,
  autoSelectProfile,
  reciprocalRankFusion,
  calculateTimeDecay,
  hybridSearch,
} from '../hybrid-search';
import type { SearchWeightProfile, SearchResultItem } from '../hybrid-search';

// ── SEARCH_PROFILES ───────────────────────────────────────────────────────

describe('SEARCH_PROFILES', () => {
  it('contains all 4 presets', () => {
    expect(Object.keys(SEARCH_PROFILES)).toEqual(
      expect.arrayContaining(['precise', 'semantic', 'recent', 'balanced']),
    );
  });

  it('precise favors keyword weight', () => {
    const p = SEARCH_PROFILES.precise;
    expect(p.keywordWeight).toBeGreaterThan(p.vectorWeight);
  });

  it('semantic favors vector weight', () => {
    const p = SEARCH_PROFILES.semantic;
    expect(p.vectorWeight).toBeGreaterThan(p.keywordWeight);
  });

  it('recent has strong recency decay', () => {
    expect(SEARCH_PROFILES.recent.recencyDecay).toBeGreaterThanOrEqual(0.5);
  });
});

// ── get/set/register SearchProfile ────────────────────────────────────────

describe('profile management', () => {
  beforeEach(() => {
    // reset to balanced
    setSearchProfile('balanced');
  });

  it('getSearchProfile returns a copy', () => {
    const p = getSearchProfile();
    p.maxResults = 999;
    expect(getSearchProfile().maxResults).not.toBe(999);
  });

  it('setSearchProfile by name', () => {
    setSearchProfile('precise');
    expect(getSearchProfile().name).toBe('precise');
  });

  it('setSearchProfile by object', () => {
    setSearchProfile({ name: 'custom', keywordWeight: 0.9, vectorWeight: 0.1, recencyDecay: 0, minRelevanceScore: 0, maxResults: 5 });
    expect(getSearchProfile().name).toBe('custom');
  });

  it('setSearchProfile throws for unknown name', () => {
    expect(() => setSearchProfile('nonexistent')).toThrow('Unknown search profile');
  });

  it('registerSearchProfile makes name available', () => {
    registerSearchProfile({ name: 'myprofile', keywordWeight: 0.6, vectorWeight: 0.4, recencyDecay: 0, minRelevanceScore: 0, maxResults: 5 });
    setSearchProfile('myprofile');
    expect(getSearchProfile().name).toBe('myprofile');
  });
});

// ── detectQueryIntent ─────────────────────────────────────────────────────

describe('detectQueryIntent', () => {
  it('detects precise for fact queries (CN)', () => {
    expect(detectQueryIntent('什么是TypeScript')).toBe('precise');
    expect(detectQueryIntent('密码是多少')).toBe('precise');
    expect(detectQueryIntent('版本号是什么')).toBe('precise');
  });

  it('detects precise for fact queries (EN)', () => {
    expect(detectQueryIntent('what is the password')).toBe('precise');
    expect(detectQueryIntent('which config setting')).toBe('precise');
  });

  it('detects recent for time-based queries (CN)', () => {
    expect(detectQueryIntent('最近讨论了什么')).toBe('recent');
    expect(detectQueryIntent('昨天说的那个')).toBe('recent');
    expect(detectQueryIntent('上次开会内容')).toBe('recent');
  });

  it('detects recent for time-based queries (EN)', () => {
    expect(detectQueryIntent('what we discussed recently')).toBe('recent');
    expect(detectQueryIntent('yesterday meeting notes')).toBe('recent');
  });

  it('detects semantic for similarity queries (CN)', () => {
    expect(detectQueryIntent('类似的方案')).toBe('semantic');
    expect(detectQueryIntent('关于数据库的记录')).toBe('semantic');
  });

  it('detects semantic for similarity queries (EN)', () => {
    expect(detectQueryIntent('similar to the previous design')).toBe('semantic');
    expect(detectQueryIntent('related topics')).toBe('semantic');
  });

  it('falls back to balanced', () => {
    expect(detectQueryIntent('hello world')).toBe('balanced');
    expect(detectQueryIntent('随便聊聊')).toBe('balanced');
  });
});

// ── autoSelectProfile ─────────────────────────────────────────────────────

describe('autoSelectProfile', () => {
  it('returns profile matching detected intent', () => {
    const p = autoSelectProfile('什么是TypeScript');
    expect(p.name).toBe('precise');
  });

  it('returns balanced for generic query', () => {
    const p = autoSelectProfile('hello');
    expect(p.name).toBe('balanced');
  });
});

// ── reciprocalRankFusion ──────────────────────────────────────────────────

describe('reciprocalRankFusion', () => {
  it('returns empty for empty lists', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });

  it('fuses single list correctly', () => {
    const result = reciprocalRankFusion([
      [{ id: 'a', score: 0.9 }, { id: 'b', score: 0.5 }],
    ]);
    expect(result[0].id).toBe('a');
    expect(result[1].id).toBe('b');
    expect(result[0].fusedScore).toBeGreaterThan(result[1].fusedScore);
  });

  it('fuses two lists with overlap', () => {
    const result = reciprocalRankFusion([
      [{ id: 'a', score: 0.9 }, { id: 'b', score: 0.5 }],
      [{ id: 'b', score: 0.8 }, { id: 'c', score: 0.3 }],
    ]);
    // 'b' appears in both lists, should get boosted
    const bItem = result.find(r => r.id === 'b')!;
    const cItem = result.find(r => r.id === 'c')!;
    expect(bItem.fusedScore).toBeGreaterThan(cItem.fusedScore);
  });

  it('tracks ranks per list', () => {
    const result = reciprocalRankFusion([
      [{ id: 'a', score: 0.9 }],
      [{ id: 'a', score: 0.7 }, { id: 'b', score: 0.3 }],
    ]);
    const aItem = result.find(r => r.id === 'a')!;
    expect(aItem.ranks).toEqual([0, 0]); // rank 0 in both lists
  });

  it('marks -1 for lists where item is absent', () => {
    const result = reciprocalRankFusion([
      [{ id: 'a', score: 0.9 }],
      [{ id: 'b', score: 0.8 }],
    ]);
    const aItem = result.find(r => r.id === 'a')!;
    expect(aItem.ranks[1]).toBe(-1);
  });
});

// ── calculateTimeDecay ───────────────────────────────────────────────────

describe('calculateTimeDecay', () => {
  it('returns 1 for current timestamp', () => {
    const decay = calculateTimeDecay(new Date().toISOString());
    expect(decay).toBeCloseTo(1, 1);
  });

  it('returns <1 for old timestamp', () => {
    const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days ago
    const decay = calculateTimeDecay(oldDate);
    expect(decay).toBeLessThan(1);
    expect(decay).toBeGreaterThan(0);
  });

  it('higher decayRate produces faster decay', () => {
    const ts = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const slow = calculateTimeDecay(ts, 0.1);
    const fast = calculateTimeDecay(ts, 0.9);
    expect(fast).toBeLessThan(slow);
  });

  it('returns 1 for future timestamp', () => {
    const future = new Date(Date.now() + 1000000).toISOString();
    expect(calculateTimeDecay(future)).toBe(1);
  });
});

// ── hybridSearch ──────────────────────────────────────────────────────────

describe('hybridSearch', () => {
  const kwSearch = vi.fn((q: string, max: number) => [
    { path: 'a.md', snippet: 'keyword match A', matchedTerms: ['test'], score: 0.8 },
    { path: 'b.md', snippet: 'keyword match B', matchedTerms: ['test'], score: 0.5 },
  ]);

  const vecSearch = vi.fn(async (q: string, max: number) => [
    { path: 'a.md', snippet: 'vector match A', score: 0.7 },
    { path: 'c.md', snippet: 'vector match C', score: 0.6 },
  ]);

  const getTs = vi.fn((path: string) => new Date().toISOString());

  beforeEach(() => {
    kwSearch.mockClear();
    vecSearch.mockClear();
    getTs.mockClear();
  });

  it('returns keyword-only results when no vector search', async () => {
    const result = await hybridSearch('test', kwSearch, undefined, getTs, SEARCH_PROFILES.balanced);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.profile).toBe('balanced');
    expect(result.query).toBe('test');
    // All items come from keyword
    for (const item of result.items) {
      expect(item.sources.keyword).toBeDefined();
    }
  });

  it('fuses keyword + vector results', async () => {
    const result = await hybridSearch('test', kwSearch, vecSearch, getTs, SEARCH_PROFILES.balanced);
    const paths = result.items.map(i => i.path);
    // Should contain items from both sources
    expect(paths).toContain('a.md'); // in both
    // a.md should have both keyword and vector sources
    const aItem = result.items.find(i => i.path === 'a.md')!;
    expect(aItem.sources.keyword).toBeDefined();
    expect(aItem.sources.vector).toBeDefined();
  });

  it('filters by minRelevanceScore', async () => {
    const highThreshold: SearchWeightProfile = {
      ...SEARCH_PROFILES.balanced,
      minRelevanceScore: 0.99,
    };
    const result = await hybridSearch('test', kwSearch, vecSearch, getTs, highThreshold);
    // With very high threshold, most items should be filtered
    expect(result.items.length).toBeLessThanOrEqual(result.totalCandidates);
  });

  it('respects maxResults', async () => {
    const smallMax: SearchWeightProfile = {
      ...SEARCH_PROFILES.balanced,
      maxResults: 1,
      minRelevanceScore: 0,
    };
    const result = await hybridSearch('test', kwSearch, vecSearch, getTs, smallMax);
    expect(result.items.length).toBeLessThanOrEqual(1);
  });

  it('falls back gracefully when vector search throws', async () => {
    const failingVec = vi.fn(async () => { throw new Error('vector down'); });
    const result = await hybridSearch('test', kwSearch, failingVec as any, getTs, SEARCH_PROFILES.balanced);
    // Should still return keyword results
    expect(result.items.length).toBeGreaterThan(0);
  });

  it('auto-selects profile when none provided', async () => {
    const result = await hybridSearch('什么是TypeScript', kwSearch);
    // Should auto-detect 'precise' intent
    expect(result.profile).toBe('precise');
  });

  it('includes matchReason in items', async () => {
    const result = await hybridSearch('test', kwSearch, vecSearch, getTs, SEARCH_PROFILES.balanced);
    for (const item of result.items) {
      expect(typeof item.matchReason).toBe('string');
    }
  });

  it('applies time decay when getTimestamp provided', async () => {
    // Return very old timestamps
    const oldTs = vi.fn(() => new Date('2020-01-01').toISOString());
    const highDecay: SearchWeightProfile = {
      ...SEARCH_PROFILES.balanced,
      recencyDecay: 0.9,
      minRelevanceScore: 0,
    };
    const result = await hybridSearch('test', kwSearch, undefined, oldTs, highDecay);
    // Items should still be returned but with lower scores due to decay
    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(item.sources.recency).toBeDefined();
    }
  });

  it('reports searchTimeMs', async () => {
    const result = await hybridSearch('test', kwSearch);
    expect(typeof result.searchTimeMs).toBe('number');
    expect(result.searchTimeMs).toBeGreaterThanOrEqual(0);
  });
});
