/**
 * Pure tests for fuzzy ranking. Stable enough that snapshot tests
 * would be brittle — instead we assert relative ordering and the
 * exact-match / prefix / substring buckets.
 */

import { describe, test, expect } from 'vitest';
import { rankCommands, scoreCommand } from '../command-scorer';
import type { Command } from '../commands';

const sample: Command[] = [
  { name: 'help', description: 'List available commands', kind: 'builtin' },
  { name: 'clear', description: 'Clear conversation history', kind: 'builtin' },
  { name: 'exit', description: 'Leave the TUI', kind: 'builtin' },
  { name: 'sessions', description: 'Show session count', kind: 'builtin' },
  { name: 'theme-factory', description: 'Pick a theme', kind: 'skill' },
  { name: 'baidu-search', description: 'Search via Baidu', kind: 'skill' },
];

describe('scoreCommand', () => {
  test('exact match scores highest', () => {
    const exact = scoreCommand('exit', sample[2]);
    const prefix = scoreCommand('ex', sample[2]);
    expect(exact).toBeGreaterThan(prefix);
  });

  test('prefix beats substring', () => {
    const cmd: Command = { name: 'sessions', description: '', kind: 'builtin' };
    const prefix = scoreCommand('sess', cmd);
    const substring = scoreCommand('ions', cmd);
    expect(prefix).toBeGreaterThan(substring);
  });

  test('substring beats fuzzy', () => {
    const cmd: Command = { name: 'theme-factory', description: '', kind: 'skill' };
    const substring = scoreCommand('factory', cmd);
    const fuzzy = scoreCommand('tef', cmd);
    expect(substring).toBeGreaterThan(fuzzy);
  });

  test('description match (only with query length >= 2)', () => {
    const cmd: Command = { name: 'random', description: 'history of the chat', kind: 'builtin' };
    expect(scoreCommand('history', cmd)).toBeGreaterThan(0);
    // Single-char queries don't trigger description match (too noisy).
    expect(scoreCommand('h', cmd)).toBe(0);
  });

  test('builtin gets a tiny tie-break bonus over equally-matched skill', () => {
    const builtin: Command = { name: 'help', description: '', kind: 'builtin' };
    const skill: Command = { name: 'help', description: '', kind: 'skill' };
    expect(scoreCommand('help', builtin)).toBeGreaterThan(scoreCommand('help', skill));
  });

  test('no match returns 0', () => {
    expect(scoreCommand('totally-different', sample[0])).toBe(0);
  });
});

describe('rankCommands', () => {
  test('empty query returns full list in registry order', () => {
    const r = rankCommands('', sample, 10);
    expect(r.map(s => s.command.name)).toEqual(sample.map(c => c.name));
  });

  test('respects limit', () => {
    const r = rankCommands('', sample, 3);
    expect(r).toHaveLength(3);
  });

  test('orders by score descending', () => {
    const r = rankCommands('e', sample, 10);
    // 'exit' (prefix) should beat 'sessions' (no prefix) and 'theme-factory' (no prefix)
    const names = r.map(s => s.command.name);
    expect(names.indexOf('exit')).toBeLessThan(names.indexOf('sessions'));
  });

  test('drops zero-scored commands when query is non-empty', () => {
    const r = rankCommands('xyz', sample, 10);
    expect(r).toEqual([]);
  });

  test('exact match wins over prefix when both present', () => {
    const cmds: Command[] = [
      { name: 'help-extra', description: '', kind: 'skill' },
      { name: 'help', description: '', kind: 'builtin' },
    ];
    const r = rankCommands('help', cmds, 10);
    expect(r[0].command.name).toBe('help');
  });

  test('skill names match too', () => {
    const r = rankCommands('baidu', sample, 10);
    expect(r[0].command.name).toBe('baidu-search');
  });

  test('description matches surface in the picker (lower priority)', () => {
    const r = rankCommands('history', sample, 10);
    expect(r.map(s => s.command.name)).toContain('clear');
  });
});
