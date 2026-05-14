/**
 * HybridToolSelector — stats tracking + failure visibility.
 *
 * The selector previously failed silently in the chat loop: caller
 * caught everything as `logger.debug` and fell back to all-tools, so
 * a regression in selection would never surface until someone noticed
 * the LLM choosing weird tools. This PR:
 *   - bumps the call-site log to warn
 *   - adds a stats counter (calls / successes / failures / I/O sizes)
 *   - wires it into /stats so dashboards can chart failure rate
 *
 * These tests cover the counter — the call-site log change is verified
 * by the existing chat-loop tests still passing.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { HybridToolSelector } from '../hybrid-tool-selector';
import type { OpenAITool } from '../types';

const tool = (name: string): OpenAITool => ({
  type: 'function',
  function: { name, description: '', parameters: { type: 'object', properties: {} } },
});

describe('HybridToolSelector stats', () => {
  let selector: HybridToolSelector;

  beforeEach(() => {
    selector = new HybridToolSelector({ strategy: 'budget-cap', maxTools: 5 });
  });

  test('starts with all-zeros stats', () => {
    const s = selector.getStats();
    expect(s.calls).toBe(0);
    expect(s.successes).toBe(0);
    expect(s.failures).toBe(0);
    expect(s.totalInputTools).toBe(0);
    expect(s.totalOutputTools).toBe(0);
    expect(s.lastError).toBeNull();
    expect(s.lastCallAt).toBeNull();
    expect(s.avgInputTools).toBe(0);
    expect(s.avgOutputTools).toBe(0);
  });

  test('increments calls + successes on under-budget select', async () => {
    const tools = [tool('a'), tool('b')];
    await selector.select(tools, 'msg');
    const s = selector.getStats();
    expect(s.calls).toBe(1);
    expect(s.successes).toBe(1);
    expect(s.failures).toBe(0);
    expect(s.totalInputTools).toBe(2);
    expect(s.totalOutputTools).toBe(2);
    expect(s.avgInputTools).toBe(2);
    expect(s.avgOutputTools).toBe(2);
    expect(s.lastCallAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('records output count when filtering happens (budget cap fires)', async () => {
    const tools = Array.from({ length: 10 }, (_, i) => tool(`t${i}`));
    const out = await selector.select(tools, 'msg');
    expect(out.length).toBe(5); // capped to maxTools
    const s = selector.getStats();
    expect(s.totalInputTools).toBe(10);
    expect(s.totalOutputTools).toBe(5);
  });

  test('averages over multiple successful calls', async () => {
    await selector.select([tool('a')], 'm');                          // in:1 out:1
    await selector.select([tool('a'), tool('b'), tool('c')], 'm');    // in:3 out:3
    const s = selector.getStats();
    expect(s.calls).toBe(2);
    expect(s.successes).toBe(2);
    expect(s.avgInputTools).toBe(2);   // (1+3)/2
    expect(s.avgOutputTools).toBe(2);  // (1+3)/2
  });

  test('recordFailure increments failures + captures error message', () => {
    selector.recordFailure(new Error('embedding provider down'));
    const s = selector.getStats();
    expect(s.failures).toBe(1);
    expect(s.lastError).toBe('embedding provider down');
    expect(s.lastCallAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('recordFailure handles non-Error throwables', () => {
    selector.recordFailure('string error');
    expect(selector.getStats().lastError).toBe('string error');
    selector.recordFailure({ weird: 'object' });
    // Falls through to String(...) — exact format isn't load-bearing,
    // just that it doesn't crash and SOMETHING is captured.
    expect(selector.getStats().lastError).toBeTruthy();
  });

  test('resetStats zeros everything', async () => {
    await selector.select([tool('a')], 'm');
    selector.recordFailure(new Error('x'));
    selector.resetStats();
    const s = selector.getStats();
    expect(s.calls).toBe(0);
    expect(s.successes).toBe(0);
    expect(s.failures).toBe(0);
    expect(s.lastError).toBeNull();
  });

  test("strategy 'all' still tracks input==output successfully", async () => {
    const allSel = new HybridToolSelector({ strategy: 'all', maxTools: 5 });
    const tools = Array.from({ length: 100 }, (_, i) => tool(`t${i}`));
    const out = await allSel.select(tools, 'm');
    expect(out.length).toBe(100);
    const s = allSel.getStats();
    expect(s.successes).toBe(1);
    expect(s.totalInputTools).toBe(100);
    expect(s.totalOutputTools).toBe(100);
  });
});
