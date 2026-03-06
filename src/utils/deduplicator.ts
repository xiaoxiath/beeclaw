/**
 * LRU + TTL Message Deduplicator — Bug #6 Fix
 *
 * Problem: Original code used a Set<string> with FIFO eviction (delete oldest
 * when size > 1000). Under burst traffic, frequently re-sent message IDs can
 * be evicted too early, causing duplicate processing.
 *
 * Solution: Map-based deduplication with TTL (time-to-live) expiration.
 */

export interface DeduplicatorOptions {
  maxSize?: number;
  ttlMs?: number;
  cleanupIntervalMs?: number;
}

const DEFAULT_MAX_SIZE = 2000;
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CLEANUP_INTERVAL = 60 * 1000;

export class MessageDeduplicator {
  private seen = new Map<string, number>();
  private maxSize: number;
  private ttlMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: DeduplicatorOptions) {
    this.maxSize = options?.maxSize ?? DEFAULT_MAX_SIZE;
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;

    const cleanupInterval = options?.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL;
    this.cleanupTimer = setInterval(() => this.cleanup(), cleanupInterval);
    if (this.cleanupTimer?.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Check if a message ID is a duplicate.
   * If not seen before, marks it as seen and returns false.
   * If seen and not expired, refreshes timestamp (LRU) and returns true.
   */
  isDuplicate(messageId: string): boolean {
    const now = Date.now();
    const existing = this.seen.get(messageId);

    if (existing !== undefined) {
      if (now - existing < this.ttlMs) {
        this.seen.set(messageId, now); // LRU refresh
        return true;
      }
      this.seen.delete(messageId); // Expired
    }

    this.seen.set(messageId, now);

    if (this.seen.size > this.maxSize) {
      this.evictOldest(Math.floor(this.maxSize * 0.1));
    }

    return false;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [id, timestamp] of this.seen) {
      if (now - timestamp >= this.ttlMs) {
        this.seen.delete(id);
      }
    }
  }

  private evictOldest(count: number): void {
    const entries = [...this.seen.entries()].sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < count && i < entries.length; i++) {
      this.seen.delete(entries[i][0]);
    }
  }

  get size(): number {
    return this.seen.size;
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.seen.clear();
  }
}
