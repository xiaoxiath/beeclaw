/**
 * TokenUsageTracker persistence + hydration hooks.
 *
 * Verifies the new optional onRecord callback (so the existing
 * memory-only behavior stays the default) and hydrateFrom() (so
 * /stats reflects rolling history rather than restarting at 0
 * every process boot).
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { TokenUsageTracker } from '../token-usage';

let tracker: TokenUsageTracker;
beforeEach(() => {
  tracker = new TokenUsageTracker();
});

describe('TokenUsageTracker.setPersistence', () => {
  test('callback fires on every record() with sanitized delta', () => {
    const persist = vi.fn();
    tracker.setPersistence(persist);

    tracker.record({ model: 'm1', promptTokens: 100, completionTokens: 50 });
    tracker.record({ model: 'm2', promptTokens: 30, completionTokens: 10 });

    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenNthCalledWith(1, {
      model: 'm1', promptTokens: 100, completionTokens: 50,
    });
    expect(persist).toHaveBeenNthCalledWith(2, {
      model: 'm2', promptTokens: 30, completionTokens: 10,
    });
  });

  test('callback receives sanitized values (negatives/non-finite clamped)', () => {
    const persist = vi.fn();
    tracker.setPersistence(persist);

    tracker.record({ model: 'm', promptTokens: -10, completionTokens: NaN as any });
    expect(persist).toHaveBeenCalledWith({
      model: 'm', promptTokens: 0, completionTokens: 0,
    });
  });

  test('persistence throw is swallowed — chat loop must never stall', () => {
    tracker.setPersistence(() => {
      throw new Error('DB locked');
    });

    expect(() =>
      tracker.record({ model: 'm', promptTokens: 1, completionTokens: 1 })
    ).not.toThrow();

    // In-memory counters still update despite the failed persist.
    const snap = tracker.snapshot();
    expect(snap.callCount).toBe(1);
    expect(snap.totalTokens).toBe(2);
  });

  test('default behavior (no callback) unchanged — pure in-memory', () => {
    // No setPersistence() call at all.
    tracker.record({ model: 'm', promptTokens: 5, completionTokens: 5 });
    const snap = tracker.snapshot();
    expect(snap.callCount).toBe(1);
    expect(snap.totalTokens).toBe(10);
  });

  test('replacing the callback discards the old one', () => {
    const first = vi.fn();
    const second = vi.fn();
    tracker.setPersistence(first);
    tracker.setPersistence(second);

    tracker.record({ model: 'm', promptTokens: 1, completionTokens: 1 });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('TokenUsageTracker.hydrateFrom', () => {
  test('adds aggregate to in-memory counters (used at startup)', () => {
    tracker.hydrateFrom({
      promptTokens: 1000,
      completionTokens: 500,
      callCount: 5,
      byModel: {
        'gpt-4': { promptTokens: 800, completionTokens: 400, totalTokens: 1200, callCount: 3 },
        'claude': { promptTokens: 200, completionTokens: 100, totalTokens: 300, callCount: 2 },
      },
    });

    const snap = tracker.snapshot();
    expect(snap.promptTokens).toBe(1000);
    expect(snap.completionTokens).toBe(500);
    expect(snap.totalTokens).toBe(1500);
    expect(snap.callCount).toBe(5);
    expect(snap.byModel['gpt-4']).toEqual({
      promptTokens: 800, completionTokens: 400, totalTokens: 1200, callCount: 3,
    });
  });

  test('hydrate then record() composes correctly', () => {
    tracker.hydrateFrom({
      promptTokens: 100,
      completionTokens: 50,
      callCount: 1,
      byModel: { 'm': { promptTokens: 100, completionTokens: 50, totalTokens: 150, callCount: 1 } },
    });

    tracker.record({ model: 'm', promptTokens: 10, completionTokens: 5 });

    const snap = tracker.snapshot();
    expect(snap.promptTokens).toBe(110);
    expect(snap.completionTokens).toBe(55);
    expect(snap.callCount).toBe(2);
    expect(snap.byModel.m.callCount).toBe(2);
    expect(snap.byModel.m.totalTokens).toBe(165);
  });

  test('hydrate merges into existing per-model stats (not replaces)', () => {
    tracker.record({ model: 'm', promptTokens: 5, completionTokens: 5 });
    tracker.hydrateFrom({
      promptTokens: 100,
      completionTokens: 50,
      callCount: 1,
      byModel: { 'm': { promptTokens: 100, completionTokens: 50, totalTokens: 150, callCount: 1 } },
    });

    const snap = tracker.snapshot();
    expect(snap.byModel.m.promptTokens).toBe(105);
    expect(snap.byModel.m.callCount).toBe(2);
  });

  test('empty aggregate is a no-op', () => {
    tracker.record({ model: 'x', promptTokens: 1, completionTokens: 1 });
    tracker.hydrateFrom({ promptTokens: 0, completionTokens: 0, callCount: 0, byModel: {} });
    const snap = tracker.snapshot();
    expect(snap.callCount).toBe(1);
    expect(snap.totalTokens).toBe(2);
  });
});
