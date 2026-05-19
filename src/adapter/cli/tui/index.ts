/**
 * TUI entry — activates logger redirect, renders the App, returns when
 * the user exits. This is the function entries/cli.ts calls in TUI mode.
 */

import React from 'react';
import { execSync } from 'child_process';
import { render } from 'ink';
import type { Agent } from '../../../domain/agent';
import { activateLoggerRedirect, restoreLogger, getLogPath } from './logger-redirect';
import { App } from './app';
import { theme } from './theme';

// ANSI helpers — we render the banner directly (not via Ink) so it
// sits in scrollback ONCE, above the live region. See the comment in
// App.tsx for why putting the banner in the React tree caused it to
// stack on every <Static> commit.
const ansi = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  color: (hex: string, s: string) => {
    // Crude hex → 24-bit ANSI; fine for our 3-color theme.
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return s;
    const [, r, g, b] = m;
    return `\x1b[38;2;${parseInt(r, 16)};${parseInt(g, 16)};${parseInt(b, 16)}m${s}\x1b[0m`;
  },
};

function printBanner(modelLabel?: string): void {
  // eslint-disable-next-line no-console
  console.log(ansi.bold(ansi.color(theme.primary, '🐝 Beeclaw CLI')));
  // eslint-disable-next-line no-console
  console.log(ansi.color(theme.dim,
    `${modelLabel ? `model: ${modelLabel}  ·  ` : ''}logs: ${getLogPath()}`,
  ));
  // eslint-disable-next-line no-console
  console.log(ansi.color(theme.dim,
    'type / for commands, /exit to quit  ·  meta+enter or trailing \\ for newline',
  ));
  // eslint-disable-next-line no-console
  console.log('');
}

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
  printBanner(opts.modelLabel);

  // Belt-and-suspenders raw-mode + echo suppression. Ink toggles
  // setRawMode internally, and under Bun the kernel evidently slips
  // back to cooked mode briefly during a busy turn — letting Enter
  // (and typed letters!) echo into the visible scrollback. We pin
  // raw mode at three layers:
  //   1. setRawMode(true) here once
  //   2. `stty -echo` via the OS TTY (in case Bun's setRawMode is
  //      racy with cooked mode)
  //   3. an interval that re-asserts setRawMode every 200ms in case
  //      Ink toggles it off mid-turn
  // All three are restored on exit.
  let restoreRaw: (() => void) | null = null;
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    const wasRaw = (process.stdin as { isRaw?: boolean }).isRaw === true;
    process.stdin.setRawMode(true);
    if (!process.stdin.isPaused()) process.stdin.resume();

    // Layer 2: stty -echo directly. We try it but don't fail TUI startup
    // if it's missing — setRawMode + interval are the primary defense.
    try { execSync('stty -echo', { stdio: 'ignore' }); } catch { /* no stty? continue */ }

    // Layer 3: periodically re-assert. 200ms is fast enough that even
    // if Ink toggles off after each render, the gap is invisible.
    const interval = setInterval(() => {
      if ((process.stdin as { isRaw?: boolean }).isRaw !== true) {
        try { process.stdin.setRawMode(true); } catch { /* ignore */ }
      }
    }, 200);

    restoreRaw = () => {
      clearInterval(interval);
      try { execSync('stty echo', { stdio: 'ignore' }); } catch { /* ignore */ }
      try { process.stdin.setRawMode(wasRaw); } catch { /* ignore */ }
    };
  }

  const handleSubmit = (line: string) => {
    return opts.agent.chatStream(line) as AsyncIterable<{ type: string; content?: string }>;
  };

  const handleExit = async (): Promise<void> => {
    if (opts.onExit) await opts.onExit();
    restoreLogger();
    if (restoreRaw) restoreRaw();
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
