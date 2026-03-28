import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ------------------------------------------------------------------ */
/*  hoisted mocks                                                      */
/* ------------------------------------------------------------------ */

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockGetSkillStore = vi.hoisted(() => vi.fn());
const MockExperimentBudget = vi.hoisted(() =>
  vi.fn().mockImplementation(function() { return { isExhausted: vi.fn(() => false) }; })
);

vi.mock('../../../infra/observability/logger', () => ({
  logger: mockLogger,
}));

vi.mock('../store', () => ({
  getSkillStore: mockGetSkillStore,
}));

vi.mock('../versioning', () => ({
  SkillVersionStore: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../evaluator', () => ({
  SkillEvaluator: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../experiment-budget', () => ({
  ExperimentBudget: MockExperimentBudget,
  EXPERIMENT_BUDGET_PRESETS: {
    quick: { maxTokens: 4000, maxToolCalls: 10, maxWallTimeMs: 30000 },
    standard: { maxTokens: 16000, maxToolCalls: 40, maxWallTimeMs: 120000 },
    deep: { maxTokens: 64000, maxToolCalls: 120, maxWallTimeMs: 600000 },
  },
}));

vi.mock('../experiment-ledger', () => ({
  ExperimentLedger: vi.fn().mockImplementation(() => ({})),
}));

/* ------------------------------------------------------------------ */
/*  import under test                                                  */
/* ------------------------------------------------------------------ */

import { ExperimentEngine, createExperimentEngine } from '../experiment-engine';
import type { ExperimentConfig, Hypothesis } from '../experiment-engine';
import { SkillVersionStore } from '../versioning';
import { SkillEvaluator } from '../evaluator';
import { ExperimentLedger } from '../experiment-ledger';

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */

function makeEvalSummary(overrides: Record<string, any> = {}) {
  return {
    skillName: 'test-skill',
    versionId: 'v001',
    timestamp: Date.now(),
    compositeScore: 0.7,
    metrics: {
      successRate: 0.8,
      triggerPrecision: 0.9,
      avgOutputQuality: 0.7,
      avgExecutionTimeMs: 100,
      complexityScore: 0.3,
    },
    testResults: [],
    budgetConsumed: { totalTokens: 100, wallClockMs: 50, llmCalls: 1 },
    ...overrides,
  };
}

function makeHypothesis(overrides: Partial<Hypothesis> = {}): Hypothesis {
  return {
    description: 'Simplify prompt structure',
    changes: 'Remove redundant instructions in step 3',
    rationale: 'Reduces complexity without losing clarity',
    ...overrides,
  };
}

/** Build mocks for the four constructor dependencies. */
function makeMocks() {
  let snapshotCounter = 0;
  const versioning = {
    snapshot: vi.fn(() => ({ versionId: `v${String(++snapshotCounter).padStart(3, '0')}` })),
    markDiscarded: vi.fn(),
  };

  const evaluator = {
    evaluate: vi.fn(async () => makeEvalSummary()),
  };

  const judge = {
    judge: vi.fn(async () => ({
      failed: false,
      result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
    })),
  };

  const ledger = {
    log: vi.fn(),
  };

  return { versioning, evaluator, judge, ledger };
}

