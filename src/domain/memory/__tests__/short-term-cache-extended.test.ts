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
import { logger } from '../../../infra/observability/logger';

function makeEntry(role: string = 'user', content: string = 'test'): any {
  return { role, content, timestamp: Date.now() };
}

describe('ShortTermMemoryCache - extended coverage', () => {
  let cache: ShortTermMemoryCache;

  beforeEach(() => {
    cache = new ShortTermMemoryCache({
      maxUsers: 3,
      conversationsPerUser: 5,
      ttl: 60 * 1000,
      maxSize: 10 * 1024 * 1024,
    });
  });

  afterEach(() => {
    cache.dispose();
  });

  // ─── calculateEntrySize catch branch ─────────────────────
  describe('calculateEntrySize', () => {
    it('falls back to rough estimate when JSON.stringify fails', async () => {
      // Create a circular reference to make JSON.stringify fail
      const entry: any = makeEntry('user', 'hello');
      const circular: any = {};
      circular.self = circular;
      entry.circular = circular;

      await cache.addConversation('user1', entry);
      // Should not throw - falls back to entries.length * 1024
      const stats = cache.getStats();
      expect(stats.currentSize).toBeGreaterThan(0);
    });
  });

  // ─── evictIfNeeded - size-based eviction ─────────────────
  describe('evictIfNeeded - size-based eviction', () => {
    it('evicts when total size exceeds maxSize', async () => {
      // Use very small maxSize
      const smallCache = new ShortTermMemoryCache({
        maxUsers: 100,
        conversationsPerUser: 100,
        ttl: 60 * 1000,
        maxSize: 100, // 100 bytes - very small
      });

      // Add entries that exceed 100 bytes total
      await smallCache.addConversation('user1', makeEntry('user', 'a'.repeat(50)));
      await smallCache.addConversation('user2', makeEntry('user', 'b'.repeat(50)));
      await smallCache.addConversation('user3', makeEntry('user', 'c'.repeat(50)));

      const stats = smallCache.getStats();
      expect(stats.evictions).toBeGreaterThanOrEqual(1);
      smallCache.dispose();
    });
  });

  // ─── evictLRU picks oldest ───────────────────────────────
  describe('evictLRU', () => {
    it('evicts the least recently used entry', async () => {
      // maxUsers = 3
      await cache.addConversation('user-old', makeEntry('user', 'old'));
      await new Promise(r => setTimeout(r, 5));
      await cache.addConversation('user-mid', makeEntry('user', 'mid'));
      await new Promise(r => setTimeout(r, 5));
      await cache.addConversation('user-new', makeEntry('user', 'new'));

      // Adding a 4th user should evict user-old (oldest lastAccess)
      await cache.addConversation('user-extra', makeEntry('user', 'extra'));

      const evicted = await cache.getRecentConversations('user-old');
      // user-old should be evicted
      expect(evicted).toBeNull();
      // user-new should still be present
      const kept = await cache.getRecentConversations('user-new');
      expect(kept).not.toBeNull();
    });

    it('updates eviction stats correctly', async () => {
      await cache.addConversation('u1', makeEntry());
      await cache.addConversation('u2', makeEntry());
      await cache.addConversation('u3', makeEntry());
      // 4th exceeds maxUsers=3
      await cache.addConversation('u4', makeEntry());

      const stats = cache.getStats();
      expect(stats.evictions).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── cleanupExpired ──────────────────────────────────────
  describe('cleanupExpired', () => {
    it('removes expired entries on cleanup', async () => {
      const shortCache = new ShortTermMemoryCache({
        maxUsers: 10,
        conversationsPerUser: 10,
        ttl: 1, // 1ms TTL
        maxSize: 10 * 1024 * 1024,
      });

      await shortCache.addConversation('user1', makeEntry());
      await shortCache.addConversation('user2', makeEntry());

      // Wait for TTL to expire
      await new Promise(r => setTimeout(r, 10));

      // Manually trigger cleanup (private method)
      (shortCache as any).cleanupExpired();

      const stats = shortCache.getStats();
      expect(stats.evictions).toBeGreaterThanOrEqual(2);
      expect(stats.userCount).toBe(0);
      shortCache.dispose();
    });

    it('does nothing when no entries are expired', async () => {
      await cache.addConversation('user1', makeEntry());
      const statsBefore = cache.getStats();
      (cache as any).cleanupExpired();
      const statsAfter = cache.getStats();
      expect(statsAfter.evictions).toBe(statsBefore.evictions);
    });

    it('logs when expired entries are cleaned', async () => {
      const shortCache = new ShortTermMemoryCache({
        maxUsers: 10,
        conversationsPerUser: 10,
        ttl: 1,
        maxSize: 10 * 1024 * 1024,
      });

      await shortCache.addConversation('user1', makeEntry());
      await new Promise(r => setTimeout(r, 10));
      (shortCache as any).cleanupExpired();

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Cleaned up'),
        // Not matching extra args since the log might not have them
      );
      shortCache.dispose();
    });
  });

  // ─── invalidate / clearUser on non-existent key ──────────
  describe('invalidate on non-existent key', () => {
    it('does nothing when key does not exist', () => {
      const statsBefore = cache.getStats();
      cache.invalidate('nonexistent');
      const statsAfter = cache.getStats();
      expect(statsAfter.evictions).toBe(statsBefore.evictions);
    });
  });

  describe('clearUser on non-existent user', () => {
    it('does nothing when user is not cached', () => {
      const statsBefore = cache.getStats();
      cache.clearUser('nobody');
      const statsAfter = cache.getStats();
      expect(statsAfter.userCount).toBe(statsBefore.userCount);
    });
  });

  // ─── invalidateAll ───────────────────────────────────────
  describe('invalidateAll', () => {
    it('increments evictions by number of entries', async () => {
      await cache.addConversation('u1', makeEntry());
      await cache.addConversation('u2', makeEntry());
      cache.invalidateAll();
      const stats = cache.getStats();
      expect(stats.evictions).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── getStats hitRate calculation ────────────────────────
  describe('getStats hitRate', () => {
    it('calculates percentage correctly', async () => {
      await cache.addConversation('u1', makeEntry());
      await cache.getRecentConversations('u1'); // hit
      await cache.getRecentConversations('u1'); // hit
      await cache.getRecentConversations('u1'); // hit
      await cache.getRecentConversations('missing'); // miss

      const stats = cache.getStats();
      // 3 hits, 1 miss = 75%
      expect(stats.hitRate).toBe('75.0%');
    });
  });

  // ─── dispose twice is safe ───────────────────────────────
  describe('dispose', () => {
    it('is safe to call twice', () => {
      cache.dispose();
      expect(() => cache.dispose()).not.toThrow();
    });

    it('clears the cleanup timer', () => {
      const spy = vi.spyOn(global, 'clearInterval');
      cache.dispose();
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  // ─── updateConversations triggers eviction ───────────────
  describe('updateConversations', () => {
    it('triggers eviction when adding new user to full cache', async () => {
      // maxUsers = 3
      await cache.addConversation('u1', makeEntry());
      await cache.addConversation('u2', makeEntry());
      await cache.addConversation('u3', makeEntry());

      // updateConversations for a new user should trigger eviction
      await cache.updateConversations('u4', [makeEntry(), makeEntry()]);
      const stats = cache.getStats();
      expect(stats.evictions).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── addConversation for existing user doesn't increment userCount again ──
  describe('addConversation', () => {
    it('does not increment userCount for existing user', async () => {
      await cache.addConversation('u1', makeEntry());
      await cache.addConversation('u1', makeEntry());
      const stats = cache.getStats();
      expect(stats.userCount).toBe(1);
    });
  });

  // ─── getRecentConversations after TTL expiration ─────────
  describe('TTL expiration on get', () => {
    it('evicts expired entry and increments misses and evictions', async () => {
      const tinyTtl = new ShortTermMemoryCache({
        maxUsers: 10,
        conversationsPerUser: 10,
        ttl: 1,
        maxSize: 10 * 1024 * 1024,
      });

      await tinyTtl.addConversation('u1', makeEntry());
      await new Promise(r => setTimeout(r, 10));

      const result = await tinyTtl.getRecentConversations('u1');
      expect(result).toBeNull();
      const stats = tinyTtl.getStats();
      expect(stats.misses).toBeGreaterThanOrEqual(1);
      expect(stats.evictions).toBeGreaterThanOrEqual(1);
      tinyTtl.dispose();
    });
  });

  // ─── Singleton getShortTermCache / resetShortTermCache ───
  describe('singleton', () => {
    afterEach(() => resetShortTermCache());

    it('passes config on first creation', () => {
      const c = getShortTermCache({ maxUsers: 42 });
      expect(c).toBeDefined();
    });

    it('resetShortTermCache calls dispose', () => {
      const c = getShortTermCache();
      const spy = vi.spyOn(c, 'dispose');
      resetShortTermCache();
      expect(spy).toHaveBeenCalled();
    });

    it('resetShortTermCache is safe when no instance exists', () => {
      // Already reset in afterEach, calling again should be safe
      expect(() => resetShortTermCache()).not.toThrow();
    });
  });
});
