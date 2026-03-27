import { describe, it, expect, beforeEach } from 'bun:test';
import { MemoryCache } from '../index';

describe('MemoryCache', () => {
  let cache: MemoryCache;

  beforeEach(() => {
    cache = new MemoryCache();
  });

  describe('set / get', () => {
    it('should store and retrieve a value', () => {
      cache.set('key', 'value');
      expect(cache.get('key')).toBe('value');
    });

    it('should store different types', () => {
      cache.set('str', 'hello');
      cache.set('num', 42);
      cache.set('bool', true);
      cache.set('obj', { a: 1 });
      cache.set('arr', [1, 2, 3]);

      expect(cache.get('str')).toBe('hello');
      expect(cache.get('num')).toBe(42);
      expect(cache.get('bool')).toBe(true);
      expect(cache.get('obj')).toEqual({ a: 1 });
      expect(cache.get('arr')).toEqual([1, 2, 3]);
    });

    it('should return undefined for non-existent key', () => {
      expect(cache.get('missing')).toBeUndefined();
    });

    it('should overwrite existing values', () => {
      cache.set('key', 'first');
      cache.set('key', 'second');
      expect(cache.get('key')).toBe('second');
    });

    it('should respect TTL', async () => {
      cache.set('expiring', 'value', 0.1); // 100ms TTL
      expect(cache.get('expiring')).toBe('value');

      await new Promise(r => setTimeout(r, 150));
      expect(cache.get('expiring')).toBeUndefined();
    });

    it('should not expire items without TTL', async () => {
      cache.set('permanent', 'value');
      await new Promise(r => setTimeout(r, 50));
      expect(cache.get('permanent')).toBe('value');
    });
  });

  describe('delete', () => {
    it('should delete existing key', () => {
      cache.set('key', 'value');
      expect(cache.delete('key')).toBe(true);
      expect(cache.get('key')).toBeUndefined();
    });

    it('should return false for non-existent key', () => {
      expect(cache.delete('missing')).toBe(false);
    });
  });

  describe('has', () => {
    it('should return true for existing key', () => {
      cache.set('key', 'value');
      expect(cache.has('key')).toBe(true);
    });

    it('should return false for non-existent key', () => {
      expect(cache.has('missing')).toBe(false);
    });

    it('should return false for expired key', async () => {
      cache.set('expiring', 'value', 0.1);
      await new Promise(r => setTimeout(r, 150));
      expect(cache.has('expiring')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.get('a')).toBeUndefined();
    });
  });

  describe('size', () => {
    it('should return 0 for empty cache', () => {
      expect(cache.size).toBe(0);
    });

    it('should return correct count', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      expect(cache.size).toBe(2);
    });
  });

  describe('cleanup', () => {
    it('should remove expired entries', async () => {
      cache.set('expire1', 'a', 0.1);
      cache.set('expire2', 'b', 0.1);
      cache.set('permanent', 'c');

      await new Promise(r => setTimeout(r, 150));
      const cleaned = cache.cleanup();
      expect(cleaned).toBe(2);
      expect(cache.size).toBe(1);
      expect(cache.get('permanent')).toBe('c');
    });

    it('should return 0 when nothing to clean', () => {
      cache.set('a', 1);
      const cleaned = cache.cleanup();
      expect(cleaned).toBe(0);
    });
  });

  describe('getOrSet', () => {
    it('should return cached value if exists', async () => {
      cache.set('key', 'cached');
      const factory = () => 'computed';
      const result = await cache.getOrSet('key', factory);
      expect(result).toBe('cached');
    });

    it('should compute and cache if not exists', async () => {
      const result = await cache.getOrSet('key', () => 'computed');
      expect(result).toBe('computed');
      expect(cache.get('key')).toBe('computed');
    });

    it('should handle async factory', async () => {
      const result = await cache.getOrSet('key', async () => {
        return 'async-value';
      });
      expect(result).toBe('async-value');
    });

    it('should respect TTL parameter', async () => {
      await cache.getOrSet('key', () => 'value', 0.1);
      expect(cache.get('key')).toBe('value');

      await new Promise(r => setTimeout(r, 150));
      expect(cache.get('key')).toBeUndefined();
    });
  });

  describe('eviction', () => {
    it('should evict entries when max size exceeded', () => {
      const smallCache = new MemoryCache(3);
      smallCache.set('a', 1);
      smallCache.set('b', 2);
      smallCache.set('c', 3);
      smallCache.set('d', 4); // triggers eviction

      expect(smallCache.size).toBeLessThanOrEqual(3);
      expect(smallCache.get('d')).toBe(4); // newest should be present
    });

    it('should evict expired entries first', async () => {
      const smallCache = new MemoryCache(3);
      smallCache.set('a', 1, 0.05); // will expire
      smallCache.set('b', 2);
      smallCache.set('c', 3);

      await new Promise(r => setTimeout(r, 100));
      smallCache.set('d', 4); // triggers eviction, 'a' should be removed first

      expect(smallCache.get('d')).toBe(4);
    });
  });
});
