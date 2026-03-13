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

import { CLIAdapter } from '../adapter/cli/adapter';
import { adapterRegistry } from '../infra/entry';
import { initApp } from '../app';
import { GracefulShutdown } from '../infra/utils/graceful-shutdown';

function showHelp(): void {
  console.log(`
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

  console.log('🐝 Starting Beeclaw CLI...\n');

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

    console.log('\n✅ Beeclaw CLI started\n');

    // 设置优雅关闭
    const shutdown = new GracefulShutdown();

    shutdown.on('shutdown', async () => {
      console.log('\n\n🛑 Shutting down CLI...');
      await adapterRegistry.stopAll();
    });

    shutdown.setupSignalHandlers();

    // 启动 CLI REPL 循环（导入现有的 cli 逻辑）
    // 注意：实际的 REPL 循环在 src/cli.ts 中
    await import('../cli');
  } catch (error) {
    console.error('❌ Failed to start Beeclaw CLI:', error);
    process.exit(1);
  }
}

main().catch(console.error);
