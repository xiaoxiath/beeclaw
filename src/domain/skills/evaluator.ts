/**
 * Immutable evaluation harness for skill assessment.
 *
 * Analogous to autoresearch's prepare.py — this is the evaluation boundary.
 * It must NEVER be modified by the ExperimentEngine. All mutations flow
 * through skill content; the evaluator itself is a fixed measurement instrument.
 */

import { logger } from "../../infra/observability/logger";
import type { FastLLMJudge } from "../agent/fast-llm-judge";
import { TRIGGER_CHECK_PROMPT, OUTPUT_QUALITY_PROMPT } from "./prompts/eval-prompts";
import { ExperimentBudget } from "./experiment-budget";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface TestCase {
  id: string;
  input: string;
  expectedBehavior: string;
  evaluationCriteria: string[];
}

export interface TestCaseResult {
  testCaseId: string;
  passed: boolean;
  score: number; // 0-1
  details: {
    triggered: boolean;
    executionSuccess: boolean;
    outputQuality: number;
    executionTimeMs: number;
  };
}

export interface EvalSummary {
  skillName: string;
  versionId: string;
  timestamp: number;
  metrics: {
    successRate: number;
    triggerPrecision: number;
    avgOutputQuality: number;
    avgExecutionTimeMs: number;
    complexityScore: number;
  };
  compositeScore: number;
  testResults: TestCaseResult[];
  budgetConsumed: {
    totalTokens: number;
    wallClockMs: number;
    llmCalls: number;
  };
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

interface CompositeMetrics {
  successRate: number;
  triggerPrecision: number;
  avgOutputQuality: number;
  avgExecutionTimeMs: number;
  complexityScore: number;
}

/**
 * Weighted composite score.
 *
 * Weights:
 *   0.35 successRate
 *   0.25 triggerPrecision
 *   0.20 avgOutputQuality
 *   0.12 simplicityBonus  (inversely proportional to complexity)
 *   0.08 speedBonus       (inversely proportional to avg execution time)
 */
export function computeCompositeScore(metrics: CompositeMetrics): number {
  // simplicityBonus: complexity 0 → 1.0, complexity 300 → 0.0
  const simplicityBonus = Math.max(0, 1 - metrics.complexityScore / 300);

  // speedBonus: 0 ms → 1.0, >= 10 000 ms → 0.0 (linear decay)
  const speedBonus = Math.max(0, 1 - metrics.avgExecutionTimeMs / 10_000);

  const score =
    0.35 * metrics.successRate +
    0.25 * metrics.triggerPrecision +
    0.20 * metrics.avgOutputQuality +
    0.12 * simplicityBonus +
    0.08 * speedBonus;

  return Math.round(score * 1000) / 1000; // three-decimal precision
}

/**
 * Heuristic complexity measure for a skill's textual content.
 *
 * Formula: lines * 0.5 + conditionals * 5 + sections * 2 + codeBlocks * 3
 * Capped at 300.
 */
export function measureComplexity(skillContent: string): number {
  const lines = skillContent.split("\n").length;

  // Conditionals: if/else/elif/switch/case/when/unless and ternary ?
  const conditionalPattern = /\b(if|else|elif|else\s+if|switch|case|when|unless)\b|\?\s*[^:]+\s*:/g;
  const conditionals = (skillContent.match(conditionalPattern) ?? []).length;

  // Sections: markdown headings (# ... ######)
  const sectionPattern = /^#{1,6}\s+/gm;
  const sections = (skillContent.match(sectionPattern) ?? []).length;

  // Code blocks: fenced ```
  const codeBlockPattern = /^```/gm;
  const codeBlockMarkers = (skillContent.match(codeBlockPattern) ?? []).length;
  const codeBlocks = Math.floor(codeBlockMarkers / 2);

  const raw = lines * 0.5 + conditionals * 5 + sections * 2 + codeBlocks * 3;
  return Math.min(raw, 300);
}

// ---------------------------------------------------------------------------
// Judge response shapes
// ---------------------------------------------------------------------------

interface TriggerJudgment {
  triggered: boolean;
  confidence: number;
  reason: string;
}

interface QualityJudgment {
  score: number;
  strengths: string[];
  weaknesses: string[];
  reason: string;
}

// ---------------------------------------------------------------------------
// Validators (pure functions, safe to call from hot path)
// ---------------------------------------------------------------------------

function validateTriggerOutput(output: unknown): TriggerJudgment | null {
  if (typeof output !== "object" || output === null) return null;
  const obj = output as Record<string, unknown>;
  if (typeof obj.triggered !== "boolean") return null;
  if (typeof obj.confidence !== "number" || obj.confidence < 0 || obj.confidence > 1) return null;
  if (typeof obj.reason !== "string") return null;
  return obj as unknown as TriggerJudgment;
}

function validateQualityOutput(output: unknown): QualityJudgment | null {
  if (typeof output !== "object" || output === null) return null;
  const obj = output as Record<string, unknown>;
  if (typeof obj.score !== "number" || obj.score < 0 || obj.score > 1) return null;
  if (!Array.isArray(obj.strengths)) return null;
  if (!Array.isArray(obj.weaknesses)) return null;
  if (typeof obj.reason !== "string") return null;
  return obj as unknown as QualityJudgment;
}

// ---------------------------------------------------------------------------
// SkillEvaluator
// ---------------------------------------------------------------------------

export class SkillEvaluator {
  private readonly judge: FastLLMJudge;

  constructor(judge: FastLLMJudge) {
    this.judge = judge;
  }

  /**
   * Run the full evaluation suite for a skill version.
   *
   * @param skillName    Human-readable name of the skill.
   * @param versionId    Unique version identifier (e.g. git SHA or counter).
   * @param skillContent Raw textual content of the skill definition.
   * @param testCases    Test inputs and expectations.
   * @param budget       Optional budget guard — evaluation aborts early if exceeded.
   * @returns            An immutable EvalSummary with composite score and per-case results.
   */
  async evaluate(
    skillName: string,
    versionId: string,
    skillContent: string,
    testCases: ReadonlyArray<TestCase>,
    budget?: ExperimentBudget,
  ): Promise<EvalSummary> {
    const evalStart = Date.now();
    logger.info(`[SkillEvaluator] Starting evaluation of "${skillName}" v${versionId} with ${testCases.length} test case(s)`);

    const testResults: TestCaseResult[] = [];
    let totalTokens = 0;
    let llmCalls = 0;

    for (const testCase of testCases) {
      if (budget?.isExhausted()) {
        logger.warn(`[SkillEvaluator] Budget exhausted — aborting remaining test cases for "${skillName}"`);
        break;
      }

      const caseStart = Date.now();
      const result = await this.evaluateTestCase(skillContent, testCase, this.judge);
      const caseElapsed = Date.now() - caseStart;

      // Approximate token usage: 2 judge calls per test case (trigger + quality).
      // Actual token counts would come from the LLM provider; we track call count here.
      llmCalls += 2;
      // Rough heuristic: ~800 tokens per judge call (prompt + response).
      totalTokens += 1600;

      if (budget) {
        budget.recordLLMCall(1600, caseElapsed);
      }

      testResults.push(result);
      logger.debug(
        `[SkillEvaluator] TestCase "${testCase.id}" — passed=${result.passed}, score=${result.score}, time=${result.details.executionTimeMs}ms`,
      );
    }

    const wallClockMs = Date.now() - evalStart;

    // Aggregate metrics
    const total = testResults.length || 1; // guard against zero-division
    const successRate = testResults.filter((r) => r.passed).length / total;
    const triggerPrecision = testResults.filter((r) => r.details.triggered).length / total;
    const avgOutputQuality =
      testResults.reduce((sum, r) => sum + r.details.outputQuality, 0) / total;
    const avgExecutionTimeMs =
      testResults.reduce((sum, r) => sum + r.details.executionTimeMs, 0) / total;
    const complexityScore = measureComplexity(skillContent);

    const metrics = {
      successRate,
      triggerPrecision,
      avgOutputQuality,
      avgExecutionTimeMs,
      complexityScore,
    };

    const compositeScore = computeCompositeScore(metrics);

    logger.info(
      `[SkillEvaluator] Evaluation complete for "${skillName}" v${versionId} — composite=${compositeScore}, success=${successRate.toFixed(2)}, wall=${wallClockMs}ms`,
    );

    return {
      skillName,
      versionId,
      timestamp: Date.now(),
      metrics,
      compositeScore,
      testResults,
      budgetConsumed: {
        totalTokens,
        wallClockMs,
        llmCalls,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async evaluateTestCase(
    skillContent: string,
    testCase: TestCase,
    judge: FastLLMJudge,
  ): Promise<TestCaseResult> {
    const caseStart = Date.now();

    // --- Step 1: Trigger check ---
    const triggerResult = await judge.judge<TriggerJudgment>({
      taskName: "trigger-check",
      promptTemplate: TRIGGER_CHECK_PROMPT,
      promptVariables: {
        skillName: "Skill",
        skillDescription: skillContent,
        userMessage: testCase.input,
      },
      validateOutput: validateTriggerOutput,
      defaultValue: { triggered: false, confidence: 0, reason: "Judge call failed" },
    });

    // --- Step 2: Output quality ---
    const qualityResult = await judge.judge<QualityJudgment>({
      taskName: "output-quality",
      promptTemplate: OUTPUT_QUALITY_PROMPT,
      promptVariables: {
        skillContent,
        userMessage: testCase.input,
        expectedBehavior: testCase.expectedBehavior,
        criteria: testCase.evaluationCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n"),
      },
      validateOutput: validateQualityOutput,
      defaultValue: { score: 0, strengths: [], weaknesses: ["Evaluation failed"], reason: "Judge call failed" },
    });

    const executionTimeMs = Date.now() - caseStart;

    // A test case passes when the skill triggers AND the quality score meets
    // a minimum bar (0.5). This keeps the bar meaningful without being harsh
    // during early experimental iterations.
    const triggerData = 'result' in triggerResult ? triggerResult.result : triggerResult;
    const qualityData = 'result' in qualityResult ? qualityResult.result : qualityResult;

    const passed = triggerData.triggered && qualityData.score >= 0.5;

    return {
      testCaseId: testCase.id,
      passed,
      score: qualityData.score,
      details: {
        triggered: triggerData.triggered,
        executionSuccess: triggerData.triggered && qualityData.score > 0,
        outputQuality: qualityData.score,
        executionTimeMs,
      },
    };
  }
}
