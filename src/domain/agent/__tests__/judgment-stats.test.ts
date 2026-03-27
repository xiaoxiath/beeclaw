import { describe, test, expect, vi } from 'vitest';
import { JudgmentStatsTracker } from '../judgment-stats';

describe('JudgmentStatsTracker', () => {
  test('should track basic stats', () => {
    const tracker = new JudgmentStatsTracker();

    tracker.incrementTotalJudgments();
    tracker.incrementLlmCalls();
    tracker.incrementCacheHits();
    tracker.incrementErrors();

    const stats = tracker.getStats();

    expect(stats.totalJudgments).toBe(1);
    expect(stats.llmCalls).toBe(1);
    expect(stats.cacheHits).toBe(1);
    expect(stats.errors).toBe(1);
    expect(stats.errorRate).toBe('100.0%');
  });

  test('should calculate error rate correctly', () => {
    const tracker = new JudgmentStatsTracker();

    tracker.incrementTotalJudgments();
    tracker.incrementTotalJudgments();
    tracker.incrementTotalJudgments();
    tracker.incrementErrors();

    const stats = tracker.getStats();

    expect(stats.totalJudgments).toBe(3);
    expect(stats.errors).toBe(1);
    expect(stats.errorRate).toBe('33.3%');
  });

  test('should handle zero totalJudgments', () => {
    const tracker = new JudgmentStatsTracker();

    const stats = tracker.getStats();

    expect(stats.totalJudgments).toBe(0);
    expect(stats.errorRate).toBe('0.0%');
  });
});
