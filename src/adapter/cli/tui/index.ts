/**
 * TUI entry — activates logger redirect, renders the App, returns when
 * the user exits. This is the function entries/cli.ts calls in TUI mode.
 *
 * PR1: chat handler is a stub that just echoes back. PR2 wires the real
 * agent.chatStream consumer.
 */

import React from 'react';
import { render } from 'ink';
import type { Agent } from '../../../domain/agent';
import { activateLoggerRedirect, restoreLogger } from './logger-redirect';
import { App } from './app';

export interface RunTuiOptions {
  agent: Agent;
  /** Used as the banner subtitle. PR6 will compute this from config. */
  modelLabel?: string;
  /** Cleanup hook fired on graceful /exit. */
  onExit?: () => void | Promise<void>;
}

/**
 * Returns true if the current stdin can support Ink's raw-mode reader.
 * Ink throws on construction otherwise (CI / pipe / docker without -it).
 */
export function canRunTui(): boolean {
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
}

export async function runTui(opts: RunTuiOptions): Promise<void> {
  if (!canRunTui()) {
    throw new Error(
      'TUI mode requires an interactive TTY. ' +
      'Set BEECLAW_LEGACY_CLI=1 to use the line-based REPL (works under pipes / CI).'
    );
  }

  // CRITICAL: activate BEFORE first React render. Any logger calls
  // during agent / hook init that fire after this point will route
  // to the side log file instead of corrupting Ink's output grid.
  activateLoggerRedirect();

  // Real wiring: each user line becomes an agent.chatStream() turn.
  // The App expects an AsyncIterable of {type, content?} events; we
  // adapt by yielding from the agent's generator directly. PR3 will
  // also pass through tool_call / tool_result events for ToolCard.
  const handleSubmit = (line: string) => {
    return opts.agent.chatStream(line) as AsyncIterable<{ type: string; content?: string }>;
  };

  const handleExit = async (): Promise<void> => {
    if (opts.onExit) await opts.onExit();
    restoreLogger();
  };

  const instance = render(
    React.createElement(App, {
      onSubmit: handleSubmit,
      onExit: handleExit,
      modelLabel: opts.modelLabel,
    }),
  );

  await instance.waitUntilExit();
}
