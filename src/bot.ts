#!/usr/bin/env bun
/**
 * Beeclaw Bot - Feishu Bot Entry Point
 *
 * Usage:
 *   bun run src/bot.ts          # Start Feishu bot
 *   bun run src/bot.ts --help   # Show help
 *   bun run src/bot.ts --daemon # Start with daemon (proactive scheduling)
 */

import { join } from 'path';
import { initApp, getAgent, getProvider, getModel, getTokenStatsConfig } from './app';
import { initFeishuWSIntegration } from './routes/proactive';
import { loadAllSessions } from './session';
import { getDaemon, getScheduler, registerFeishuHandler } from './proactive';
import { getFeishuWSClient } from './feishu';
import { initSelfEvolution } from './evolution/self-evolution';
import { fetchHolidayInfo } from './utils/holiday';
import { fetchWeatherInfo } from './utils/weather';

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

  // Initialize app (unified initialization)
  const { config, provider, model } = await initApp();

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

  // Start daemon for proactive scheduling if enabled
  if (enableDaemon) {
    console.log('\n⏰ Starting proactive daemon...');

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
              if (job.params.chatId && job.params.message) {
                const client = getFeishuWSClient();
                if (client) {
                  await client.sendTextMessage(job.params.chatId as string, 'chat_id', job.params.message as string);
                }
              }
              break;

            case 'check_goal_progress':
              console.log('[Daemon] Checking goal progress...');
              break;

            case 'memory_compress':
              console.log('[Daemon] Running memory compression...');
              try {
                const { getCompressionEngine } = require('./memory/compression');
                const { getMemoryStore } = require('./memory');
                const store = getMemoryStore();
                const engine = getCompressionEngine(store.getBasePath());
                const result = await engine.compress();
                console.log(`[Daemon] Compression complete: processed=${result.processed}, summarized=${result.summarized}, archived=${result.archived}`);
              } catch (error) {
                console.error('[Daemon] Memory compression failed:', error);
              }
              break;

            case 'custom':
              console.log('[Daemon] Running custom task...');
              console.log('[Daemon] Use beeclaw-self-evolution skill to review lessons.md and update SOUL.md');
              break;

            case 'llm_proactive_chat': {
              console.log('[Daemon] LLM proactive chat triggered...');
              try {
                const { sendProactiveMessage } = await import('./session');
                const { getMemoryStore } = await import('./memory');

                // 获取用户上下文
                let context = '';
                try {
                  const memoryStore = getMemoryStore();
                  const coreContext = memoryStore.getCoreContext();
                  if (coreContext.user) {
                    context += `用户信息: ${coreContext.user}\n`;
                  }
                  if (coreContext.facts) {
                    context += `用户事实: ${coreContext.facts}\n`;
                  }
                } catch {
                  // Memory store not initialized
                }

                // 构建提示
                const prompt = job.params?.prompt as string ||
                  '现在是定时主动沟通时间。根据用户上下文，发起一个简短、有意义的问候或提醒。保持友好和个性化。';

                const fullPrompt = context
                  ? `${context}\n\n${prompt}`
                  : prompt;

                const chatId = job.params?.chatId as string;
                const userId = job.params?.userId as string || 'feishu-user';

                const result = await sendProactiveMessage({
                  message: fullPrompt,
                  userId,
                  channel: 'feishu',
                  sessionId: chatId ? `feishu-${chatId}-${userId}` : undefined,
                });

                if (result.success && result.response) {
                  console.log(`[Daemon] LLM generated: ${result.response.substring(0, 100)}...`);

                  // 推送到飞书
                  if (chatId) {
                    const client = getFeishuWSClient();
                    if (client) {
                      await client.sendTextMessage(chatId, 'chat_id', result.response);
                      console.log(`[Daemon] Message pushed to Feishu chat: ${chatId}`);
                    }
                  }
                } else {
                  console.error('[Daemon] LLM proactive chat failed:', result.error);
                }
              } catch (error) {
                console.error('[Daemon] LLM proactive chat error:', error);
              }
              break;
            }

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
  }

  console.log('\n✅ Bot is running!');
  console.log('   Send a message to your Feishu bot to start chatting.');
  if (enableDaemon) {
    console.log('   Daemon mode enabled - proactive scheduling active.');
  }
  console.log('   Press Ctrl+C to stop.\n');

  // Keep the process alive
  process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down...');
    process.exit(0);
  });

  process.stdin.resume();
}

main().catch((error) => {
  console.error('Failed to start Beeclaw Bot:', error);
  process.exit(1);
});
