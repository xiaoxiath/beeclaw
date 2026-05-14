/**
 * Public API for the prompt-evaluation framework.
 *
 * Wire this in as:
 *   import { runEvalSuite, FixtureStore, DEFAULT_EVAL_CASES } from '@/domain/agent/evals';
 *
 * See README.md in this directory (TBD) and scripts/run-prompt-evals.ts for
 * the operator workflow.
 */

export type {
  EvalCase,
  EvalAssertion,
  AssertionResult,
  EvalRunResult,
  EvalSuiteResult,
  EvalToolCall,
  EvalLLMClient,
  Fixture,
} from './types';

export { evaluateAssertion } from './assertions';
export {
  FixtureStore,
  computePromptHash,
  FIXTURE_FORMAT_VERSION,
} from './fixture-store';
export { runEvalCase, runEvalSuite, type RunOptions } from './runner';
export { DEFAULT_EVAL_CASES } from './cases';
