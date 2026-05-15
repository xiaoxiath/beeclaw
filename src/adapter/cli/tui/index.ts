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

  // PR1 stub: chat handler echoes. PR2 swaps in agent.chatStream.
  const handleSubmit = async (line: string): Promise<void> => {
    // Use stderr so it doesn't fight Ink's stdout — PR2 replaces this.
    process.stderr.write(`[stub] would chat: ${line}\n`);
    void opts.agent; // mark referenced; PR2 actually uses it
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
