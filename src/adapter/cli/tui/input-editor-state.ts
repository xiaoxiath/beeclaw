/**
 * Pure state + reducer for the input editor.
 *
 * Lives independently from the React component so we can unit-test
 * cursor / word-jump / history navigation behavior with no Ink.
 *
 * State shape:
 *   buffer       — the current text (may contain '\n' for multi-line)
 *   cursor       — byte offset into buffer (0..buffer.length)
 *   historyIndex — -1 means "current draft"; 0+ indexes into history[]
 *                  (history[0] is the most-recent submission)
 *   savedDraft   — the buffer the user was editing when they started
 *                  browsing history; restored when they exit history
 */

export interface EditorState {
  buffer: string;
  cursor: number;
  historyIndex: number;
  savedDraft: string;
}

export const initialEditorState: EditorState = {
  buffer: '',
  cursor: 0,
  historyIndex: -1,
  savedDraft: '',
};

export type EditorAction =
  | { type: 'insert'; text: string }
  | { type: 'backspace' }
  | { type: 'delete' }
  | { type: 'left' }
  | { type: 'right' }
  | { type: 'up'; history: readonly string[] }
  | { type: 'down'; history: readonly string[] }
  | { type: 'home' }   // line start (cursor)
  | { type: 'end' }    // line end (cursor)
  | { type: 'wordLeft' }
  | { type: 'wordRight' }
  | { type: 'deleteWord' }
  | { type: 'newline' }  // explicit \n insert (for multi-line continuation)
  | { type: 'reset' };   // clear, cursor=0, historyIndex=-1

// ─── Internal helpers (pure) ────────────────────────────────────────────────

const WORD_BOUNDARY_RE = /[^\w]/;

/** Find the start of the current line (offset of char after previous \n, or 0). */
function lineStart(buf: string, cur: number): number {
  for (let i = cur - 1; i >= 0; i--) {
    if (buf[i] === '\n') return i + 1;
  }
  return 0;
}
/** Find the end of the current line (offset of next \n, or buffer length). */
function lineEnd(buf: string, cur: number): number {
  const idx = buf.indexOf('\n', cur);
  return idx === -1 ? buf.length : idx;
}

/** Move cursor one word to the left. */
function wordLeft(buf: string, cur: number): number {
  if (cur === 0) return 0;
  let i = cur - 1;
  // Skip trailing whitespace/punct.
  while (i > 0 && WORD_BOUNDARY_RE.test(buf[i])) i--;
  // Skip word characters.
  while (i > 0 && !WORD_BOUNDARY_RE.test(buf[i - 1])) i--;
  return i;
}
function wordRight(buf: string, cur: number): number {
  const len = buf.length;
  if (cur >= len) return len;
  let i = cur;
  while (i < len && WORD_BOUNDARY_RE.test(buf[i])) i++;
  while (i < len && !WORD_BOUNDARY_RE.test(buf[i])) i++;
  return i;
}

// ─── Public reducer ─────────────────────────────────────────────────────────

