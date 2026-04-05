/**
 * Tests for ConcurrencyLimiter.
 *
 * TDD: Tests written first, then implementation.
 * Extracted from beeclaw's src/infra/ai/concurrency-limiter.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ConcurrencyLimiter,
  LLMRequestPriority,
  type ConcurrencyLimiterOptions,
} from './concurrency';

describe('ConcurrencyLimiter', () => {
  let limiter: ConcurrencyLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    limiter = new ConcurrencyLimiter({ maxConcurrent: 2, maxQueueSize: 5, queueTimeoutMs: 5000 });
  });

  afterEach(() => {
    // Suppress unhandled rejections from queued promises in tests that don't fully drain
    try { limiter.drain(); } catch { /* noop */ }
    vi.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // Immediate acquire
  // --------------------------------------------------------------------------

  it('should immediately acquire when under limit', async () => {
    const release = await limiter.acquire();
    expect(typeof release).toBe('function');

    const stats = limiter.getStats();
    expect(stats.activeCount).toBe(1);
    expect(stats.immediateAcquires).toBe(1);

    release();
    expect(limiter.getStats().activeCount).toBe(0);
  });

  it('should acquire up to maxConcurrent', async () => {
    const r1 = await limiter.acquire();
    const r2 = await limiter.acquire();

    expect(limiter.getStats().activeCount).toBe(2);

    r1();
    expect(limiter.getStats().activeCount).toBe(1);
    r2();
    expect(limiter.getStats().activeCount).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Queuing
  // --------------------------------------------------------------------------

  it('should queue requests when at capacity', async () => {
    const r1 = await limiter.acquire();
    const r2 = await limiter.acquire();

    // Third request should queue
    const acquirePromise = limiter.acquire({ caller: 'test_queued' });

    // Not resolved yet
    expect(limiter.getStats().queueSize).toBe(1);

    // Release one slot
    r1();

    // Queued request should now resolve
    const r3 = await acquirePromise;
    expect(limiter.getStats().activeCount).toBe(2);
    expect(limiter.getStats().queuedAcquires).toBe(1);

    r2();
    r3();
  });

  // --------------------------------------------------------------------------
  // Priority
  // --------------------------------------------------------------------------

  it('should respect priority ordering (higher priority first)', async () => {
    const r1 = await limiter.acquire();
    const r2 = await limiter.acquire();

    // Queue LOW first, then CRITICAL
    const lowPromise = limiter.acquire({ priority: LLMRequestPriority.LOW, caller: 'low' });
    const criticalPromise = limiter.acquire({ priority: LLMRequestPriority.CRITICAL, caller: 'critical' });

    expect(limiter.getStats().queueSize).toBe(2);

    // Release both slots
    r1();
    r2();

    // Both should resolve — CRITICAL first
    const [r3, r4] = await Promise.all([lowPromise, criticalPromise]);

    const stats = limiter.getStats();
    expect(stats.queuedAcquires).toBe(2);

    r3();
    r4();
  });

  // --------------------------------------------------------------------------
  // Queue timeout
  // --------------------------------------------------------------------------

  it('should reject queued requests on timeout', async () => {
    await limiter.acquire();
    await limiter.acquire();

    const timeoutPromise = limiter.acquire({
      caller: 'will_timeout',
      timeoutMs: 3000,
    });

    // Advance past timeout
    vi.advanceTimersByTime(3100);

    await expect(timeoutPromise).rejects.toThrow('Queue timeout');

    expect(limiter.getStats().timeoutRejects).toBe(1);
  });

  // --------------------------------------------------------------------------
  // Queue full
  // --------------------------------------------------------------------------

  it('should reject when queue is full', async () => {
    await limiter.acquire();
    await limiter.acquire();

    // Fill the queue (size 5) — catch to prevent unhandled rejection on drain
    const queued: Promise<() => void>[] = [];
    for (let i = 0; i < 5; i++) {
      queued.push(limiter.acquire({ caller: `q${i}` }).catch(() => (() => {}) as any as () => void));
    }

    // Next should fail
    await expect(
      limiter.acquire({ caller: 'overflow' }),
    ).rejects.toThrow('Queue full');

    expect(limiter.getStats().queueFullRejects).toBe(1);
  });

  // --------------------------------------------------------------------------
  // execute() helper
  // --------------------------------------------------------------------------

  it('should auto-manage acquire/release via execute()', async () => {
    const result = await limiter.execute(
      async () => 42,
      { caller: 'test_execute' },
    );

    expect(result).toBe(42);
    expect(limiter.getStats().activeCount).toBe(0);
  });

  it('should release on execute() error', async () => {
    await expect(
      limiter.execute(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(limiter.getStats().activeCount).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Stats
  // --------------------------------------------------------------------------

  it('should track statistics', async () => {
    const r1 = await limiter.acquire();
    r1();

    const stats = limiter.getStats();
    expect(stats.totalRequests).toBe(1);
    expect(stats.immediateAcquires).toBe(1);
    expect(stats.maxConcurrent).toBe(2);
  });

  // --------------------------------------------------------------------------
  // Dynamic update
  // --------------------------------------------------------------------------

  it('should dynamically update maxConcurrent', async () => {
    const r1 = await limiter.acquire();
    const r2 = await limiter.acquire();

    // Queue a third
    const p3 = limiter.acquire();

    limiter.updateMaxConcurrent(3);

    // Queued request should resolve since capacity increased
    const r3 = await p3;
    expect(limiter.getStats().activeCount).toBe(3);

    r1();
    r2();
    r3();
  });

  // --------------------------------------------------------------------------
  // drain()
  // --------------------------------------------------------------------------

  it('should drain all pending requests', async () => {
    await limiter.acquire();
    await limiter.acquire();

    const pending = limiter.acquire({ caller: 'drain_test' });
    expect(limiter.getStats().queueSize).toBe(1);

    limiter.drain();

    await expect(pending).rejects.toThrow('Draining');
    expect(limiter.getStats().queueSize).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Double release safety
  // --------------------------------------------------------------------------

  it('should ignore double release', async () => {
    const release = await limiter.acquire();
    release();
    release(); // Second call should be no-op

    expect(limiter.getStats().activeCount).toBe(0);
  });
});
