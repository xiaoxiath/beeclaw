/**
 * Real-SQL tests for the usage_events repo.
 *
 * Uses node:sqlite (Node 24+) so we exercise the same prepared-
 * statement API the production bun:sqlite path uses.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.unmock('fs');

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { UsageRepo } from '../usage-repo';
import type { SqlDatabase } from '../../queue/task-repo';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    recorded_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );
  CREATE INDEX IF NOT EXISTS usage_events_recorded_at_idx ON usage_events(recorded_at);
  CREATE INDEX IF NOT EXISTS usage_events_model_idx ON usage_events(model);
`;

function makeDb(): { db: SqlDatabase; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA);
  return { db: raw as unknown as SqlDatabase, raw };
}

describe('UsageRepo.insert', () => {
  test('appends a single row with the given model + token counts', () => {
    const { db, raw } = makeDb();
    const repo = new UsageRepo(db);

    repo.insert({ model: 'gpt-4', promptTokens: 100, completionTokens: 50 });

    const rows = raw.prepare('SELECT * FROM usage_events').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].model).toBe('gpt-4');
    expect(rows[0].prompt_tokens).toBe(100);
    expect(rows[0].completion_tokens).toBe(50);
    expect(rows[0].recorded_at).toBeGreaterThan(0);
  });

  test('coerces missing model → "unknown"', () => {
    const { db, raw } = makeDb();
    new UsageRepo(db).insert({ model: '', promptTokens: 1, completionTokens: 2 });
    const r = raw.prepare('SELECT model FROM usage_events').get() as any;
    expect(r.model).toBe('unknown');
  });

  test('clamps negative / non-finite token counts to 0', () => {
    const { db, raw } = makeDb();
    const repo = new UsageRepo(db);
    repo.insert({ model: 'm', promptTokens: -10, completionTokens: NaN as any });
    repo.insert({ model: 'm', promptTokens: 1.7, completionTokens: 2.9 });
    const rows = raw.prepare('SELECT prompt_tokens, completion_tokens FROM usage_events ORDER BY id').all() as any[];
    expect(rows[0]).toEqual({ prompt_tokens: 0, completion_tokens: 0 });
    expect(rows[1]).toEqual({ prompt_tokens: 1, completion_tokens: 2 }); // floored
  });
});

describe('UsageRepo.getAggregateSince', () => {
  test('totals across all events when seconds <= 0 (lifetime)', () => {
    const { db } = makeDb();
    const repo = new UsageRepo(db);
    repo.insert({ model: 'a', promptTokens: 100, completionTokens: 10 });
    repo.insert({ model: 'b', promptTokens: 50, completionTokens: 5 });

    const agg = repo.getAggregateSince(0);
    expect(agg.promptTokens).toBe(150);
    expect(agg.completionTokens).toBe(15);
    expect(agg.totalTokens).toBe(165);
    expect(agg.callCount).toBe(2);
    expect(agg.byModel).toEqual({
      a: { promptTokens: 100, completionTokens: 10, totalTokens: 110, callCount: 1 },
      b: { promptTokens: 50, completionTokens: 5, totalTokens: 55, callCount: 1 },
    });
  });

  test('groups by model correctly with multiple calls per model', () => {
    const { db } = makeDb();
    const repo = new UsageRepo(db);
    repo.insert({ model: 'gpt-4', promptTokens: 100, completionTokens: 50 });
    repo.insert({ model: 'gpt-4', promptTokens: 200, completionTokens: 100 });
    repo.insert({ model: 'claude', promptTokens: 30, completionTokens: 20 });

    const agg = repo.getAggregateSince(0);
    expect(agg.callCount).toBe(3);
    expect(agg.byModel['gpt-4']).toEqual({
      promptTokens: 300, completionTokens: 150, totalTokens: 450, callCount: 2,
    });
    expect(agg.byModel.claude).toEqual({
      promptTokens: 30, completionTokens: 20, totalTokens: 50, callCount: 1,
    });
  });

  test('time filter excludes events older than the window', () => {
    const { db, raw } = makeDb();
    const repo = new UsageRepo(db);

    // Manually insert one row 10 days ago, one "now"
    const tenDaysAgo = Math.floor(Date.now() / 1000) - 10 * 86400;
    raw.prepare('INSERT INTO usage_events (model, prompt_tokens, completion_tokens, recorded_at) VALUES (?, ?, ?, ?)')
      .run('old', 1000, 0, tenDaysAgo);
    repo.insert({ model: 'new', promptTokens: 50, completionTokens: 0 });

    const last7d = repo.getAggregateSince(7 * 86400);
    expect(last7d.callCount).toBe(1);
    expect(last7d.byModel.new).toBeDefined();
    expect(last7d.byModel.old).toBeUndefined();

    const lifetime = repo.getAggregateSince(0);
    expect(lifetime.callCount).toBe(2);
  });

  test('returns zero-baseline when no events exist', () => {
    const { db } = makeDb();
    const agg = new UsageRepo(db).getAggregateSince(86400);
    expect(agg).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      callCount: 0,
      byModel: {},
    });
  });
});

describe('UsageRepo.getDailyBreakdown', () => {
  test('groups by date over the requested window', () => {
    const { db, raw } = makeDb();
    const repo = new UsageRepo(db);

    const now = Math.floor(Date.now() / 1000);
    const yesterday = now - 86400;
    const twoDaysAgo = now - 2 * 86400;

    // 2 events yesterday, 1 today, 1 two days ago
    raw.prepare('INSERT INTO usage_events (model, prompt_tokens, completion_tokens, recorded_at) VALUES (?, ?, ?, ?)')
      .run('m', 100, 10, yesterday);
    raw.prepare('INSERT INTO usage_events (model, prompt_tokens, completion_tokens, recorded_at) VALUES (?, ?, ?, ?)')
      .run('m', 200, 20, yesterday);
    raw.prepare('INSERT INTO usage_events (model, prompt_tokens, completion_tokens, recorded_at) VALUES (?, ?, ?, ?)')
      .run('m', 50, 5, twoDaysAgo);
    repo.insert({ model: 'm', promptTokens: 30, completionTokens: 3 });

    const breakdown = repo.getDailyBreakdown(7);
    // Three distinct dates expected
    expect(breakdown.length).toBeGreaterThanOrEqual(3);
    // Today's entry
    const todayStr = new Date(now * 1000).toISOString().slice(0, 10);
    const todayRow = breakdown.find(r => r.date === todayStr);
    expect(todayRow?.callCount).toBe(1);
    expect(todayRow?.totalTokens).toBe(33);
  });

  test('returns empty array when daysBack <= 0', () => {
    const { db } = makeDb();
    expect(new UsageRepo(db).getDailyBreakdown(0)).toEqual([]);
    expect(new UsageRepo(db).getDailyBreakdown(-5)).toEqual([]);
  });
});
