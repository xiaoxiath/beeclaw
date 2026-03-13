#!/usr/bin/env bun
/**
 * Beeclaw Web - Web UI Entry Point
 *
 * Usage:
 *   bun run src/entries/web.ts          # Start web server
 *   bun run src/entries/web.ts --help   # Show help
 *
 * Note: Bun automatically loads .env file
 */

import { initApp } from '../app';
import { WebAdapter } from '../adapter/web/adapter';
import { adapterRegistry } from '../infra/entry';
import { GracefulShutdown } from '../infra/utils/graceful-shutdown';

function showHelp(): void {
  console.log(`
🐝 Beeclaw Web - Web UI Mode

Usage:
  bun run web           # Start web server
  bun run web --help    # Show help

Environment Variables:
  WEB_AUTH_TOKEN      Web UI authentication token (optional)
  WEB_ADMIN_PASSWORD  Admin password for basic auth (optional)

Features:
  1. Start HTTP server with Web UI
  2. Provide RESTful API for chat, memory, skills
  3. Support authentication (token/basic/none)
  4. Real-time chat with streaming support
`);
  process.exit(0);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
  }

  console.log('🐝 Starting Beeclaw Web...\n');

  try {
    // 初始化应用
    const context = await initApp({
      enableRecovery: false, // Web 模式不需要 session recovery
    });

    // 注册 Web adapter
    const webAdapter = new WebAdapter();
    adapterRegistry.register(webAdapter);

    await webAdapter.initialize(context);
    await webAdapter.start();

    console.log('\n✅ Beeclaw Web started');

    // 设置优雅关闭
    const shutdown = new GracefulShutdown();

    shutdown.on('shutdown', async () => {
      console.log('\n\n🛑 Shutting down Web server...');
      await adapterRegistry.stopAll();
    });

    shutdown.setupSignalHandlers();

    // Keep process alive
    await new Promise(() => {}); // Never resolve
  } catch (error) {
    console.error('❌ Failed to start Beeclaw Web:', error);
    process.exit(1);
  }
}

main().catch(console.error);
