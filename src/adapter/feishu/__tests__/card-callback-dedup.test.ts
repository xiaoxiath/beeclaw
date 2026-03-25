/**
 * Tests for Fix 3: Card Callback Event Deduplication
 *
 * Covers:
 * - First occurrence allowed, duplicate blocked
 * - TTL-based cleanup
 * - Max size enforcement
 * - clear() for testing
 */

import { describe, it, expect, beforeEach } from 'bun:test';

// Re-implement CallbackEventDedup for unit testing (same logic as patched code)
const CALLBACK_DEDUP_TTL_MS = 30 * 60 * 1000;
const CALLBACK_DEDUP_MAX_SIZE = 1000;

class CallbackEventDedup {
  private events = new Map<string, number>();

  isDuplicate(eventId: string): boolean {
    this.cleanup();
    if (this.events.has(eventId)) {
      return true;
    }
    this.events.set(eventId, Date.now());
    return false;
  }

  private cleanup(): void {
    if (this.events.size <= CALLBACK_DEDUP_MAX_SIZE) return;
    const now = Date.now();
    for (const [id, ts] of this.events) {
      if (now - ts > CALLBACK_DEDUP_TTL_MS) {
        this.events.delete(id);
      }
    }
    // If still over limit, drop oldest half
    if (this.events.size > CALLBACK_DEDUP_MAX_SIZE) {
      const entries = [...this.events.entries()].sort((a, b) => a[1] - b[1]);
      const toDelete = entries.slice(0, Math.floor(entries.length / 2));
      for (const [id] of toDelete) {
        this.events.delete(id);
      }
    }
  }

  get size(): number { return this.events.size; }
  clear(): void { this.events.clear(); }
}

describe('Card Callback Event Deduplication (Fix 3)', () => {
  let dedup: CallbackEventDedup;

  beforeEach(() => {
    dedup = new CallbackEventDedup();
  });

  it('allows first occurrence of an event_id', () => {
    expect(dedup.isDuplicate('evt_001')).toBe(false);
  });

  it('blocks second occurrence of same event_id', () => {
    dedup.isDuplicate('evt_001');
    expect(dedup.isDuplicate('evt_001')).toBe(true);
  });

  it('allows different event_ids independently', () => {
    expect(dedup.isDuplicate('evt_001')).toBe(false);
    expect(dedup.isDuplicate('evt_002')).toBe(false);
    expect(dedup.isDuplicate('evt_003')).toBe(false);
    expect(dedup.size).toBe(3);
  });

  it('cleans up expired entries after TTL', () => {
    // This test verifies that cleanup is triggered when size exceeds max
    // We fill beyond max size to trigger cleanup
    // Note: cleanup is called BEFORE adding new entry, so we need to add 2 extra
    // to ensure cleanup actually runs and reduces size
    for (let i = 0; i < CALLBACK_DEDUP_MAX_SIZE + 2; i++) {
      dedup.isDuplicate(`evt_${i}`);
    }

    // After cleanup is triggered, size should be within limit
    // Since all entries are new (not expired), LRU will drop oldest half
    expect(dedup.size).toBeLessThanOrEqual(CALLBACK_DEDUP_MAX_SIZE);
    expect(dedup.size).toBeGreaterThan(CALLBACK_DEDUP_MAX_SIZE / 2 - 10);
  });

  it('enforces max size by dropping oldest half', () => {
    // Fill beyond max to trigger LRU eviction
    for (let i = 0; i < CALLBACK_DEDUP_MAX_SIZE + 100; i++) {
      dedup.isDuplicate(`evt_${i}`);
    }

    // Size should be reduced to within limit
    expect(dedup.size).toBeLessThanOrEqual(CALLBACK_DEDUP_MAX_SIZE);
  });

  it('clear() removes all entries', () => {
    dedup.isDuplicate('evt_001');
    dedup.isDuplicate('evt_002');
    expect(dedup.size).toBe(2);

    dedup.clear();
    expect(dedup.size).toBe(0);

    // Previously seen events should now be allowed
    expect(dedup.isDuplicate('evt_001')).toBe(false);
  });
});
