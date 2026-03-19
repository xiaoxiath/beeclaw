#!/usr/bin/env bun
/**
 * Beeclaw Bot - Feishu Bot Entry Point
 *
 * Usage:
 *   bun run src/entries/bot.ts          # Start Feishu bot
 *   bun run src/entries/bot.ts --help   # Show help
 *   bun run src/entries/bot.ts --daemon # Start with daemon (proactive scheduling)
 *   bun run src/entries/bot.ts --web    # Also start web UI
 *
 * Note: Bun automatically loads .env file
 */

import { join } from 'path';
import { initApp, getAgent } from '../app';
import { getMessageGateway } from '../app/gateway-channel';
import { getTaskDispatcher } from '../app/dispatcher';
import { FeishuAdapter } from '../adapter/feishu/adapter';
import { WebAdapter } from '../adapter/web/adapter';
import { adapterRegistry } from '../infra/entry';
import { loadAllSessions, saveAllSessions } from '../domain/session';
import { getDaemon, getScheduler, registerFeishuHandler, setCliDeliveryHandler } from '../domain/proactive';
import { getFeishuWSClient } from '../adapter/feishu';
import { initSelfEvolution } from '../domain/agent/evolution/self-evolution';
import { fetchHolidayInfo } from '../domain/tools/holiday';
import { fetchWeatherInfo } from '../domain/tools/weather';
import { initTaskManager } from '../infra/queue';
import { initWorkers } from '../app/queue-handlers/workers';
import { GracefulShutdown } from '../infra/utils/graceful-shutdown';
import {
  handleRunSkillJob,
  handleLlmProactiveChatJob,
  handleSelfEvolutionJob,
  handleMemoryCompressJob,
  handleGoalProgressCheckJob,
  handleCustomJob,
  handleSendReminderJob,
} from '../domain/proactive/job-handlers';

