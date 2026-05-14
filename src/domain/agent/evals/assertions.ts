/**
 * Assertion evaluator — given an LLM response and a single EvalAssertion,
 * decide pass/fail and produce a human-readable message.
 *
 * Pure functions, no I/O. Every assertion variant is covered here so the
 * runner does not need to know how each one works.
 */

import type {
  EvalAssertion,
  AssertionResult,
  EvalToolCall,
} from './types';

interface ResponseContext {
  text: string;
  toolCalls: EvalToolCall[];
}

export function evaluateAssertion(
  assertion: EvalAssertion,
  ctx: ResponseContext,
): AssertionResult {
  switch (assertion.type) {
    case 'contains':       return evalContains(assertion, ctx);
    case 'notContains':    return evalNotContains(assertion, ctx);
    case 'matches':        return evalMatches(assertion, ctx);
    case 'notMatches':     return evalNotMatches(assertion, ctx);
    case 'minLength':      return evalMinLength(assertion, ctx);
    case 'maxLength':      return evalMaxLength(assertion, ctx);
    case 'toolCall':       return evalToolCall(assertion, ctx);
    case 'noToolCall':     return evalNoToolCall(assertion, ctx);
  }
}

// ─── individual assertion handlers ───────────────────────────────────────

function evalContains(
  a: { type: 'contains'; substring: string; caseSensitive?: boolean },
  ctx: ResponseContext,
): AssertionResult {
  const cs = a.caseSensitive ?? false;
  const haystack = cs ? ctx.text : ctx.text.toLowerCase();
  const needle = cs ? a.substring : a.substring.toLowerCase();
  const passed = haystack.includes(needle);
  return {
    assertion: a,
    passed,
    message: passed
      ? `response contains "${a.substring}"`
      : `expected response to contain "${a.substring}" (case ${cs ? 'sensitive' : 'insensitive'})`,
  };
}

function evalNotContains(
  a: { type: 'notContains'; substring: string; caseSensitive?: boolean },
  ctx: ResponseContext,
): AssertionResult {
  const cs = a.caseSensitive ?? false;
  const haystack = cs ? ctx.text : ctx.text.toLowerCase();
  const needle = cs ? a.substring : a.substring.toLowerCase();
  const passed = !haystack.includes(needle);
  return {
    assertion: a,
    passed,
    message: passed
      ? `response does not contain "${a.substring}"`
      : `expected response NOT to contain "${a.substring}"`,
  };
}

function evalMatches(
  a: { type: 'matches'; pattern: string; flags?: string },
  ctx: ResponseContext,
): AssertionResult {
  let re: RegExp;
  try {
    re = new RegExp(a.pattern, a.flags ?? '');
  } catch (e) {
    return {
      assertion: a, passed: false,
      message: `invalid regex /${a.pattern}/${a.flags ?? ''}: ${(e as Error).message}`,
    };
  }
  const passed = re.test(ctx.text);
  return {
    assertion: a, passed,
    message: passed
      ? `response matches /${a.pattern}/${a.flags ?? ''}`
      : `expected response to match /${a.pattern}/${a.flags ?? ''}`,
  };
}

function evalNotMatches(
  a: { type: 'notMatches'; pattern: string; flags?: string },
  ctx: ResponseContext,
): AssertionResult {
  let re: RegExp;
  try {
    re = new RegExp(a.pattern, a.flags ?? '');
  } catch (e) {
    return {
      assertion: a, passed: false,
      message: `invalid regex /${a.pattern}/${a.flags ?? ''}: ${(e as Error).message}`,
    };
  }
  const passed = !re.test(ctx.text);
  return {
    assertion: a, passed,
    message: passed
      ? `response does not match /${a.pattern}/${a.flags ?? ''}`
      : `expected response NOT to match /${a.pattern}/${a.flags ?? ''}`,
  };
}

function evalMinLength(
  a: { type: 'minLength'; chars: number },
  ctx: ResponseContext,
): AssertionResult {
  const passed = ctx.text.length >= a.chars;
  return {
    assertion: a, passed,
    message: passed
      ? `response length ${ctx.text.length} ≥ ${a.chars}`
      : `response length ${ctx.text.length} < ${a.chars}`,
  };
}

function evalMaxLength(
  a: { type: 'maxLength'; chars: number },
  ctx: ResponseContext,
): AssertionResult {
  const passed = ctx.text.length <= a.chars;
  return {
    assertion: a, passed,
    message: passed
      ? `response length ${ctx.text.length} ≤ ${a.chars}`
      : `response length ${ctx.text.length} > ${a.chars}`,
  };
}

function evalToolCall(
  a: { type: 'toolCall'; name: string; argsContain?: Record<string, unknown> },
  ctx: ResponseContext,
): AssertionResult {
  const candidates = ctx.toolCalls.filter(c => c.name === a.name);
  if (candidates.length === 0) {
    return {
      assertion: a, passed: false,
      message: `expected a tool call to "${a.name}", got: [${
        ctx.toolCalls.map(c => c.name).join(', ') || 'none'
      }]`,
    };
  }
  if (!a.argsContain) {
    return {
      assertion: a, passed: true,
      message: `tool call to "${a.name}" found`,
    };
  }
  // At least one matching call must have ALL the expected key/values.
  const match = candidates.find(c => objectContains(c.args, a.argsContain!));
  if (match) {
    return {
      assertion: a, passed: true,
      message: `tool call to "${a.name}" with expected args`,
    };
  }
  return {
    assertion: a, passed: false,
    message: `tool call to "${a.name}" found but args did not match expected subset (got ${
      candidates.length
    } call(s))`,
  };
}

function evalNoToolCall(
  a: { type: 'noToolCall'; name?: string },
  ctx: ResponseContext,
): AssertionResult {
  if (a.name === undefined) {
    const passed = ctx.toolCalls.length === 0;
    return {
      assertion: a, passed,
      message: passed
        ? 'no tool calls'
        : `expected no tool calls, got [${ctx.toolCalls.map(c => c.name).join(', ')}]`,
    };
  }
  const found = ctx.toolCalls.some(c => c.name === a.name);
  return {
    assertion: a, passed: !found,
    message: found
      ? `expected no call to "${a.name}", but it was called`
      : `no call to "${a.name}"`,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────

/**
 * Subset-equality: every key in `expected` exists in `actual` with the
 * same value. Nested objects recurse; arrays compare element-wise by
 * shallow JSON equality (sufficient for our tool-arg use case).
 */
function objectContains(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean {
  for (const [k, v] of Object.entries(expected)) {
    if (!(k in actual)) return false;
    const av = actual[k];
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      if (typeof av !== 'object' || av === null || Array.isArray(av)) return false;
      if (!objectContains(av as Record<string, unknown>, v as Record<string, unknown>)) return false;
    } else {
      if (JSON.stringify(av) !== JSON.stringify(v)) return false;
    }
  }
  return true;
}
