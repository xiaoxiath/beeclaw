/**
 * Job Handlers
 *
 * Unified task execution logic for proactive jobs
 * Used by both bot.ts (Feishu mode) and daemon.ts (default handler)
 *
 * [AUDIT FIX M-02, M-06, M-10] Major improvements:
 * - Proactive tasks now inherit user conversation context via associatedSessionId
 * - Default blockedTools prevent unsafe operations in unattended mode
 * - Task results are injected back into user sessions for bidirectional context
 */

import type { ProactiveJobData } from './types';
import { logger } from '../../infra/observability/logger';
import { getCompressionEngine } from '../memory/compression';
import { getMemoryStore } from '../memory';
import { getReflectionEngine } from '../agent/reflection-engine';
import { getConfig } from '../../infra/config';
import { sendProactiveMessage, injectProactiveResult, getRecentSessionHistory } from '../session';
import type { SessionMessage } from '../session';
import { getSkillStore } from '../skills/store';
import { pushNotification } from './pusher';
import { PROACTIVE_DEFAULT_BLOCKED_TOOLS } from '../agent/types';
import type { ContentBlock } from '../../types/content-block';

// [FIX] Lazy import to avoid circular dependency — Card V2 renderer is in adapter layer
// We use a helper that domain code can call; adapter layer provides the actual renderer.
let _renderMessageCard: ((blocks: ContentBlock[], options?: { streaming?: boolean }) => any) | null = null;

/**
 * Register Card V2 renderer from adapter layer (called during initialization).
 * This enables domain/proactive code to send Card V2 messages without
 * directly importing adapter/feishu code.
 */
export function registerCardV2Renderer(
  renderer: (blocks: ContentBlock[], options?: { streaming?: boolean }) => any
): void {
  _renderMessageCard = renderer;
}

/**
 * Send message to Feishu using Card V2 format (unified output).
 * Falls back to sendMarkdownMessage if Card V2 renderer is not registered.
 */
async function sendFeishuMessage(
  client: any,
  chatId: string,
  message: string,
  options?: { title?: string }
): Promise<void> {
  if (_renderMessageCard) {
    // [Card V2] Unified format — all Feishu messages use Card V2
    const textBlock: ContentBlock = { type: 'text', text: message };
    const card = _renderMessageCard([textBlock], { streaming: false });
    await client.sendCard(chatId, 'chat_id', card);
  } else {
    // Fallback to markdown message if Card V2 not available
    if (options) {
      await client.sendMarkdownMessage(chatId, 'chat_id', message, options);
    } else {
      await client.sendMarkdownMessage(chatId, 'chat_id', message);
    }
  }
}

/**
 * Get default push target from config
 */
function getDefaultPushTarget(): { channel: string; chatId: string; userId: string } | null {
  try {
    const config = getConfig();
    if (config?.defaultPushTarget) {
      return {
        channel: config.defaultPushTarget.channel || 'feishu',
        chatId: config.defaultPushTarget.chatId || '',
        userId: config.defaultPushTarget.userId || 'feishu-user',
      };
    }
  } catch (error) {
    logger.debug('Failed to get default push target from config:', error);
  }
  return null;
}

/**
 * Merge job params with default push target
 */
function getPushTarget(
  jobParams: Record<string, unknown> | undefined,
  client?: { lastActiveChatId?: string; lastActiveUserId?: string }
): { channel: 'cli' | 'feishu' | 'webhook' | 'api' | 'web'; chatId: string | undefined; userId: string } {
  const defaults = getDefaultPushTarget();

  const channelRaw = (jobParams?.channel as string) || defaults?.channel || 'feishu';
  const channel = channelRaw as 'cli' | 'feishu' | 'webhook' | 'api' | 'web';
  const chatId = (jobParams?.chatId as string) || client?.lastActiveChatId || defaults?.chatId;
  const userId = (jobParams?.userId as string) || client?.lastActiveUserId || defaults?.userId || 'feishu-user';

  return { channel, chatId, userId };
}

/**
 * [AUDIT FIX M-02] Build conversation history context from associated session.
 *
 * Loads recent messages from the user's active session and formats them
 * as context for the proactive task, enabling context-aware responses.
 */
