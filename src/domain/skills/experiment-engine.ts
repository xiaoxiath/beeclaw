/**
 * ExperimentEngine — autoresearch-style experiment loop for skill improvement.
 *
 * This is the orchestrator that ties together versioning, evaluation, budgeting,
 * and ledger modules to iteratively improve a skill via hypothesis-driven
 * experimentation.  Each round:
 *   1. Generates one hypothesis (via FastLLMJudge).
 *   2. Snapshots the current version (via SkillVersionStore).
 *   3. Applies the hypothesis to produce a new skill definition.
 *   4. Evaluates the new version (via SkillEvaluator).
 *   5. Decides keep / discard using the Simplicity Criterion.
 *   6. Records the outcome in the experiment ledger.
 *
 * The loop exits early when the budget is exhausted, when the judge can no
 * longer generate new hypotheses, or when maxRounds is reached.
 */

import { logger } from '../../infra/observability/logger';
import { SkillVersionStore } from './versioning';
import { SkillEvaluator } from './evaluator';
import type { EvalSummary, TestCase } from './evaluator';
import { ExperimentBudget, EXPERIMENT_BUDGET_PRESETS } from './experiment-budget';
import { ExperimentLedger } from './experiment-ledger';
import type { FastLLMJudge } from '../agent/fast-llm-judge';
import { getSkillStore } from './store';
import type { SkillEvals } from './types';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ExperimentConfig {
  skillName: string;
  /** Maximum number of hypothesis rounds. @default 5 */
  maxRounds: number;
  /** Budget preset governing token / time / call limits. */
  budgetPreset: 'quick' | 'standard' | 'deep';
  /** When `false` the engine will still auto-decide but the caller can intercept. @default false */
  autoDecision: boolean;
  /** Maximum allowed relative complexity growth per round (0.2 = 20%). @default 0.2 */
  maxComplexityGrowth: number;
}

export interface Hypothesis {
  /** Human-readable description of the improvement idea. */
  description: string;
  /** The concrete SKILL.md modification instructions. */
  changes: string;
  /** Why the author expects this to help. */
  rationale: string;
}

export interface ExperimentResult {
  round: number;
  hypothesis: string;
  beforeScore: number;
  afterScore: number;
  decision: 'keep' | 'discard' | 'crash';
  reason: string;
  versionId: string;
}

