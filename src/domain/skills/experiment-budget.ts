import type { BudgetConfig } from '../../infra/config/resilience-config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Point-in-time consumption snapshot across every tracked dimension. */
export interface BudgetSnapshot {
  tokens: number;
  toolCalls: number;
  wallClockMs: number;
  llmCalls: number;
}

export interface BudgetReport {
  consumed: BudgetSnapshot;
  limits: BudgetSnapshot;
  elapsedMs: number;
  exhausted: boolean;
}

// ---------------------------------------------------------------------------
// ExperimentBudget
// ---------------------------------------------------------------------------

/**
 * Lightweight experiment budget manager.
 *
 * Tracks consumption across four dimensions (tokens, tool-calls, wall-clock
 * time, LLM calls) and answers the single question: "should we stop?"
 */
export class ExperimentBudget {
  private readonly limits: BudgetSnapshot;
  private readonly consumed: BudgetSnapshot = {
    tokens: 0,
    toolCalls: 0,
    wallClockMs: 0,
    llmCalls: 0,
  };
  private readonly startTime: number;

  constructor(
    config: Pick<BudgetConfig, 'maxTokens' | 'maxToolCalls' | 'maxWallTimeMs'>,
  ) {
    this.limits = {
      tokens: config.maxTokens,
      toolCalls: config.maxToolCalls,
      wallClockMs: config.maxWallTimeMs,
      llmCalls: Infinity, // no explicit config field – effectively unbounded
    };
    this.startTime = Date.now();
  }

  /** Record consumption against a single dimension. */
  record(dimension: keyof BudgetSnapshot, amount: number): void {
    this.consumed[dimension] += amount;
  }

  /**
   * Convenience: record a single LLM call with its token cost and wall-clock time.
   * Increments tokens, wallClockMs, and llmCalls in one call.
   */
  recordLLMCall(tokens: number, wallClockMs: number): void {
    this.consumed.tokens += tokens;
    this.consumed.wallClockMs += wallClockMs;
    this.consumed.llmCalls += 1;
  }

  /** Returns `true` when **any** dimension has hit its limit. */
  isExhausted(): boolean {
    const elapsed = Date.now() - this.startTime;
    return (
      this.consumed.tokens >= this.limits.tokens ||
      this.consumed.toolCalls >= this.limits.toolCalls ||
      elapsed >= this.limits.wallClockMs ||
      this.consumed.llmCalls >= this.limits.llmCalls
    );
  }

  /** Produce a full report of current budget state. */
  getReport(): BudgetReport {
    const elapsedMs = Date.now() - this.startTime;
    return {
      consumed: { ...this.consumed },
      limits: { ...this.limits },
      elapsedMs,
      exhausted: this.isExhausted(),
    };
  }
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/** Common budget presets for different experiment depths. */
export const EXPERIMENT_BUDGET_PRESETS = {
  quick: {
    maxTokens: 4_000,
    maxToolCalls: 10,
    maxWallTimeMs: 30_000, // 30 s
  },
  standard: {
    maxTokens: 16_000,
    maxToolCalls: 40,
    maxWallTimeMs: 120_000, // 2 min
  },
  deep: {
    maxTokens: 64_000,
    maxToolCalls: 120,
    maxWallTimeMs: 600_000, // 10 min
  },
} as const satisfies Record<
  string,
  Pick<BudgetConfig, 'maxTokens' | 'maxToolCalls' | 'maxWallTimeMs'>
>;