function buildConversationHistoryContext(
  associatedSessionId: string | undefined,
  maxMessages: number = 10
): string {
  if (!associatedSessionId) return '';

  try {
    const history: SessionMessage[] = getRecentSessionHistory(associatedSessionId, maxMessages);
    if (history.length === 0) return '';

    const formatted = history.map(m => {
      const role = m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : '系统';
      // Truncate very long messages to avoid bloating the prompt
      const content = m.content.length > 500 ? m.content.substring(0, 500) + '...' : m.content;
      return `${role}: ${content}`;
    }).join('\n');

    return `\n\n## 用户最近对话上下文\n${formatted}\n`;
  } catch (error) {
    logger.debug('Failed to load conversation history for proactive task:', error);
    return '';
  }
}

/**
 * [AUDIT FIX M-06] Get blocked tools list for proactive tasks.
 * Merges default blocked tools with any custom ones from job params.
 */
function getProactiveBlockedTools(jobParams?: Record<string, unknown>): string[] {
  const customBlocked = (jobParams?.blockedTools as string[]) || [];
  // Merge defaults with custom, deduplicate
  return [...new Set([...PROACTIVE_DEFAULT_BLOCKED_TOOLS, ...customBlocked])];
}

/**
 * Execute a skill with parameters
 *
 * [AUDIT FIX M-10] Now loads conversation history from associatedSessionId
 * and passes blockedTools to prevent unsafe operations.
 */
