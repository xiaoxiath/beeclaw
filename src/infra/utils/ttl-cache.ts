/**
 * Shared TTL (Time-To-Live) Cache Implementation
 *
 * Extracted from search/orchestrator.ts and finance/orchestrator.ts
 * to eliminate code duplication.
 */

export interface TTLCacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export interface TTLCacheOptions {
  /** Maximum number of entries (default: 1000) */
  maxSize?: number;
  /** Cleanup threshold (default: 80% of maxSize) */
  cleanupThreshold?: number;
}

/**
 * Generic TTL cache with size limits and LRU eviction
 */
export class TTLCache<T = unknown> {
  private cache: Map<string, TTLCacheEntry<T>> = new Map();
  private maxSize: number;
  private cleanupThreshold: number;

  constructor(options: TTLCacheOptions = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.cleanupThreshold = options.cleanupThreshold ?? Math.floor(this.maxSize * 0.8);
  }

  /**
   * Get a value from the cache if it exists and hasn't expired
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Set a value in the cache with a TTL
   */
  set(key: string, data: T, ttl: number): void {
    // Clean up if approaching size limit
    if (this.cache.size >= this.cleanupThreshold) {
      this.cleanup();
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
  }

  /**
   * Check if a key exists and hasn't expired
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * Delete a key from the cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get current cache size
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Remove expired entries and enforce size limit using LRU strategy
   */
  cleanup(): void {
    const now = Date.now();

    // First pass: remove expired entries
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
      }
    }

    // Second pass: if still over threshold, remove oldest entries (LRU)
    if (this.cache.size > this.maxSize) {
      const entries = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp); // Sort by timestamp (oldest first)

      const toRemove = entries.slice(0, this.cache.size - this.cleanupThreshold);
      for (const [key] of toRemove) {
        this.cache.delete(key);
      }
    }
  }
}
