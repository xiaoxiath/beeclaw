#!/usr/bin/env bun
/**
 * Beeclaw CLI - Interactive AI Assistant.
 *
 * Default UI is the Ink-based TUI (src/adapter/cli/tui/). It requires
 * an interactive TTY — Ink's raw-mode reader cannot attach when stdin
 * is piped, redirected, or running under CI.
 *
 * Usage:
 *   bun run cli           # start TUI chat
 *   bun run cli --help    # show help
 */

import { logger } from '../infra/observability/logger';
import { CLIAdapter } from '../adapter/cli/adapter';
import { adapterRegistry } from '../infra/entry';
import { initApp, getAgent, getConfig_ } from '../app';
import { GracefulShutdown } from '../infra/utils/graceful-shutdown';
import { runTui, canRunTui } from '../adapter/cli/tui';

function showHelp(): void {
  // Direct console output — logger is replaced by the TUI's redirect
  // when running interactively, so we want this to land on stdout
  // directly even with --help.
  // eslint-disable-next-line no-console
  console.log(`
🐝 Beeclaw CLI - Interactive AI Assistant

Usage:
  bun run cli           # Start interactive chat (TUI)
  bun run cli --help    # Show help

Inside the TUI:
  type / to see slash commands (autocomplete picker)
  /clear /exit /quit /help /model /sessions   built-in commands
  /<skill-name>                                  any installed skill
  meta+enter or trailing \\                       multi-line input
  up / down                                      cursor or input history
  ctrl+a / ctrl+e                                line start / end
  ctrl+w                                         delete word back
  ctrl+c                                         graceful exit

Logs (info+ from internal subsystems) go to logs/cli-debug.log so
chat output owns stdout cleanly.
`);
  process.exit(0);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
  }

  logger.info('🐝 Starting Beeclaw CLI...\n');

  try {
    const context = await initApp({
      enableRecovery: false, // CLI 模式不需要 session recovery
    });

    const cliAdapter = new CLIAdapter();
    adapterRegistry.register(cliAdapter);

    await cliAdapter.initialize(context);
    await cliAdapter.start();

    logger.info('\n✅ Beeclaw CLI started\n');

    const shutdown = new GracefulShutdown({ installSignalHandlers: false });
    shutdown.register({
      name: 'cli-adapter-shutdown',
      priority: 10,
      fn: async () => {
        logger.debug('\n\n🛑 Shutting down CLI...');
        await adapterRegistry.stopAll();
      },
    });
    shutdown.installSignalHandlers();

    if (!canRunTui()) {
      // TUI requires a real TTY (Ink's raw-mode reader). Fail fast with
      // a clear message rather than silently breaking. Operators who
      // need scripted / piped runs should drive the agent through its
      // bot/web entry points.
      // eslint-disable-next-line no-console
      console.error(
        '❌ Beeclaw CLI requires an interactive TTY. ' +
        'Detected: stdin.isTTY=' + Boolean(process.stdin.isTTY) +
        ' stdout.isTTY=' + Boolean(process.stdout.isTTY) + '\n' +
        '   For piped / CI scripts, use `bun run bot` (Feishu) or ' +
        '`bun run web` (HTTP) instead.\n',
      );
      process.exit(2);
    }

    const agent = getAgent();
    const cfg = getConfig_();
    const role = cfg?.agent?.role;
    const roleDef = role ? cfg?.roles?.[role] : undefined;
    const modelLabel = roleDef
      ? `${roleDef.provider} / ${roleDef.model}`
      : undefined;

    // Discover skills for the slash-command picker. Best-effort:
    // missing store → only built-in commands shown.
    let skills: Array<{ name: string; description?: string }> = [];
    try {
      const { getSkillStore } = await import('../domain/skills/store');
      const list = getSkillStore().list();
      skills = list.map((s: { name: string; description?: string }) => ({
        name: s.name,
        description: s.description,
      }));
    } catch (e) {
      logger.debug('[CLI] skill discovery failed (non-fatal)', e);
    }

    // /model and /sessions hint suppliers — fresh on each call.
    const getInfo = () => {
      let sessionsLine = '(unknown)';
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { listSessions } = require('../domain/session');
        sessionsLine = `${listSessions().length} sessions`;
      } catch { /* ignore */ }
      return {
        modelLine: modelLabel ? `model: ${modelLabel}` : '(no model configured)',
        sessionsLine,
      };
    };

    // Footer's right-hand stat — pulls from the in-memory token
    // tracker. Polled by App at turn boundaries.
    const getTotalTokens = (): number => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getTokenUsageTracker } = require('../infra/observability/token-usage');
        return getTokenUsageTracker().snapshot().totalTokens;
      } catch {
        return 0;
      }
    };

    await runTui({
      agent,
      modelLabel,
      skills,
      getInfo,
      getTotalTokens,
      onExit: async () => {
        await adapterRegistry.stopAll();
      },
    });
    // runTui returns when Ink's render loop ends (user /exit).
    process.exit(0);
  } catch (error) {
    logger.error('❌ Failed to start Beeclaw CLI:', error);
    process.exit(1);
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error('cli main crashed:', err);
  process.exit(1);
});