export async function handleRunSkillJob(
  job: ProactiveJobData,
  options?: {
    getFeishuClient?: () => any;
  }
): Promise<void> {
  // Support both skillName (camelCase) and skill_name (snake_case) for compatibility
  const skillName = job.params?.skillName as string || job.params?.skill_name as string;
  const skillParams = job.params?.skillParams as Record<string, unknown>
                    || job.params?.params as Record<string, unknown>
                    || {};

  if (!skillName) {
    logger.error('[Daemon] run_skill task missing skillName parameter');
    return;
  }

  logger.info(`[Daemon] Executing skill: ${skillName}`);
  logger.debug(`[Daemon] Skill params:`, { params: JSON.stringify(skillParams).substring(0, 100) });

  try {
    // Get the skill content
    const skillStore = getSkillStore();
    const skill = skillStore.get(skillName);

    if (!skill) {
      logger.error(`[Daemon] Skill not found: ${skillName}`);
      return;
    }

    // [AUDIT FIX M-02] Load conversation history from associated session
    const historyContext = buildConversationHistoryContext(job.associatedSessionId);

    // Build prompt to execute the skill
    const skillPrompt = `请执行技能 "${skillName}"。

技能说明：
${skill.description}

技能内容：
${skill.content || '(无详细内容)'}

参数：
${JSON.stringify(skillParams, null, 2)}
${historyContext}
请根据技能说明和参数执行相应操作。`;

    // Get Feishu client for channel info
    const client = options?.getFeishuClient?.();
    const { channel, chatId, userId } = getPushTarget(job.params, client);

    logger.debug(`[Daemon] Push target: channel=${channel}, chatId=${chatId || '(none)'}, userId=${userId}`);

    // [AUDIT FIX M-06] Execute through the agent with blocked tools
    const result = await sendProactiveMessage({
      message: skillPrompt,
      userId,
      channel,
      sessionId: job.associatedSessionId || (chatId ? `feishu-${chatId}-${userId}` : undefined),
      context: { source: 'proactive', jobType: job.taskType },
      agentOptions: {
        blockedTools: getProactiveBlockedTools(job.params),
      },
    });

    if (result.success && result.response) {
      logger.info(`[Daemon] ✅ Skill ${skillName} executed successfully`);
      logger.debug(`[Daemon] Response: ${result.response.substring(0, 200)}...`);

      // [AUDIT FIX M-02] Inject result back into user's active session
      if (job.associatedSessionId) {
        injectProactiveResult(job.associatedSessionId, {
          source: `技能执行: ${skillName}`,
          content: result.response.substring(0, 1000),  // Limit injection size
        });
      }

      // Push to Feishu if we have chatId
      if (channel === 'feishu' && chatId && client) {
        await sendFeishuMessage(client, chatId, result.response);
        logger.info(`[Daemon] 📤 Skill result pushed to Feishu chat: ${chatId} (Card V2)`);
      } else if (!chatId) {
        // Fallback: push as notification if no chatId
        await pushNotification({
          message: result.response,
          priority: 'normal',
          category: 'skill-execution',
        });
        logger.info(`[Daemon] 📤 Skill result pushed as notification (no chatId)`);
      }
    } else {
      logger.error(`[Daemon] ❌ Skill ${skillName} execution failed:`, { error: result.error });
    }
  } catch (error) {
    logger.error('[Daemon] Failed to execute skill:', { error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

/**
 * Handle LLM proactive chat
 *
 * [AUDIT FIX M-02, M-06, M-09] Major improvements:
 * - Loads conversation history from associatedSessionId
 * - Passes blockedTools for safety
 * - Injects results back into user session
 */
export async function handleLlmProactiveChatJob(
  job: ProactiveJobData,
  options?: {
    getFeishuClient?: () => any;
  }
): Promise<void> {
  logger.info('[Daemon] LLM proactive chat triggered...');

  try {
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
    } catch (error) {
      logger.debug('Memory store not initialized:', error);
    }

    // [AUDIT FIX M-02] Load conversation history from associated session
    const historyContext = buildConversationHistoryContext(job.associatedSessionId);
    context += historyContext;

    // 构建提示
    const prompt = job.params?.prompt as string ||
      '现在是定时主动沟通时间。根据用户上下文，发起一个简短、有意义的问候或提醒。保持友好和个性化。';

    const fullPrompt = context
      ? `${context}\n\n${prompt}`
      : prompt;

    // 获取推送目标
    const client = options?.getFeishuClient?.();
    const { channel, chatId, userId } = getPushTarget(job.params, client);

    logger.debug(`[Daemon] Push target: channel=${channel}, chatId=${chatId || '(none)'}, userId=${userId}`);

    // [AUDIT FIX M-06] 调用 LLM 生成内容 with blocked tools
    const result = await sendProactiveMessage({
      message: fullPrompt,
      userId,
      channel,
      sessionId: job.associatedSessionId || (chatId ? `feishu-${chatId}-${userId}` : undefined),
      context: { source: 'proactive', jobType: job.taskType },
      agentOptions: {
        blockedTools: getProactiveBlockedTools(job.params),
      },
    });

    if (result.success && result.response) {
      logger.debug(`[Daemon] LLM generated: ${result.response.substring(0, 100)}...`);

      // [AUDIT FIX M-02] Inject result back into user's active session
      if (job.associatedSessionId) {
        injectProactiveResult(job.associatedSessionId, {
          source: '定时主动沟通',
          content: result.response.substring(0, 1000),
        });
      }

      // 推送到飞书（需要 chatId)
      if (chatId && client) {
        await sendFeishuMessage(client, chatId, result.response);
        logger.info(`[Daemon] 📤 Message pushed to Feishu chat: ${chatId} (Card V2)`);
      } else if (!chatId) {
        logger.warn('[Daemon] No chatId available, message not pushed to Feishu');
        // Fallback to notification
        await pushNotification({
          message: result.response,
          priority: 'normal',
          category: 'llm-proactive',
        });
        logger.info(`[Daemon] 📤 Message pushed as notification (no chatId)`);
      }
    } else {
      logger.error('[Daemon] LLM generation failed:', { error: result.error });
    }
  } catch (error) {
    logger.error('[Daemon] LLM proactive chat error:', { error });
  }
}

/**
 * Handle self-evolution task
 */
export async function handleSelfEvolutionJob(_job: ProactiveJobData): Promise<void> {
  logger.info('[Daemon] Self-evolution triggered...');

  try {
    // Get current memory context
    let context = '';
    try {
      const memoryStore = getMemoryStore();
      const coreContext = memoryStore.getCoreContext();
      if (coreContext.facts) {
        context += `## 用户事实和经验教训\n${coreContext.facts}\n`;
      }
      if (coreContext.soul) {
        context += `## 当前 SOUL.md\n${coreContext.soul}\n`;
      }
    } catch (error) {
      logger.debug('Memory store not initialized:', error);
    }

    // 构建自我进化提示
    const evolutionPrompt = `你是一个自我进化系统。请执行以下任务：

${context}

## 任务
1. 分析 facts/lessons.md 中的经验教训
2. 检查是否有新的原则或模式值得加入 SOUL.md
3. 如果有，更新 SOUL.md；如果没有，说明原因

请使用 memory_read 读取 facts/lessons.md 和 SOUL.md，分析后使用 memory_write 更新 SOUL.md（如果需要）。`;

    // 调用 LLM 执行自我进化
    const result = await sendProactiveMessage({
      message: evolutionPrompt,
      userId: 'self-evolution',
      channel: 'cli',
      sessionId: 'self-evolution-session',
    });

    if (result.success && result.response) {
      logger.info(`[Daemon] Self-evolution completed: ${result.response.substring(0, 200)}...`);
    } else {
      logger.error('[Daemon] Self-evolution failed:', { error: result.error });
    }
  } catch (error) {
    logger.error('[Daemon] Self-evolution failed:', { error });
  }
}

/**
 * Handle memory compression task
 */
export async function handleMemoryCompressJob(): Promise<void> {
  logger.debug('[Daemon] Running memory compression...');

  try {
    const store = getMemoryStore();
    const engine = getCompressionEngine(store.getBasePath());
    const result = await engine.compress();
    logger.info(`[Daemon] Compression complete: processed=${result.processed}, summarized=${result.summarized}, archived=${result.archived}`);
  } catch (error) {
    logger.error('[Daemon] Memory compression failed:', error);
  }
}

/**
 * Handle goal progress check
 */
export async function handleGoalProgressCheckJob(): Promise<void> {
  logger.debug('[Daemon] Checking goal progress...');
  // Implementation can be expanded based on needs
}

/**
 * Handle custom task
 */
export async function handleCustomJob(job: ProactiveJobData): Promise<void> {
  logger.debug('[Daemon] Running custom task...');
  logger.debug('[Daemon] Custom task params:', job.params);

  const action = job.params?.action as string;

  // Handle daily reflection task
  if (action === 'daily-reflection') {
    try {
      const engine = getReflectionEngine();

      logger.debug('[Daemon] Running daily reflection...');

      // Get recent conversations from memory store
      const store = getMemoryStore();
      const conversationEntries = await store.getRecentConversations('default', 50);

      if (conversationEntries.length === 0) {
        logger.debug('[Daemon] No conversations to reflect on');
        return;
      }

      // Convert ConversationEntry[] to ConversationRecord[] format
      const conversations = conversationEntries.map(entry => ({
        timestamp: entry.timestamp,
        userMessage: entry.user,
        assistantMessage: entry.assistant,
        skillTriggered: entry.metadata?.skillTriggered,
      }));

      // Run reflection
      const result = await engine.reflect(conversations);

      if (result && (result.patterns || result.strategyUpdates)) {
        logger.info('[Daemon] Reflection complete:');
        logger.debug(`  - Patterns found: ${result.patterns?.length || 0}`);
        logger.debug(`  - Strategy updates: ${result.strategyUpdates?.length || 0}`);

        // Store patterns as facts in memory
        if (result.patterns && result.patterns.length > 0) {
          for (const pattern of result.patterns) {
            const patternText = `${pattern.description}${pattern.suggestion ? ` Suggestion: ${pattern.suggestion}` : ''}`;
            await store.record('lessons', patternText);
          }
          logger.debug(`[Daemon] Stored ${result.patterns.length} patterns as lessons`);
        }
      }
    } catch (error) {
      logger.error('[Daemon] Daily reflection failed:', error);
    }
    return;
  }

  logger.warn('[Daemon] Unknown custom action:', action);
}

/**
 * Handle send reminder task
 */
export async function handleSendReminderJob(
  job: ProactiveJobData,
  options?: {
    getFeishuClient?: () => any;
  }
): Promise<void> {
  const client = options?.getFeishuClient?.();
  const { channel: _channel, chatId, userId: _userId } = getPushTarget(job.params, client);
  
  if (chatId && job.params?.message) {
    if (client) {
      await sendFeishuMessage(client, chatId, job.params.message as string, { title: '⏰ 提醒' });
      logger.debug(`[Daemon] 📤 Reminder sent to chat: ${chatId} (Card V2)`);

      // [AUDIT FIX M-02] Inject reminder into user's session if associated
      if (job.associatedSessionId) {
        injectProactiveResult(job.associatedSessionId, {
          source: '定时提醒',
          content: job.params.message as string,
        });
      }
    }
  } else {
    // Fallback to notification
    await pushNotification({
      message: job.params?.message as string,
      priority: (job.params?.priority as 'low' | 'normal' | 'high' | 'urgent') || 'normal',
      category: 'reminder',
    });
    logger.debug(`[Daemon] 📤 Reminder pushed as notification`);
  }
}
