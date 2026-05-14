/**
 * Per-turn budget configuration.
 *
 * Two literals were hard-coded in the agent loop:
 *   - 5  → max tool iterations
 *   - 0.6 → percent of context window allotted to a single turn
 *
 * Both are now overridable via AgentOptions; defaults stay the same
 * so existing deployments see no change. The exported constants are
 * the contract; orchestrator + stream-handler inline them at the
 * call sites to keep test mocks simple.
 *
 * These tests assert the contract surface, not the runtime behavior
 * (which is exercised by index.test.ts / agent-coverage.test.ts —
 * those still pass after this change).
 */

import { describe, test, expect } from 'vitest';
import {
  DEFAULT_MAX_TOOL_ITERATIONS,
  DEFAULT_TOKEN_BUDGET_PCT_PER_TURN,
} from '../types';
import type { AgentOptions } from '../types';
import * as fs from 'fs';
import * as path from 'path';

describe('per-turn budget defaults', () => {
  test('exports the canonical default constants', () => {
    expect(DEFAULT_MAX_TOOL_ITERATIONS).toBe(5);
    expect(DEFAULT_TOKEN_BUDGET_PCT_PER_TURN).toBe(0.6);
  });

  test('defaults are byte-identical to inlined call-site values (drift guard)', () => {
    // Same pattern as fallback-messages.test.ts: inlined defaults
    // protect tests from mock churn, but the exported constants are
    // the authoritative contract. Drift between them = silent bug.
    const here = path.dirname(new URL(import.meta.url).pathname);

    const orchSrc = fs.readFileSync(path.join(here, '..', 'orchestrator.ts'), 'utf-8');
    const streamSrc = fs.readFileSync(path.join(here, '..', 'stream-handler.ts'), 'utf-8');

    // 0.6 default appears as a fallback for tokenBudgetPctPerTurn.
    expect(orchSrc).toContain(`?? ${DEFAULT_TOKEN_BUDGET_PCT_PER_TURN}`);
    expect(streamSrc).toContain(`?? ${DEFAULT_TOKEN_BUDGET_PCT_PER_TURN}`);

    // 5 default appears as a fallback for maxToolIterations in the
    // `iterations < (this.options.maxToolIterations || 5)` shape.
    expect(orchSrc).toMatch(/maxToolIterations\s*\|\|\s*5/);
    expect(streamSrc).toMatch(/maxToolIterations\s*\|\|\s*5/);
  });
});

describe('AgentOptions typing', () => {
  test('accepts tokenBudgetPctPerTurn (fraction)', () => {
    const opts: AgentOptions = {
      provider: {} as any,
      model: 'm',
      tokenBudgetPctPerTurn: 0.4,
    };
    expect(opts.tokenBudgetPctPerTurn).toBe(0.4);
  });

  test('accepts maxTokensPerTurn (absolute, takes precedence)', () => {
    const opts: AgentOptions = {
      provider: {} as any,
      model: 'm',
      maxTokensPerTurn: 8000,
      tokenBudgetPctPerTurn: 0.4,
    };
    // Just type-check that both fields are accepted simultaneously;
    // resolution-precedence is asserted in orchestrator behavior tests.
    expect(opts.maxTokensPerTurn).toBe(8000);
    expect(opts.tokenBudgetPctPerTurn).toBe(0.4);
  });

  test('accepts maxToolIterations override', () => {
    const opts: AgentOptions = {
      provider: {} as any,
      model: 'm',
      maxToolIterations: 12,
    };
    expect(opts.maxToolIterations).toBe(12);
  });
});
