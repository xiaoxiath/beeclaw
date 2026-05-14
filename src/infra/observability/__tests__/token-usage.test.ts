import { describe, it, expect, beforeEach } from 'vitest';
import {
  TokenUsageTracker,
  getTokenUsageTracker,
  resetTokenUsageTracker,
} from '../token-usage';

describe('TokenUsageTracker', () => {
  let tracker: TokenUsageTracker;
  beforeEach(() => { tracker = new TokenUsageTracker(); });

  it('starts at zero with empty per-model breakdown', () => {
    const s = tracker.snapshot();
    expect(s.promptTokens).toBe(0);
    expect(s.completionTokens).toBe(0);
    expect(s.totalTokens).toBe(0);
    expect(s.callCount).toBe(0);
    expect(s.lastRecordedAt).toBeNull();
    expect(s.byModel).toEqual({});
  });

  it('aggregates across multiple records', () => {
    tracker.record({ model: 'fast', promptTokens: 10, completionTokens: 5 });
    tracker.record({ model: 'fast', promptTokens: 20, completionTokens: 8 });
    tracker.record({ model: 'main', promptTokens: 100, completionTokens: 50 });

    const s = tracker.snapshot();
    expect(s.promptTokens).toBe(130);
    expect(s.completionTokens).toBe(63);
    expect(s.totalTokens).toBe(193);
    expect(s.callCount).toBe(3);
    expect(s.byModel.fast).toEqual({
      promptTokens: 30, completionTokens: 13, totalTokens: 43, callCount: 2,
    });
    expect(s.byModel.main).toEqual({
      promptTokens: 100, completionTokens: 50, totalTokens: 150, callCount: 1,
    });
  });

  it('updates lastRecordedAt on every record', () => {
    expect(tracker.snapshot().lastRecordedAt).toBeNull();
    tracker.record({ model: 'm', promptTokens: 1, completionTokens: 1 });
    const ts1 = tracker.snapshot().lastRecordedAt;
    expect(ts1).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('treats negative, NaN, or undefined token counts as 0 but still bumps callCount', () => {
    tracker.record({ model: 'm', promptTokens: -5, completionTokens: NaN });
    tracker.record({ model: 'm', promptTokens: Infinity, completionTokens: 10 });
    tracker.record({ model: 'm', promptTokens: undefined as unknown as number, completionTokens: 5 });

    const s = tracker.snapshot();
    expect(s.promptTokens).toBe(0);
    expect(s.completionTokens).toBe(15);
    expect(s.callCount).toBe(3);
  });

  it('floors fractional token counts', () => {
    tracker.record({ model: 'm', promptTokens: 10.7, completionTokens: 5.9 });
    const s = tracker.snapshot();
    expect(s.promptTokens).toBe(10);
    expect(s.completionTokens).toBe(5);
  });

  it('falls back to "unknown" when model name is empty', () => {
    tracker.record({ model: '', promptTokens: 7, completionTokens: 3 });
    const s = tracker.snapshot();
    expect(s.byModel.unknown).toEqual({
      promptTokens: 7, completionTokens: 3, totalTokens: 10, callCount: 1,
    });
  });

  it('snapshot is a copy — mutating it does not affect the tracker', () => {
    tracker.record({ model: 'm', promptTokens: 10, completionTokens: 5 });
    const s = tracker.snapshot();
    s.promptTokens = 99999;
    s.byModel.m.promptTokens = 99999;
    const s2 = tracker.snapshot();
    expect(s2.promptTokens).toBe(10);
    expect(s2.byModel.m.promptTokens).toBe(10);
  });

  it('reset() clears everything', () => {
    tracker.record({ model: 'm', promptTokens: 100, completionTokens: 50 });
    tracker.reset();
    const s = tracker.snapshot();
    expect(s.promptTokens).toBe(0);
    expect(s.callCount).toBe(0);
    expect(s.lastRecordedAt).toBeNull();
    expect(s.byModel).toEqual({});
  });
});

describe('getTokenUsageTracker / resetTokenUsageTracker', () => {
  it('returns a singleton across calls', () => {
    resetTokenUsageTracker();
    const a = getTokenUsageTracker();
    const b = getTokenUsageTracker();
    expect(a).toBe(b);
    a.record({ model: 'm', promptTokens: 1, completionTokens: 1 });
    expect(b.snapshot().promptTokens).toBe(1);
    resetTokenUsageTracker();
  });

  it('resetTokenUsageTracker creates a fresh instance', () => {
    resetTokenUsageTracker();
    const a = getTokenUsageTracker();
    a.record({ model: 'm', promptTokens: 100, completionTokens: 50 });
    resetTokenUsageTracker();
    const b = getTokenUsageTracker();
    expect(b).not.toBe(a);
    expect(b.snapshot().promptTokens).toBe(0);
  });
});
