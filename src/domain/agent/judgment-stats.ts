/**
 * Judgment Stats Tracker
 *
 * 通用统计追踪器，用于所有基于 FastLLMJudge 的选择器
 */

export interface JudgmentStats {
  totalJudgments: number;
  llmCalls: number;
  cacheHits: number;
  errors: number;
}

export class JudgmentStatsTracker {
  private stats: JudgmentStats = {
    totalJudgments: 0,
    llmCalls: 0,
    cacheHits: 0,
    errors: 0,
  };

  incrementTotalJudgments(): void {
    this.stats.totalJudgments++;
  }

  incrementLlmCalls(): void {
    this.stats.llmCalls++;
  }

  incrementCacheHits(): void {
    this.stats.cacheHits++;
  }

  incrementErrors(): void {
    this.stats.errors++;
  }

  getStats(): JudgmentStats & { errorRate: string } {
    return {
      ...this.stats,
      errorRate: `${((this.stats.errors / this.stats.totalJudgments) * 100 || 0).toFixed(1)}%`,
    };
  }
}
