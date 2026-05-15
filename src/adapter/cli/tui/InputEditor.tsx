/**
 * Multi-line input editor with cursor + history navigation.
 *
 * Bindings (Ink useInput key shape):
 *   printable           insert at cursor
 *   backspace / delete  delete adjacent char
 *   left / right        move cursor 1 char
 *   up / down           cursor row (multi-line) OR history (single-line/edge)
 *   ctrl+a / ctrl+e     line start / line end
 *   ctrl+w              delete word back
 *   meta+b / meta+f     word jump
 *   meta+enter          newline (multi-line continuation)
 *   trailing backslash  also enables newline if user prefers ASCII
 *   enter               submit
 *   ctrl+c              caller handles (App treats as graceful exit)
 *
 * Cursor is rendered as an inverted character at its position. When
 * the cursor is past the end of buffer, an inverted space is shown.
 */

import React, { useReducer, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme } from './theme';
import {
  initialEditorState,
  applyAction,
  type EditorState,
  type EditorAction,
} from './input-editor-state';
import { loadHistory, appendHistory } from './history';

export interface InputEditorProps {
  /** Called with the buffer contents when the user submits with Enter. */
  onSubmit: (line: string) => void;
  /** Disables key handling (e.g. while a turn is busy). */
  disabled?: boolean;
  /** Override path for testing — defaults to ~/.beeclaw_history. */
  historyPath?: string;
}

/**
 * Reducer wrapper so React's `useReducer` signature matches our
 * pure (state, action) → state shape.
 */
function reducer(state: EditorState, action: EditorAction): EditorState {
  return applyAction(state, action);
}

export function InputEditor({ onSubmit, disabled, historyPath }: InputEditorProps): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, initialEditorState);
  // History loaded at mount; new entries are appended to disk + state.
  const [history, setHistory] = React.useState<readonly string[]>([]);

  useEffect(() => {
    setHistory(loadHistory(historyPath));
  }, [historyPath]);

  const submit = useCallback((line: string): void => {
    if (line.length === 0) return;
    appendHistory(line, historyPath);
    setHistory(prev => {
      // Keep newest-first ordering, dedup vs head.
      if (prev[0] === line) return prev;
      return [line, ...prev];
    });
    dispatch({ type: 'reset' });
    onSubmit(line);
  }, [historyPath, onSubmit]);

  useInput((char, key) => {
    if (disabled) return;

    // Submit / newline.
    if (key.return) {
      // Meta+Enter or trailing backslash → newline (multi-line continuation).
      if (key.meta || state.buffer.endsWith('\\')) {
        // If trailing backslash, drop it before inserting the newline so
        // the user doesn't have to manually delete it.
        if (state.buffer.endsWith('\\') && !key.meta) {
          dispatch({ type: 'backspace' });
        }
        dispatch({ type: 'newline' });
        return;
      }
      submit(state.buffer);
      return;
    }

    // Cursor / history.
    if (key.upArrow) { dispatch({ type: 'up', history }); return; }
    if (key.downArrow) { dispatch({ type: 'down', history }); return; }
    if (key.leftArrow) {
      if (key.meta) dispatch({ type: 'wordLeft' });
      else dispatch({ type: 'left' });
      return;
    }
    if (key.rightArrow) {
      if (key.meta) dispatch({ type: 'wordRight' });
      else dispatch({ type: 'right' });
      return;
    }

    // Editing.
    if (key.backspace) { dispatch({ type: 'backspace' }); return; }
    if (key.delete) { dispatch({ type: 'delete' }); return; }

    // Ctrl bindings.
    if (key.ctrl && char === 'a') { dispatch({ type: 'home' }); return; }
    if (key.ctrl && char === 'e') { dispatch({ type: 'end' }); return; }
    if (key.ctrl && char === 'w') { dispatch({ type: 'deleteWord' }); return; }

    // Plain character insert. Ignore other ctrl/meta combos.
    if (char && !key.ctrl && !key.meta) {
      dispatch({ type: 'insert', text: char });
    }
  }, { isActive: !disabled });

  // Render. For single-line, show inline; for multi-line, render each
  // line on its own row. Cursor is the inverted character at state.cursor.
  const lines = state.buffer.split('\n');

  // Compute (row, col) from absolute cursor.
  let cursorRow = 0;
  let cursorCol = state.cursor;
  for (let i = 0; i < lines.length; i++) {
    if (cursorCol <= lines[i].length) {
      cursorRow = i;
      break;
    }
    cursorCol -= lines[i].length + 1; // +1 for the '\n'
  }

  return (
    <Box flexDirection="column">
      {lines.map((line, rowIdx) => {
        const isCursorRow = rowIdx === cursorRow && !disabled;
        const prefix = rowIdx === 0
          ? <Text color={theme.user} bold>{'> '}</Text>
          : <Text color={theme.dim}>{'  '}</Text>;

        if (!isCursorRow) {
          return (
            <Box key={rowIdx} flexDirection="row">
              {prefix}
              <Text>{line}</Text>
            </Box>
          );
        }

        // Cursor is on this row — split around the cursor column and
        // render an inverted character (or space if at end-of-line).
        const before = line.slice(0, cursorCol);
        const at = line.slice(cursorCol, cursorCol + 1);
        const after = line.slice(cursorCol + 1);
        return (
          <Box key={rowIdx} flexDirection="row">
            {prefix}
            <Text>{before}</Text>
            <Text inverse>{at || ' '}</Text>
            <Text>{after}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
