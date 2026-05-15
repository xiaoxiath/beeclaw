/**
 * Multi-line input editor with cursor + history + slash-command picker.
 *
 * Bindings (Ink useInput key shape):
 *   printable           insert at cursor
 *   backspace / delete  delete adjacent char
 *   left / right        move cursor 1 char
 *   up / down           cursor row (multi-line) OR history (single-line/edge)
 *                       OR picker selection (when picker is visible)
 *   tab                 with picker visible: insert selected command name
 *   enter               with picker visible: insert selected command name
 *                       otherwise: submit
 *   esc                 dismiss picker without clearing buffer
 *   ctrl+a / ctrl+e     line start / line end
 *   ctrl+w              delete word back
 *   meta+left/right     word jump
 *   meta+enter          newline (multi-line continuation)
 *   trailing backslash  also enables newline if user prefers ASCII
 *   ctrl+c              caller handles (App treats as graceful exit)
 *
 * Picker visibility derives from buffer.startsWith('/') AND a non-empty
 * `commands` registry being passed. Pressing Esc dismisses the picker
 * without clearing the buffer; typing anything that mutates the buffer
 * resets the dismissal state, so the picker reappears.
 */

import React, { useReducer, useEffect, useCallback, useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme } from './theme';
import {
  initialEditorState,
  applyAction,
  type EditorState,
  type EditorAction,
} from './input-editor-state';
import { loadHistory, appendHistory } from './history';
import { CommandPicker } from './CommandPicker';
import { rankCommands } from './command-scorer';
import type { Command } from './commands';

export interface InputEditorProps {
  /** Called with the buffer contents when the user submits with Enter. */
  onSubmit: (line: string) => void;
  /** Disables key handling (e.g. while a turn is busy). */
  disabled?: boolean;
  /** Override path for testing — defaults to ~/.beeclaw_history. */
  historyPath?: string;
  /** When set, enables slash-command picker. */
  commands?: readonly Command[];
}

function reducer(state: EditorState, action: EditorAction): EditorState {
  return applyAction(state, action);
}

const PICKER_LIMIT = 5;

export function InputEditor({ onSubmit, disabled, historyPath, commands }: InputEditorProps): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, initialEditorState);
  const [history, setHistory] = useState<readonly string[]>([]);
  const [pickerSelectedIdx, setPickerSelectedIdx] = useState(0);
  const [pickerDismissed, setPickerDismissed] = useState(false);

  useEffect(() => {
    setHistory(loadHistory(historyPath));
  }, [historyPath]);

  // Picker becomes visible only when buffer starts with '/' and we
  // were given a registry to query. Esc latches it off until the
  // buffer changes (handled below by clearing pickerDismissed).
  const pickerActive = !!commands && state.buffer.startsWith('/') && !pickerDismissed;
  const pickerMatches = useMemo(() => {
    if (!pickerActive || !commands) return [];
    return rankCommands(state.buffer.slice(1), commands, PICKER_LIMIT);
  }, [pickerActive, commands, state.buffer]);

  // Reset selection when the picker contents change shape.
  useEffect(() => {
    setPickerSelectedIdx(idx => {
      if (pickerMatches.length === 0) return 0;
      if (idx >= pickerMatches.length) return 0;
      return idx;
    });
  }, [pickerMatches]);

  const submit = useCallback((line: string): void => {
    if (line.length === 0) return;
    appendHistory(line, historyPath);
    setHistory(prev => {
      if (prev[0] === line) return prev;
      return [line, ...prev];
    });
    setPickerDismissed(false);
    setPickerSelectedIdx(0);
    dispatch({ type: 'reset' });
    onSubmit(line);
  }, [historyPath, onSubmit]);

  /**
   * Replace the entire buffer with the picked command + trailing space,
   * ready for arguments. Resets cursor to the end.
   */
  const insertSelectedCommand = useCallback(() => {
    if (pickerMatches.length === 0) return;
    const picked = pickerMatches[pickerSelectedIdx]?.command;
    if (!picked) return;
    dispatch({ type: 'reset' });
    dispatch({ type: 'insert', text: `/${picked.name} ` });
  }, [pickerMatches, pickerSelectedIdx]);

  useInput((char, key) => {
    if (disabled) return;

    // Picker-aware navigation when visible.
    if (pickerActive && pickerMatches.length > 0) {
      if (key.upArrow) {
        setPickerSelectedIdx(i => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setPickerSelectedIdx(i => Math.min(pickerMatches.length - 1, i + 1));
        return;
      }
      if (key.tab) {
        insertSelectedCommand();
        return;
      }
      if (key.escape) {
        setPickerDismissed(true);
        return;
      }
      // Enter: if picker is visible AND user hasn't typed anything past
      // the slash query, treat Enter as "pick this command". Otherwise
      // (user already added args), Enter submits the line as-is.
      if (key.return && !key.meta) {
        const picked = pickerMatches[pickerSelectedIdx];
        // If buffer exactly equals "/<picked-name>" or shorter, expand.
        const bufferQuery = state.buffer.slice(1);
        if (picked && bufferQuery.length <= picked.command.name.length) {
          insertSelectedCommand();
          return;
        }
        // Otherwise fall through to normal submit.
      }
    }

    // Submit / newline.
    if (key.return) {
      if (key.meta || state.buffer.endsWith('\\')) {
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
    if (key.backspace) {
      // Re-arm picker on edit.
      setPickerDismissed(false);
      dispatch({ type: 'backspace' });
      return;
    }
    if (key.delete) {
      setPickerDismissed(false);
      dispatch({ type: 'delete' });
      return;
    }

    if (key.ctrl && char === 'a') { dispatch({ type: 'home' }); return; }
    if (key.ctrl && char === 'e') { dispatch({ type: 'end' }); return; }
    if (key.ctrl && char === 'w') { dispatch({ type: 'deleteWord' }); return; }

    if (char && !key.ctrl && !key.meta) {
      // Re-arm picker on typed char.
      setPickerDismissed(false);
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
      {/* Picker (above the input row, only when visible). */}
      {pickerActive && pickerMatches.length > 0 && (
        <CommandPicker matches={pickerMatches} selectedIndex={pickerSelectedIdx} />
      )}

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
