/**
 * Beeclaw TUI root component.
 *
 * Layout (top → bottom):
 *   <Static items={completed}> — chat history flushed to scrollback
 *   <MessageView active />       — currently-streaming assistant turn
 *   <Hint />                     — transient banner (errors / unknown cmd)
 *   <InputArea />                — bottom-aligned input field
 *
 * Ink's <Static> writes each item ONCE above the live region. After
 * write, items aren't re-rendered on subsequent state changes, so
 * appending messages stays cheap as the conversation grows.
 *
 * Scope notes for this PR:
 *   - <InputArea> is still single-line keypress accumulation (PR4
 *     replaces with full cursor/history/multi-line editor).
 *   - Tool events from agent.chatStream are ignored here (PR3 builds
 *     ToolCard); only `content` events are folded into the live
 *     assistant message and committed to scrollback at turn end.
 */

import React, { useState, useCallback, useRef } from 'react';
import { Box, Text, Static, useInput, useApp } from 'ink';
import { theme } from './theme';
import { getLogPath } from './logger-redirect';
import { MessageView } from './MessageView';
import type { ChatMessage } from './messages';
import { nextMessageId } from './messages';

export interface AppProps {
  /**
   * Submit a single user line. Yields streaming events:
   *   { type: 'content', content: string } for text deltas
   *   anything else is ignored in PR2 (PR3 handles tool_call/tool_result)
   * Returns when the turn is done.
   */
  onSubmit?: (line: string) => AsyncIterable<{ type: string; content?: string }>;
  /** Called when the user issues /exit or /quit. */
  onExit?: () => Promise<void> | void;
  /** Banner subtitle, e.g. the active model. PR6 wires this from config. */
  modelLabel?: string;
}

type Status = 'idle' | 'busy' | 'exiting';

export function App({ onSubmit, onExit, modelLabel }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [hint, setHint] = useState<string | null>(null);
  // Committed history — Static flushes these to scrollback once each.
  const [history, setHistory] = useState<ChatMessage[]>([]);
  // Currently-streaming assistant text. Stays live; gets committed to
  // history when the stream ends.
  const [streaming, setStreaming] = useState<string>('');
  const streamingRef = useRef<string>('');

  const commitTurn = useCallback((userLine: string, assistantText: string) => {
    setHistory(prev => {
      const userId = nextMessageId(prev);
      const next: ChatMessage[] = [
        ...prev,
        { id: userId, role: 'user', content: userLine },
      ];
      if (assistantText) {
        next.push({ id: userId + 1, role: 'assistant', content: assistantText });
      }
      return next;
    });
    setStreaming('');
    streamingRef.current = '';
  }, []);

  const handleSubmit = useCallback(async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    // Slash commands (PR5 swaps in a richer registry).
    if (trimmed === '/exit' || trimmed === '/quit') {
      setStatus('exiting');
      if (onExit) await onExit();
      exit();
      return;
    }
    if (trimmed === '/help') {
      setHint('Available: /help · /clear · /exit · /quit  (more in PR5)');
      return;
    }
    if (trimmed === '/clear') {
      setHistory([]);
      setHint('history cleared');
      return;
    }
    if (trimmed.startsWith('/')) {
      setHint(`Unknown command: ${trimmed.split(/\s+/)[0]}. Try /help.`);
      return;
    }

    // Chat turn.
    setHint(null);
    setStatus('busy');
    streamingRef.current = '';
    setStreaming('');

    try {
      if (!onSubmit) {
        commitTurn(trimmed, '(no agent wired — stub)');
        return;
      }
      for await (const ev of onSubmit(trimmed)) {
        if (ev.type === 'content' && typeof ev.content === 'string') {
          streamingRef.current += ev.content;
          setStreaming(streamingRef.current);
        }
        // tool_call / tool_result events ignored in PR2 — PR3 wires them.
      }
      commitTurn(trimmed, streamingRef.current);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setHint(`error: ${msg}`);
      commitTurn(trimmed, '');
    } finally {
      setStatus('idle');
    }
  }, [exit, onExit, onSubmit, commitTurn]);

  useInput((char, key) => {
    if (status === 'exiting') return;
    if (key.return) {
      const value = input;
      setInput('');
      void handleSubmit(value);
      return;
    }
    if (key.backspace || key.delete) {
      setInput(prev => prev.slice(0, -1));
      return;
    }
    if (key.ctrl && char === 'c') {
      setStatus('exiting');
      void (async () => {
        if (onExit) await onExit();
        exit();
      })();
      return;
    }
    if (char && !key.ctrl && !key.meta) {
      setInput(prev => prev + char);
    }
  });

  // Streaming live message (only visible while status === 'busy').
  const liveAssistant: ChatMessage | null = streaming
    ? { id: -1, role: 'assistant', content: streaming }
    : null;

  return (
    <Box flexDirection="column">
      {/* Banner — Ink renders this once at top, before <Static>. */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={theme.primary}>🐝 Beeclaw CLI</Text>
        <Text color={theme.dim}>
          {modelLabel ? `model: ${modelLabel}  ·  ` : ''}logs: {getLogPath()}
        </Text>
        <Text color={theme.dim}>type /help for commands, /exit to quit</Text>
      </Box>

      {/* Completed messages: flushed to scrollback, never re-rendered. */}
      <Static items={history}>
        {message => <MessageView key={message.id} message={message} />}
      </Static>

      {/* Currently-streaming assistant text — stays live, re-renders per delta. */}
      {liveAssistant && <MessageView message={liveAssistant} />}

      {/* Transient hint line. */}
      {hint && (
        <Box marginBottom={1}>
          <Text color={theme.warn}>{hint}</Text>
        </Box>
      )}

      {/* Input. */}
      <Box>
        <Text color={theme.user} bold>{'> '}</Text>
        <Text>{input}</Text>
        {status === 'idle' && <Text inverse> </Text>}
        {status === 'busy' && <Text color={theme.dim}>  (working…)</Text>}
        {status === 'exiting' && <Text color={theme.dim}>  (exiting…)</Text>}
      </Box>
    </Box>
  );
}
