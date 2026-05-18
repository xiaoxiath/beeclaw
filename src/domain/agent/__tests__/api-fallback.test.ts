/**
 * Unit tests for callAIWithFallback and shouldFallback.
 *
 * Uses the optional callImpl injection seam on callAIWithFallback to
 * stub the underlying provider call — avoids dragging fetch, the
 * concurrency limiter, and the retry engine into a logic test.
 */

import { describe, test, expect, vi } from 'vitest';
import type { AIResponse, ChatMessage } from '../types';

vi.mock('@infra/observability/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { callAIWithFallback, shouldFallback } from '../api';

function makeProvider(name: string) {
  return { name, type: 'openai' as const, apiKey: 'k', models: {} };
}
function okResponse(content: string): AIResponse {
  return {
    id: `r-${content}`,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  } as AIResponse;
}

describe('shouldFallback', () => {
  test('AbortError → never falls back', () => {
    const err = new Error('aborted'); err.name = 'AbortError';
    expect(shouldFallback(err)).toBe(false);
  });

  test('400 / invalid_request_error → never falls back', () => {
    expect(shouldFallback(new Error('Codex Responses API error: 400 - invalid_request_error'))).toBe(false);
    expect(shouldFallback(new Error('context_length_exceeded'))).toBe(false);
  });

  test('401 / 403 / 429 / 5xx / network → falls back', () => {
    expect(shouldFallback(new Error('Codex 401 - token revoked'))).toBe(true);
    expect(shouldFallback(new Error('429 - quota'))).toBe(true);
    expect(shouldFallback(new Error('Codex Responses API error: 503'))).toBe(true);
    expect(shouldFallback(new Error('ECONNRESET'))).toBe(true);
  });

  test('null / undefined / empty → not worth a fallback', () => {
    expect(shouldFallback(null)).toBe(false);
    expect(shouldFallback(undefined)).toBe(false);
  });
});

describe('callAIWithFallback', () => {
  const primaryOpts = {
    provider: makeProvider('primary'),
    model: 'm1',
    messages: [] as ChatMessage[],
  };
  const fallback = { provider: makeProvider('fallback'), model: 'm2' };

  test('primary succeeds → fallback never invoked, returns primary', async () => {
    const calls: string[] = [];
    const callImpl = vi.fn(async (o) => { calls.push(o.provider.name); return okResponse('primary-ok'); });
    const res = await callAIWithFallback(primaryOpts, fallback, callImpl);
    expect(res.choices[0].message.content).toBe('primary-ok');
    expect(calls).toEqual(['primary']);
  });

  test('primary throws 5xx → fallback called with fallback target', async () => {
    const calls: Array<{ name: string; model: string }> = [];
    const callImpl = vi.fn(async (o) => {
      calls.push({ name: o.provider.name, model: o.model });
      if (o.provider.name === 'primary') throw new Error('Codex Responses API error: 503 - upstream');
      return okResponse('fallback-ok');
    });
    const res = await callAIWithFallback(primaryOpts, fallback, callImpl);
    expect(res.choices[0].message.content).toBe('fallback-ok');
    expect(calls).toEqual([
      { name: 'primary', model: 'm1' },
      { name: 'fallback', model: 'm2' },
    ]);
  });

  test('primary AbortError → not retried on fallback, propagates', async () => {
    const calls: string[] = [];
    const callImpl = vi.fn(async (o) => {
      calls.push(o.provider.name);
      const err = new Error('aborted'); err.name = 'AbortError';
      throw err;
    });
    await expect(callAIWithFallback(primaryOpts, fallback, callImpl)).rejects.toThrow('aborted');
    expect(calls).toEqual(['primary']);
  });

  test('primary 400 → not retried on fallback, propagates', async () => {
    const calls: string[] = [];
    const callImpl = vi.fn(async (o) => {
      calls.push(o.provider.name);
      throw new Error('Codex Responses API error: 400 - invalid_request_error');
    });
    await expect(callAIWithFallback(primaryOpts, fallback, callImpl)).rejects.toThrow(/400/);
    expect(calls).toEqual(['primary']);
  });

  test('no fallback configured → behaves like raw callAI', async () => {
    const callImpl = vi.fn(async () => { throw new Error('boom'); });
    await expect(callAIWithFallback(primaryOpts, undefined, callImpl)).rejects.toThrow('boom');
    expect(callImpl).toHaveBeenCalledTimes(1);
  });

  test('fallback target overrides temperature / maxTokens for the second call', async () => {
    const captured: Array<{ temp?: number; max?: number }> = [];
    const callImpl = vi.fn(async (o) => {
      captured.push({ temp: o.temperature, max: o.maxTokens });
      if (captured.length === 1) throw new Error('503');
      return okResponse('fallback-ok');
    });
    await callAIWithFallback(
      { ...primaryOpts, temperature: 0.7, maxTokens: 4096 },
      { provider: makeProvider('fallback'), model: 'm2', temperature: 0.3, maxTokens: 2048 },
      callImpl,
    );
    expect(captured).toEqual([
      { temp: 0.7, max: 4096 },
      { temp: 0.3, max: 2048 },
    ]);
  });
});
