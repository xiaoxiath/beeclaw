import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.unmock('fs');

import { runEvalCase, runEvalSuite } from '../runner';
import { FixtureStore, computePromptHash } from '../fixture-store';
import type { EvalCase, EvalLLMClient } from '../types';

const SYSTEM_PROMPT = '# Test system prompt';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'beeclaw-runner-'));
}

function makeStore(): { dir: string; store: FixtureStore } {
  const dir = mkTmp();
  return { dir, store: new FixtureStore(dir) };
}

function caseOf(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    id: 'sample-case',
    description: 'a sample',
    userMessage: 'hello',
    assertions: [{ type: 'contains', substring: 'world' }],
    ...overrides,
  };
}

describe('runEvalCase — fixture mode', () => {
  let dir: string;
  let store: FixtureStore;
  beforeEach(() => { ({ dir, store } = makeStore()); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('replays a fixture and runs assertions over the recorded text', async () => {
    const tc = caseOf();
    const promptHash = computePromptHash({
      systemPrompt: SYSTEM_PROMPT, userMessage: tc.userMessage, model: 'fake-model',
    });
    store.save(FixtureStore.newFixture(tc.id, 'fake-model', promptHash, 'hello world', []));

    const r = await runEvalCase(tc, {
      mode: 'fixture',
      resolveSystemPrompt: () => SYSTEM_PROMPT,
      model: 'fake-model',
      fixtureStore: store,
    });
    expect(r.passed).toBe(true);
    expect(r.assertions[0].passed).toBe(true);
    expect(r.source).toBe('fixture');
    expect(r.fixtureId).toBe(tc.id);
    expect(r.responseText).toBe('hello world');
  });

  it('reports failure when no fixture exists for the case', async () => {
    const r = await runEvalCase(caseOf(), {
      mode: 'fixture',
      resolveSystemPrompt: () => SYSTEM_PROMPT,
      model: 'fake-model',
      fixtureStore: store,
    });
    expect(r.passed).toBe(false);
    expect(r.error).toMatch(/not found/);
    // Each assertion is reported as not-evaluated rather than silently skipped.
    expect(r.assertions[0].passed).toBe(false);
    expect(r.assertions[0].message).toMatch(/not evaluated/);
  });

  it('reports failure when the fixture is stale (promptHash mismatch)', async () => {
    const tc = caseOf();
    store.save(FixtureStore.newFixture(tc.id, 'fake-model', 'OLDHASH', 'old text', []));
    const r = await runEvalCase(tc, {
      mode: 'fixture',
      resolveSystemPrompt: () => SYSTEM_PROMPT,
      model: 'fake-model',
      fixtureStore: store,
    });
    expect(r.passed).toBe(false);
    expect(r.error).toMatch(/stale/);
  });

  it('a single failing assertion fails the whole case but other assertions still report', async () => {
    const tc = caseOf({
      assertions: [
        { type: 'contains', substring: 'world' },
        { type: 'contains', substring: 'NOT_PRESENT' },
        { type: 'minLength', chars: 1 },
      ],
    });
    const promptHash = computePromptHash({
      systemPrompt: SYSTEM_PROMPT, userMessage: tc.userMessage, model: 'fake-model',
    });
    store.save(FixtureStore.newFixture(tc.id, 'fake-model', promptHash, 'hello world', []));

    const r = await runEvalCase(tc, {
      mode: 'fixture',
      resolveSystemPrompt: () => SYSTEM_PROMPT,
      model: 'fake-model',
      fixtureStore: store,
    });
    expect(r.passed).toBe(false);
    expect(r.assertions.map(a => a.passed)).toEqual([true, false, true]);
  });
});

describe('runEvalCase — live mode', () => {
  let dir: string;
  let store: FixtureStore;
  beforeEach(() => { ({ dir, store } = makeStore()); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('calls the LLM client and runs assertions over the live response', async () => {
    const stub: EvalLLMClient = {
      complete: vi.fn(async () => ({
        text: 'live response saying hello world',
        toolCalls: [{ name: 'memory_record', args: { key: 'pref' } }],
      })),
    };
    const tc = caseOf({
      assertions: [
        { type: 'contains', substring: 'hello world' },
        { type: 'toolCall', name: 'memory_record', argsContain: { key: 'pref' } },
      ],
    });

    const r = await runEvalCase(tc, {
      mode: 'live',
      resolveSystemPrompt: () => SYSTEM_PROMPT,
      model: 'fake-model',
      fixtureStore: store,
      llmClient: stub,
    });
    expect(r.passed).toBe(true);
    expect(r.source).toBe('live');
    expect(stub.complete).toHaveBeenCalledOnce();
    // recordOnLive is false by default → no fixture written.
    expect(store.exists(tc.id)).toBe(false);
  });

  it('records a fixture when recordOnLive is true', async () => {
    const stub: EvalLLMClient = {
      complete: vi.fn(async () => ({ text: 'fresh', toolCalls: [] })),
    };
    const tc = caseOf({ assertions: [{ type: 'contains', substring: 'fresh' }] });

    await runEvalCase(tc, {
      mode: 'live',
      resolveSystemPrompt: () => SYSTEM_PROMPT,
      model: 'fake-model',
      fixtureStore: store,
      llmClient: stub,
      recordOnLive: true,
    });
    expect(store.exists(tc.id)).toBe(true);
    const promptHash = computePromptHash({
      systemPrompt: SYSTEM_PROMPT, userMessage: tc.userMessage, model: 'fake-model',
    });
    expect(store.load(tc.id, promptHash)!.responseText).toBe('fresh');
  });

  it('reports a runtime error when the LLM client throws', async () => {
    const stub: EvalLLMClient = {
      complete: vi.fn(async () => { throw new Error('rate limited'); }),
    };
    const r = await runEvalCase(caseOf(), {
      mode: 'live',
      resolveSystemPrompt: () => SYSTEM_PROMPT,
      model: 'fake-model',
      fixtureStore: store,
      llmClient: stub,
    });
    expect(r.passed).toBe(false);
    expect(r.error).toMatch(/rate limited/);
  });

  it('refuses live mode without an llmClient', async () => {
    const r = await runEvalCase(caseOf(), {
      mode: 'live',
      resolveSystemPrompt: () => SYSTEM_PROMPT,
      model: 'fake-model',
      fixtureStore: store,
    });
    expect(r.passed).toBe(false);
    expect(r.error).toMatch(/no llmClient/);
  });
});

describe('runEvalSuite', () => {
  let dir: string;
  let store: FixtureStore;
  beforeEach(() => { ({ dir, store } = makeStore()); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('aggregates pass/fail counts across multiple cases', async () => {
    const cases: EvalCase[] = [
      { id: 'a', description: '', userMessage: 'a', assertions: [{ type: 'contains', substring: 'a' }] },
      { id: 'b', description: '', userMessage: 'b', assertions: [{ type: 'contains', substring: 'NOPE' }] },
      { id: 'c', description: '', userMessage: 'c', assertions: [{ type: 'minLength', chars: 1 }] },
    ];
    const opts = {
      mode: 'fixture' as const,
      resolveSystemPrompt: () => SYSTEM_PROMPT,
      model: 'fake-model',
      fixtureStore: store,
    };
    for (const c of cases) {
      const h = computePromptHash({
        systemPrompt: SYSTEM_PROMPT, userMessage: c.userMessage, model: 'fake-model',
      });
      store.save(FixtureStore.newFixture(c.id, 'fake-model', h, c.userMessage, []));
    }

    const result = await runEvalSuite(cases, opts);
    expect(result.total).toBe(3);
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.cases.find(r => r.caseId === 'b')!.passed).toBe(false);
  });
});