function showHelp(): void {
  console.log(`
🐝 Beeclaw Bot - Feishu Bot Mode

Usage:
  bun run bot           # Start Feishu bot
  bun run bot --daemon  # Start with proactive scheduling
  bun run bot --web     # Also start web UI
  bun run bot --help    # Show help

Environment Variables:
  LARK_BEECLAW_APPID   Feishu App ID (required)
  LARK_BEECLAW_AS      Feishu App Secret (required)

Features:
  1. Connect to Feishu via WebSocket
  2. Load memory from data/memory/
  3. Respond to messages with AI
  4. --daemon: Enable proactive scheduling (timed tasks, reminders)
  5. --web: Also start web UI server
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  const enableDaemon = args.includes('--daemon');
  const enableWeb = args.includes('--web');

  console.log('🐝 Beeclaw Bot - Feishu Integration');
  console.log('='.repeat(50));

  // Initialize graceful shutdown FIRST
  const shutdownManager = GracefulShutdown.getInstance({
    gracePeriodMs: 30_000,
    installSignalHandlers: true,
  });

  // Initialize app (unified initialization)
  const { config, provider, model } = await initApp({
    daemon: enableDaemon,
    enableRecovery: true,
  });

  // Pre-load dynamic context (holiday and weather info)
  console.log('\n📅 Loading dynamic context...');
  try {
    await fetchHolidayInfo();
    console.log('   ✓ Holiday information loaded');
  } catch (_error) {
    console.log('   ⚠ Holiday information unavailable (will use fallback)');
  }

  try {
    await fetchWeatherInfo();
    console.log('   ✓ Weather information loaded');
  } catch (_error) {
    console.log('   ⚠ Weather information unavailable (QWEATHER_TOKEN may not be configured)');
  }

  // Check Feishu configuration
  if (!config.feishu?.appId || !config.feishu?.appSecret) {
    console.error('❌ Feishu credentials not configured.');
    console.error('   Set LARK_BEECLAW_APPID and LARK_BEECLAW_AS environment variables');
    process.exit(1);
  }

  console.log(`   App ID: ${config.feishu.appId.substring(0, 10)}...`);

  // Register and start Feishu adapter
  console.log('\n📡 Connecting to Feishu...');
  try {
    const feishuAdapter = new FeishuAdapter();
    adapterRegistry.register(feishuAdapter);
    await feishuAdapter.initialize({
      config,
      agent: getAgent(),
      provider,
      model,
      gateway: getMessageGateway(),
      dispatcher: getTaskDispatcher(),
    });
    await feishuAdapter.start();
  } catch (error) {
    console.error('❌ Failed to initialize Feishu:', error);
    process.exit(1);
  }

  // Optionally start Web adapter
  if (enableWeb && config.web?.enabled) {
    console.log('\n🌐 Starting Web UI...');
    try {
      const webAdapter = new WebAdapter();
      adapterRegistry.register(webAdapter);
      await webAdapter.initialize({
        config,
        agent: getAgent(),
        provider,
        model,
        gateway: getMessageGateway(),
        dispatcher: getTaskDispatcher(),
      });
      await webAdapter.start();
    } catch (error) {
      console.error('⚠️ Failed to start Web UI:', error);
    }
  }

  // Register cleanup handlers
  shutdownManager.register({
    name: 'Stop all adapters',
    priority: 20,
    fn: async () => {
      await adapterRegistry.stopAll();
    },
  });

  shutdownManager.register({
    name: 'Save all sessions',
    priority: 10,
    fn: () => {
      saveAllSessions();
      console.log('[Shutdown] Sessions saved.');
    },
  });

  // Register Feishu push handler for proactive messaging
  registerFeishuHandler(async (chatId: string, message: string) => {
    const client = getFeishuWSClient();
    if (!client) return false;

    try {
      await client.sendTextMessage(chatId, 'chat_id', message);
      return true;
    } catch (error) {
      console.error('[Bot] Feishu push failed:', error);
      return false;
    }
  });

  // Register CLI handler as fallback
  setCliDeliveryHandler((message: string, priority: string) => {
    const emoji = { low: '⚪', normal: '🟢', high: '🟠', urgent: '🔴' }[priority] || '🟢';
    console.log(`\n${emoji} ${message}\n`);
  });

  // Start daemon for proactive scheduling if enabled
  if (enableDaemon) {
    console.log('\n⏰ Starting proactive daemon...');

    // Initialize queue system
    console.log('   Initializing task queue...');
    await initTaskManager({
      enabled: true,
      mode: 'embedded',
      storage: { path: join(config.memory.path, 'queue', 'beeclaw.db') },
    });

    // Initialize workers
    await initWorkers({
      enabled: true,
      mode: 'embedded',
      storage: { path: join(config.memory.path, 'queue', 'beeclaw.db') },
    });
    console.log('   ✓ Task queue and workers initialized');

    const daemonPath = join(config.memory.path, 'daemon');
    const daemon = getDaemon(daemonPath);
    const scheduler = getScheduler(join(config.memory.path, 'proactive'));

    // Initialize scheduler
    scheduler.init();

    // Ensure memory compression schedule exists
    const existingSchedules = scheduler.listSchedules({ enabled: true });
    const hasCompressionSchedule = existingSchedules.some(s => s.task?.type === 'memory_compress');

    if (!hasCompressionSchedule) {
      console.log('   Creating daily memory compression schedule...');
      scheduler.createSchedule({
        name: 'Daily Memory Compression',
        description: 'Compress old memories daily at 3:30 AM (30min after Daily Reflection)',
        cron: '30 3 * * *',
        taskType: 'memory_compress',
        taskParams: {},
        enabled: true,
      });
    }

    // Initialize self-evolution schedule
    initSelfEvolution(config.memory.path);

    // Define job handler for scheduled tasks
    await daemon.start({
      checkIntervalMs: 60000,
      onJob: async (job) => {
        console.log(`[Daemon] Executing job: ${job.taskType}`);

        try {
          switch (job.taskType) {
            case 'send_reminder':
              await handleSendReminderJob(job, { getFeishuClient: getFeishuWSClient });
              break;

            case 'check_goal_progress':
              await handleGoalProgressCheckJob();
              break;

            case 'memory_compress':
              await handleMemoryCompressJob();
              break;

            case 'custom':
              await handleCustomJob(job);
              break;

            case 'self_evolution':
              await handleSelfEvolutionJob();
              break;

            case 'llm_proactive_chat':
              await handleLlmProactiveChatJob(job, { getFeishuClient: getFeishuWSClient });
              break;

            case 'run_skill':
              await handleRunSkillJob(job, { getFeishuClient: getFeishuWSClient });
              break;

            default:
              console.log(`[Daemon] Unknown task type: ${job.taskType}`);
          }
        } catch (error) {
          console.error(`[Daemon] Job execution failed:`, error);
        }
      },
    });

    const scheduleCount = scheduler.listSchedules({ enabled: true }).length;
    console.log(`   Loaded ${scheduleCount} active schedules`);

    shutdownManager.register({
      name: 'Stop proactive daemon',
      priority: 30,
      fn: async () => {
        try {
          await daemon.stop();
          console.log('[Shutdown] Proactive daemon stopped.');
        } catch (error) {
          console.warn('[Shutdown] Daemon stop error:', error);
        }
      },
    });
  }

  console.log('\n✅ Bot is running!');
  console.log('   Send a message to your Feishu bot to start chatting.');
  if (enableDaemon) {
    console.log('   Daemon mode enabled - proactive scheduling active.');
  }
  if (enableWeb) {
    console.log('   Web UI enabled - access via browser.');
  }
  console.log('   Press Ctrl+C to stop.\n');

  // Keep the process alive
  process.stdin.resume();
}

main().catch((error) => {
  console.error('Failed to start Beeclaw Bot:', error);
  process.exit(1);
});
