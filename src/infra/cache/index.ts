/**
 * Simple In-Memory Cache
 *
 * Basic key-value cache with TTL support
 */

interface CacheEntry<T> {
  value: T;
  expiresAt?: number;
}

class MemoryCache {
  private store = new Map<string, CacheEntry<any>>();
  private maxSize: number;

  constructor(maxSize = 10000) {
    this.maxSize = maxSize;
  }

  /**
   * Set a value in the cache
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttlSeconds - Time to live in seconds (optional)
   */
  set<T>(key: string, value: T, ttlSeconds?: number): void {
    if (this.store.size >= this.maxSize) {
      this.evict();
    }
    const entry: CacheEntry<T> = {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
    };
    this.store.set(key, entry);
  }

  /**
   * Get a value from the cache
   * @param key - Cache key
   * @returns The cached value or undefined if not found/expired
   */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);

    if (!entry) {
      return undefined;
    }

    // Check if expired
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  /**
   * Delete a value from the cache
   * @param key - Cache key
   */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /**
   * Check if a key exists in the cache
   * @param key - Cache key
   */
  has(key: string): boolean {
    const entry = this.store.get(key);

    if (!entry) {
      return false;
    }

    // Check if expired
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Clear all cached values
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Get the number of entries in the cache
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * Clean up expired entries
   */

  /**
   * Get a cached value or compute and cache it
   * @param key - Cache key
   * @param factory - Function to compute the value if not cached
   * @param ttlSeconds - Time to live in seconds (optional)
   * @returns The cached or newly computed value
   */
  async getOrSet<T>(key: string, factory: () => T | Promise<T>, ttlSeconds?: number): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;
    const value = await factory();
    this.set(key, value, ttlSeconds);
    return value;
  }
  cleanup(): number {
    let cleaned = 0;
    const now = Date.now();

    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.store.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Evict entries when cache exceeds maxSize.
   * First removes expired entries, then removes oldest entries if still over limit.
   */
  private evict(): void {
    // First pass: remove expired
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.store.delete(key);
      }
    }
    // Second pass: if still over limit, remove oldest entries
    if (this.store.size >= this.maxSize) {
      const excess = this.store.size - this.maxSize + 1;
      const keys = [...this.store.keys()];
      for (let i = 0; i < excess; i++) {
        this.store.delete(keys[i]);
      }
    }
  }
}

// Export singleton instance
export const cache = new MemoryCache();

// Also export the class for testing
export { MemoryCache };