export interface ExperimentReport {
  skillName: string;
  startTime: string;
  endTime: string;
  totalRounds: number;
  results: ExperimentResult[];
  baselineScore: number;
  finalScore: number;
  /** Absolute improvement (finalScore - baselineScore). */
  improvement: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Omit<ExperimentConfig, 'skillName'> = {
  maxRounds: 5,
  budgetPreset: 'standard',
  autoDecision: false,
  maxComplexityGrowth: 0.2,
};

// ---------------------------------------------------------------------------
// Prompt templates
// ---------------------------------------------------------------------------

const HYPOTHESIS_PROMPT = `You are a skill-improvement researcher. Your goal is to propose ONE concrete
improvement hypothesis for the skill below.

## Current skill definition
\`\`\`
{skillContent}
\`\`\`

## Current evaluation results
- Composite score: {compositeScore}
- Success rate: {successRate}
- Trigger precision: {triggerPrecision}
- Output quality: {avgOutputQuality}
- Complexity score: {complexityScore}

## Failure details
{failureDetails}

## Previously attempted hypotheses (DO NOT repeat these)
{previousHypotheses}

## Guidelines
- Propose exactly ONE improvement.  Focus on the weakest metric.
- Prefer simplifications that remove unnecessary complexity while maintaining capability.
- The Simplicity Criterion: a change should either improve the score by >= 0.03 OR reduce
  complexity by >= 15 % without hurting the score.
- Be concrete: specify exactly what text to add, remove, or change.

Respond with a JSON object:
{{
  "description": "<one-line summary>",
  "changes": "<detailed modification instructions for the SKILL.md>",
  "rationale": "<why this should improve the score>"
}}

If you believe no further meaningful improvement is possible, respond with:
{{ "description": "NO_MORE_HYPOTHESES", "changes": "", "rationale": "" }}`;

const APPLY_HYPOTHESIS_PROMPT = `You are a skill-definition editor. Apply the requested modification to the SKILL.md content below.

## Current SKILL.md
\`\`\`
{currentContent}
\`\`\`

## Modification instructions
{changes}

## Rules
1. You MUST preserve the YAML frontmatter header (the block between --- delimiters) exactly as-is
   unless the modification instructions explicitly target frontmatter fields.
2. Return ONLY the complete, modified SKILL.md content — no commentary, no wrapping code fences.
3. Do NOT add any meta-commentary such as "Here is the modified file".

Return the full modified SKILL.md content now:`;

// ---------------------------------------------------------------------------
// ExperimentEngine
// ---------------------------------------------------------------------------

export class ExperimentEngine {
  constructor(
    private readonly versioning: SkillVersionStore,
    private readonly evaluator: SkillEvaluator,
    private readonly judge: FastLLMJudge,
    private readonly ledger: ExperimentLedger,
  ) {}

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Run the full experiment loop for a given skill.
   *
   * @returns An {@link ExperimentReport} summarising every round and the net improvement.
   */
  async run(config: Partial<ExperimentConfig> & Pick<ExperimentConfig, 'skillName'>): Promise<ExperimentReport> {
    const cfg: ExperimentConfig = { ...DEFAULT_CONFIG, ...config };
    const { skillName, maxRounds, budgetPreset } = cfg;

    const startTime = new Date().toISOString();
    const results: ExperimentResult[] = [];

    logger.info(`[ExperimentEngine] Starting experiment for "${skillName}"`, {
      maxRounds,
      budgetPreset,
      autoDecision: cfg.autoDecision,
      maxComplexityGrowth: cfg.maxComplexityGrowth,
    });

    // ---- Phase 1: Bootstrap ------------------------------------------------

    // 1a. Retrieve current skill content from SkillStore.
    const store = getSkillStore();
    const skill = store.get(skillName);
    if (!skill) {
      throw new Error(`Skill "${skillName}" not found in SkillStore`);
    }
    let currentContent = skill.content;

    // 1b. Load test cases for evaluation.
    const testCases = await this.getTestCases(skillName);
    if (testCases.length === 0) {
      throw new Error(
        `No test cases found for skill "${skillName}". ` +
        'Create evals before running experiments.',
      );
    }

    // 1c. Create a baseline snapshot.
    const baselineSnapshot = this.versioning.snapshot(
      skillName,
      currentContent,
      'experiment baseline',
      'agent',
    );
    logger.info(`[ExperimentEngine] Baseline snapshot: ${baselineSnapshot.versionId}`);

    // 1d. Create the budget tracker.
    const budget = new ExperimentBudget(EXPERIMENT_BUDGET_PRESETS[budgetPreset]);

    // 1e. Evaluate the baseline.
    const baselineEval = await this.evaluator.evaluate(
      skillName,
      baselineSnapshot.versionId,
      currentContent,
      testCases,
      budget,
    );
    const baselineScore = baselineEval.compositeScore;

    logger.info(`[ExperimentEngine] Baseline score: ${baselineScore.toFixed(4)}`, {
      successRate: baselineEval.metrics.successRate,
      triggerPrecision: baselineEval.metrics.triggerPrecision,
      avgOutputQuality: baselineEval.metrics.avgOutputQuality,
      complexityScore: baselineEval.metrics.complexityScore,
    });

    // 1f. Log baseline to ledger.
    this.ledger.log(
      skillName,
      baselineEval.compositeScore,
      baselineEval.metrics.successRate,
      baselineEval.metrics.complexityScore,
      baselineSnapshot.versionId,
      'keep',
      'experiment baseline',
    );

    // ---- Phase 2: Experiment loop ------------------------------------------

    let currentEval = baselineEval;

    for (let round = 1; round <= maxRounds; round++) {
      logger.info(`[ExperimentEngine] ---- Round ${round}/${maxRounds} ----`);

      // Step 8 (checked at loop top for rounds > 1): budget guard.
      if (budget.isExhausted()) {
        logger.warn('[ExperimentEngine] Budget exhausted — stopping experiment loop.');
        break;
      }

      // Step 1: Generate hypothesis.
      const hypothesis = await this.generateHypothesis(
        skillName,
        currentContent,
        currentEval,
        results,
      );

      if (!hypothesis) {
        logger.info('[ExperimentEngine] No more hypotheses — stopping experiment loop.');
        break;
      }

      logger.info(`[ExperimentEngine] Hypothesis: ${hypothesis.description}`);

      // Step 2: Create snapshot of current (pre-modification) state.
      const preSnapshot = this.versioning.snapshot(
        skillName,
        currentContent,
        `pre-round-${round}`,
        'agent',
      );

      let result: ExperimentResult;

      try {
        // Step 3: Apply hypothesis to produce modified content.
        const modifiedContent = await this.applyHypothesis(currentContent, hypothesis);

        // Step 4: Snapshot the modified version & evaluate.
        const modifiedSnapshot = this.versioning.snapshot(
          skillName,
          modifiedContent,
          `hypothesis: ${hypothesis.description}`,
          'agent',
        );

        const modifiedEval = await this.evaluator.evaluate(
          skillName,
          modifiedSnapshot.versionId,
          modifiedContent,
          testCases,
          budget,
        );

        logger.info(
          `[ExperimentEngine] Round ${round} scores — before: ${currentEval.compositeScore.toFixed(4)}, after: ${modifiedEval.compositeScore.toFixed(4)}`,
        );

        // Step 5: Decide keep / discard.
        const decision = this.decide(currentEval, modifiedEval, cfg);

        result = {
          round,
          hypothesis: hypothesis.description,
          beforeScore: currentEval.compositeScore,
          afterScore: modifiedEval.compositeScore,
          decision: decision.action,
          reason: decision.reason,
          versionId: modifiedSnapshot.versionId,
        };

        // Step 6: Apply decision.
        if (decision.action === 'keep') {
          logger.info(
            `[ExperimentEngine] KEEP round ${round}: ${decision.reason}`,
          );
          currentContent = modifiedContent;
          currentEval = modifiedEval;
          // currentVersionId tracked for potential future use
        } else {
          logger.info(
            `[ExperimentEngine] DISCARD round ${round}: ${decision.reason}`,
          );
          // Mark the modified snapshot as discarded; content reverts to pre-round.
          this.versioning.markDiscarded(
            skillName,
            modifiedSnapshot.versionId,
            decision.reason,
          );
        }

        // Step 7: Log to ledger.
        this.ledger.log(
          skillName,
          modifiedEval.compositeScore,
          modifiedEval.metrics.successRate,
          modifiedEval.metrics.complexityScore,
          modifiedSnapshot.versionId,
          decision.action,
          `round ${round}: ${hypothesis.description}`,
        );
      } catch (error) {
        // Crash path — hypothesis application or evaluation threw.
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`[ExperimentEngine] Round ${round} CRASHED: ${errorMsg}`);

        result = {
          round,
          hypothesis: hypothesis.description,
          beforeScore: currentEval.compositeScore,
          afterScore: currentEval.compositeScore,
          decision: 'crash',
          reason: errorMsg,
          versionId: preSnapshot.versionId,
        };

        // Log crash to ledger.
        this.ledger.log(
          skillName,
          currentEval.compositeScore,
          currentEval.metrics.successRate,
          currentEval.metrics.complexityScore,
          preSnapshot.versionId,
          'crash',
          `round ${round} crash: ${errorMsg}`,
        );
      }

      results.push(result);

      // Step 8: Re-check budget after the round.
      if (budget.isExhausted()) {
        logger.warn('[ExperimentEngine] Budget exhausted after round — stopping.');
        break;
      }
    }