/** Build a minimal SkillStore mock. */
function makeStoreMock(overrides: Record<string, any> = {}) {
  return {
    get: vi.fn(() => ({
      name: 'test-skill',
      content: '---\nname: test-skill\n---\nHello world',
      ...overrides.skillOverrides,
    })),
    getEvals: vi.fn(() => ({
      success: true,
      data: {
        evals: [
          { id: 1, prompt: 'What is testing?', expected_output: 'A process', expectations: ['accurate'] },
          { id: 2, prompt: 'Explain CI', expected_output: 'Continuous Integration', expectations: ['correct'] },
        ],
      },
      ...overrides.evalsOverrides,
    })),
    ...overrides.storeMethods,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('ExperimentEngine', () => {
  let mocks: ReturnType<typeof makeMocks>;
  let engine: ExperimentEngine;
  let storeMock: ReturnType<typeof makeStoreMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    MockExperimentBudget.mockImplementation(function() { return { isExhausted: vi.fn(() => false) }; });
    mocks = makeMocks();
    engine = new ExperimentEngine(
      mocks.versioning as any,
      mocks.evaluator as any,
      mocks.judge as any,
      mocks.ledger as any,
    );
    storeMock = makeStoreMock();
    mockGetSkillStore.mockReturnValue(storeMock);
  });

  /* ================================================================ */
  /*  Constructor                                                      */
  /* ================================================================ */

  describe('constructor', () => {
    it('creates an instance', () => {
      expect(engine).toBeInstanceOf(ExperimentEngine);
    });
  });

  /* ================================================================ */
  /*  run() — Phase 1: Bootstrap                                       */
  /* ================================================================ */

  describe('run() — bootstrap phase', () => {
    it('throws when skill is not found in store', async () => {
      storeMock.get.mockReturnValue(null);
      await expect(engine.run({ skillName: 'nonexistent' })).rejects.toThrow(
        'Skill "nonexistent" not found in SkillStore',
      );
    });

    it('throws when no test cases exist for the skill', async () => {
      storeMock.getEvals.mockReturnValue({ success: true, data: { evals: [] } });
      await expect(engine.run({ skillName: 'test-skill' })).rejects.toThrow(
        'No test cases found for skill "test-skill"',
      );
    });

    it('throws when getEvals returns unsuccessful result', async () => {
      storeMock.getEvals.mockReturnValue({ success: false, data: null });
      await expect(engine.run({ skillName: 'test-skill' })).rejects.toThrow(
        'No test cases found',
      );
    });

    it('throws when getEvals returns null data', async () => {
      storeMock.getEvals.mockReturnValue({ success: true, data: null });
      await expect(engine.run({ skillName: 'test-skill' })).rejects.toThrow(
        'No test cases found',
      );
    });

    it('uses default config values when only skillName provided', async () => {
      const report = await engine.run({ skillName: 'test-skill' });
      expect(report.skillName).toBe('test-skill');
      expect(mocks.versioning.snapshot).toHaveBeenCalledWith(
        'test-skill',
        expect.any(String),
        'experiment baseline',
        'agent',
      );
    });

    it('creates baseline snapshot and evaluates it', async () => {
      await engine.run({ skillName: 'test-skill' });

      expect(mocks.versioning.snapshot.mock.calls[0]).toEqual([
        'test-skill',
        '---\nname: test-skill\n---\nHello world',
        'experiment baseline',
        'agent',
      ]);

      expect(mocks.evaluator.evaluate).toHaveBeenCalled();
    });

    it('logs baseline to ledger', async () => {
      await engine.run({ skillName: 'test-skill' });
      expect(mocks.ledger.log).toHaveBeenCalledWith(
        'test-skill',
        0.7,
        0.8,
        0.3,
        expect.any(String),
        'keep',
        'experiment baseline',
      );
    });

    it('merges partial config with defaults', async () => {
      const report = await engine.run({
        skillName: 'test-skill',
        maxRounds: 2,
        budgetPreset: 'quick',
      });
      expect(report.skillName).toBe('test-skill');
    });
  });

  /* ================================================================ */
  /*  run() — Phase 2: Experiment loop                                 */
  /* ================================================================ */

  describe('run() — experiment loop', () => {
    it('stops when judge returns NO_MORE_HYPOTHESES', async () => {
      const report = await engine.run({ skillName: 'test-skill', maxRounds: 3 });
      expect(report.totalRounds).toBe(0);
      expect(report.results).toHaveLength(0);
    });

    it('stops when judge returns failed=true', async () => {
      mocks.judge.judge.mockResolvedValueOnce({ failed: true, error: 'timeout' });
      const report = await engine.run({ skillName: 'test-skill', maxRounds: 3 });
      expect(report.totalRounds).toBe(0);
    });

    it('stops when judge returns null result', async () => {
      mocks.judge.judge.mockResolvedValueOnce({ failed: false, result: null });
      const report = await engine.run({ skillName: 'test-skill', maxRounds: 3 });
      expect(report.totalRounds).toBe(0);
    });

    it('runs a single round and keeps when score improves significantly', async () => {
      mocks.judge.judge
        .mockResolvedValueOnce({ failed: false, result: makeHypothesis() })
        .mockResolvedValueOnce({ failed: false, result: '---\nname: test-skill\n---\nImproved content' })
        .mockResolvedValueOnce({
          failed: false,
          result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
        });

      mocks.evaluator.evaluate
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.5 }))
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.6 }));

      const report = await engine.run({ skillName: 'test-skill', maxRounds: 3 });

      expect(report.totalRounds).toBe(1);
      expect(report.results[0].decision).toBe('keep');
      expect(report.results[0].beforeScore).toBe(0.5);
      expect(report.results[0].afterScore).toBe(0.6);
      expect(report.improvement).toBeCloseTo(0.1);
    });

    it('runs a round and discards when score decreases', async () => {
      mocks.judge.judge
        .mockResolvedValueOnce({ failed: false, result: makeHypothesis() })
        .mockResolvedValueOnce({ failed: false, result: '---\nname: test-skill\n---\nWorse content' })
        .mockResolvedValueOnce({
          failed: false,
          result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
        });

      mocks.evaluator.evaluate
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.7 }))
        .mockResolvedValueOnce(
          makeEvalSummary({
            compositeScore: 0.65,
            metrics: { successRate: 0.7, triggerPrecision: 0.8, avgOutputQuality: 0.6, avgExecutionTimeMs: 100, complexityScore: 0.3 },
          }),
        );

      const report = await engine.run({ skillName: 'test-skill', maxRounds: 3 });

      expect(report.totalRounds).toBe(1);
      expect(report.results[0].decision).toBe('discard');
      expect(mocks.versioning.markDiscarded).toHaveBeenCalled();
    });

    it('handles crash during hypothesis application', async () => {
      mocks.judge.judge
        .mockResolvedValueOnce({ failed: false, result: makeHypothesis() })
        .mockRejectedValueOnce(new Error('LLM API timeout'))
        .mockResolvedValueOnce({
          failed: false,
          result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
        });

      mocks.evaluator.evaluate.mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.7 }));

      const report = await engine.run({ skillName: 'test-skill', maxRounds: 3 });

      expect(report.totalRounds).toBe(1);
      expect(report.results[0].decision).toBe('crash');
      expect(report.results[0].reason).toBe('LLM API timeout');
      expect(mocks.ledger.log).toHaveBeenCalledWith(
        'test-skill',
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(String),
        'crash',
        expect.stringContaining('crash'),
      );
    });

    it('handles crash with non-Error object', async () => {
      mocks.judge.judge
        .mockResolvedValueOnce({ failed: false, result: makeHypothesis() })
        .mockRejectedValueOnce('string error')
        .mockResolvedValueOnce({
          failed: false,
          result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
        });

      mocks.evaluator.evaluate.mockResolvedValueOnce(makeEvalSummary());

      const report = await engine.run({ skillName: 'test-skill', maxRounds: 3 });

      expect(report.results[0].decision).toBe('crash');
      expect(report.results[0].reason).toBe('string error');
    });

    it('runs multiple rounds with mixed decisions', async () => {
      mocks.judge.judge
        // Round 1: hypothesis + apply
        .mockResolvedValueOnce({ failed: false, result: makeHypothesis({ description: 'H1' }) })
        .mockResolvedValueOnce({ failed: false, result: '---\nname: test-skill\n---\nR1 content' })
        // Round 2: hypothesis + apply
        .mockResolvedValueOnce({ failed: false, result: makeHypothesis({ description: 'H2' }) })
        .mockResolvedValueOnce({ failed: false, result: '---\nname: test-skill\n---\nR2 content' })
        // Round 3: no more
        .mockResolvedValueOnce({
          failed: false,
          result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
        });

      mocks.evaluator.evaluate
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.5 }))  // baseline
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.6 }))  // R1 (keep)
        .mockResolvedValueOnce(                                           // R2 (discard: score down)
          makeEvalSummary({
            compositeScore: 0.59,
            metrics: { successRate: 0.8, triggerPrecision: 0.9, avgOutputQuality: 0.7, avgExecutionTimeMs: 100, complexityScore: 0.3 },
          }),
        );

      const report = await engine.run({ skillName: 'test-skill', maxRounds: 5 });

      expect(report.totalRounds).toBe(2);
      expect(report.results[0].decision).toBe('keep');
      expect(report.results[1].decision).toBe('discard');
      expect(report.finalScore).toBe(0.6);
      expect(report.improvement).toBeCloseTo(0.1);
    });

    it('stops at maxRounds even when hypotheses remain', async () => {
      mocks.judge.judge.mockImplementation(async (opts: any) => {
        if (opts.taskName.startsWith('hypothesis-generation')) {
          return { failed: false, result: makeHypothesis() };
        }
        return { failed: false, result: '---\nname: test-skill\n---\nModified' };
      });

      let score = 0.5;
      mocks.evaluator.evaluate.mockImplementation(async () => {
        score += 0.05;
        return makeEvalSummary({ compositeScore: score });
      });

      const report = await engine.run({ skillName: 'test-skill', maxRounds: 2 });

      expect(report.totalRounds).toBe(2);
    });

    it('stops when budget is exhausted before loop starts', async () => {
      // Override the ExperimentBudget mock to return exhausted
      
      MockExperimentBudget.mockImplementation(function() { return { isExhausted: vi.fn(() => true) }; } as any);

      mocks.evaluator.evaluate.mockResolvedValueOnce(makeEvalSummary());

      const report = await engine.run({ skillName: 'test-skill', maxRounds: 3 });

      expect(report.totalRounds).toBe(0);

      // Restore
      MockExperimentBudget.mockImplementation(function() { return { isExhausted: vi.fn(() => false) }; } as any);
    });

    it('stops when budget is exhausted after a round', async () => {
      let callCount = 0;
      
      MockExperimentBudget.mockImplementation(function() {
        return {
          isExhausted: vi.fn(() => {
            callCount++;
            return callCount >= 2;
          }),
        };
      } as any);

      mocks.judge.judge
        .mockResolvedValueOnce({ failed: false, result: makeHypothesis() })
        .mockResolvedValueOnce({ failed: false, result: '---\nname: test-skill\n---\nModified' });

      mocks.evaluator.evaluate
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.5 }))
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.6 }));

      const report = await engine.run({ skillName: 'test-skill', maxRounds: 5 });

      expect(report.totalRounds).toBe(1);

      // Restore
      MockExperimentBudget.mockImplementation(function() { return { isExhausted: vi.fn(() => false) }; } as any);
    });
  });

  /* ================================================================ */
  /*  run() — Phase 3: Report                                          */
  /* ================================================================ */

  describe('run() — report', () => {
    it('returns a complete ExperimentReport', async () => {
      const report = await engine.run({ skillName: 'test-skill' });

      expect(report).toEqual(
        expect.objectContaining({
          skillName: 'test-skill',
          startTime: expect.any(String),
          endTime: expect.any(String),
          totalRounds: expect.any(Number),
          results: expect.any(Array),
          baselineScore: expect.any(Number),
          finalScore: expect.any(Number),
          improvement: expect.any(Number),
        }),
      );
    });

    it('improvement is finalScore - baselineScore', async () => {
      mocks.evaluator.evaluate.mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.4 }));
      const report = await engine.run({ skillName: 'test-skill' });
      expect(report.baselineScore).toBe(0.4);
      expect(report.finalScore).toBe(0.4);
      expect(report.improvement).toBe(0);
    });

    it('reports positive improvement when rounds succeed', async () => {
      mocks.judge.judge
        .mockResolvedValueOnce({ failed: false, result: makeHypothesis() })
        .mockResolvedValueOnce({ failed: false, result: '---\nname: test-skill\n---\nBetter' })
        .mockResolvedValueOnce({
          failed: false,
          result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
        });

      mocks.evaluator.evaluate
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.3 }))
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.5 }));

      const report = await engine.run({ skillName: 'test-skill', maxRounds: 3 });

      expect(report.baselineScore).toBe(0.3);
      expect(report.finalScore).toBe(0.5);
      expect(report.improvement).toBeCloseTo(0.2);
    });
  });

  /* ================================================================ */
  /*  decide() — Simplicity Criterion                                  */
  /* ================================================================ */

  describe('decide() — Simplicity Criterion', () => {
    function callDecide(
      before: Record<string, any>,
      after: Record<string, any>,
      configOverrides: Partial<ExperimentConfig> = {},
    ) {
      const cfg: ExperimentConfig = {
        skillName: 'test',
        maxRounds: 5,
        budgetPreset: 'standard',
        autoDecision: false,
        maxComplexityGrowth: 0.2,
        ...configOverrides,
      };
      return (engine as any).decide(
        makeEvalSummary(before),
        makeEvalSummary(after),
        cfg,
      );
    }

    it('Rule 1: keeps on significant score improvement (>= 0.03)', () => {
      const result = callDecide(
        { compositeScore: 0.5 },
        { compositeScore: 0.54 },
      );
      expect(result.action).toBe('keep');
      expect(result.reason).toContain('Significant improvement');
    });

    it('Rule 1: exact boundary — 0.03 delta is kept', () => {
      const result = callDecide(
        { compositeScore: 0.50 },
        { compositeScore: 0.53 },
      );
      expect(result.action).toBe('keep');
    });

    it('Rule 2: keeps on positive improvement with simplification', () => {
      const result = callDecide(
        { compositeScore: 0.50, metrics: { successRate: 0.8, triggerPrecision: 0.9, avgOutputQuality: 0.7, avgExecutionTimeMs: 100, complexityScore: 0.5 } },
        { compositeScore: 0.52, metrics: { successRate: 0.8, triggerPrecision: 0.9, avgOutputQuality: 0.7, avgExecutionTimeMs: 100, complexityScore: 0.4 } },
      );
      expect(result.action).toBe('keep');
      expect(result.reason).toContain('Improvement');
      expect(result.reason).toContain('simplification');
    });

    it('Rule 3: keeps on flat score with major simplification (>= 15%)', () => {
      const result = callDecide(
        { compositeScore: 0.70, metrics: { successRate: 0.8, triggerPrecision: 0.9, avgOutputQuality: 0.7, avgExecutionTimeMs: 100, complexityScore: 1.0 } },
        { compositeScore: 0.70, metrics: { successRate: 0.8, triggerPrecision: 0.9, avgOutputQuality: 0.7, avgExecutionTimeMs: 100, complexityScore: 0.8 } },
      );
      expect(result.action).toBe('keep');
      expect(result.reason).toContain('Major simplification');
    });

    it('Rule 3: boundary — exactly 15% simplification with flat score is kept', () => {
      const result = callDecide(
        { compositeScore: 0.700, metrics: { successRate: 0.8, triggerPrecision: 0.9, avgOutputQuality: 0.7, avgExecutionTimeMs: 100, complexityScore: 1.0 } },
        { compositeScore: 0.705, metrics: { successRate: 0.8, triggerPrecision: 0.9, avgOutputQuality: 0.7, avgExecutionTimeMs: 100, complexityScore: 0.85 } },
      );
      expect(result.action).toBe('keep');
    });

    it('Rule 4: discards on complexity explosion beyond threshold', () => {
      const result = callDecide(
        { compositeScore: 0.70, metrics: { successRate: 0.8, triggerPrecision: 0.9, avgOutputQuality: 0.7, avgExecutionTimeMs: 100, complexityScore: 0.4 } },
        { compositeScore: 0.72, metrics: { successRate: 0.8, triggerPrecision: 0.9, avgOutputQuality: 0.7, avgExecutionTimeMs: 100, complexityScore: 0.7 } },
      );
      expect(result.action).toBe('discard');
      expect(result.reason).toContain('Complexity explosion');
    });

    it('Rule 4: custom maxComplexityGrowth threshold', () => {
      const result = callDecide(
        { compositeScore: 0.70, metrics: { successRate: 0.8, triggerPrecision: 0.9, avgOutputQuality: 0.7, avgExecutionTimeMs: 100, complexityScore: 0.4 } },
        { compositeScore: 0.72, metrics: { successRate: 0.8, triggerPrecision: 0.9, avgOutputQuality: 0.7, avgExecutionTimeMs: 100, complexityScore: 0.5 } },
        { maxComplexityGrowth: 0.1 },
      );
      expect(result.action).toBe('discard');
      expect(result.reason).toContain('Complexity explosion');
      expect(result.reason).toContain('10%');
    });

    it('Rule 5: discards marginal improvement with complexity cost', () => {
      const result = callDecide(
        { compositeScore: 0.70, metrics: { successRate: 0.8, triggerPrecision: 0.9, avgOutputQuality: 0.7, avgExecutionTimeMs: 100, complexityScore: 0.5 } },
        { compositeScore: 0.72, metrics: { successRate: 0.8, triggerPrecision: 0.9, avgOutputQuality: 0.7, avgExecutionTimeMs: 100, complexityScore: 0.55 } },
      );
      expect(result.action).toBe('discard');
      expect(result.reason).toContain('Marginal improvement');
    });

    it('Default rule: discards when no compelling reason to keep', () => {
      const result = callDecide(
        { compositeScore: 0.70 },
        { compositeScore: 0.69 },
      );
      expect(result.action).toBe('discard');
      expect(result.reason).toContain('No compelling improvement');
    });

    it('handles zero baseline complexity correctly', () => {
      const result = callDecide(
        { compositeScore: 0.70, metrics: { successRate: 0.8, triggerPrecision: 0.9, avgOutputQuality: 0.7, avgExecutionTimeMs: 100, complexityScore: 0 } },
        { compositeScore: 0.72, metrics: { successRate: 0.8, triggerPrecision: 0.9, avgOutputQuality: 0.7, avgExecutionTimeMs: 100, complexityScore: 0.5 } },
      );
      expect(result.action).toBe('discard');
      expect(result.reason).toContain('Complexity explosion');
    });

    it('handles zero baseline complexity when after is also zero', () => {
      const result = callDecide(
        { compositeScore: 0.70, metrics: { successRate: 0.8, triggerPrecision: 0.9, avgOutputQuality: 0.7, avgExecutionTimeMs: 100, complexityScore: 0 } },
        { compositeScore: 0.69, metrics: { successRate: 0.8, triggerPrecision: 0.9, avgOutputQuality: 0.7, avgExecutionTimeMs: 100, complexityScore: 0 } },
      );
      expect(result.action).toBe('discard');
      expect(result.reason).toContain('No compelling improvement');
    });

    it('Rule 1 takes precedence over Rule 4 complexity explosion', () => {
      const result = callDecide(
        { compositeScore: 0.50, metrics: { successRate: 0.8, triggerPrecision: 0.9, avgOutputQuality: 0.7, avgExecutionTimeMs: 100, complexityScore: 0.3 } },
        { compositeScore: 0.55, metrics: { successRate: 0.8, triggerPrecision: 0.9, avgOutputQuality: 0.7, avgExecutionTimeMs: 100, complexityScore: 0.9 } },
      );
      expect(result.action).toBe('keep');
      expect(result.reason).toContain('Significant improvement');
    });
  });

  /* ================================================================ */
  /*  generateHypothesis() — private, tested via run()                 */
  /* ================================================================ */

  describe('generateHypothesis — via run()', () => {
    it('includes failure details in the prompt', async () => {
      const failingEval = makeEvalSummary({
        compositeScore: 0.5,
        testResults: [
          { testCaseId: 'tc1', passed: false, score: 0.3, details: { triggered: true, outputQuality: 0.3 } },
          { testCaseId: 'tc2', passed: true, score: 0.9, details: { triggered: true, outputQuality: 0.9 } },
        ],
      });

      mocks.evaluator.evaluate.mockResolvedValueOnce(failingEval);
      mocks.judge.judge.mockResolvedValueOnce({
        failed: false,
        result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
      });

      await engine.run({ skillName: 'test-skill', maxRounds: 1 });

      expect(mocks.judge.judge).toHaveBeenCalledWith(
        expect.objectContaining({
          taskName: 'hypothesis-generation:test-skill',
          promptVariables: expect.objectContaining({
            failureDetails: expect.stringContaining('tc1'),
          }),
        }),
      );
    });

    it('includes previous hypotheses in the prompt for later rounds', async () => {
      mocks.judge.judge
        .mockResolvedValueOnce({ failed: false, result: makeHypothesis({ description: 'First idea' }) })
        .mockResolvedValueOnce({ failed: false, result: '---\nname: test-skill\n---\nR1' })
        .mockResolvedValueOnce({
          failed: false,
          result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
        });

      mocks.evaluator.evaluate
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.5 }))
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.6 }));

      await engine.run({ skillName: 'test-skill', maxRounds: 5 });

      // Third judge call is hypothesis generation for round 2
      const secondHypothesisCall = mocks.judge.judge.mock.calls[2];
      expect(secondHypothesisCall[0].promptVariables.previousHypotheses).toContain('First idea');
    });

    it('sends (none) for previousHypotheses on first round', async () => {
      mocks.judge.judge.mockResolvedValueOnce({
        failed: false,
        result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
      });

      mocks.evaluator.evaluate.mockResolvedValueOnce(makeEvalSummary());

      await engine.run({ skillName: 'test-skill', maxRounds: 1 });

      const firstCall = mocks.judge.judge.mock.calls[0];
      expect(firstCall[0].promptVariables.previousHypotheses).toContain('none');
    });

    it('sends (all test cases passed) when no failures', async () => {
      mocks.evaluator.evaluate.mockResolvedValueOnce(
        makeEvalSummary({
          testResults: [
            { testCaseId: 'tc1', passed: true, score: 1.0, details: { triggered: true, outputQuality: 1.0 } },
          ],
        }),
      );
      mocks.judge.judge.mockResolvedValueOnce({
        failed: false,
        result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
      });

      await engine.run({ skillName: 'test-skill', maxRounds: 1 });

      const firstCall = mocks.judge.judge.mock.calls[0];
      expect(firstCall[0].promptVariables.failureDetails).toContain('all test cases passed');
    });
  });

  /* ================================================================ */
  /*  applyHypothesis() — private, tested via run()                    */
  /* ================================================================ */

  describe('applyHypothesis — via run()', () => {
    it('returns original content when judge fails', async () => {
      mocks.judge.judge
        .mockResolvedValueOnce({ failed: false, result: makeHypothesis() })
        .mockResolvedValueOnce({ failed: true, error: 'model error' })
        .mockResolvedValueOnce({
          failed: false,
          result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
        });

      mocks.evaluator.evaluate
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.5 }))
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.5 }));

      const report = await engine.run({ skillName: 'test-skill', maxRounds: 3 });
      expect(report.totalRounds).toBe(1);
    });

    it('returns original content when modified content loses frontmatter', async () => {
      mocks.judge.judge
        .mockResolvedValueOnce({ failed: false, result: makeHypothesis() })
        .mockResolvedValueOnce({ failed: false, result: 'No frontmatter here' })
        .mockResolvedValueOnce({
          failed: false,
          result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
        });

      mocks.evaluator.evaluate
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.5 }))
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.5 }));

      await engine.run({ skillName: 'test-skill', maxRounds: 3 });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('lost frontmatter'),
      );
    });

    it('accepts valid modified content with frontmatter', async () => {
      mocks.judge.judge
        .mockResolvedValueOnce({ failed: false, result: makeHypothesis() })
        .mockResolvedValueOnce({ failed: false, result: '---\nname: test-skill\n---\nGood content' })
        .mockResolvedValueOnce({
          failed: false,
          result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
        });

      mocks.evaluator.evaluate
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.5 }))
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.6 }));

      const report = await engine.run({ skillName: 'test-skill', maxRounds: 3 });
      expect(report.totalRounds).toBe(1);
    });
  });

  /* ================================================================ */
  /*  getTestCases() — private, tested via run()                       */
  /* ================================================================ */

  describe('getTestCases — via run()', () => {
    it('maps evals to TestCase objects correctly', async () => {
      storeMock.getEvals.mockReturnValue({
        success: true,
        data: {
          evals: [
            { id: 42, prompt: 'Tell me about X', expected_output: 'X is...', expectations: ['accurate', 'concise'] },
          ],
        },
      });

      mocks.evaluator.evaluate.mockResolvedValueOnce(makeEvalSummary());

      await engine.run({ skillName: 'test-skill' });

      expect(mocks.evaluator.evaluate).toHaveBeenCalledWith(
        'test-skill',
        expect.any(String),
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({
            id: '42',
            input: 'Tell me about X',
            expectedBehavior: 'X is...',
            evaluationCriteria: ['accurate', 'concise'],
          }),
        ]),
        expect.anything(),
      );
    });

    it('handles evals without expected_output or expectations', async () => {
      storeMock.getEvals.mockReturnValue({
        success: true,
        data: {
          evals: [
            { id: 1, prompt: 'Test prompt' },
          ],
        },
      });

      mocks.evaluator.evaluate.mockResolvedValueOnce(makeEvalSummary());

      await engine.run({ skillName: 'test-skill' });

      expect(mocks.evaluator.evaluate).toHaveBeenCalledWith(
        'test-skill',
        expect.any(String),
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({
            id: '1',
            input: 'Test prompt',
            expectedBehavior: '',
          }),
        ]),
        expect.anything(),
      );
    });
  });

  /* ================================================================ */
  /*  Ledger interaction                                               */
  /* ================================================================ */

  describe('ledger interaction', () => {
    it('logs every keep decision to ledger', async () => {
      mocks.judge.judge
        .mockResolvedValueOnce({ failed: false, result: makeHypothesis() })
        .mockResolvedValueOnce({ failed: false, result: '---\nname: test-skill\n---\nImproved' })
        .mockResolvedValueOnce({
          failed: false,
          result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
        });

      mocks.evaluator.evaluate
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.5 }))
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.6 }));

      await engine.run({ skillName: 'test-skill', maxRounds: 3 });

      // Baseline log + round 1 log = 2 total
      expect(mocks.ledger.log).toHaveBeenCalledTimes(2);

      const roundLog = mocks.ledger.log.mock.calls[1];
      expect(roundLog[5]).toBe('keep');
      expect(roundLog[6]).toContain('round 1');
    });

    it('logs every discard decision to ledger', async () => {
      mocks.judge.judge
        .mockResolvedValueOnce({ failed: false, result: makeHypothesis() })
        .mockResolvedValueOnce({ failed: false, result: '---\nname: test-skill\n---\nWorse' })
        .mockResolvedValueOnce({
          failed: false,
          result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
        });

      mocks.evaluator.evaluate
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.7 }))
        .mockResolvedValueOnce(
          makeEvalSummary({
            compositeScore: 0.65,
            metrics: { successRate: 0.7, triggerPrecision: 0.8, avgOutputQuality: 0.6, avgExecutionTimeMs: 100, complexityScore: 0.3 },
          }),
        );

      await engine.run({ skillName: 'test-skill', maxRounds: 3 });

      const roundLog = mocks.ledger.log.mock.calls[1];
      expect(roundLog[5]).toBe('discard');
    });

    it('logs crash to ledger with pre-snapshot version', async () => {
      mocks.judge.judge
        .mockResolvedValueOnce({ failed: false, result: makeHypothesis() })
        .mockRejectedValueOnce(new Error('eval failed'))
        .mockResolvedValueOnce({
          failed: false,
          result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
        });

      mocks.evaluator.evaluate.mockResolvedValueOnce(makeEvalSummary());

      await engine.run({ skillName: 'test-skill', maxRounds: 3 });

      const crashLog = mocks.ledger.log.mock.calls[1];
      expect(crashLog[5]).toBe('crash');
      expect(crashLog[6]).toContain('crash');
    });
  });

  /* ================================================================ */
  /*  Versioning interaction                                           */
  /* ================================================================ */

  describe('versioning interaction', () => {
    it('creates pre-round snapshot for each round', async () => {
      mocks.judge.judge
        .mockResolvedValueOnce({ failed: false, result: makeHypothesis() })
        .mockResolvedValueOnce({ failed: false, result: '---\nname: test-skill\n---\nM' })
        .mockResolvedValueOnce({
          failed: false,
          result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
        });

      mocks.evaluator.evaluate
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.5 }))
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.6 }));

      await engine.run({ skillName: 'test-skill', maxRounds: 3 });

      // snapshot calls: baseline + pre-round + modified = 3
      expect(mocks.versioning.snapshot).toHaveBeenCalledTimes(3);
      expect(mocks.versioning.snapshot.mock.calls[1][2]).toBe('pre-round-1');
    });

    it('creates modified snapshot with hypothesis description', async () => {
      mocks.judge.judge
        .mockResolvedValueOnce({ failed: false, result: makeHypothesis({ description: 'Improve X' }) })
        .mockResolvedValueOnce({ failed: false, result: '---\nname: test-skill\n---\nM' })
        .mockResolvedValueOnce({
          failed: false,
          result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
        });

      mocks.evaluator.evaluate
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.5 }))
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.6 }));

      await engine.run({ skillName: 'test-skill', maxRounds: 3 });

      expect(mocks.versioning.snapshot.mock.calls[2][2]).toBe('hypothesis: Improve X');
    });

    it('marks discarded snapshot with reason', async () => {
      mocks.judge.judge
        .mockResolvedValueOnce({ failed: false, result: makeHypothesis() })
        .mockResolvedValueOnce({ failed: false, result: '---\nname: test-skill\n---\nWorse' })
        .mockResolvedValueOnce({
          failed: false,
          result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
        });

      mocks.evaluator.evaluate
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.7 }))
        .mockResolvedValueOnce(
          makeEvalSummary({
            compositeScore: 0.65,
            metrics: { successRate: 0.7, triggerPrecision: 0.8, avgOutputQuality: 0.6, avgExecutionTimeMs: 100, complexityScore: 0.3 },
          }),
        );

      await engine.run({ skillName: 'test-skill', maxRounds: 3 });

      expect(mocks.versioning.markDiscarded).toHaveBeenCalledWith(
        'test-skill',
        expect.any(String),
        expect.any(String),
      );
    });

    it('does not markDiscarded when decision is keep', async () => {
      mocks.judge.judge
        .mockResolvedValueOnce({ failed: false, result: makeHypothesis() })
        .mockResolvedValueOnce({ failed: false, result: '---\nname: test-skill\n---\nBetter' })
        .mockResolvedValueOnce({
          failed: false,
          result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
        });

      mocks.evaluator.evaluate
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.5 }))
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.6 }));

      await engine.run({ skillName: 'test-skill', maxRounds: 3 });

      expect(mocks.versioning.markDiscarded).not.toHaveBeenCalled();
    });
  });

  /* ================================================================ */
  /*  Logging                                                          */
  /* ================================================================ */

  describe('logging', () => {
    it('logs experiment start with config', async () => {
      await engine.run({ skillName: 'test-skill' });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Starting experiment'),
        expect.objectContaining({
          maxRounds: 5,
          budgetPreset: 'standard',
        }),
      );
    });

    it('logs baseline snapshot and score', async () => {
      mocks.evaluator.evaluate.mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.42 }));
      await engine.run({ skillName: 'test-skill' });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Baseline snapshot'),
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Baseline score: 0.4200'),
        expect.any(Object),
      );
    });

    it('logs experiment completion summary', async () => {
      await engine.run({ skillName: 'test-skill' });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Experiment complete'),
      );
    });

    it('logs KEEP decisions', async () => {
      mocks.judge.judge
        .mockResolvedValueOnce({ failed: false, result: makeHypothesis() })
        .mockResolvedValueOnce({ failed: false, result: '---\nname: test-skill\n---\nBetter' })
        .mockResolvedValueOnce({
          failed: false,
          result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
        });

      mocks.evaluator.evaluate
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.5 }))
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.6 }));

      await engine.run({ skillName: 'test-skill', maxRounds: 3 });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('KEEP'),
      );
    });

    it('logs DISCARD decisions', async () => {
      mocks.judge.judge
        .mockResolvedValueOnce({ failed: false, result: makeHypothesis() })
        .mockResolvedValueOnce({ failed: false, result: '---\nname: test-skill\n---\nWorse' })
        .mockResolvedValueOnce({
          failed: false,
          result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
        });

      mocks.evaluator.evaluate
        .mockResolvedValueOnce(makeEvalSummary({ compositeScore: 0.7 }))
        .mockResolvedValueOnce(
          makeEvalSummary({
            compositeScore: 0.65,
            metrics: { successRate: 0.7, triggerPrecision: 0.8, avgOutputQuality: 0.6, avgExecutionTimeMs: 100, complexityScore: 0.3 },
          }),
        );

      await engine.run({ skillName: 'test-skill', maxRounds: 3 });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('DISCARD'),
      );
    });

    it('logs budget exhaustion', async () => {
      
      MockExperimentBudget.mockImplementation(function() { return { isExhausted: vi.fn(() => true) }; } as any);

      mocks.evaluator.evaluate.mockResolvedValueOnce(makeEvalSummary());

      await engine.run({ skillName: 'test-skill', maxRounds: 3 });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Budget exhausted'),
      );

      MockExperimentBudget.mockImplementation(function() { return { isExhausted: vi.fn(() => false) }; } as any);
    });

    it('logs hypothesis generation failure', async () => {
      mocks.judge.judge.mockResolvedValueOnce({ failed: true, error: 'rate limit' });
      mocks.evaluator.evaluate.mockResolvedValueOnce(makeEvalSummary());

      await engine.run({ skillName: 'test-skill', maxRounds: 3 });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Hypothesis generation failed'),
      );
    });

    it('logs crash errors', async () => {
      mocks.judge.judge
        .mockResolvedValueOnce({ failed: false, result: makeHypothesis() })
        .mockRejectedValueOnce(new Error('API down'))
        .mockResolvedValueOnce({
          failed: false,
          result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
        });

      mocks.evaluator.evaluate.mockResolvedValueOnce(makeEvalSummary());

      await engine.run({ skillName: 'test-skill', maxRounds: 3 });

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('CRASHED: API down'),
      );
    });

    it('logs "No more hypotheses" when judge signals stop', async () => {
      mocks.evaluator.evaluate.mockResolvedValueOnce(makeEvalSummary());
      mocks.judge.judge.mockResolvedValueOnce({
        failed: false,
        result: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
      });

      await engine.run({ skillName: 'test-skill', maxRounds: 3 });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('No more hypotheses'),
      );
    });
  });
});

