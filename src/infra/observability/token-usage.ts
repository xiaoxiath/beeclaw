/**
 * Process-level LLM token usage tracker.
 *
 * Increments are O(1) and lock-free (single-threaded JS). Snapshots are
 * cheap copies, safe to read from any handler. Use this for the /stats
 * endpoint, periodic logging, or quota enforcement at the app layer.
 *
 * Per-model breakdowns are kept so dashboards can attribute cost across
 * tiers (e.g. fast vs. main router).
 */

export interface TokenUsageDelta {
  /** Model identifier as seen by the provider (e.g. "claude-sonnet-4-6"). */
  model: string;
  /** Tokens charged for the input portion of the call. */
  promptTokens: number;
  /** Tokens charged for the generated portion of the call. */
  completionTokens: number;
}

export interface PerModelStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  callCount: number;
}

export interface TokenUsageSnapshot {
  /** Total prompt tokens across all models. */
  promptTokens: number;
  /** Total completion tokens across all models. */
  completionTokens: number;
  /** Sum of prompt + completion. */
  totalTokens: number;
  /** Total successful LLM calls recorded. */
  callCount: number;
  /** ISO timestamp of the most recent record() call (null if never). */
  lastRecordedAt: string | null;
  /** Per-model breakdown. */
  byModel: Record<string, PerModelStats>;
}

export class TokenUsageTracker {
  private promptTokens = 0;
  private completionTokens = 0;
  private callCount = 0;
  private lastRecordedAt: string | null = null;
  private byModel: Map<string, PerModelStats> = new Map();

  /**
   * Optional persistence hook. When set (typically by bootstrap with a
   * SqliteUsageRepo), gets called on every record() with the sanitized
   * delta. Throws are swallowed and logged elsewhere — never let
   * persistence breakage stall the chat loop. When unset, the tracker
   * runs purely in-memory (test mode, partial init).
   */
  private onRecord: ((delta: TokenUsageDelta) => void) | null = null;

  setPersistence(onRecord: (delta: TokenUsageDelta) => void): void {
    this.onRecord = onRecord;
  }

  /** Record a completed LLM call. Negative or non-finite numbers are clamped to 0. */
  record(delta: TokenUsageDelta): void {
    const prompt = sanitize(delta.promptTokens);
    const completion = sanitize(delta.completionTokens);
    if (prompt === 0 && completion === 0) {
      // Still bump callCount so we can distinguish "no calls" from "calls with no usage".
    }

    this.promptTokens += prompt;
    this.completionTokens += completion;
    this.callCount += 1;
    this.lastRecordedAt = new Date().toISOString();

    const key = delta.model || 'unknown';
    const existing = this.byModel.get(key);
    if (existing) {
      existing.promptTokens += prompt;
      existing.completionTokens += completion;
      existing.totalTokens += prompt + completion;
      existing.callCount += 1;
    } else {
      this.byModel.set(key, {
        promptTokens: prompt,
        completionTokens: completion,
        totalTokens: prompt + completion,
        callCount: 1,
      });
    }

    if (this.onRecord) {
      try {
        this.onRecord({ model: key, promptTokens: prompt, completionTokens: completion });
      } catch {
        // Persistence is best-effort — swallow so chat loop never stalls.
        // The repo path itself logs failures.
      }
    }
  }

  /**
   * Hydrate in-memory counters from a persistence aggregate. Useful at
   * startup so /stats reflects "last N days" rather than "since this
   * process booted 30 seconds ago". Adds to existing counters; safe to
   * call multiple times if you accept double-counting.
   */
  hydrateFrom(aggregate: { promptTokens: number; completionTokens: number; callCount: number; byModel: Record<string, { promptTokens: number; completionTokens: number; totalTokens: number; callCount: number }> }): void {
    this.promptTokens += aggregate.promptTokens;
    this.completionTokens += aggregate.completionTokens;
    this.callCount += aggregate.callCount;
    for (const [model, stats] of Object.entries(aggregate.byModel)) {
      const existing = this.byModel.get(model);
      if (existing) {
        existing.promptTokens += stats.promptTokens;
        existing.completionTokens += stats.completionTokens;
        existing.totalTokens += stats.totalTokens;
        existing.callCount += stats.callCount;
      } else {
        this.byModel.set(model, { ...stats });
      }
    }
  }

  snapshot(): TokenUsageSnapshot {
    const byModel: Record<string, PerModelStats> = {};
    for (const [k, v] of this.byModel) {
      byModel[k] = { ...v };
    }
    return {
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      totalTokens: this.promptTokens + this.completionTokens,
      callCount: this.callCount,
      lastRecordedAt: this.lastRecordedAt,
      byModel,
    };
  }

  /** For tests. Production code should never reset live counters. */
  reset(): void {
    this.promptTokens = 0;
    this.completionTokens = 0;
    this.callCount = 0;
    this.lastRecordedAt = null;
    this.byModel.clear();
  }
}

function sanitize(n: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

let singleton: TokenUsageTracker | null = null;

export function getTokenUsageTracker(): TokenUsageTracker {
  if (!singleton) singleton = new TokenUsageTracker();
  return singleton;
}

/** For tests only. */
export function resetTokenUsageTracker(): void {
  singleton = null;
}
