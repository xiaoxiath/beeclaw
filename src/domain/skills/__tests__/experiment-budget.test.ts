import { describe, test, expect, vi } from 'vitest';
import {
  ExperimentBudget,
  EXPERIMENT_BUDGET_PRESETS,
  type BudgetReport,
} from '../experiment-budget';

// ---------------------------------------------------------------------------
// ExperimentBudget
// ---------------------------------------------------------------------------

describe('ExperimentBudget', () => {
  // ── Constructor ──────────────────────────────────────────────────────────

  describe('constructor', () => {
    test('creates with correct limits from config', () => {
      const budget = new ExperimentBudget({
        maxTokens: 10_000,
        maxToolCalls: 20,
        maxWallTimeMs: 60_000,
      });

      const report = budget.getReport();
      expect(report.limits.tokens).toBe(10_000);
      expect(report.limits.toolCalls).toBe(20);
      expect(report.limits.wallClockMs).toBe(60_000);
      // llmCalls has no explicit config field — effectively unbounded
      expect(report.limits.llmCalls).toBe(Infinity);
    });
  });

  // ── record() ─────────────────────────────────────────────────────────────

  describe('record()', () => {
    test('increments the correct dimension — tokens', () => {
      const budget = new ExperimentBudget({
        maxTokens: 10_000,
        maxToolCalls: 20,
        maxWallTimeMs: 60_000,
      });

      budget.record('tokens', 500);
      budget.record('tokens', 300);

      const report = budget.getReport();
      expect(report.consumed.tokens).toBe(800);
      // Other dimensions should remain at 0
      expect(report.consumed.toolCalls).toBe(0);
      expect(report.consumed.llmCalls).toBe(0);
    });

    test('increments the correct dimension — toolCalls', () => {
      const budget = new ExperimentBudget({
        maxTokens: 10_000,
        maxToolCalls: 20,
        maxWallTimeMs: 60_000,
      });

      budget.record('toolCalls', 1);
      budget.record('toolCalls', 1);
      budget.record('toolCalls', 1);

      const report = budget.getReport();
      expect(report.consumed.toolCalls).toBe(3);
      expect(report.consumed.tokens).toBe(0);
    });
  });

  // ── recordLLMCall() ──────────────────────────────────────────────────────

  describe('recordLLMCall()', () => {
    test('increments tokens, wallClockMs, and llmCalls in one call', () => {
      const budget = new ExperimentBudget({
        maxTokens: 10_000,
        maxToolCalls: 20,
        maxWallTimeMs: 60_000,
      });

      budget.recordLLMCall(1500, 200);

      const report = budget.getReport();
      expect(report.consumed.tokens).toBe(1500);
      expect(report.consumed.wallClockMs).toBe(200);
      expect(report.consumed.llmCalls).toBe(1);
    });

    test('accumulates across multiple LLM calls', () => {
      const budget = new ExperimentBudget({
        maxTokens: 10_000,
        maxToolCalls: 20,
        maxWallTimeMs: 60_000,
      });

      budget.recordLLMCall(800, 100);
      budget.recordLLMCall(600, 150);
      budget.recordLLMCall(400, 50);

      const report = budget.getReport();
      expect(report.consumed.tokens).toBe(1800);
      expect(report.consumed.wallClockMs).toBe(300);
      expect(report.consumed.llmCalls).toBe(3);
    });
  });

  // ── isExhausted() ────────────────────────────────────────────────────────

  describe('isExhausted()', () => {
    test('returns false when under all limits', () => {
      const budget = new ExperimentBudget({
        maxTokens: 10_000,
        maxToolCalls: 20,
        maxWallTimeMs: 60_000,
      });

      budget.record('tokens', 100);
      budget.record('toolCalls', 1);

      expect(budget.isExhausted()).toBe(false);
    });

    test('returns true when tokens exceed maxTokens', () => {
      const budget = new ExperimentBudget({
        maxTokens: 1_000,
        maxToolCalls: 20,
        maxWallTimeMs: 60_000,
      });

      budget.record('tokens', 1_000);

      expect(budget.isExhausted()).toBe(true);
    });

    test('returns true when toolCalls exceed maxToolCalls', () => {
      const budget = new ExperimentBudget({
        maxTokens: 10_000,
        maxToolCalls: 3,
        maxWallTimeMs: 60_000,
      });

      budget.record('toolCalls', 3);

      expect(budget.isExhausted()).toBe(true);
    });

    test('returns true when wall clock exceeds maxWallTimeMs', async () => {
      // Use a 1ms budget so it's immediately exhausted after a small delay
      const budget = new ExperimentBudget({
        maxTokens: 10_000,
        maxToolCalls: 20,
        maxWallTimeMs: 1,
      });

      // Wait just enough for the 1ms to elapse
      await new Promise((resolve) => setTimeout(resolve, 5));

      expect(budget.isExhausted()).toBe(true);
    });
  });

  // ── getReport() ──────────────────────────────────────────────────────────

  describe('getReport()', () => {
    test('returns correct consumed, limits, elapsed, and exhausted fields', () => {
      const budget = new ExperimentBudget({
        maxTokens: 5_000,
        maxToolCalls: 10,
        maxWallTimeMs: 60_000,
      });

      budget.record('tokens', 200);
      budget.record('toolCalls', 2);
      budget.recordLLMCall(300, 50);

      const report: BudgetReport = budget.getReport();

      // consumed
      expect(report.consumed.tokens).toBe(500);
      expect(report.consumed.toolCalls).toBe(2);
      expect(report.consumed.wallClockMs).toBe(50);
      expect(report.consumed.llmCalls).toBe(1);

      // limits
      expect(report.limits.tokens).toBe(5_000);
      expect(report.limits.toolCalls).toBe(10);
      expect(report.limits.wallClockMs).toBe(60_000);
      expect(report.limits.llmCalls).toBe(Infinity);

      // elapsed should be a non-negative number
      expect(report.elapsedMs).toBeGreaterThanOrEqual(0);

      // exhausted should be false (well under limits)
      expect(report.exhausted).toBe(false);
    });

    test('reports exhausted=true when a limit is hit', () => {
      const budget = new ExperimentBudget({
        maxTokens: 100,
        maxToolCalls: 10,
        maxWallTimeMs: 60_000,
      });

      budget.record('tokens', 100);

      const report = budget.getReport();
      expect(report.exhausted).toBe(true);
    });
  });

  // ── EXPERIMENT_BUDGET_PRESETS ─────────────────────────────────────────────

  describe('EXPERIMENT_BUDGET_PRESETS', () => {
    test('has quick, standard, and deep presets', () => {
      expect(EXPERIMENT_BUDGET_PRESETS).toHaveProperty('quick');
      expect(EXPERIMENT_BUDGET_PRESETS).toHaveProperty('standard');
      expect(EXPERIMENT_BUDGET_PRESETS).toHaveProperty('deep');
    });

    test('quick preset has the smallest limits', () => {
      const { quick } = EXPERIMENT_BUDGET_PRESETS;
      expect(quick.maxTokens).toBe(4_000);
      expect(quick.maxToolCalls).toBe(10);
      expect(quick.maxWallTimeMs).toBe(30_000);
    });

    test('presets have increasing limits: quick < standard < deep', () => {
      const { quick, standard, deep } = EXPERIMENT_BUDGET_PRESETS;

      // maxTokens
      expect(quick.maxTokens).toBeLessThan(standard.maxTokens);
      expect(standard.maxTokens).toBeLessThan(deep.maxTokens);

      // maxToolCalls
      expect(quick.maxToolCalls).toBeLessThan(standard.maxToolCalls);
      expect(standard.maxToolCalls).toBeLessThan(deep.maxToolCalls);

      // maxWallTimeMs
      expect(quick.maxWallTimeMs).toBeLessThan(standard.maxWallTimeMs);
      expect(standard.maxWallTimeMs).toBeLessThan(deep.maxWallTimeMs);
    });
  });
});
