#!/usr/bin/env bun
/**
 * Beeclaw Bot - Feishu Bot Entry Point
 *
 * Usage:
 *   bun run src/bot.ts          # Start Feishu bot
 *   bun run src/bot.ts --help   # Show help
 *   bun run src/bot.ts --daemon # Start with daemon (proactive scheduling)
 *
 * Note: Bun automatically loads .env file
 */

import { join } from 'path';
import { initApp, getAgent, getProvider, getModel, getTokenStatsConfig } from './app';
import { initFeishuWSIntegration } from './app/routes/proactive';
import { loadAllSessions, saveAllSessions } from './domain/session';
import { getDaemon, getScheduler, registerFeishuHandler, pushPendingNotifications, setCliDeliveryHandler } from './domain/proactive';
import { getFeishuWSClient } from './adapter/feishu';
import { initSelfEvolution } from './domain/agent/evolution/self-evolution';
import { fetchHolidayInfo } from './domain/tools/holiday';
import { fetchWeatherInfo } from './domain/tools/weather';
import { initTaskManager } from './infra/queue';
import { initWorkers } from './app/queue-handlers/workers';
import { GracefulShutdown } from './infra/utils/graceful-shutdown';
import {
  handleRunSkillJob,
  handleLlmProactiveChatJob,
  handleSelfEvolutionJob,
  handleMemoryCompressJob,
  handleGoalProgressCheckJob,
  handleCustomJob,
  handleSendReminderJob,
} from './domain/proactive/job-handlers';

function showHelp(): void {
  console.log(`
🐝 Beeclaw Bot - Feishu Bot Mode

Usage:
  bun run bot           # Start Feishu bot
  bun run bot --daemon  # Start with proactive scheduling
  bun run bot --help    # Show help

Environment Variables:
  LARK_BEECLAW_APPID   Feishu App ID (required)
  LARK_BEECLAW_AS      Feishu App Secret (required)

Features:
  1. Connect to Feishu via WebSocket
  2. Load memory from data/memory/
  3. Respond to messages with AI
  4. --daemon: Enable proactive scheduling (timed tasks, reminders)
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  console.log('🐝 Beeclaw Bot - Feishu Integration');
  console.log('='.repeat(50));

  // BUG #5 FIX: Initialize graceful shutdown FIRST
  const shutdownManager = GracefulShutdown.getInstance({
    gracePeriodMs: 30_000,         // 30 seconds total grace period
    installSignalHandlers: true,   // Handle SIGINT + SIGTERM
  });

  // Initialize app (unified initialization)
  const { config, provider, model } = await initApp({
    daemon: args.includes('--daemon'),
    enableRecovery: true,
  });

  // Pre-load dynamic context (holiday and weather info)
  console.log('\n📅 Loading dynamic context...');
  try {
    // Fetch holiday info for today
    await fetchHolidayInfo();
    console.log('   ✓ Holiday information loaded');
  } catch (error) {
    console.log('   ⚠ Holiday information unavailable (will use fallback)');
  }

  try {
    // Fetch weather info
    await fetchWeatherInfo();
    console.log('   ✓ Weather information loaded');
  } catch (error) {
    console.log('   ⚠ Weather information unavailable (QWEATHER_TOKEN may not be configured)');
  }

  // Load previous sessions (already loaded in initApp, but show count here)
  const sessionsLoaded = loadAllSessions();
  if (sessionsLoaded > 0) {
    console.log(`📂 Loaded ${sessionsLoaded} previous sessions`);
  }

  // Check Feishu configuration
  if (!config.feishu?.appId || !config.feishu?.appSecret) {
    console.error('❌ Feishu credentials not configured.');
    console.error('   Set LARK_BEECLAW_APPID and LARK_BEECLAW_AS environment variables');
    process.exit(1);
  }

  console.log(`   App ID: ${config.feishu.appId.substring(0, 10)}...`);

  const enableDaemon = args.includes('--daemon');

  // Initialize Feishu WebSocket
  console.log('\n📡 Connecting to Feishu...');
  try {
    await initFeishuWSIntegration(config.feishu);
  } catch (error) {
    console.error('❌ Failed to initialize Feishu:', error);
    process.exit(1);
  }

  // BUG #5 FIX: Register cleanup — Save all sessions on shutdown
  shutdownManager.register({
    name: 'Save all sessions',
    priority: 10,  // High priority — run first
    fn: () => {
      saveAllSessions();
      console.log('[Shutdown] Sessions saved.');
    },
  });

  // BUG #5 FIX: Register cleanup — Disconnect WebSocket
  shutdownManager.register({
    name: 'Disconnect Feishu WebSocket',
    priority: 50,  // After sessions are saved
    fn: () => {
      const client = getFeishuWSClient();
      if (client) {
        client.stop();
        console.log('[Shutdown] Feishu WebSocket disconnected.');
      }
    },
  });

  // BUG #5 FIX: Register cleanup — Save all sessions on shutdown
  shutdownManager.register({
    name: 'Save all sessions',
    priority: 10,  // High priority — run first
    fn: () => {
      saveAllSessions();
      console.log('[Shutdown] Sessions saved.');
    },
  });

  // BUG #5 FIX: Register cleanup — Disconnect WebSocket
  shutdownManager.register({
    name: 'Disconnect Feishu WebSocket',
    priority: 50,  // After sessions are saved
    fn: () => {
      const client = getFeishuWSClient();
      if (client) {
        client.stop();
        console.log('[Shutdown] Feishu WebSocket disconnected.');
      }
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

  // Register CLI handler as fallback (for notifications without specific channel)
  setCliDeliveryHandler((message: string, priority: string) => {
    const emoji = { low: '⚪', normal: '🟢', high: '🟠', urgent: '🔴' }[priority] || '🟢';
    console.log(`\n${emoji} ${message}\n`);
  });

  // Start daemon for proactive scheduling if enabled
  if (enableDaemon) {
    console.log('\n⏰ Starting proactive daemon...');

    // Initialize queue system first
    console.log('   Initializing task queue...');
    await initTaskManager({
      enabled: true,
      mode: 'embedded',
      storage: { path: join(config.memory.path, 'queue', 'beeclaw.db') },
    });

    // Initialize workers to process queue jobs
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
        description: 'Compress old memories daily at 3 AM',
        cron: '0 3 * * *',
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

    // BUG #5 FIX: Register daemon cleanup
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
  console.log('   Press Ctrl+C to stop.\n');

  // BUG #5 FIX: Removed old SIGINT handler
  // GracefulShutdown now handles SIGINT and SIGTERM with:
  //   1. Drain in-flight message queues
  //   2. Save all sessions
  //   3. Stop daemon (if enabled)
  //   4. Disconnect WebSocket
  //   5. Exit cleanly

  // Keep the process alive
  process.stdin.resume();
}

main().catch((error) => {
  console.error('Failed to start Beeclaw Bot:', error);
  process.exit(1);
});
