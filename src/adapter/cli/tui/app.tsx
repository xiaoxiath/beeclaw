/**
 * Beeclaw TUI root component.
 *
 * Layout (top → bottom):
 *   Banner                       fixed header
 *   <Static items={history}>     completed turns flushed to scrollback
 *   <MessageView active />        currently-streaming live region
 *   <Hint />                      transient banner (errors / unknown cmd)
 *   <InputEditor />               multi-line input with cursor + history
 *
 * Per-turn lifecycle:
 *   1. user submits a non-slash line via InputEditor
 *   2. push user message into a turn-local sequence (live)
 *   3. iterate agent.chatStream(line):
 *        content event       → append to streaming assistant text
 *        tool_call event     → append a pending ToolCard to live sequence
 *        tool_result event   → resolve the matching pending tool by name
 *   4. on stream end, commit the whole turn sequence to history (Static
 *      flushes it to scrollback) and clear live state
 *
 * Ctrl+C lives in a separate top-level useInput so it works regardless
 * of whether the InputEditor is disabled.
 */

import React, { useState, useCallback, useRef } from 'react';
import { Box, Text, Static, useInput, useApp } from 'ink';
import { theme } from './theme';
import { getLogPath } from './logger-redirect';
import { MessageView } from './MessageView';
import { InputEditor } from './InputEditor';
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
  const [status, setStatus] = useState<Status>('idle');
  const [hint, setHint] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [liveTurn, setLiveTurn] = useState<ChatMessage[]>([]);
  const liveTurnRef = useRef<ChatMessage[]>([]);

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
          updateLive(prev => {
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
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setHint(`error: ${msg}`);
    } finally {
      setHistory(prev => [...prev, ...liveTurnRef.current]);
      liveTurnRef.current = [];
      setLiveTurn([]);
      setStatus('idle');
    }
  }, [allocateId, exit, onExit, onSubmit, updateLive]);

  // Top-level useInput — handles Ctrl+C as graceful exit. The
  // InputEditor's own useInput coexists; Ink dispatches to both, but
  // they handle disjoint keys (InputEditor filters out ctrl combos).
  useInput((char, key) => {
    if (key.ctrl && char === 'c' && status !== 'exiting') {
      setStatus('exiting');
      void (async () => {
        if (onExit) await onExit();
        exit();
      })();
    }
  });

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={theme.primary}>🐝 Beeclaw CLI</Text>
        <Text color={theme.dim}>
          {modelLabel ? `model: ${modelLabel}  ·  ` : ''}logs: {getLogPath()}
        </Text>
        <Text color={theme.dim}>
          type /help for commands, /exit to quit  ·  meta+enter or trailing \ for newline
        </Text>
      </Box>

      <Static items={history}>
        {message => <MessageView key={message.id} message={message} />}
      </Static>

      {liveTurn.map(m => (
        <MessageView key={m.id} message={m} />
      ))}

      {hint && (
        <Box marginBottom={1}>
          <Text color={theme.warn}>{hint}</Text>
        </Box>
      )}

      {/* Input + status indicator on the same row when busy. */}
      <Box flexDirection="column">
        <InputEditor onSubmit={handleSubmit} disabled={status !== 'idle'} />
        {status === 'busy' && (
          <Text color={theme.dim}>(working…)</Text>
        )}
        {status === 'exiting' && (
          <Text color={theme.dim}>(exiting…)</Text>
        )}
      </Box>
    </Box>
  );
}
