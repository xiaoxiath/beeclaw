/**
 * TUI entry — activates logger redirect, renders the App, returns when
 * the user exits. This is the function entries/cli.ts calls in TUI mode.
 */

import React from 'react';
import { render } from 'ink';
import type { Agent } from '../../../domain/agent';
import { activateLoggerRedirect, restoreLogger } from './logger-redirect';
import { App } from './app';

// Banner is now rendered inside Ink by <WelcomeBanner/> when messages
// are empty — see app.tsx. After the first turn it disappears from
// the tree (cleaner than a persistent header).

export interface RunTuiOptions {
  agent: Agent;
  /** Used as the banner subtitle. PR6 will compute this from config. */
  modelLabel?: string;
  /** Cleanup hook fired on graceful /exit. */
  onExit?: () => void | Promise<void>;
  /**
   * Skills available for the slash-command picker. Pass `undefined`
   * to skip skill commands entirely (only built-ins exposed).
   */
  skills?: Array<{ name: string; description?: string }>;
  /**
   * Ops-info supplier for /model and /sessions hints. Called on
   * demand so values stay fresh.
   */
  getInfo?: () => { modelLine: string; sessionsLine: string };
  /** Footer's right-hand total-tokens stat. App polls at turn boundaries. */
  getTotalTokens?: () => number;
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
      'For piped / CI scripts, drive the agent through bun run bot or bun run web instead.'
    );
  }

  // CRITICAL: activate BEFORE first React render. Any logger calls
  // during agent / hook init that fire after this point will route
  // to the side log file instead of corrupting Ink's output grid.
  activateLoggerRedirect();

  // Banner printed directly to stdout — Ink's render area mounts BELOW
  // it. Putting the banner inside the React tree (any sibling of
  // <Static>) caused it to re-appear in scrollback on every Static
  // commit, because Ink erases at its OLD tracked position while
  // Static-flushed lines have pushed everything down.
  // No stty / setRawMode acrobatics needed any more: App.tsx now
  // architecturally avoids the situations where Ink would toggle
  // raw mode off (App-level + InputEditor useInput are BOTH always
  // active and consume every key). The earlier echo problem was a
  // symptom of useInput de-registering during busy state, which we
  // no longer do.

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
      skills: opts.skills,
      getInfo: opts.getInfo,
      getTotalTokens: opts.getTotalTokens,
    }),
  );

  await instance.waitUntilExit();
}
