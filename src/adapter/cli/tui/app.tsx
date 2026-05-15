/**
 * Beeclaw TUI root component.
 *
 * Layout (top → bottom):
 *   <Static items={history}>     completed turns flushed to scrollback
 *   <MessageView active />        currently-streaming live region
 *   <Hint />                      transient banner (errors / unknown cmd)
 *   <InputArea />                 bottom-aligned input field
 *
 * Per-turn lifecycle:
 *   1. user submits a non-slash line
 *   2. push user message into a turn-local sequence (live)
 *   3. iterate agent.chatStream(line):
 *        content event       → append to streaming assistant text
 *        tool_call event     → append a pending ToolCard to live sequence
 *        tool_result event   → resolve the matching pending tool by name
 *   4. on stream end, commit the whole turn sequence to history (Static
 *      flushes it to scrollback) and clear live state
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
   *   { type: 'content', content: string }                — text delta
   *   { type: 'tool_call', name, params }                 — tool start
   *   { type: 'tool_result', name, result }               — tool end
   * Returns when the turn is done.
   */
  onSubmit?: (line: string) => AsyncIterable<{
    type: string;
    content?: string;
    name?: string;
    params?: Record<string, unknown>;
    result?: unknown;
  }>;
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
  // The currently-running turn's events. Held live until the turn ends,
  // then appended wholesale to history. We keep tools + assistant text
  // as separate entries so the order matches what the model emitted.
  const [liveTurn, setLiveTurn] = useState<ChatMessage[]>([]);
  const liveTurnRef = useRef<ChatMessage[]>([]);

  // Local id allocator that combines history + live so no duplicates.
  const allocateId = useCallback((): number => {
    const all = [...history, ...liveTurnRef.current];
    return nextMessageId(all);
  }, [history]);

  const updateLive = useCallback((updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    const next = updater(liveTurnRef.current);
    liveTurnRef.current = next;
    setLiveTurn(next);
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

    // Seed the turn with the user's message.
    const userMsg: ChatMessage = { id: allocateId(), kind: 'user', content: trimmed };
    updateLive(() => [userMsg]);

    try {
      if (!onSubmit) {
        const stub: ChatMessage = {
          id: allocateId() + 1,
          kind: 'assistant',
          content: '(no agent wired — stub)',
        };
        updateLive(prev => [...prev, stub]);
        return;
      }

      // Track the currently-streaming assistant message so we can
      // append content deltas in place.
      let assistantId: number | null = null;

      for await (const ev of onSubmit(trimmed)) {
        if (ev.type === 'content' && typeof ev.content === 'string') {
          if (assistantId === null) {
            const seed: ChatMessage = {
              id: allocateId(),
              kind: 'assistant',
              content: ev.content,
            };
            assistantId = seed.id;
            updateLive(prev => [...prev, seed]);
          } else {
            updateLive(prev => prev.map(m =>
              m.id === assistantId && m.kind === 'assistant'
                ? { ...m, content: m.content + ev.content! }
                : m
            ));
          }
          continue;
        }

        if (ev.type === 'tool_call' && typeof ev.name === 'string') {
          // A new tool call. If we already had a streaming assistant,
          // close that off (a fresh assistant message can re-open after
          // tool results — matches how multi-step agents emit text).
          assistantId = null;
          const tool: ChatMessage = {
            id: allocateId(),
            kind: 'tool',
            name: ev.name,
            params: ev.params ?? {},
            resolved: false,
          };
          updateLive(prev => [...prev, tool]);
          continue;
        }

        if (ev.type === 'tool_result' && typeof ev.name === 'string') {
          // Resolve the most-recent pending tool with the matching name.
          updateLive(prev => {
            // Walk backwards to find latest unresolved with matching name.
            let updated = false;
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i--) {
              const m = next[i];
              if (m.kind === 'tool' && !m.resolved && m.name === ev.name) {
                next[i] = { ...m, result: ev.result, resolved: true };
                updated = true;
                break;
              }
            }
            return updated ? next : prev;
          });
          continue;
        }
        // Unknown event types are silently ignored.
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setHint(`error: ${msg}`);
    } finally {
      // Commit the whole turn to history; scrollback flushes via Static.
      setHistory(prev => [...prev, ...liveTurnRef.current]);
      liveTurnRef.current = [];
      setLiveTurn([]);
      setStatus('idle');
    }
  }, [allocateId, exit, onExit, onSubmit, updateLive]);

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

      {/* Completed turns: flushed to scrollback, never re-rendered. */}
      <Static items={history}>
        {message => <MessageView key={message.id} message={message} />}
      </Static>

      {/* Live turn (in-flight): re-renders per delta. */}
      {liveTurn.map(m => (
        <MessageView key={m.id} message={m} />
      ))}

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
