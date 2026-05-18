import { describe, test, expect, vi, beforeEach } from 'vitest';
import { computeCompositeScore, measureComplexity, SkillEvaluator } from '../evaluator';
import type { TestCase, TestCaseResult, EvalSummary } from '../evaluator';

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

vi.mock('../prompts/eval-prompts', () => ({
  TRIGGER_CHECK_PROMPT: 'trigger-prompt-template',
  OUTPUT_QUALITY_PROMPT: 'quality-prompt-template',
}));

// ---------------------------------------------------------------------------
// computeCompositeScore
// ---------------------------------------------------------------------------

describe('computeCompositeScore()', () => {
  test('returns a value between 0 and 1', () => {
    const score = computeCompositeScore({
      successRate: 0.5,
      triggerPrecision: 0.5,
      avgOutputQuality: 0.5,
      avgExecutionTimeMs: 5_000,
      complexityScore: 150,
    });

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  test('returns 1 (or close to 1) for perfect metrics', () => {
    const score = computeCompositeScore({
      successRate: 1.0,
      triggerPrecision: 1.0,
      avgOutputQuality: 1.0,
      avgExecutionTimeMs: 0,
      complexityScore: 0,
    });

    // 0.35*1 + 0.25*1 + 0.20*1 + 0.12*1 + 0.08*1 = 1.0
    expect(score).toBeCloseTo(1.0, 2);
  });

  test('returns 0 for worst-case metrics', () => {
    const score = computeCompositeScore({
      successRate: 0,
      triggerPrecision: 0,
      avgOutputQuality: 0,
      avgExecutionTimeMs: 10_000,
      complexityScore: 300,
    });

    // All components should be 0
    expect(score).toBeCloseTo(0, 2);
  });

  test('gives higher score for higher success rate', () => {
    const base = {
      triggerPrecision: 0.5,
      avgOutputQuality: 0.5,
      avgExecutionTimeMs: 5_000,
      complexityScore: 100,
    };

    const lowSuccess = computeCompositeScore({ ...base, successRate: 0.2 });
    const highSuccess = computeCompositeScore({ ...base, successRate: 0.9 });

    expect(highSuccess).toBeGreaterThan(lowSuccess);
  });

  test('penalizes high complexity via simplicityBonus', () => {
    const base = {
      successRate: 0.8,
      triggerPrecision: 0.8,
      avgOutputQuality: 0.8,
      avgExecutionTimeMs: 1_000,
    };

    const lowComplexity = computeCompositeScore({ ...base, complexityScore: 10 });
    const highComplexity = computeCompositeScore({ ...base, complexityScore: 280 });

    expect(lowComplexity).toBeGreaterThan(highComplexity);
  });

  test('rewards faster execution via speedBonus', () => {
    const base = {
      successRate: 0.8,
      triggerPrecision: 0.8,
      avgOutputQuality: 0.8,
      complexityScore: 50,
    };

    const fast = computeCompositeScore({ ...base, avgExecutionTimeMs: 100 });
    const slow = computeCompositeScore({ ...base, avgExecutionTimeMs: 9_000 });

    expect(fast).toBeGreaterThan(slow);
  });

  test('speedBonus floors at 0 for >= 10000ms', () => {
    const base = {
      successRate: 0.5,
      triggerPrecision: 0.5,
      avgOutputQuality: 0.5,
      complexityScore: 150,
    };

    const at10k = computeCompositeScore({ ...base, avgExecutionTimeMs: 10_000 });
    const at20k = computeCompositeScore({ ...base, avgExecutionTimeMs: 20_000 });

    // Both should have speedBonus = 0, so scores are equal
    expect(at10k).toBeCloseTo(at20k, 3);
  });

  test('simplicityBonus floors at 0 for complexity >= 300', () => {
    const base = {
      successRate: 0.5,
      triggerPrecision: 0.5,
      avgOutputQuality: 0.5,
      avgExecutionTimeMs: 5_000,
    };

    const at300 = computeCompositeScore({ ...base, complexityScore: 300 });
    const at500 = computeCompositeScore({ ...base, complexityScore: 500 });

    // Both should have simplicityBonus = 0
    expect(at300).toBeCloseTo(at500, 3);
  });

  test('returns three-decimal precision', () => {
    const score = computeCompositeScore({
      successRate: 0.333,
      triggerPrecision: 0.444,
      avgOutputQuality: 0.555,
      avgExecutionTimeMs: 3333,
      complexityScore: 111,
    });
    // Three decimal places means multiply by 1000 is integer
    expect(Math.round(score * 1000)).toBe(score * 1000);
  });
});

// ---------------------------------------------------------------------------
// measureComplexity
// ---------------------------------------------------------------------------

describe('measureComplexity()', () => {
  test('returns 0.5 for empty string (1 line)', () => {
    const result = measureComplexity('');
    expect(result).toBe(0.5);
  });

  test('increases with more lines', () => {
    const shortContent = 'line 1\nline 2';
    const longContent = 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10';

    const shortScore = measureComplexity(shortContent);
    const longScore = measureComplexity(longContent);

    expect(longScore).toBeGreaterThan(shortScore);
  });

  test('increases with conditional keywords (if/when/unless)', () => {
    const noConditionals = 'Just plain text\nNothing special here.';
    const withConditionals = 'if the user asks\nwhen triggered\nunless disabled\nif condition met';

    const plainScore = measureComplexity(noConditionals);
    const conditionalScore = measureComplexity(withConditionals);

    expect(conditionalScore).toBeGreaterThan(plainScore);
  });

  test('counts else if and elif as conditionals', () => {
    const content = 'else if this\nelif that';
    const score = measureComplexity(content);
    // 2 lines * 0.5 + 2 conditionals * 5 = 1 + 10 = 11
    expect(score).toBeGreaterThanOrEqual(11);
  });

  test('counts switch and case keywords', () => {
    const content = 'switch on mode\ncase A\ncase B\ncase C';
    const score = measureComplexity(content);
    // 4 lines * 0.5 + 4 conditionals * 5 = 2 + 20 = 22
    expect(score).toBeGreaterThanOrEqual(22);
  });

  test('counts ternary operators', () => {
    const content = 'result = condition ? value1 : value2';
    const score = measureComplexity(content);
    expect(score).toBeGreaterThan(0.5); // more than just 1 line
  });

  test('increases with markdown headings (sections)', () => {
    const noHeadings = 'plain content\nmore content';
    const withHeadings = '# Title\n## Section\n### Subsection\ncontent';

    const plainScore = measureComplexity(noHeadings);
    const headingScore = measureComplexity(withHeadings);

    expect(headingScore).toBeGreaterThan(plainScore);
  });

  test('counts all heading levels h1-h6', () => {
    const content = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6';
    const score = measureComplexity(content);
    // 6 lines * 0.5 + 6 sections * 2 = 3 + 12 = 15
    expect(score).toBe(15);
  });

  test('increases with fenced code blocks', () => {
    const noCode = 'just text\nmore text';
    const withCode = 'text\n```python\nprint("hello")\n```\nmore text';

    const plainScore = measureComplexity(noCode);
    const codeScore = measureComplexity(withCode);

    expect(codeScore).toBeGreaterThan(plainScore);
  });

  test('counts code blocks as pairs of fences', () => {
    // 3 backtick markers → floor(3/2) = 1 code block
    const oddFences = '```\ncode\n```\n```';
    const score = measureComplexity(oddFences);
    // 4 lines * 0.5 + 1 code block * 3 = 2 + 3 = 5
    expect(score).toBe(5);
  });

  test('caps at 300', () => {
    const lines: string[] = [];
    for (let i = 0; i < 1000; i++) {
      lines.push(`# Section ${i}`);
      lines.push(`if condition ${i} then do something`);
      lines.push(`when triggered, execute step ${i}`);
      lines.push('```\ncode\n```');
    }
    const hugeContent = lines.join('\n');

    const score = measureComplexity(hugeContent);
    expect(score).toBe(300);
  });

  test('handles content with only code blocks', () => {
    const content = '```js\nconst x = 1;\n```\n```py\nprint(1)\n```';

    const score = measureComplexity(content);
    expect(score).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// SkillEvaluator
// ---------------------------------------------------------------------------

describe('SkillEvaluator', () => {
  function makeJudge(overrides: Record<string, any> = {}) {
    return {
      judge: vi.fn(async (opts: any) => {
        if (opts.taskName === 'trigger-check') {
          return {
            result: {
              triggered: true,
              confidence: 0.9,
              reason: 'Matches well',
              ...overrides.trigger,
            },
            fromCache: false,
            failed: false,
          };
        }
        if (opts.taskName === 'output-quality') {
          return {
            result: {
              score: 0.8,
              strengths: ['good'],
              weaknesses: [],
              reason: 'Quality output',
              ...overrides.quality,
            },
            fromCache: false,
            failed: false,
          };
        }
        return {};
      }),
    };
  }

  function makeTestCase(overrides: Partial<TestCase> = {}): TestCase {
    return {
      id: 'tc1',
      input: 'Test input',
      expectedBehavior: 'Expected output',
      evaluationCriteria: ['correct', 'concise'],
      ...overrides,
    };
  }

  const skillContent = '---\nname: test-skill\n---\n# My Skill\nDo something useful.';

  describe('constructor', () => {
    test('creates an instance', () => {
      const judge = makeJudge();
      const evaluator = new SkillEvaluator(judge as any);
      expect(evaluator).toBeInstanceOf(SkillEvaluator);
    });
  });

  describe('evaluate()', () => {
    test('returns a complete EvalSummary', async () => {
      const judge = makeJudge();
      const evaluator = new SkillEvaluator(judge as any);

      const summary = await evaluator.evaluate(
        'test-skill', 'v001', skillContent, [makeTestCase()],
      );

      expect(summary).toEqual(expect.objectContaining({
        skillName: 'test-skill',
        versionId: 'v001',
        timestamp: expect.any(Number),
        metrics: expect.objectContaining({
          successRate: expect.any(Number),
          triggerPrecision: expect.any(Number),
          avgOutputQuality: expect.any(Number),
          avgExecutionTimeMs: expect.any(Number),
          complexityScore: expect.any(Number),
        }),
        compositeScore: expect.any(Number),
        testResults: expect.any(Array),
        budgetConsumed: expect.objectContaining({
          totalTokens: expect.any(Number),
          wallClockMs: expect.any(Number),
          llmCalls: expect.any(Number),
        }),
      }));
    });

    test('calls judge twice per test case (trigger + quality)', async () => {
      const judge = makeJudge();
      const evaluator = new SkillEvaluator(judge as any);

      await evaluator.evaluate('s', 'v1', skillContent, [makeTestCase(), makeTestCase({ id: 'tc2' })]);

      // 2 test cases * 2 judge calls each = 4
      expect(judge.judge).toHaveBeenCalledTimes(4);
    });

    test('passes correct prompt variables to trigger check', async () => {
      const judge = makeJudge();
      const evaluator = new SkillEvaluator(judge as any);

      await evaluator.evaluate('mySkill', 'v1', skillContent, [makeTestCase({ input: 'Hello' })]);

      const triggerCall = judge.judge.mock.calls[0][0];
      expect(triggerCall.taskName).toBe('trigger-check');
      expect(triggerCall.promptVariables).toEqual(expect.objectContaining({
        skillDescription: skillContent,
        userMessage: 'Hello',
      }));
    });

    test('passes correct prompt variables to quality check', async () => {
      const judge = makeJudge();
      const evaluator = new SkillEvaluator(judge as any);

      const tc = makeTestCase({
        input: 'What is X?',
        expectedBehavior: 'X is...',
        evaluationCriteria: ['accurate', 'complete'],
      });
      await evaluator.evaluate('mySkill', 'v1', skillContent, [tc]);

      const qualityCall = judge.judge.mock.calls[1][0];
      expect(qualityCall.taskName).toBe('output-quality');
      expect(qualityCall.promptVariables).toEqual(expect.objectContaining({
        skillContent,
        userMessage: 'What is X?',
        expectedBehavior: 'X is...',
        criteria: '1. accurate\n2. complete',
      }));
    });

    test('test case passes when triggered AND quality >= 0.5', async () => {
      const judge = makeJudge();
      const evaluator = new SkillEvaluator(judge as any);

      const summary = await evaluator.evaluate('s', 'v1', skillContent, [makeTestCase()]);

      expect(summary.testResults[0].passed).toBe(true);
      expect(summary.testResults[0].details.triggered).toBe(true);
      expect(summary.testResults[0].details.outputQuality).toBe(0.8);
    });

    test('test case fails when trigger is false', async () => {
      const judge = {
        judge: vi.fn(async (opts: any) => {
          if (opts.taskName === 'trigger-check') {
            return { triggered: false, confidence: 0.1, reason: 'No match' };
          }
          return { score: 0.9, strengths: [], weaknesses: [], reason: 'ok' };
        }),
      };
      const evaluator = new SkillEvaluator(judge as any);

      const summary = await evaluator.evaluate('s', 'v1', skillContent, [makeTestCase()]);

      expect(summary.testResults[0].passed).toBe(false);
      expect(summary.testResults[0].details.triggered).toBe(false);
    });

    test('test case fails when quality < 0.5', async () => {
      const judge = {
        judge: vi.fn(async (opts: any) => {
          if (opts.taskName === 'trigger-check') {
            return { triggered: true, confidence: 0.9, reason: 'yes' };
          }
          return { score: 0.3, strengths: [], weaknesses: ['bad'], reason: 'poor' };
        }),
      };
      const evaluator = new SkillEvaluator(judge as any);

      const summary = await evaluator.evaluate('s', 'v1', skillContent, [makeTestCase()]);

      expect(summary.testResults[0].passed).toBe(false);
      expect(summary.testResults[0].details.outputQuality).toBe(0.3);
    });

    test('test case passes with quality exactly 0.5', async () => {
      const judge = {
        judge: vi.fn(async (opts: any) => {
          if (opts.taskName === 'trigger-check') {
            return { triggered: true, confidence: 0.9, reason: 'yes' };
          }
          return { score: 0.5, strengths: [], weaknesses: [], reason: 'ok' };
        }),
      };
      const evaluator = new SkillEvaluator(judge as any);

      const summary = await evaluator.evaluate('s', 'v1', skillContent, [makeTestCase()]);

      expect(summary.testResults[0].passed).toBe(true);
    });

    test('executionSuccess is true when triggered and quality > 0', async () => {
      const judge = makeJudge();
      const evaluator = new SkillEvaluator(judge as any);

      const summary = await evaluator.evaluate('s', 'v1', skillContent, [makeTestCase()]);

      expect(summary.testResults[0].details.executionSuccess).toBe(true);
    });

    test('executionSuccess is false when not triggered', async () => {
      const judge = {
        judge: vi.fn(async (opts: any) => {
          if (opts.taskName === 'trigger-check') {
            return { triggered: false, confidence: 0.1, reason: 'no' };
          }
          return { score: 0.8, strengths: [], weaknesses: [], reason: 'ok' };
        }),
      };
      const evaluator = new SkillEvaluator(judge as any);

      const summary = await evaluator.evaluate('s', 'v1', skillContent, [makeTestCase()]);

      expect(summary.testResults[0].details.executionSuccess).toBe(false);
    });

    test('executionSuccess is false when triggered but quality is 0', async () => {
      const judge = {
        judge: vi.fn(async (opts: any) => {
          if (opts.taskName === 'trigger-check') {
            return { triggered: true, confidence: 0.9, reason: 'yes' };
          }
          return { score: 0, strengths: [], weaknesses: ['zero'], reason: 'fail' };
        }),
      };
      const evaluator = new SkillEvaluator(judge as any);

      const summary = await evaluator.evaluate('s', 'v1', skillContent, [makeTestCase()]);

      expect(summary.testResults[0].details.executionSuccess).toBe(false);
    });

    test('computes metrics correctly for multiple test cases', async () => {
      let callIndex = 0;
      const judge = {
        judge: vi.fn(async (opts: any) => {
          callIndex++;
          if (opts.taskName === 'trigger-check') {
            // TC1: triggered, TC2: not triggered, TC3: triggered
            const idx = Math.ceil(callIndex / 2);
            return {
              triggered: idx !== 2,
              confidence: 0.9,
              reason: 'test',
            };
          }
          // Quality scores: TC1=0.8, TC2=0.6, TC3=0.4
          const idx = Math.ceil(callIndex / 2);
          const scores = [0.8, 0.6, 0.4];
          return {
            score: scores[idx - 1] ?? 0.5,
            strengths: [],
            weaknesses: [],
            reason: 'test',
          };
        }),
      };
      const evaluator = new SkillEvaluator(judge as any);

      const summary = await evaluator.evaluate('s', 'v1', skillContent, [
        makeTestCase({ id: 'tc1' }),
        makeTestCase({ id: 'tc2' }),
        makeTestCase({ id: 'tc3' }),
      ]);

      expect(summary.testResults).toHaveLength(3);

      // successRate: TC1 passes (triggered + 0.8>=0.5), TC2 fails (not triggered), TC3 fails (triggered but 0.4<0.5)
      // => 1/3
      expect(summary.metrics.successRate).toBeCloseTo(1 / 3, 2);

      // triggerPrecision: TC1 and TC3 triggered = 2/3
      expect(summary.metrics.triggerPrecision).toBeCloseTo(2 / 3, 2);

      // avgOutputQuality: (0.8 + 0.6 + 0.4) / 3 = 0.6
      expect(summary.metrics.avgOutputQuality).toBeCloseTo(0.6, 2);
    });

    test('handles zero test cases without division error', async () => {
      const judge = makeJudge();
      const evaluator = new SkillEvaluator(judge as any);

      const summary = await evaluator.evaluate('s', 'v1', skillContent, []);

      // total = max(0, 1) = 1, so metrics are all 0
      expect(summary.testResults).toHaveLength(0);
      expect(summary.metrics.successRate).toBe(0);
      expect(summary.metrics.triggerPrecision).toBe(0);
      expect(summary.metrics.avgOutputQuality).toBe(0);
      expect(summary.compositeScore).toBeGreaterThanOrEqual(0);
    });

    test('tracks budget consumption per test case', async () => {
      const judge = makeJudge();
      const evaluator = new SkillEvaluator(judge as any);

      const summary = await evaluator.evaluate('s', 'v1', skillContent, [
        makeTestCase({ id: 'tc1' }),
        makeTestCase({ id: 'tc2' }),
      ]);

      // 2 test cases * 2 calls * ~800 tokens = 3200
      expect(summary.budgetConsumed.totalTokens).toBe(3200);
      expect(summary.budgetConsumed.llmCalls).toBe(4);
      expect(summary.budgetConsumed.wallClockMs).toBeGreaterThanOrEqual(0);
    });

    test('records budget consumption when budget object provided', async () => {
      const budget = {
        isExhausted: vi.fn(() => false),
        recordLLMCall: vi.fn(),
      };
      const judge = makeJudge();
      const evaluator = new SkillEvaluator(judge as any);

      await evaluator.evaluate('s', 'v1', skillContent, [makeTestCase()], budget as any);

      expect(budget.recordLLMCall).toHaveBeenCalledWith(1600, expect.any(Number));
    });

    test('aborts remaining test cases when budget exhausted', async () => {
      const budget = {
        isExhausted: vi.fn()
          .mockReturnValueOnce(false)  // TC1 check
          .mockReturnValueOnce(true),  // TC2 check -> exhausted
        recordLLMCall: vi.fn(),
      };
      const judge = makeJudge();
      const evaluator = new SkillEvaluator(judge as any);

      const summary = await evaluator.evaluate('s', 'v1', skillContent, [
        makeTestCase({ id: 'tc1' }),
        makeTestCase({ id: 'tc2' }),
        makeTestCase({ id: 'tc3' }),
      ], budget as any);

      // Only TC1 should have been evaluated
      expect(summary.testResults).toHaveLength(1);
      expect(summary.testResults[0].testCaseId).toBe('tc1');
    });

    test('computes complexityScore from skillContent', async () => {
      const judge = makeJudge();
      const evaluator = new SkillEvaluator(judge as any);

      const complexContent = '# H1\n## H2\nif this\nwhen that\n```\ncode\n```';
      const summary = await evaluator.evaluate('s', 'v1', complexContent, [makeTestCase()]);

      // Should match measureComplexity result
      expect(summary.metrics.complexityScore).toBe(measureComplexity(complexContent));
    });

    test('uses validateOutput functions for trigger check', async () => {
      const judge = {
        judge: vi.fn(async (opts: any) => {
          // Call the validateOutput to check its behavior
          if (opts.taskName === 'trigger-check') {
            const validator = opts.validateOutput;
            // Valid
            expect(validator({ triggered: true, confidence: 0.5, reason: 'ok' })).toBeTruthy();
            // Invalid: no triggered
            expect(validator({ confidence: 0.5, reason: 'ok' })).toBeNull();
            // Invalid: null
            expect(validator(null)).toBeNull();
            // Invalid: not object
            expect(validator('string')).toBeNull();
            // Invalid: confidence out of range
            expect(validator({ triggered: true, confidence: 1.5, reason: 'ok' })).toBeNull();
            // Invalid: confidence negative
            expect(validator({ triggered: true, confidence: -0.1, reason: 'ok' })).toBeNull();
            // Invalid: reason not string
            expect(validator({ triggered: true, confidence: 0.5, reason: 123 })).toBeNull();
            // Invalid: triggered not boolean
            expect(validator({ triggered: 'yes', confidence: 0.5, reason: 'ok' })).toBeNull();

            return { triggered: true, confidence: 0.9, reason: 'ok' };
          }
          return { score: 0.8, strengths: [], weaknesses: [], reason: 'ok' };
        }),
      };
      const evaluator = new SkillEvaluator(judge as any);
      await evaluator.evaluate('s', 'v1', skillContent, [makeTestCase()]);
    });

    test('uses validateOutput functions for quality check', async () => {
      const judge = {
        judge: vi.fn(async (opts: any) => {
          if (opts.taskName === 'trigger-check') {
            return { triggered: true, confidence: 0.9, reason: 'ok' };
          }
          if (opts.taskName === 'output-quality') {
            const validator = opts.validateOutput;
            // Valid
            expect(validator({ score: 0.8, strengths: ['a'], weaknesses: ['b'], reason: 'ok' })).toBeTruthy();
            // Invalid: null
            expect(validator(null)).toBeNull();
            // Invalid: string
            expect(validator('string')).toBeNull();
            // Invalid: no score
            expect(validator({ strengths: [], weaknesses: [], reason: 'ok' })).toBeNull();
            // Invalid: score out of range (>1)
            expect(validator({ score: 1.5, strengths: [], weaknesses: [], reason: 'ok' })).toBeNull();
            // Invalid: score negative
            expect(validator({ score: -0.1, strengths: [], weaknesses: [], reason: 'ok' })).toBeNull();
            // Invalid: strengths not array
            expect(validator({ score: 0.5, strengths: 'good', weaknesses: [], reason: 'ok' })).toBeNull();
            // Invalid: weaknesses not array
            expect(validator({ score: 0.5, strengths: [], weaknesses: 'bad', reason: 'ok' })).toBeNull();
            // Invalid: reason not string
            expect(validator({ score: 0.5, strengths: [], weaknesses: [], reason: 42 })).toBeNull();

            return { score: 0.8, strengths: [], weaknesses: [], reason: 'ok' };
          }
          return {};
        }),
      };
      const evaluator = new SkillEvaluator(judge as any);
      await evaluator.evaluate('s', 'v1', skillContent, [makeTestCase()]);
    });

    test('uses defaultValue for trigger check', async () => {
      const judge = {
        judge: vi.fn(async (opts: any) => {
          if (opts.taskName === 'trigger-check') {
            // Verify defaultValue shape
            expect(opts.defaultValue).toEqual({
              triggered: false,
              confidence: 0,
              reason: 'Judge call failed',
            });
            return opts.defaultValue; // simulate failure fallback
          }
          return { score: 0.8, strengths: [], weaknesses: [], reason: 'ok' };
        }),
      };
      const evaluator = new SkillEvaluator(judge as any);

      const summary = await evaluator.evaluate('s', 'v1', skillContent, [makeTestCase()]);

      // With defaultValue, triggered=false → passed=false
      expect(summary.testResults[0].passed).toBe(false);
      expect(summary.testResults[0].details.triggered).toBe(false);
    });

    test('uses defaultValue for quality check', async () => {
      const judge = {
        judge: vi.fn(async (opts: any) => {
          if (opts.taskName === 'trigger-check') {
            return { triggered: true, confidence: 0.9, reason: 'ok' };
          }
          if (opts.taskName === 'output-quality') {
            expect(opts.defaultValue).toEqual({
              score: 0,
              strengths: [],
              weaknesses: ['Evaluation failed'],
              reason: 'Judge call failed',
            });
            return opts.defaultValue;
          }
          return {};
        }),
      };
      const evaluator = new SkillEvaluator(judge as any);

      const summary = await evaluator.evaluate('s', 'v1', skillContent, [makeTestCase()]);

      // With defaultValue, score=0 → passed=false (triggered but quality < 0.5)
      expect(summary.testResults[0].passed).toBe(false);
      expect(summary.testResults[0].details.outputQuality).toBe(0);
    });

    test('composite score uses computeCompositeScore function', async () => {
      const judge = makeJudge();
      const evaluator = new SkillEvaluator(judge as any);

      const summary = await evaluator.evaluate('s', 'v1', skillContent, [makeTestCase()]);

      // Manually compute expected composite
      const expected = computeCompositeScore(summary.metrics);
      expect(summary.compositeScore).toBe(expected);
    });

    test('handles single passing test case metrics', async () => {
      const judge = makeJudge();
      const evaluator = new SkillEvaluator(judge as any);

      const summary = await evaluator.evaluate('s', 'v1', skillContent, [makeTestCase()]);

      // 1 test case, passes → successRate=1, triggerPrecision=1
      expect(summary.metrics.successRate).toBe(1);
      expect(summary.metrics.triggerPrecision).toBe(1);
    });

    test('handles budget not provided (optional parameter)', async () => {
      const judge = makeJudge();
      const evaluator = new SkillEvaluator(judge as any);

      // No budget parameter — should not throw
      const summary = await evaluator.evaluate('s', 'v1', skillContent, [makeTestCase()]);
      expect(summary.testResults).toHaveLength(1);
    });
  });
});
