/**
 * Markdown → ANSI terminal text renderer.
 *
 * Tests assert structural properties: literal markdown markers (** ` `)
 * are stripped, content survives, trailing newlines normalize. We do
 * NOT assert presence of ANSI escapes because marked-terminal disables
 * color when stdout isn't a TTY (e.g. under vitest), which is the
 * correct upstream behavior — the integration in the actual TUI
 * inherits Ink's stdout which does have colors.
 */

import { describe, test, expect } from 'vitest';
import { renderMarkdown } from '../markdown';

describe('renderMarkdown', () => {
  test('empty input returns empty string', () => {
    expect(renderMarkdown('')).toBe('');
  });

  test('plain text passes through with the original words intact', () => {
    const out = renderMarkdown('hello world');
    expect(out).toContain('hello world');
  });

  test('bold marker text survives but literal asterisks are stripped', () => {
    const out = renderMarkdown('I am **bold** here.');
    expect(out).toContain('bold');
    expect(out).not.toContain('**bold**');
  });

  test('code block content survives', () => {
    const out = renderMarkdown('```\nconst x = 1;\n```');
    expect(out).toContain('const x = 1;');
  });

  test('inline code preserves its text without backticks', () => {
    const out = renderMarkdown('use `bun run cli` to start');
    expect(out).toContain('bun run cli');
    expect(out).not.toContain('`bun run cli`');
  });

  test('trailing newlines normalize to a single \\n', () => {
    const out = renderMarkdown('hello\n\n\n\n');
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n\n')).toBe(false);
  });

});
