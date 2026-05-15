/**
 * History persistence — real fs (vi.unmock'd) round-trip tests.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.unmock('fs');

import { loadHistory, appendHistory } from '../history';

let tmp: string;
let histPath: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beeclaw-tui-hist-'));
  histPath = path.join(tmp, '.beeclaw_history');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('loadHistory', () => {
  test('returns empty array when file does not exist', () => {
    expect(loadHistory(histPath)).toEqual([]);
  });

  test('returns lines newest-first (file is append-ordered)', () => {
    const lines = [
      JSON.stringify({ ts: 't1', line: 'first' }),
      JSON.stringify({ ts: 't2', line: 'second' }),
      JSON.stringify({ ts: 't3', line: 'third' }),
    ].join('\n') + '\n';
    fs.writeFileSync(histPath, lines);

    expect(loadHistory(histPath)).toEqual(['third', 'second', 'first']);
  });

  test('skips malformed JSON lines', () => {
    const content = [
      JSON.stringify({ ts: 't', line: 'good1' }),
      'this is not json',
      JSON.stringify({ ts: 't', line: 'good2' }),
      '',
      JSON.stringify({ ts: 't', line: 'good3' }),
    ].join('\n');
    fs.writeFileSync(histPath, content);

    expect(loadHistory(histPath)).toEqual(['good3', 'good2', 'good1']);
  });

  test('skips entries missing or empty line field', () => {
    const content = [
      JSON.stringify({ ts: 't', line: 'kept' }),
      JSON.stringify({ ts: 't' }),
      JSON.stringify({ ts: 't', line: '' }),
      JSON.stringify({ ts: 't', line: 'also kept' }),
    ].join('\n');
    fs.writeFileSync(histPath, content);

    expect(loadHistory(histPath)).toEqual(['also kept', 'kept']);
  });

  test('preserves multi-line entries with embedded newlines', () => {
    fs.writeFileSync(histPath, JSON.stringify({ ts: 't', line: 'line1\nline2' }) + '\n');
    expect(loadHistory(histPath)).toEqual(['line1\nline2']);
  });
});

describe('appendHistory', () => {
  test('creates file on first append', () => {
    appendHistory('hello', histPath);
    expect(fs.existsSync(histPath)).toBe(true);
    expect(loadHistory(histPath)).toEqual(['hello']);
  });

  test('appends in chronological order (newest read first)', () => {
    appendHistory('a', histPath);
    appendHistory('b', histPath);
    appendHistory('c', histPath);
    expect(loadHistory(histPath)).toEqual(['c', 'b', 'a']);
  });

  test('coalesces consecutive duplicates', () => {
    appendHistory('same', histPath);
    appendHistory('same', histPath);
    appendHistory('same', histPath);
    expect(loadHistory(histPath)).toEqual(['same']);
  });

  test('does NOT coalesce non-consecutive duplicates', () => {
    appendHistory('a', histPath);
    appendHistory('b', histPath);
    appendHistory('a', histPath);
    expect(loadHistory(histPath)).toEqual(['a', 'b', 'a']);
  });

  test('multi-line entry survives the round-trip', () => {
    appendHistory('one\ntwo\nthree', histPath);
    expect(loadHistory(histPath)).toEqual(['one\ntwo\nthree']);
  });

  test('creates parent directory if missing', () => {
    const nested = path.join(tmp, 'sub', 'dir', '.history');
    appendHistory('x', nested);
    expect(fs.existsSync(nested)).toBe(true);
  });

  test('empty input is a no-op', () => {
    appendHistory('', histPath);
    expect(fs.existsSync(histPath)).toBe(false);
  });
});