export function applyAction(state: EditorState, action: EditorAction): EditorState {
  const { buffer, cursor } = state;

  switch (action.type) {
    case 'insert': {
      // Any user typing exits history-browse mode and clears savedDraft.
      const text = action.text;
      if (!text) return state;
      return {
        buffer: buffer.slice(0, cursor) + text + buffer.slice(cursor),
        cursor: cursor + text.length,
        historyIndex: -1,
        savedDraft: '',
      };
    }
    case 'newline': {
      return {
        buffer: buffer.slice(0, cursor) + '\n' + buffer.slice(cursor),
        cursor: cursor + 1,
        historyIndex: -1,
        savedDraft: '',
      };
    }
    case 'backspace': {
      if (cursor === 0) return state;
      return {
        ...state,
        buffer: buffer.slice(0, cursor - 1) + buffer.slice(cursor),
        cursor: cursor - 1,
      };
    }
    case 'delete': {
      if (cursor >= buffer.length) return state;
      return {
        ...state,
        buffer: buffer.slice(0, cursor) + buffer.slice(cursor + 1),
      };
    }
    case 'left':
      return cursor > 0 ? { ...state, cursor: cursor - 1 } : state;
    case 'right':
      return cursor < buffer.length ? { ...state, cursor: cursor + 1 } : state;
    case 'home':
      return { ...state, cursor: lineStart(buffer, cursor) };
    case 'end':
      return { ...state, cursor: lineEnd(buffer, cursor) };
    case 'wordLeft':
      return { ...state, cursor: wordLeft(buffer, cursor) };
    case 'wordRight':
      return { ...state, cursor: wordRight(buffer, cursor) };
    case 'deleteWord': {
      const newCursor = wordLeft(buffer, cursor);
      return {
        ...state,
        buffer: buffer.slice(0, newCursor) + buffer.slice(cursor),
        cursor: newCursor,
      };
    }
    case 'up': {
      // Multi-line: move cursor up one line if possible.
      // Single-line: navigate history backward.
      if (buffer.includes('\n') && !isFirstLine(buffer, cursor)) {
        return moveUpOneLine(state);
      }
      return navigateHistory(state, action.history, +1);
    }
    case 'down': {
      if (buffer.includes('\n') && !isLastLine(buffer, cursor)) {
        return moveDownOneLine(state);
      }
      return navigateHistory(state, action.history, -1);
    }
    case 'reset':
      return { ...initialEditorState };
  }
}

function isFirstLine(buf: string, cur: number): boolean {
  return lineStart(buf, cur) === 0;
}
function isLastLine(buf: string, cur: number): boolean {
  return lineEnd(buf, cur) === buf.length;
}

function moveUpOneLine(state: EditorState): EditorState {
  const { buffer, cursor } = state;
  const curLineStart = lineStart(buffer, cursor);
  const col = cursor - curLineStart;
  const prevLineEnd = curLineStart - 1;       // the '\n' itself
  const prevLineStart = lineStart(buffer, prevLineEnd);
  const prevLineLen = prevLineEnd - prevLineStart;
  const newCol = Math.min(col, prevLineLen);
  return { ...state, cursor: prevLineStart + newCol };
}

function moveDownOneLine(state: EditorState): EditorState {
  const { buffer, cursor } = state;
  const curLineStart = lineStart(buffer, cursor);
  const col = cursor - curLineStart;
  const curLineEnd = lineEnd(buffer, cursor); // the '\n' or buffer.length
  const nextLineStart = curLineEnd + 1;
  if (nextLineStart > buffer.length) return state;
  const nextLineEnd = lineEnd(buffer, nextLineStart);
  const nextLineLen = nextLineEnd - nextLineStart;
  const newCol = Math.min(col, nextLineLen);
  return { ...state, cursor: nextLineStart + newCol };
}

/**
 * Navigate the persisted history. delta=+1 goes "older" (up), -1 goes
 * "newer" (down). When stepping out of history at the bottom, restore
 * the savedDraft. When entering history from -1, save the current
 * buffer as savedDraft so it survives the round trip.
 */
function navigateHistory(state: EditorState, history: readonly string[], delta: number): EditorState {
  if (history.length === 0) return state;
  const newIndex = state.historyIndex + delta;
  if (newIndex < -1) return state; // already at draft, can't go newer
  if (newIndex >= history.length) return state; // at oldest, can't go older

  const enteringHistory = state.historyIndex === -1 && newIndex >= 0;
  const exitingHistory = newIndex === -1;

  let buffer: string;
  if (exitingHistory) {
    buffer = state.savedDraft;
  } else {
    buffer = history[newIndex];
  }

  return {
    buffer,
    cursor: buffer.length,
    historyIndex: newIndex,
    savedDraft: enteringHistory ? state.buffer : state.savedDraft,
  };
}