    // ---- Phase 3: Build report ---------------------------------------------

    const endTime = new Date().toISOString();
    const finalScore = currentEval.compositeScore;

    const report: ExperimentReport = {
      skillName,
      startTime,
      endTime,
      totalRounds: results.length,
      results,
      baselineScore,
      finalScore,
      improvement: finalScore - baselineScore,
    };

    logger.info(
      `[ExperimentEngine] Experiment complete for "${skillName}": ` +
      `${results.length} round(s), baseline=${baselineScore.toFixed(4)}, ` +
      `final=${finalScore.toFixed(4)}, improvement=${report.improvement >= 0 ? '+' : ''}${report.improvement.toFixed(4)}`,
    );

    return report;
  }

  // -----------------------------------------------------------------------
  // Decision logic — the Simplicity Criterion
  // -----------------------------------------------------------------------

  /**
   * Decide whether to keep or discard a candidate version.
   *
   * The Simplicity Criterion encodes a preference for changes that either
   * meaningfully improve the composite score or significantly reduce
   * complexity without hurting it.
   */
  private decide(
    before: EvalSummary,
    after: EvalSummary,
    config: ExperimentConfig,
  ): { action: 'keep' | 'discard'; reason: string } {
    const scoreDelta = after.compositeScore - before.compositeScore;
    const complexityBefore = before.metrics.complexityScore;
    const complexityAfter = after.metrics.complexityScore;

    // Avoid division by zero when baseline complexity is 0.
    const complexityChange =
      complexityBefore > 0
        ? (complexityAfter - complexityBefore) / complexityBefore
        : complexityAfter > 0
          ? 1
          : 0;

    const complexityReduction = -complexityChange; // positive means simpler

    // Rule 1: Significant score improvement (>= 0.03) — keep regardless of complexity.
    if (scoreDelta >= 0.03) {
      return {
        action: 'keep',
        reason: `Significant improvement: score +${scoreDelta.toFixed(4)}`,
      };
    }

    // Rule 2: Positive improvement combined with simplification — keep.
    if (scoreDelta > 0 && complexityReduction > 0) {
      return {
        action: 'keep',
        reason: `Improvement (+${scoreDelta.toFixed(4)}) with simplification (${(complexityReduction * 100).toFixed(1)}% less complex)`,
      };
    }

    // Rule 3: Flat score but major simplification (>= 15% reduction) — keep.
    if (Math.abs(scoreDelta) < 0.01 && complexityReduction >= 0.15) {
      return {
        action: 'keep',
        reason: `Major simplification (${(complexityReduction * 100).toFixed(1)}%) with negligible score change (${scoreDelta.toFixed(4)})`,
      };
    }

    // Rule 4: Complexity explosion beyond the configured threshold — discard.
    if (complexityChange > config.maxComplexityGrowth) {
      return {
        action: 'discard',
        reason: `Complexity explosion: +${(complexityChange * 100).toFixed(1)}% exceeds max allowed ${(config.maxComplexityGrowth * 100).toFixed(0)}%`,
      };
    }

    // Rule 5: Marginal improvement that comes with a complexity cost — discard.
    if (scoreDelta > 0 && scoreDelta < 0.03 && complexityChange > 0) {
      return {
        action: 'discard',
        reason: `Marginal improvement (+${scoreDelta.toFixed(4)}) does not justify complexity increase (+${(complexityChange * 100).toFixed(1)}%)`,
      };
    }

    // Default: discard — no compelling reason to keep.
    return {
      action: 'discard',
      reason: `No compelling improvement: score delta ${scoreDelta.toFixed(4)}, complexity change ${(complexityChange * 100).toFixed(1)}%`,
    };
  }

