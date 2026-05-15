#!/usr/bin/env bun
/**
 * Beeclaw CLI - Interactive AI Assistant with Function Calling
 *
 * Usage:
 *   bun run src/entries/cli.ts          # Start interactive chat
 *   bun run src/entries/cli.ts --help   # Show help
 *
 * Note: Bun automatically loads .env file
 */

import { logger } from '../infra/observability/logger';
import { CLIAdapter } from '../adapter/cli/adapter';
import { adapterRegistry } from '../infra/entry';
import { initApp, getAgent, getConfig_ } from '../app';
import { GracefulShutdown } from '../infra/utils/graceful-shutdown';
import { InputHandler } from '../adapter/cli/input';
import { runRepl } from '../adapter/cli/repl';
import { runTui, canRunTui } from '../adapter/cli/tui';

function showHelp(): void {
  logger.debug(`
🐝 Beeclaw CLI - Interactive AI Assistant

Usage:
  bun run cli           # Start interactive chat
  bun run cli --help    # Show help

Features:
  1. Interactive chat with AI
  2. Function calling and tool use
  3. Memory persistence
  4. Skill management
  5. Session management
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
    // 初始化应用
    const context = await initApp({
      enableRecovery: false, // CLI 模式不需要 session recovery
    });

    // 注册 CLI adapter
    const cliAdapter = new CLIAdapter();
    adapterRegistry.register(cliAdapter);

    await cliAdapter.initialize(context);
    await cliAdapter.start();

    logger.info('\n✅ Beeclaw CLI started\n');

    // 设置优雅关闭
    // FIX (P0): Use GracefulShutdown's actual API — register() + installSignalHandlers().
    // The previous code called .on() and .setupSignalHandlers() which do not exist
    // on the GracefulShutdown class (it is not an EventEmitter).
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

    const agent = getAgent();
    // Default to TUI; fall back to legacy when explicitly opted out OR
    // when stdin is not a TTY (CI, pipe, docker without -it). Ink's raw
    // mode requires a real TTY and will throw otherwise.
    const useLegacy = process.env.BEECLAW_LEGACY_CLI === '1' || !canRunTui();

    if (useLegacy) {
      // Legacy readline REPL — kept as a fallback while the TUI lands
      // (PRs 1-7). PR8 will delete this branch.
      const inputHandler = new InputHandler();
      await runRepl({
        agent,
        input: inputHandler,
        onExit: async () => {
          await adapterRegistry.stopAll();
          process.exit(0);
        },
      });
    } else {
      // Default: Ink-based TUI. The runTui call activates a logger
      // redirect to logs/cli-debug.log so chat output owns stdout.
      const cfg = getConfig_();
      const role = cfg?.agent?.role;
      const roleDef = role ? cfg?.roles?.[role] : undefined;
      const modelLabel = roleDef
        ? `${roleDef.provider} / ${roleDef.model}`
        : undefined;

      await runTui({
        agent,
        modelLabel,
        onExit: async () => {
          await adapterRegistry.stopAll();
        },
      });
      // runTui returns when Ink's render loop ends (user /exit).
      process.exit(0);
    }
  } catch (error) {
    logger.error('❌ Failed to start Beeclaw CLI:', error);
    process.exit(1);
  }
}

main().catch(console.error);
