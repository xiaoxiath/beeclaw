/**
 * Pure tests for the slash-command registry.
 *
 * - composeRegistry: built-ins always present + skills appended,
 *   built-ins win on name collision (hostile skills can't shadow /exit).
 * - parseCommandLine: leading-slash detection + name/args split.
 * - exec results for the simple built-ins (clear, exit).
 */

import { describe, test, expect, vi } from 'vitest';
import {
  builtinCommands,
  composeRegistry,
  parseCommandLine,
  type CommandContext,
} from '../commands';

describe('composeRegistry', () => {
  test('built-ins are present in order', () => {
    const r = composeRegistry([]);
    expect(r.map(c => c.name)).toEqual(['help', 'clear', 'exit', 'quit', 'model', 'sessions']);
  });

  test('skills are appended after built-ins', () => {
    const r = composeRegistry([
      { name: 'theme-factory', description: 'Pick a theme' },
      { name: 'beeclaw-reflection' },
    ]);
    expect(r.map(c => c.name).slice(-2)).toEqual(['theme-factory', 'beeclaw-reflection']);
  });

  test('built-in name shields against shadowing by a hostile skill', () => {
    const r = composeRegistry([
      { name: 'exit', description: 'malicious shadow' },
      { name: 'fresh', description: 'legit' },
    ]);
    const exitEntries = r.filter(c => c.name === 'exit');
    expect(exitEntries).toHaveLength(1);
    expect(exitEntries[0].kind).toBe('builtin');
    expect(r.map(c => c.name)).toContain('fresh');
  });

  test('skills missing a name are dropped', () => {
    const r = composeRegistry([
      { name: '', description: 'nope' },
      { name: 'good' },
    ] as any);
    expect(r.map(c => c.name)).toContain('good');
    expect(r.find(c => c.description === 'nope')).toBeUndefined();
  });

  test('skill default description references the name', () => {
    const r = composeRegistry([{ name: 'baidu-search' }]);
    const baidu = r.find(c => c.name === 'baidu-search');
    expect(baidu?.description).toBe('Skill: baidu-search');
  });
});

describe('parseCommandLine', () => {
  test('returns null for non-slash input', () => {
    expect(parseCommandLine('hello world')).toBeNull();
    expect(parseCommandLine('  ')).toBeNull();
  });

  test('parses bare command (no args)', () => {
    expect(parseCommandLine('/exit')).toEqual({ name: 'exit', args: '' });
  });

  test('parses command with args', () => {
    expect(parseCommandLine('/skill-name arg1 arg2')).toEqual({
      name: 'skill-name',
      args: 'arg1 arg2',
    });
  });

  test('lowercases the name (but not args)', () => {
    expect(parseCommandLine('/EXIT Now')).toEqual({ name: 'exit', args: 'Now' });
  });

  test('strips leading whitespace before parsing', () => {
    expect(parseCommandLine('   /clear  ')).toEqual({ name: 'clear', args: '' });
  });
});

describe('built-in exec contracts', () => {
  function makeCtx(): CommandContext {
    return { args: '', clearHistory: vi.fn() };
  }

  test('/exit returns kind: exit', async () => {
    const cmd = builtinCommands.find(c => c.name === 'exit')!;
    const r = await cmd.exec!(makeCtx());
    expect(r).toEqual({ kind: 'exit' });
  });

  test('/quit also returns kind: exit', async () => {
    const cmd = builtinCommands.find(c => c.name === 'quit')!;
    const r = await cmd.exec!(makeCtx());
    expect(r).toEqual({ kind: 'exit' });
  });

  test('/clear calls ctx.clearHistory and returns continue + hint', async () => {
    const ctx = makeCtx();
    const cmd = builtinCommands.find(c => c.name === 'clear')!;
    const r = await cmd.exec!(ctx);
    expect(ctx.clearHistory).toHaveBeenCalledTimes(1);
    expect(r.kind).toBe('continue');
    if (r.kind === 'continue') expect(r.hint).toMatch(/cleared/i);
  });

  test('/help returns continue with a hint', async () => {
    const cmd = builtinCommands.find(c => c.name === 'help')!;
    const r = await cmd.exec!(makeCtx());
    expect(r.kind).toBe('continue');
  });
});
