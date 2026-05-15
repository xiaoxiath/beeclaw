/**
 * Pure reducer tests — no React, no Ink. Covers cursor mechanics,
 * multi-line navigation, history browse, word jumps.
 */

import { describe, test, expect } from 'vitest';
import {
  applyAction,
  initialEditorState,
  type EditorState,
} from '../input-editor-state';

const empty: EditorState = { ...initialEditorState };

describe('insert / backspace / delete', () => {
  test('insert appends and advances cursor', () => {
    const s = applyAction(empty, { type: 'insert', text: 'hi' });
    expect(s.buffer).toBe('hi');
    expect(s.cursor).toBe(2);
  });

  test('insert respects cursor position', () => {
    let s: EditorState = { ...empty, buffer: 'hello', cursor: 2 };
    s = applyAction(s, { type: 'insert', text: 'X' });
    expect(s.buffer).toBe('heXllo');
    expect(s.cursor).toBe(3);
  });

  test('backspace removes char before cursor', () => {
    const s = applyAction({ ...empty, buffer: 'abc', cursor: 3 }, { type: 'backspace' });
    expect(s.buffer).toBe('ab');
    expect(s.cursor).toBe(2);
  });

  test('backspace at cursor=0 is a no-op', () => {
    const s = applyAction({ ...empty, buffer: 'abc', cursor: 0 }, { type: 'backspace' });
    expect(s).toEqual({ ...empty, buffer: 'abc', cursor: 0 });
  });

  test('delete removes char at cursor (forward)', () => {
    const s = applyAction({ ...empty, buffer: 'abc', cursor: 1 }, { type: 'delete' });
    expect(s.buffer).toBe('ac');
    expect(s.cursor).toBe(1);
  });

  test('delete at end of buffer is a no-op', () => {
    const s = applyAction({ ...empty, buffer: 'abc', cursor: 3 }, { type: 'delete' });
    expect(s.buffer).toBe('abc');
  });
});

describe('cursor movement', () => {
  test('left / right move within bounds', () => {
    let s: EditorState = { ...empty, buffer: 'abc', cursor: 1 };
    s = applyAction(s, { type: 'left' });
    expect(s.cursor).toBe(0);
    s = applyAction(s, { type: 'left' });
    expect(s.cursor).toBe(0); // clamped
    s = applyAction(s, { type: 'right' });
    expect(s.cursor).toBe(1);
  });

  test('home moves to current line start', () => {
    const s = applyAction(
      { ...empty, buffer: 'foo\nbar', cursor: 6 },
      { type: 'home' },
    );
    expect(s.cursor).toBe(4); // 'b' position
  });

  test('end moves to current line end', () => {
    const s = applyAction(
      { ...empty, buffer: 'foo\nbar', cursor: 5 },
      { type: 'end' },
    );
    expect(s.cursor).toBe(7); // end of 'bar'
  });

  test('home/end on single-line work too', () => {
    let s = applyAction({ ...empty, buffer: 'hello', cursor: 2 }, { type: 'home' });
    expect(s.cursor).toBe(0);
    s = applyAction(s, { type: 'end' });
    expect(s.cursor).toBe(5);
  });
});

describe('word jumps', () => {
  test('wordLeft skips current word + leading whitespace', () => {
    const s = applyAction(
      { ...empty, buffer: 'foo bar baz', cursor: 11 },
      { type: 'wordLeft' },
    );
    expect(s.cursor).toBe(8); // 'b' of baz
  });

  test('wordRight jumps to start of next word', () => {
    const s = applyAction(
      { ...empty, buffer: 'foo bar baz', cursor: 0 },
      { type: 'wordRight' },
    );
    expect(s.cursor).toBe(3); // end of "foo"
  });

  test('deleteWord removes word back from cursor', () => {
    const s = applyAction(
      { ...empty, buffer: 'foo bar baz', cursor: 11 },
      { type: 'deleteWord' },
    );
    expect(s.buffer).toBe('foo bar ');
    expect(s.cursor).toBe(8);
  });
});

