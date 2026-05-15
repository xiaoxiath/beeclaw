/**
 * Beeclaw TUI root component.
 *
 * PR1 scope: bare shell — banner, input field, /exit. No real chat yet.
 * PR2-PR7 layer in messages, tool cards, slash commands, footer, modals.
 *
 * Architecture:
 *   - Single React component tree under <App>.
 *   - State: { input, status }. Submitted lines flow through onSubmit
 *     prop (TUI is decoupled from agent — wiring happens in PR2).
 *   - Ink renders to stdout; logger goes to logs/cli-debug.log via the
 *     logger-redirect module so chat output stays clean.
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { getLogPath } from './logger-redirect';

export interface AppProps {
  /** Called when the user submits a non-slash line. PR2+ wires this to agent.chatStream. */
  onSubmit?: (line: string) => Promise<void> | void;
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

  const handleSubmit = useCallback(async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    // Slash commands handled here in PR1; PR5 swaps in a richer registry.
    if (trimmed === '/exit' || trimmed === '/quit') {
      setStatus('exiting');
      if (onExit) await onExit();
      exit();
      return;
    }
    if (trimmed === '/help') {
      setHint('Available: /help · /exit · /quit  (more commands in PR5)');
      return;
    }
    if (trimmed.startsWith('/')) {
      setHint(`Unknown command: ${trimmed.split(/\s+/)[0]}. Try /help.`);
      return;
    }

    // Non-slash → chat turn (stubbed in PR1).
    setHint(null);
    setStatus('busy');
    try {
      if (onSubmit) await onSubmit(trimmed);
      else setHint('(PR1 stub: chat wiring lands in PR2)');
    } catch (err) {
      setHint(`error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setStatus('idle');
    }
  }, [exit, onExit, onSubmit]);

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
      // Treat Ctrl+C as graceful /exit.
      setStatus('exiting');
      void (async () => {
        if (onExit) await onExit();
        exit();
      })();
      return;
    }
    // Ignore non-printable keys for PR1 (cursor / history land in PR4).
    if (char && !key.ctrl && !key.meta) {
      setInput(prev => prev + char);
    }
  });

  return (
    <Box flexDirection="column">
      {/* Banner */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">🐝 Beeclaw CLI</Text>
        <Text dimColor>
          {modelLabel ? `model: ${modelLabel}  ·  ` : ''}logs: {getLogPath()}
        </Text>
        <Text dimColor>type /help for commands, /exit to quit</Text>
      </Box>

      {/* Hint / status line (transient) */}
      {hint && (
        <Box marginBottom={1}>
          <Text color="yellow">{hint}</Text>
        </Box>
      )}

      {/* Input */}
      <Box>
        <Text color="cyan" bold>{'> '}</Text>
        <Text>{input}</Text>
        {status === 'idle' && <Text inverse> </Text>}
        {status === 'busy' && <Text dimColor>  (working…)</Text>}
        {status === 'exiting' && <Text dimColor>  (exiting…)</Text>}
      </Box>
    </Box>
  );
}
