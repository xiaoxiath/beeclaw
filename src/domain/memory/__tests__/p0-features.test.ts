/**
 * P0 Feature Tests
 *
 * Tests for:
 * 1. Short-Term Memory Cache
 * 2. Dynamic Memory Injector
 * 3. Integration behavior
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
    record: vi.fn(async () => ({ success: true, data: 'recorded' })),
    recordConversation: vi.fn(async () => ({ success: true, data: 'conversation recorded' })),
    getRecentConversations: vi.fn(async () => []),
  })),
  resetMemoryStore: vi.fn(),
}));

vi.mock('../vector-store', () => ({
  getVectorStore: vi.fn(() => ({
    search: vi.fn(async () => []),
  })),
  getEmbeddingProvider: vi.fn(() => null),
}));

vi.mock('../../agent/fast-llm-judge', () => ({
  getFastLLMJudge: vi.fn(() => ({
    judge: vi.fn(async (opts: any) => ({
      result: opts.defaultValue,
      failed: false,
    })),
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
}));

import { ShortTermMemoryCache, resetShortTermCache, getShortTermCache } from '../short-term-cache';
import {
  DynamicMemoryInjector,
  resetDynamicMemoryInjector,
} from '../dynamic-injector';

const fakeProvider: any = { type: 'openai', model: 'gpt-4o-mini' };

// ── Test 1: Short-Term Memory Cache ────────────────────────────────────────

describe('Short-Term Memory Cache (P0)', () => {
  let cache: ShortTermMemoryCache;

  beforeEach(() => {
    cache = new ShortTermMemoryCache();
  });

  afterEach(() => {
    cache.dispose();
  });

  it('should add and retrieve conversations', async () => {
    await cache.addConversation('user1', {
      timestamp: new Date().toISOString(),
      source: 'cli',
      user: '你好',
      assistant: '你好！有什么可以帮助你的吗？',
    });

    const cached = await cache.getRecentConversations('user1', 5);
    expect(cached).not.toBeNull();
    expect(cached!.length).toBe(1);
    expect(cached![0].user).toBe('你好');
  });

  it('should return null on cache miss', async () => {
    const cached = await cache.getRecentConversations('nonexistent', 5);
    expect(cached).toBeNull();
  });

  it('should hit cache on second access', async () => {
    await cache.addConversation('user1', {
      timestamp: new Date().toISOString(),
      source: 'cli',
      user: 'test',
      assistant: 'response',
    });

    // First access: cache hit (since we just added)
    const cached1 = await cache.getRecentConversations('user1', 5);
    expect(cached1).not.toBeNull();

    // Second access: also cache hit
    const cached2 = await cache.getRecentConversations('user1', 5);
    expect(cached2).not.toBeNull();
  });

  it('should track cache stats', async () => {
    // Miss
    await cache.getRecentConversations('user1', 5);
    
    // Add conversation
    await cache.addConversation('user1', {
      timestamp: new Date().toISOString(),
      source: 'cli',
      user: 'test',
      assistant: 'response',
    });

    // Hit
    await cache.getRecentConversations('user1', 5);

    const stats = cache.getStats();
    expect(stats.hits).toBeGreaterThanOrEqual(1);
    expect(stats.misses).toBeGreaterThanOrEqual(1);
    expect(stats.userCount).toBe(1);
    expect(typeof stats.hitRate).toBe('string');
  });

  it('should clear user cache', async () => {
    await cache.addConversation('user1', {
      timestamp: new Date().toISOString(),
      source: 'cli',
      user: 'test',
      assistant: 'response',
    });

    cache.clearUser('user1');

    const cached = await cache.getRecentConversations('user1', 5);
    expect(cached).toBeNull();
  });

  it('should limit conversations per user', async () => {
    const smallCache = new ShortTermMemoryCache({ conversationsPerUser: 3 });

    for (let i = 0; i < 5; i++) {
      await smallCache.addConversation('user1', {
        timestamp: new Date().toISOString(),
        source: 'cli',
        user: `message ${i}`,
        assistant: `response ${i}`,
      });
    }

    const cached = await smallCache.getRecentConversations('user1', 10);
    expect(cached).not.toBeNull();
    expect(cached!.length).toBeLessThanOrEqual(3);

    smallCache.dispose();
  });
});

// ── Test 2: Dynamic Memory Injector ────────────────────────────────────────

describe('Dynamic Memory Injector (P0)', () => {
  let injector: DynamicMemoryInjector;

  beforeEach(() => {
    resetDynamicMemoryInjector();
    injector = new DynamicMemoryInjector(fakeProvider);
  });

  it('should not inject for normal queries (no history keywords)', async () => {
    const normalQuery = '今天天气怎么样？';
    const result = await injector.inject(normalQuery);
    expect(result).toBe(normalQuery);
  });

  it('should attempt injection for queries with history keywords', async () => {
    const recallQuery = '之前创建的 React 项目怎么样了？';
    const result = await injector.inject(recallQuery);
    // Even if no memories are found, the function should not crash
    expect(typeof result).toBe('string');
  });

  it('should return stats', () => {
    const stats = injector.getStats();
    expect(stats).toHaveProperty('injections');
    expect(stats).toHaveProperty('enabled');
    expect(stats.enabled).toBe(true);
  });
});

// ── Test 3: Singleton management ───────────────────────────────────────────

describe('Singleton management (P0)', () => {
  beforeEach(() => {
    resetShortTermCache();
    resetDynamicMemoryInjector();
  });

  it('getShortTermCache returns a ShortTermMemoryCache instance', () => {
    const cache = getShortTermCache();
    expect(cache).toBeInstanceOf(ShortTermMemoryCache);
    resetShortTermCache();
  });

  it('resetShortTermCache clears the singleton', () => {
    const cache1 = getShortTermCache();
    resetShortTermCache();
    const cache2 = getShortTermCache();
    expect(cache1).not.toBe(cache2);
    resetShortTermCache();
  });
});