describe('multi-line navigation (up/down)', () => {
  test('up on multi-line moves cursor to previous row, same col', () => {
    const s = applyAction(
      { ...empty, buffer: 'aaaa\nbbbb', cursor: 7 }, // col=2 of "bbbb"
      { type: 'up', history: [] },
    );
    expect(s.cursor).toBe(2); // col=2 of "aaaa"
  });

  test('up clamps col when previous line is shorter', () => {
    const s = applyAction(
      { ...empty, buffer: 'ab\nlonger line', cursor: 9 }, // col=6
      { type: 'up', history: [] },
    );
    expect(s.cursor).toBe(2); // end of "ab"
  });

  test('down on multi-line moves cursor to next row', () => {
    const s = applyAction(
      { ...empty, buffer: 'aaaa\nbbbb', cursor: 1 }, // col=1 of "aaaa"
      { type: 'down', history: [] },
    );
    expect(s.cursor).toBe(6); // col=1 of "bbbb"
  });

  test('newline action splits buffer at cursor', () => {
    const s = applyAction(
      { ...empty, buffer: 'foo bar', cursor: 4 },
      { type: 'newline' },
    );
    expect(s.buffer).toBe('foo \nbar');
    expect(s.cursor).toBe(5);
  });
});

describe('history navigation', () => {
  const history = ['most recent', 'middle', 'oldest']; // newest first

  test('up enters history, saves draft, loads newest entry', () => {
    let s: EditorState = { ...empty, buffer: 'my draft', cursor: 8 };
    s = applyAction(s, { type: 'up', history });
    expect(s.buffer).toBe('most recent');
    expect(s.cursor).toBe('most recent'.length);
    expect(s.historyIndex).toBe(0);
    expect(s.savedDraft).toBe('my draft');
  });

  test('up walks deeper into history', () => {
    let s: EditorState = { ...empty, buffer: '', cursor: 0 };
    s = applyAction(s, { type: 'up', history });
    s = applyAction(s, { type: 'up', history });
    expect(s.buffer).toBe('middle');
    expect(s.historyIndex).toBe(1);
  });

  test('down at oldest is a no-op (cannot go older than oldest)', () => {
    let s: EditorState = { ...empty, historyIndex: 2, buffer: 'oldest', cursor: 6 };
    const before = { ...s };
    s = applyAction(s, { type: 'down', history }); // moves to index 1
    expect(s.historyIndex).toBe(1);
    expect(before.historyIndex).toBe(2); // didn't mutate
  });

  test('down past newest restores savedDraft', () => {
    let s: EditorState = { ...empty, buffer: 'draft', cursor: 5 };
    s = applyAction(s, { type: 'up', history });   // draft → "most recent", saves 'draft'
    s = applyAction(s, { type: 'down', history }); // exits history → 'draft' restored
    expect(s.buffer).toBe('draft');
    expect(s.historyIndex).toBe(-1);
  });

  test('up with empty history is a no-op', () => {
    const s = applyAction(empty, { type: 'up', history: [] });
    expect(s).toEqual(empty);
  });

  test('insert while in history exits history mode and uses current entry', () => {
    let s: EditorState = { ...empty, buffer: 'draft', cursor: 5 };
    s = applyAction(s, { type: 'up', history });   // now showing 'most recent'
    s = applyAction(s, { type: 'insert', text: '!' });
    expect(s.buffer).toBe('most recent!');
    expect(s.historyIndex).toBe(-1);
    expect(s.savedDraft).toBe(''); // cleared by edit
  });
});

describe('reset', () => {
  test('returns to initial state regardless of history index', () => {
    const s = applyAction(
      { buffer: 'stuff', cursor: 3, historyIndex: 1, savedDraft: 'draft' },
      { type: 'reset' },
    );
    expect(s).toEqual(initialEditorState);
  });
});