  // -----------------------------------------------------------------------
  // Hypothesis generation
  // -----------------------------------------------------------------------

  /**
   * Use the FastLLMJudge to generate a single improvement hypothesis based on
   * current evaluation results and previously attempted ideas.
   *
   * Returns `null` when the judge signals that no more hypotheses are viable.
   */
  private async generateHypothesis(
    skillName: string,
    skillContent: string,
    baseline: EvalSummary,
    previousResults: ExperimentResult[],
  ): Promise<Hypothesis | null> {
    // Build a summary of failure details from the eval.
    const failureDetails = baseline.testResults
      .filter((r) => !r.passed)
      .map(
        (r) =>
          `- TestCase "${r.testCaseId}": score=${r.score.toFixed(2)}, ` +
          `triggered=${r.details.triggered}, quality=${r.details.outputQuality.toFixed(2)}`,
      )
      .join('\n') || '(all test cases passed)';

    // Build a summary of previous hypotheses so the judge avoids repeats.
    const previousHypotheses =
      previousResults.length > 0
        ? previousResults
            .map(
              (r) =>
                `- [${r.decision}] "${r.hypothesis}" (score: ${r.beforeScore.toFixed(4)} -> ${r.afterScore.toFixed(4)}, reason: ${r.reason})`,
            )
            .join('\n')
        : '(none — this is the first round)';

    const judgment = await this.judge.judge<Hypothesis>({
      taskName: `hypothesis-generation:${skillName}`,
      promptTemplate: HYPOTHESIS_PROMPT,
      promptVariables: {
        skillContent,
        compositeScore: baseline.compositeScore.toFixed(4),
        successRate: baseline.metrics.successRate.toFixed(4),
        triggerPrecision: baseline.metrics.triggerPrecision.toFixed(4),
        avgOutputQuality: baseline.metrics.avgOutputQuality.toFixed(4),
        complexityScore: baseline.metrics.complexityScore.toFixed(4),
        failureDetails,
        previousHypotheses,
      },
      validateOutput: (output: unknown): Hypothesis | null => {
        if (
          typeof output === 'object' &&
          output !== null &&
          'description' in output &&
          'changes' in output &&
          'rationale' in output
        ) {
          const h = output as Hypothesis;
          // Sentinel value indicating the judge sees no more improvements.
          if (h.description === 'NO_MORE_HYPOTHESES') return null;
          if (h.description && h.changes) return h;
        }
        return null;
      },
      defaultValue: { description: 'NO_MORE_HYPOTHESES', changes: '', rationale: '' },
      temperature: 0.4, // slightly creative for hypothesis generation
      maxTokens: 1024,
    });

    if (judgment.failed) {
      logger.warn(
        `[ExperimentEngine] Hypothesis generation failed: ${judgment.error ?? 'unknown'}`,
      );
      return null;
    }

    // The validate function returns null for the sentinel, but the judge wraps
    // it in a JudgmentResult so we also check the result value.
    const hyp = judgment.result;
    if (!hyp || hyp.description === 'NO_MORE_HYPOTHESES') {
      return null;
    }

    return hyp;
  }

