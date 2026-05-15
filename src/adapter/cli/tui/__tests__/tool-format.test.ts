/**
 * Pure formatters that turn raw tool events into the human-friendly
 * lines the ToolCard renders. Heavily exercised because they're the
 * only thing standing between a model emitting `spawn_subagent
 * {"task":"..."}` and a readable card in the UI.
 */

import { describe, test, expect } from 'vitest';
import {
  formatParamValue,
  describeToolCall,
  formatToolDetail,
  formatToolResult,
} from '../tool-format';

describe('formatParamValue', () => {
  test('quotes strings', () => {
    expect(formatParamValue('hello')).toBe('"hello"');
  });

  test('numbers and booleans pass through verbatim', () => {
    expect(formatParamValue(42)).toBe('42');
    expect(formatParamValue(true)).toBe('true');
    expect(formatParamValue(false)).toBe('false');
  });

  test('null / undefined have explicit forms', () => {
    expect(formatParamValue(null)).toBe('null');
    expect(formatParamValue(undefined)).toBe('undefined');
  });

  test('long strings get truncated with ellipsis', () => {
    const long = 'x'.repeat(200);
    const out = formatParamValue(long, 20);
    expect(out.length).toBeLessThanOrEqual(22); // 20 chars + 2 quotes
    expect(out).toMatch(/…"$/);
  });

  test('objects compact-JSON then truncate', () => {
    const obj = { a: 1, b: 'two' };
    expect(formatParamValue(obj)).toContain('"a":1');
  });

  test('handles unserializable values without throwing', () => {
    const cyclic: any = { x: 1 };
    cyclic.self = cyclic;
    expect(() => formatParamValue(cyclic)).not.toThrow();
    expect(formatParamValue(cyclic)).toBe('[unserializable]');
  });
});

describe('describeToolCall', () => {
  test('maps known tools to friendly labels', () => {
    expect(describeToolCall('web_search')).toBe('Searching the web');
    expect(describeToolCall('spawn_subagent')).toBe('Spawning subagent');
    expect(describeToolCall('memory_grep')).toBe('Searching memory');
  });

  test('unknown tool falls back to underscore-stripped name', () => {
    expect(describeToolCall('totally_made_up')).toBe('totally made up');
    expect(describeToolCall('plain')).toBe('plain');
  });
});

describe('formatToolDetail', () => {
  test('picks the configured key field for a known tool', () => {
    expect(formatToolDetail('web_search', { query: 'Bun runtime' }))
      .toBe('query: "Bun runtime"');
    expect(formatToolDetail('shell', { command: 'ls -la' }))
      .toBe('command: "ls -la"');
  });

  test('prefers the FIRST key if multiple options exist', () => {
    expect(formatToolDetail('spawn_subagent', { task: 'do thing', type: 'research' }))
      .toBe('task: "do thing"');
  });

  test('falls back to the second key if the first is absent', () => {
    expect(formatToolDetail('memory_grep', { path: 'facts/' }))
      .toBe('path: "facts/"');
  });

  test('empty params returns empty string (caller omits the line)', () => {
    expect(formatToolDetail('web_search', {})).toBe('');
  });

  test('unknown tool uses generic fallback fields', () => {
    expect(formatToolDetail('mystery_tool', { name: 'Bob', age: 99 }))
      .toBe('name: "Bob"');
  });

  test('unknown tool with no recognized field picks first scalar', () => {
    expect(formatToolDetail('mystery', { weirdField: 42 }))
      .toBe('weirdField: 42');
  });

  test('long detail line gets truncated', () => {
    const long = 'x'.repeat(500);
    const out = formatToolDetail('web_search', { query: long });
    expect(out.length).toBeLessThanOrEqual(101);
  });
});

describe('formatToolResult', () => {
  test('null / undefined → "done"', () => {
    expect(formatToolResult(null)).toBe('done');
    expect(formatToolResult(undefined)).toBe('done');
  });

  test('short string passes through verbatim', () => {
    expect(formatToolResult('ok')).toBe('ok');
  });

  test('empty string → "done (empty)"', () => {
    expect(formatToolResult('')).toBe('done (empty)');
  });

  test('long string → length annotation', () => {
    expect(formatToolResult('x'.repeat(1000))).toBe('1000 chars');
  });

  test('success:true with summary string surfaces it', () => {
    expect(formatToolResult({ success: true, summary: 'Found 3 docs' }))
      .toBe('Found 3 docs');
  });

  test('success:true falls back to "ok" when no summary fields', () => {
    expect(formatToolResult({ success: true, data: { lots: 'of stuff' } }))
      .toBe('ok');
  });

  test('success:false surfaces the error', () => {
    expect(formatToolResult({ success: false, error: 'rate limited' }))
      .toBe('error: rate limited');
  });

  test('success:false with very long error truncates', () => {
    const out = formatToolResult({ success: false, error: 'x'.repeat(200) });
    expect(out.length).toBeLessThan(70);
    expect(out).toMatch(/^error: /);
  });

  test('arrays show item count', () => {
    expect(formatToolResult([1, 2, 3, 4, 5])).toBe('5 items');
  });

  test('plain objects show field count', () => {
    expect(formatToolResult({ a: 1, b: 2, c: 3 })).toBe('3 fields');
  });
});
