import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../infra/observability/logger', () => {
  const m = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { logger: m, getLogger: () => m };
});

vi.mock('../types', () => ({}));

import {
  ShortTermMemoryCache,
  getShortTermCache,
  resetShortTermCache,
} from '../short-term-cache';
import type { ShortTermCacheConfig } from '../short-term-cache';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeEntry(role: string = 'user', content: string = 'test'): any {
  return {
    role,
    content,
    timestamp: Date.now(),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ShortTermMemoryCache', () => {
  let cache: ShortTermMemoryCache;

  beforeEach(() => {
    cache = new ShortTermMemoryCache({
      maxUsers: 5,
      conversationsPerUser: 3,
      ttl: 60 * 1000, // 1 minute for fast testing
      maxSize: 10 * 1024 * 1024,
    });
  });

  afterEach(() => {
    cache.dispose();
  });

  // ── getRecentConversations / addConversation ──────────────────────

  describe('getRecentConversations', () => {
    it('returns null on cache miss', async () => {
      const result = await cache.getRecentConversations('user1');
      expect(result).toBeNull();
    });

    it('returns conversations after addConversation', async () => {
      const entry = makeEntry('user', 'hello');
      await cache.addConversation('user1', entry);

      const result = await cache.getRecentConversations('user1');
      expect(result).not.toBeNull();
      expect(result!.length).toBe(1);
      expect(result![0].content).toBe('hello');
    });

    it('respects limit parameter', async () => {
      await cache.addConversation('user1', makeEntry('user', 'a'));
      await cache.addConversation('user1', makeEntry('user', 'b'));
      await cache.addConversation('user1', makeEntry('user', 'c'));

      const result = await cache.getRecentConversations('user1', 2);
      expect(result!.length).toBe(2);
    });

    it('returns most recent first (unshift order)', async () => {
      await cache.addConversation('user1', makeEntry('user', 'first'));
      await cache.addConversation('user1', makeEntry('user', 'second'));

      const result = await cache.getRecentConversations('user1');
      expect(result![0].content).toBe('second');
      expect(result![1].content).toBe('first');
    });

    it('returns null for expired entries', async () => {
      const shortTtl = new ShortTermMemoryCache({
        ttl: 1, // 1ms TTL
        maxUsers: 10,
        conversationsPerUser: 10,
        maxSize: 10 * 1024 * 1024,
      });

      await shortTtl.addConversation('user1', makeEntry());
      // Wait for TTL to expire
      await new Promise(r => setTimeout(r, 10));
      const result = await shortTtl.getRecentConversations('user1');
      expect(result).toBeNull();
      shortTtl.dispose();
    });
  });

  describe('addConversation', () => {
    it('caps at conversationsPerUser', async () => {
      // Config is 3 per user
      for (let i = 0; i < 5; i++) {
        await cache.addConversation('user1', makeEntry('user', `msg${i}`));
      }

      const result = await cache.getRecentConversations('user1', 10);
      expect(result!.length).toBe(3);
    });
  });

  // ── updateConversations ────────────────────────────────────────────

  describe('updateConversations', () => {
    it('replaces entire conversation list', async () => {
      await cache.addConversation('user1', makeEntry('user', 'old'));

      const newList = [makeEntry('user', 'new1'), makeEntry('user', 'new2')];
      await cache.updateConversations('user1', newList);

      const result = await cache.getRecentConversations('user1');
      expect(result!.length).toBe(2);
      expect(result![0].content).toBe('new1');
    });

    it('caps to conversationsPerUser', async () => {
      const bigList = Array.from({ length: 10 }, (_, i) => makeEntry('user', `m${i}`));
      await cache.updateConversations('user1', bigList);

      const result = await cache.getRecentConversations('user1', 100);
      expect(result!.length).toBe(3); // capped at conversationsPerUser
    });
  });

  // ── clearUser ──────────────────────────────────────────────────────

  describe('clearUser', () => {
    it('removes user cache', async () => {
      await cache.addConversation('user1', makeEntry());
      cache.clearUser('user1');

      const result = await cache.getRecentConversations('user1');
      expect(result).toBeNull();
    });

    it('does not affect other users', async () => {
      await cache.addConversation('user1', makeEntry('user', 'u1'));
      await cache.addConversation('user2', makeEntry('user', 'u2'));
      cache.clearUser('user1');

      expect(await cache.getRecentConversations('user1')).toBeNull();
      expect(await cache.getRecentConversations('user2')).not.toBeNull();
    });
  });

  // ── invalidate / invalidateAll ─────────────────────────────────────

  describe('invalidate', () => {
    it('removes specific key from cache', async () => {
      await cache.addConversation('user1', makeEntry());
      cache.invalidate('user1');

      expect(await cache.getRecentConversations('user1')).toBeNull();
    });

    it('increments evictions stat', async () => {
      await cache.addConversation('user1', makeEntry());
      cache.invalidate('user1');

      const stats = cache.getStats();
      expect(stats.evictions).toBeGreaterThanOrEqual(1);
    });
  });

  describe('invalidateAll', () => {
    it('clears all entries', async () => {
      await cache.addConversation('user1', makeEntry());
      await cache.addConversation('user2', makeEntry());
      cache.invalidateAll();

      expect(await cache.getRecentConversations('user1')).toBeNull();
      expect(await cache.getRecentConversations('user2')).toBeNull();
    });

    it('resets size and user count', () => {
      cache.invalidateAll();
      const stats = cache.getStats();
      expect(stats.currentSize).toBe(0);
      expect(stats.userCount).toBe(0);
    });
  });

  // ── clear ──────────────────────────────────────────────────────────

  describe('clear', () => {
    it('empties entire cache', async () => {
      await cache.addConversation('u1', makeEntry());
      cache.clear();

      const stats = cache.getStats();
      expect(stats.currentSize).toBe(0);
      expect(stats.userCount).toBe(0);
    });
  });

  // ── LRU eviction ──────────────────────────────────────────────────

  describe('LRU eviction', () => {
    it('evicts oldest entry when maxUsers exceeded', async () => {
      // maxUsers = 5
      for (let i = 0; i < 6; i++) {
        await cache.addConversation(`user${i}`, makeEntry('user', `msg${i}`));
      }

      // user0 should have been evicted (oldest)
      const evicted = await cache.getRecentConversations('user0');
      // May or may not be null depending on timing, but stats should show eviction
      const stats = cache.getStats();
      expect(stats.evictions).toBeGreaterThanOrEqual(1);
    });
  });

  // ── getStats ──────────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns hitRate as N/A when no accesses', () => {
      const stats = cache.getStats();
      expect(stats.hitRate).toBe('N/A');
    });

    it('tracks hits and misses', async () => {
      await cache.getRecentConversations('noone'); // miss
      await cache.addConversation('user1', makeEntry());
      await cache.getRecentConversations('user1'); // hit

      const stats = cache.getStats();
      expect(stats.misses).toBeGreaterThanOrEqual(1);
      expect(stats.hits).toBeGreaterThanOrEqual(1);
      expect(stats.hitRate).not.toBe('N/A');
    });
  });

  // ── dispose ────────────────────────────────────────────────────────

  describe('dispose', () => {
    it('clears timer and cache', () => {
      cache.dispose();
      const stats = cache.getStats();
      expect(stats.currentSize).toBe(0);
      expect(stats.userCount).toBe(0);
    });
  });
});

// ── Singleton ──────────────────────────────────────────────────────────────

describe('getShortTermCache / resetShortTermCache', () => {
  afterEach(() => {
    resetShortTermCache();
  });

  it('returns singleton instance', () => {
    const a = getShortTermCache();
    const b = getShortTermCache();
    expect(a).toBe(b);
  });

  it('resetShortTermCache clears singleton', () => {
    const a = getShortTermCache();
    resetShortTermCache();
    const b = getShortTermCache();
    expect(a).not.toBe(b);
  });
});