/* ==================================================================== */
/*  createExperimentEngine factory                                       */
/* ==================================================================== */

describe('createExperimentEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an ExperimentEngine instance with default dataDir', () => {
    const mockJudge = { judge: vi.fn() } as any;
    const engine = createExperimentEngine(mockJudge);
    expect(engine).toBeInstanceOf(ExperimentEngine);
  });

  it('creates an ExperimentEngine instance with custom dataDir', () => {
    const mockJudge = { judge: vi.fn() } as any;
    const engine = createExperimentEngine(mockJudge, '/tmp/experiments');
    expect(engine).toBeInstanceOf(ExperimentEngine);
  });

  it('passes judge to SkillEvaluator', () => {
    const mockJudge = { judge: vi.fn() } as any;
    createExperimentEngine(mockJudge);
    expect(SkillEvaluator).toHaveBeenCalledWith(mockJudge);
  });

  it('creates SkillVersionStore with the dataDir', () => {
    const mockJudge = { judge: vi.fn() } as any;
    createExperimentEngine(mockJudge, 'custom/dir');
    expect(SkillVersionStore).toHaveBeenCalledWith('custom/dir');
  });

  it('creates ExperimentLedger with the dataDir', () => {
    const mockJudge = { judge: vi.fn() } as any;
    createExperimentEngine(mockJudge, 'custom/dir');
    expect(ExperimentLedger).toHaveBeenCalledWith('custom/dir');
  });
});
