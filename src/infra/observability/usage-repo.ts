/**
 * Persistence layer for LLM token usage events.
 *
 * The in-memory TokenUsageTracker is fast (lock-free counters) but
 * loses everything on process restart. For ops/billing visibility we
 * need durable per-call records. This module appends one row per
 * record() call (SQLite handles 1000s/sec of single-row INSERTs in
 * WAL mode, so no batching needed at current scale).
 *
 * The tracker stays untouched; bootstrap wires its `onRecord`
 * callback to insert() here. If the DB connection is unavailable
 * (test mode, partial init), the tracker still works in pure
 * memory — wiring is opt-in.
 */

import type { SqlDatabase } from '../queue/task-repo';

export interface UsageEvent {
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** Unix epoch seconds. Defaults to "now" via SQLite if omitted. */
  recordedAt?: number;
}

export interface UsageAggregate {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  callCount: number;
  byModel: Record<string, {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    callCount: number;
  }>;
}

export interface DailyBreakdown {
  date: string; // YYYY-MM-DD
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  callCount: number;
}

export class UsageRepo {
  private insertStmt: { run(...params: unknown[]): unknown };

  constructor(private db: SqlDatabase) {
    this.insertStmt = db.prepare(
      'INSERT INTO usage_events (model, prompt_tokens, completion_tokens) VALUES (?, ?, ?)'
    );
  }

  /** Append one usage event. Returns immediately; no batching. */
  insert(event: UsageEvent): void {
    this.insertStmt.run(
      event.model || 'unknown',
      Math.max(0, Math.floor(event.promptTokens || 0)),
      Math.max(0, Math.floor(event.completionTokens || 0)),
    );
  }

  /**
   * Aggregate usage since N seconds ago.
   * Used by /stats to show "last 24h" / "last 7d" totals separately
   * from "since process start". Negative or zero seconds returns the
   * lifetime total.
   */
  getAggregateSince(seconds: number): UsageAggregate {
    const sinceFilter = seconds > 0
      ? `WHERE recorded_at >= strftime('%s', 'now') - ?`
      : '';
    const params = seconds > 0 ? [seconds] : [];

    // Totals
    const totalsRow = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(prompt_tokens), 0) AS prompt,
          COALESCE(SUM(completion_tokens), 0) AS completion,
          COUNT(*) AS calls
        FROM usage_events ${sinceFilter}`
      )
      .get(...params) as { prompt: number; completion: number; calls: number };

    // Per-model breakdown
    const byModelRows = this.db
      .prepare(
        `SELECT model,
          COALESCE(SUM(prompt_tokens), 0) AS prompt,
          COALESCE(SUM(completion_tokens), 0) AS completion,
          COUNT(*) AS calls
        FROM usage_events ${sinceFilter}
        GROUP BY model`
      )
      .all(...params) as Array<{ model: string; prompt: number; completion: number; calls: number }>;

    const byModel: UsageAggregate['byModel'] = {};
    for (const r of byModelRows) {
      byModel[r.model] = {
        promptTokens: r.prompt,
        completionTokens: r.completion,
        totalTokens: r.prompt + r.completion,
        callCount: r.calls,
      };
    }

    return {
      promptTokens: totalsRow.prompt,
      completionTokens: totalsRow.completion,
      totalTokens: totalsRow.prompt + totalsRow.completion,
      callCount: totalsRow.calls,
      byModel,
    };
  }

  /**
   * Daily totals for the last N days. Useful for cost charts. Days
   * with no usage are omitted (caller fills gaps if needed).
   */
  getDailyBreakdown(daysBack: number): DailyBreakdown[] {
    if (daysBack <= 0) return [];
    const rows = this.db
      .prepare(
        `SELECT
          strftime('%Y-%m-%d', recorded_at, 'unixepoch') AS date,
          COALESCE(SUM(prompt_tokens), 0) AS prompt,
          COALESCE(SUM(completion_tokens), 0) AS completion,
          COUNT(*) AS calls
        FROM usage_events
        WHERE recorded_at >= strftime('%s', 'now') - ?
        GROUP BY date
        ORDER BY date ASC`
      )
      .all(daysBack * 86400) as Array<{ date: string; prompt: number; completion: number; calls: number }>;

    return rows.map(r => ({
      date: r.date,
      promptTokens: r.prompt,
      completionTokens: r.completion,
      totalTokens: r.prompt + r.completion,
      callCount: r.calls,
    }));
  }
}