  // -----------------------------------------------------------------------
  // Hypothesis application
  // -----------------------------------------------------------------------

  /**
   * Use the FastLLMJudge to rewrite the skill content according to a hypothesis.
   *
   * The prompt instructs the model to preserve the YAML frontmatter and return
   * the complete modified SKILL.md.
   */
  private async applyHypothesis(
    skillContent: string,
    hypothesis: Hypothesis,
  ): Promise<string> {
    const judgment = await this.judge.judge<string>({
      taskName: 'apply-hypothesis',
      promptTemplate: APPLY_HYPOTHESIS_PROMPT,
      promptVariables: {
        currentContent: skillContent,
        changes: hypothesis.changes,
      },
      validateOutput: (output: unknown): string | null => {
        // The model should return the raw markdown content.  When the judge
        // parses JSON it may wrap it in a string or return as-is.
        if (typeof output === 'string' && output.length > 0) {
          return output;
        }
        // If the model returned an object with a "content" field, accept that.
        if (
          typeof output === 'object' &&
          output !== null &&
          'content' in output &&
          typeof (output as Record<string, unknown>).content === 'string'
        ) {
          return (output as Record<string, unknown>).content as string;
        }
        return null;
      },
      defaultValue: skillContent, // fallback: unchanged content
      temperature: 0.1, // deterministic rewriting
      maxTokens: 4096,
    });

    if (judgment.failed) {
      logger.warn(
        `[ExperimentEngine] Hypothesis application failed: ${judgment.error ?? 'unknown'} — returning original content`,
      );
      return skillContent;
    }

    const modified = judgment.result;

    // Sanity check: the modified content must still contain frontmatter.
    if (!modified.includes('---')) {
      logger.warn(
        '[ExperimentEngine] Modified content lost frontmatter — discarding modification',
      );
      return skillContent;
    }

    return modified;
  }

  // -----------------------------------------------------------------------
  // Test-case retrieval
  // -----------------------------------------------------------------------

  /**
   * Load test cases from the SkillStore's evals directory and map them into the
   * {@link TestCase} shape expected by the evaluator.
   */
  private async getTestCases(skillName: string): Promise<TestCase[]> {
    const store = getSkillStore();
    const result = store.getEvals(skillName);

    if (!result.success || !result.data) {
      logger.warn(`[ExperimentEngine] No evals available for "${skillName}"`);
      return [];
    }

    const evals = result.data as SkillEvals;

    return evals.evals.map((ev) => ({
      id: String(ev.id),
      input: ev.prompt,
      expectedBehavior: ev.expected_output ?? '',
      evaluationCriteria: ev.expectations ?? [],
    }));
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Convenience factory that wires up the ExperimentEngine with default
 * infrastructure (versioning, evaluator, ledger) rooted under `dataDir`.
 *
 * @param judge   A pre-configured {@link FastLLMJudge} instance.
 * @param dataDir Root directory for experiment artefacts. Defaults to `data/experiments`.
 */
export function createExperimentEngine(
  judge: FastLLMJudge,
  dataDir = 'data/experiments',
): ExperimentEngine {
  const versioning = new SkillVersionStore(dataDir);
  const evaluator = new SkillEvaluator(judge);
  const ledger = new ExperimentLedger(dataDir);

  return new ExperimentEngine(versioning, evaluator, judge, ledger);
}
