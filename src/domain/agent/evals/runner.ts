/**
 * Eval runner — wires an EvalCase through the chosen response source
 * (fixture or live LLM) and into the assertion evaluator.
 *
 * The runner has no I/O of its own — it depends on the FixtureStore and
 * EvalLLMClient passed in. That keeps it 100 % unit-testable with stubs.
 *
 * Two modes:
 *   - 'fixture': read response from disk; never touch the LLM. Used in CI.
 *   - 'live':    call the LLM; optionally record the response back to disk.
 */

import { evaluateAssertion } from './assertions';
import { computePromptHash, FixtureStore } from './fixture-store';
import type {
  EvalCase,
  EvalRunResult,
  EvalSuiteResult,
  EvalLLMClient,
  EvalToolCall,
  AssertionResult,
} from './types';

export interface RunOptions {
  mode: 'fixture' | 'live';
  /** The system prompt used for hash and (in live mode) for the LLM call. */
  resolveSystemPrompt: (testCase: EvalCase) => string;
  /** The model id used for hash and (in live mode) for the LLM call. */
  model: string;
  fixtureStore: FixtureStore;
  /** Required when mode='live'. */
  llmClient?: EvalLLMClient;
  /**
   * Live-mode only. When true, save the captured response back to disk.
   * Default: false (live runs don't overwrite fixtures unless explicitly
   * asked to record).
   */
  recordOnLive?: boolean;
}

export async function runEvalCase(
  testCase: EvalCase,
  opts: RunOptions,
): Promise<EvalRunResult> {
  const startedAt = Date.now();
  const systemPrompt = opts.resolveSystemPrompt(testCase);
  const promptHash = computePromptHash({
    systemPrompt,
    userMessage: testCase.userMessage,
    model: opts.model,
  });

  let responseText = '';
  let toolCalls: EvalToolCall[] = [];
  let source: 'fixture' | 'live' = opts.mode;
  let fixtureId: string | undefined;
  let runtimeError: string | undefined;

  try {
    if (opts.mode === 'fixture') {
      const fixture = opts.fixtureStore.load(testCase.id, promptHash);
      if (!fixture) {
        return runtimeFailure(testCase, source,
          `fixture for "${testCase.id}" not found. Record with --record first.`,
          Date.now() - startedAt);
      }
      responseText = fixture.responseText;
      toolCalls = fixture.toolCalls;
      fixtureId = testCase.id;
    } else {
      if (!opts.llmClient) {
        return runtimeFailure(testCase, source, 'live mode but no llmClient supplied', Date.now() - startedAt);
      }
      const out = await opts.llmClient.complete({
        systemPrompt,
        userMessage: testCase.userMessage,
        model: opts.model,
      });
      responseText = out.text;
      toolCalls = out.toolCalls;

      if (opts.recordOnLive) {
        opts.fixtureStore.save(FixtureStore.newFixture(
          testCase.id, opts.model, promptHash, responseText, toolCalls,
        ));
      }
    }
  } catch (e) {
    return runtimeFailure(testCase, source, (e as Error).message, Date.now() - startedAt);
  }

  const ctx = { text: responseText, toolCalls };
  const assertions: AssertionResult[] = testCase.assertions.map(a => evaluateAssertion(a, ctx));
  const passed = assertions.every(r => r.passed);

  return {
    caseId: testCase.id,
    passed,
    assertions,
    responseText,
    toolCalls,
    durationMs: Date.now() - startedAt,
    source,
    fixtureId,
    error: runtimeError,
  };
}

function runtimeFailure(
  testCase: EvalCase,
  source: 'fixture' | 'live',
  message: string,
  durationMs: number,
): EvalRunResult {
  return {
    caseId: testCase.id,
    passed: false,
    assertions: testCase.assertions.map(a => ({
      assertion: a, passed: false,
      message: `not evaluated: ${message}`,
    })),
    responseText: '',
    toolCalls: [],
    durationMs,
    source,
    error: message,
  };
}

/** Run a list of cases sequentially and return an aggregated suite result. */
export async function runEvalSuite(
  cases: EvalCase[],
  opts: RunOptions,
): Promise<EvalSuiteResult> {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const results: EvalRunResult[] = [];
  for (const c of cases) {
    results.push(await runEvalCase(c, opts));
  }
  const durationMs = Date.now() - start;
  return {
    total: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    cases: results,
    startedAt,
    durationMs,
  };
}
