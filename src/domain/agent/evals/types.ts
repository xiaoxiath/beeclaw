/**
 * Prompt-evaluation framework — shared type definitions.
 *
 * The framework runs a set of EvalCase against a real or recorded LLM
 * response and produces a structured result. Two modes are supported:
 *
 *   - 'fixture' (default in CI): replay a recorded LLM response. Free,
 *     deterministic, runnable on every PR.
 *   - 'live' (opt-in via env var): hit a real provider. Costs real money;
 *     used to record fresh fixtures or to validate prompt changes against
 *     the actual model.
 *
 * Assertions are intentionally structural (contains/regex/toolCall/length
 * etc.) rather than full-text snapshots. LLM outputs vary between runs even
 * at temperature=0, so byte-exact snapshots are flaky. Structural assertions
 * pin the *behaviour* the prompt is supposed to elicit.
 */

/** A single tool call extracted from an LLM response. */
export interface EvalToolCall {
  name: string;
  args: Record<string, unknown>;
}

/** A single eval case: one user query + the expected behaviour. */
export interface EvalCase {
  /** Stable identifier; doubles as the fixture filename. */
  id: string;
  /** Human-readable summary: what behaviour this case pins. */
  description: string;
  /** Free-form tags for filtering (e.g. 'safety', 'skill-protocol'). */
  tags?: string[];
  /** The user message to send. */
  userMessage: string;
  /**
   * Optional system-prompt override. When omitted the runner uses the
   * project's normal assembled prompt — that's what we want for end-to-end
   * regression tests. Set this only when probing a specific layer.
   */
  systemPrompt?: string;
  /** Assertions to run against the response. ALL must pass for the case to pass. */
  assertions: EvalAssertion[];
}

/**
 * Assertions are a closed union — every shape is recognised by the runner
 * and produces a deterministic pass/fail with a human-readable message.
 */
export type EvalAssertion =
  | { type: 'contains'; substring: string; caseSensitive?: boolean }
  | { type: 'notContains'; substring: string; caseSensitive?: boolean }
  | { type: 'matches'; pattern: string; flags?: string }
  | { type: 'notMatches'; pattern: string; flags?: string }
  | { type: 'minLength'; chars: number }
  | { type: 'maxLength'; chars: number }
  | { type: 'toolCall'; name: string; argsContain?: Record<string, unknown> }
  | { type: 'noToolCall'; name?: string };

/** Result of running a single assertion. */
export interface AssertionResult {
  assertion: EvalAssertion;
  passed: boolean;
  /** When passed=false, this is the human-readable failure reason. */
  message: string;
}

/** Overall result of running a single eval case. */
export interface EvalRunResult {
  caseId: string;
  /** True iff every assertion passed AND no runtime error occurred. */
  passed: boolean;
  assertions: AssertionResult[];
  responseText: string;
  toolCalls: EvalToolCall[];
  durationMs: number;
  /** Where the response came from. */
  source: 'fixture' | 'live';
  /** Set when source='fixture'; identifies the on-disk fixture used. */
  fixtureId?: string;
  /** Set when the runner itself failed (e.g. fixture missing, LLM error). */
  error?: string;
}

/** Aggregated result across many cases — for CLI / CI summary. */
export interface EvalSuiteResult {
  total: number;
  passed: number;
  failed: number;
  cases: EvalRunResult[];
  startedAt: string;
  durationMs: number;
}

/**
 * On-disk record of a previously-captured LLM response. Used by the
 * fixture store to replay deterministically.
 *
 * promptHash captures (systemPrompt + userMessage + model). When ANY of
 * those change, the fixture is considered stale and the runner refuses
 * to use it — forcing the operator to re-record before merging.
 */
export interface Fixture {
  caseId: string;
  recordedAt: string;
  model: string;
  /** sha256 of `${model}\n${systemPrompt}\n${userMessage}` (first 16 hex chars). */
  promptHash: string;
  responseText: string;
  toolCalls: EvalToolCall[];
}

/**
 * Minimal LLM client interface the eval runner needs. Production wires this
 * to bee's AIClient; tests pass an in-memory stub.
 */
export interface EvalLLMClient {
  /** Run one round-trip and return the assistant's text + tool calls. */
  complete(input: {
    systemPrompt: string;
    userMessage: string;
    model: string;
  }): Promise<{ text: string; toolCalls: EvalToolCall[] }>;
}
