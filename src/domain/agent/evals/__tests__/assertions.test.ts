import { describe, it, expect } from 'vitest';
import { evaluateAssertion } from '../assertions';
import type { EvalAssertion, EvalToolCall } from '../types';

const ctx = (text: string, toolCalls: EvalToolCall[] = []) => ({ text, toolCalls });

describe('contains', () => {
  it('passes when the substring is present (case-insensitive default)', () => {
    const r = evaluateAssertion(
      { type: 'contains', substring: 'HELLO' },
      ctx('hello world'),
    );
    expect(r.passed).toBe(true);
  });

  it('fails when the substring is absent', () => {
    const r = evaluateAssertion(
      { type: 'contains', substring: 'goodbye' },
      ctx('hello world'),
    );
    expect(r.passed).toBe(false);
    expect(r.message).toMatch(/goodbye/);
  });

  it('respects caseSensitive: true', () => {
    const r = evaluateAssertion(
      { type: 'contains', substring: 'HELLO', caseSensitive: true },
      ctx('hello world'),
    );
    expect(r.passed).toBe(false);
  });
});

describe('notContains', () => {
  it('passes when the substring is absent', () => {
    const r = evaluateAssertion(
      { type: 'notContains', substring: 'forbidden' },
      ctx('safe response'),
    );
    expect(r.passed).toBe(true);
  });

  it('fails when the substring is present (case-insensitive default)', () => {
    const r = evaluateAssertion(
      { type: 'notContains', substring: 'API_KEY' },
      ctx('here is your api_key=...'),
    );
    expect(r.passed).toBe(false);
  });
});

describe('matches / notMatches', () => {
  it('matches a regex with flags', () => {
    const r = evaluateAssertion(
      { type: 'matches', pattern: '^hello\\s+\\w+$', flags: 'i' },
      ctx('Hello World'),
    );
    expect(r.passed).toBe(true);
  });

  it('reports invalid regex without throwing', () => {
    const r = evaluateAssertion(
      { type: 'matches', pattern: '[invalid', flags: '' },
      ctx('anything'),
    );
    expect(r.passed).toBe(false);
    expect(r.message).toMatch(/invalid regex/);
  });

  it('notMatches inverts the result', () => {
    const r = evaluateAssertion(
      { type: 'notMatches', pattern: '\\bsystem:\\b' },
      ctx('user message about systems'),
    );
    expect(r.passed).toBe(true);
  });
});

describe('minLength / maxLength', () => {
  it('minLength passes when the response is long enough', () => {
    const r = evaluateAssertion({ type: 'minLength', chars: 5 }, ctx('hello'));
    expect(r.passed).toBe(true);
  });

  it('minLength fails when too short', () => {
    const r = evaluateAssertion({ type: 'minLength', chars: 100 }, ctx('hi'));
    expect(r.passed).toBe(false);
  });

  it('maxLength fails when too long', () => {
    const r = evaluateAssertion({ type: 'maxLength', chars: 5 }, ctx('hello world'));
    expect(r.passed).toBe(false);
  });
});

describe('toolCall', () => {
  it('passes when a tool with the right name was called', () => {
    const r = evaluateAssertion(
      { type: 'toolCall', name: 'memory_record' },
      ctx('done', [{ name: 'memory_record', args: { key: 'x', value: 'y' } }]),
    );
    expect(r.passed).toBe(true);
  });

  it('fails with a useful message when the tool is missing', () => {
    const r = evaluateAssertion(
      { type: 'toolCall', name: 'memory_record' },
      ctx('done', [{ name: 'web_search', args: {} }]),
    );
    expect(r.passed).toBe(false);
    expect(r.message).toMatch(/expected.*memory_record/);
    expect(r.message).toMatch(/web_search/);
  });

  it('argsContain checks subset of args', () => {
    const r = evaluateAssertion(
      { type: 'toolCall', name: 'memory_record', argsContain: { key: 'pref' } },
      ctx('done', [{ name: 'memory_record', args: { key: 'pref', value: 'concise' } }]),
    );
    expect(r.passed).toBe(true);
  });

  it('argsContain fails when value does not match', () => {
    const r = evaluateAssertion(
      { type: 'toolCall', name: 'memory_record', argsContain: { key: 'pref' } },
      ctx('done', [{ name: 'memory_record', args: { key: 'other', value: 'x' } }]),
    );
    expect(r.passed).toBe(false);
  });

  it('argsContain handles nested objects', () => {
    const r = evaluateAssertion(
      { type: 'toolCall', name: 'foo', argsContain: { meta: { user: 'alice' } } },
      ctx('done', [{ name: 'foo', args: { meta: { user: 'alice', extra: 1 } } }]),
    );
    expect(r.passed).toBe(true);
  });

  it('argsContain matches against any of multiple calls of the same name', () => {
    const r = evaluateAssertion(
      { type: 'toolCall', name: 'memory_record', argsContain: { key: 'pref' } },
      ctx('done', [
        { name: 'memory_record', args: { key: 'first', value: '1' } },
        { name: 'memory_record', args: { key: 'pref', value: '2' } },
      ]),
    );
    expect(r.passed).toBe(true);
  });
});

describe('noToolCall', () => {
  it('passes when there are no tool calls at all', () => {
    const r = evaluateAssertion({ type: 'noToolCall' }, ctx('chat reply', []));
    expect(r.passed).toBe(true);
  });

  it('fails when any tool call exists', () => {
    const r = evaluateAssertion(
      { type: 'noToolCall' },
      ctx('done', [{ name: 'web_search', args: {} }]),
    );
    expect(r.passed).toBe(false);
  });

  it('with name: passes if that specific tool was not called', () => {
    const r = evaluateAssertion(
      { type: 'noToolCall', name: 'rm_rf' },
      ctx('done', [{ name: 'memory_read', args: { path: 'x' } }]),
    );
    expect(r.passed).toBe(true);
  });

  it('with name: fails if that specific tool was called', () => {
    const r = evaluateAssertion(
      { type: 'noToolCall', name: 'rm_rf' },
      ctx('done', [{ name: 'rm_rf', args: { path: '/' } }]),
    );
    expect(r.passed).toBe(false);
  });
});

describe('exhaustiveness', () => {
  // Smoke check that the union is fully covered — if a new variant is added
  // to EvalAssertion, this test will fail to compile because the switch
  // result will be `never` somewhere. Compilation-time check; runtime is
  // just sanity.
  it('handles every known assertion shape', () => {
    const variants: EvalAssertion[] = [
      { type: 'contains', substring: 'x' },
      { type: 'notContains', substring: 'y' },
      { type: 'matches', pattern: '.' },
      { type: 'notMatches', pattern: '.' },
      { type: 'minLength', chars: 1 },
      { type: 'maxLength', chars: 1000 },
      { type: 'toolCall', name: 't' },
      { type: 'noToolCall' },
    ];
    for (const v of variants) {
      expect(() => evaluateAssertion(v, ctx('x', []))).not.toThrow();
    }
  });
});
