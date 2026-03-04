/**
 * Job Handlers
 *
 * Unified task execution logic for proactive jobs
 * Used by both bot.ts (Feishu mode) and daemon.ts (default handler)
 */

import type { ProactiveJobData } from './types';

/**
 * Execute a skill with parameters
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
    console.error('[Daemon] run_skill task missing skillName parameter');
    return;
  }

  console.log(`[Daemon] Executing skill: ${skillName}`);
  console.log(`[Daemon] Skill params:`, JSON.stringify(skillParams).substring(0, 100));

  try {
    const { sendProactiveMessage } = await import('../session');
    const { getSkillStore } = await import('../skills/store');

    // Get the skill content
    const skillStore = getSkillStore();
    const skill = skillStore.get(skillName);

    if (!skill) {
      console.error(`[Daemon] Skill not found: ${skillName}`);
      return;
    }

    // Build prompt to execute the skill
    const skillPrompt = `请执行技能 "${skillName}"。

技能说明：
${skill.description}

技能内容：
${skill.content || '(无详细内容)'}

参数：
${JSON.stringify(skillParams, null, 2)}

请根据技能说明和参数执行相应操作。`;

    // Get Feishu client for channel info
    const client = options?.getFeishuClient?.();
    const channel = (job.params?.channel as 'cli' | 'feishu' | 'webhook') || 'feishu';
    const chatId = (job.params?.chatId as string) || client?.lastActiveChatId;
    const userId = (job.params?.userId as string) || client?.lastActiveUserId || 'feishu-user';

    // Execute through the agent
    const result = await sendProactiveMessage({
      message: skillPrompt,
      userId,
      channel,
      sessionId: chatId ? `feishu-${chatId}-${userId}` : undefined,
    });

    if (result.success && result.response) {
      console.log(`[Daemon] ✅ Skill ${skillName} executed successfully`);
      console.log(`[Daemon] Response: ${result.response.substring(0, 200)}...`);

      // Push to Feishu if channel is feishu and we have chatId
      if (channel === 'feishu' && chatId && client) {
        // Use rich text message for better formatting
        await client.sendPostMessage(chatId, 'chat_id', result.response);
        console.log(`[Daemon] 📤 Skill result pushed to Feishu chat: ${chatId}`);
      } else if (job.params?.push !== false) {
        // Fallback: push as notification if push is not explicitly disabled
        const { pushNotification } = await import('./pusher');
        await pushNotification({
          message: result.response,
          priority: 'normal',
          category: 'skill-execution',
        });
        console.log(`[Daemon] 📤 Skill result pushed as notification`);
      }
    } else {
      console.error(`[Daemon] ❌ Skill ${skillName} execution failed:`, result.error);
    }
  } catch (error) {
    console.error('[Daemon] Failed to execute skill:', error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Handle LLM proactive chat
 */
export async function handleLlmProactiveChatJob(
  job: ProactiveJobData,
  options?: {
    getFeishuClient?: () => any;
  }
): Promise<void> {
  console.log('[Daemon] LLM proactive chat triggered...');

  try {
    const { sendProactiveMessage } = await import('../session');
    const { getMemoryStore } = await import('../memory');

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

    // 获取 chatId：优先参数，其次最近活跃的
    const client = options?.getFeishuClient?.();
    const chatId = (job.params?.chatId as string) || client?.lastActiveChatId;
    const userId = (job.params?.userId as string) || client?.lastActiveUserId || 'feishu-user';

    // 调用 LLM 生成内容（无论是否有 chatId）
    const result = await sendProactiveMessage({
      message: fullPrompt,
      userId,
      channel: 'feishu',
      sessionId: chatId ? `feishu-${chatId}-${userId}` : undefined,
    });

    if (result.success && result.response) {
      console.log(`[Daemon] LLM generated: ${result.response.substring(0, 100)}...`);

      // 推送到飞书（需要 chatId）
      if (chatId && client) {
        // Use rich text message for better formatting
        await client.sendPostMessage(chatId, 'chat_id', result.response);
        console.log(`[Daemon] Message pushed to Feishu chat: ${chatId}`);
      } else if (!chatId) {
        console.warn('[Daemon] No chatId available, message not pushed to Feishu');
      }
    } else {
      console.error('[Daemon] LLM generation failed:', result.error);
    }
  } catch (error) {
    console.error('[Daemon] LLM proactive chat error:', error);
  }
}

/**
 * Handle self-evolution task
 */
export async function handleSelfEvolutionJob(job: ProactiveJobData): Promise<void> {
  console.log('[Daemon] Self-evolution triggered...');

  try {
    const { sendProactiveMessage } = await import('../session');
    const { getMemoryStore } = await import('../memory');

    // 获取当前记忆上下文
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
    } catch {
      // Memory store not initialized
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
      console.log(`[Daemon] Self-evolution completed: ${result.response.substring(0, 200)}...`);
    } else {
      console.error('[Daemon] Self-evolution failed:', result.error);
    }
  } catch (error) {
    console.error('[Daemon] Self-evolution failed:', error);
  }
}

/**
 * Handle memory compression task
 */
export async function handleMemoryCompressJob(): Promise<void> {
  console.log('[Daemon] Running memory compression...');

  try {
    const { getCompressionEngine } = require('../memory/compression');
    const { getMemoryStore } = require('../memory');
    const store = getMemoryStore();
    const engine = getCompressionEngine(store.getBasePath());
    const result = await engine.compress();
    console.log(`[Daemon] Compression complete: processed=${result.processed}, summarized=${result.summarized}, archived=${result.archived}`);
  } catch (error) {
    console.error('[Daemon] Memory compression failed:', error);
  }
}

/**
 * Handle goal progress check
 */
export async function handleGoalProgressCheckJob(): Promise<void> {
  console.log('[Daemon] Checking goal progress...');
  // Implementation can be expanded based on needs
}

/**
 * Handle custom task
 */
export async function handleCustomJob(job: ProactiveJobData): Promise<void> {
  console.log('[Daemon] Running custom task...');
  console.log('[Daemon] Custom task params:', job.params);
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
  if (job.params?.chatId && job.params?.message) {
    const client = options?.getFeishuClient?.();
    if (client) {
      await client.sendTextMessage(job.params.chatId as string, 'chat_id', job.params.message as string);
    }
  }
}
