/**
 * Proactive Worker Handler
 *
 * Handles proactive scheduled jobs
 */

import type { Job } from 'bunqueue/client';
import type { ProactiveJobData } from '../../../infra/queue/types';
import { getGoalStore } from '../../../domain/agent/goal/store';
import { getNotificationManager } from '../../../domain/proactive/notifications';
import { pushNotification } from '../../../domain/proactive/pusher';
import { getFeishuWSClient } from '../../../adapter/feishu';
import { sendProactiveMessage } from '../../../domain/session';
import { getMemoryStore } from '../../../domain/memory';
import { getSessionSummary } from '../../../domain/session';

export async function handleProactiveJob(job: Job<ProactiveJobData>): Promise<unknown> {
  const { scheduleId, taskType, params, triggeredAt, triggeredBy } = job.data;

  console.log(`[Worker:proactive] Processing job for schedule ${scheduleId}`);
  console.log(`  Task: ${taskType}, Triggered: ${triggeredBy} at ${triggeredAt}`);

  await job.updateProgress(25);

  try {
    let result: unknown;

    switch (taskType) {
      case 'check_goal_progress': {
        result = await handleGoalProgressCheck(params);
        break;
      }

      case 'run_skill': {
        result = await handleRunSkill(params);
        break;
      }

      case 'send_reminder': {
        result = await handleSendReminder(params);
        break;
      }

      case 'memory_compress': {
        result = await handleMemoryCompress(params);
        break;
      }

      case 'llm_proactive_chat': {
        result = await handleLlmProactiveChat(params);
        break;
      }

      case 'custom': {
        result = await handleCustomTask(params);
        break;
      }

      default:
        throw new Error(`Unknown task type: ${taskType}`);
    }

    await job.updateProgress(100);

    console.log(`[Worker:proactive] Job completed for schedule ${scheduleId}`);

    return {
      success: true,
      scheduleId,
      taskType,
      result,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`[Worker:proactive] Job failed for schedule ${scheduleId}:`, error);

    return {
      success: false,
      scheduleId,
      taskType,
      error: error instanceof Error ? error.message : 'Unknown error',
      failedAt: new Date().toISOString(),
    };
  }
}

// Task handlers

async function handleGoalProgressCheck(_params?: Record<string, unknown>): Promise<unknown> {
  try {
    const goalStore = getGoalStore();
    const goals = goalStore.list({ state: 'active' });

    const notifications: string[] = [];

    for (const goal of goals) {
      // Check for goals with low progress that haven't been updated recently
      const daysSinceUpdate = (Date.now() - new Date(goal.updatedAt).getTime()) / (1000 * 60 * 60 * 24);

      if (goal.progress < 50 && daysSinceUpdate > 3) {
        const notificationManager = getNotificationManager();
        notificationManager.create({
          userId: 'cli-user',
          message: `Goal "${goal.title}" is at ${goal.progress}% progress. Consider updating it.`,
          priority: 'normal',
          category: 'goal-progress',
        });
        notifications.push(goal.id);
      }
    }

    return {
      checkedGoals: goals.length,
      notificationsCreated: notifications.length,
      goalIds: notifications,
    };
  } catch (_error) {
    return { error: 'Goal store not initialized' };
  }
}

async function handleRunSkill(params?: Record<string, unknown>): Promise<unknown> {
  const skillName = params?.skillName as string;
  const skillParams = params?.skillParams as Record<string, unknown> | undefined;

  if (!skillName) {
    throw new Error('skillName parameter required for run_skill task');
  }

  // This would integrate with the skill execution system
  // For now, just log the intent
  console.log(`[Worker:proactive] Would run skill: ${skillName}`, skillParams);

  return {
    skillName,
    executed: false,
    note: 'Skill execution not implemented in proactive handler',
  };
}

async function handleSendReminder(params?: Record<string, unknown>): Promise<unknown> {
  const message = params?.message as string;
  const userId = (params?.userId as string) || 'cli-user';
  const priority = (params?.priority as 'low' | 'normal' | 'high' | 'urgent') || 'normal';

  if (!message) {
    throw new Error('message parameter required for send_reminder task');
  }

  try {
    // Determine channels and metadata: use Feishu if available, otherwise CLI
    let channels: ('cli' | 'feishu')[] = ['cli'];
    const metadata: Record<string, unknown> = {};

    try {
      const client = getFeishuWSClient();
      if (client?.lastActiveChatId) {
        channels = ['feishu'];
        metadata.feishuChatId = client.lastActiveChatId;
        console.log(`[Worker:proactive] Using Feishu channel, chatId: ${client.lastActiveChatId}`);
      }
    } catch {
      // Feishu not available
    }

    // Create and push notification immediately
    const result = await pushNotification({
      message,
      priority,
      category: 'reminder',
      channels,
      metadata,
    });

    if (result.success) {
      return {
        notificationId: result.notificationId,
        delivered: result.delivered,
        message,
        userId,
        channels,
        chatId: metadata.feishuChatId,
      };
    } else {
      throw new Error(result.error || 'Failed to push notification');
    }
  } catch (error) {
    console.error('[Worker:proactive] send_reminder failed:', error);
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function handleMemoryCompress(_params?: Record<string, unknown>): Promise<unknown> {
  // This will be implemented in Phase 3
  console.log('[Worker:proactive] Memory compression not yet implemented');

  return {
    executed: false,
    note: 'Memory compression not implemented yet (Phase 3)',
  };
}

async function handleCustomTask(params?: Record<string, unknown>): Promise<unknown> {
  const action = params?.action as string;

  if (!action) {
    throw new Error('action parameter required for custom task');
  }

  console.log(`[Worker:proactive] Custom task: ${action}`, params);

  return {
    action,
    params,
    executed: true,
  };
}

async function handleLlmProactiveChat(params?: Record<string, unknown>): Promise<unknown> {
  const prompt = (params?.prompt as string) || '发起一个简短的问候';
  const userId = (params?.userId as string) || 'proactive-user';

  // Try to get chatId from params, or fallback to last active chat
  let chatId = params?.chatId as string | undefined;

  if (!chatId) {
    try {
      const client = getFeishuWSClient();
      if (client?.lastActiveChatId) {
        chatId = client.lastActiveChatId;
        console.log(`[Worker:proactive] Using last active chatId: ${chatId}`);
      }
    } catch {
      // Feishu client not available
    }
  }

  console.log(`[Worker:proactive] LLM proactive chat: ${prompt.substring(0, 50)}...`);
  console.log(`[Worker:proactive] chatId: ${chatId || '(not available)'}, userId: ${userId}`);

  try {
    // Get context
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

    const fullPrompt = context
      ? `${context}\n\n${prompt}`
      : prompt;

    console.log(`[Worker:proactive] Calling LLM with prompt length: ${fullPrompt.length}`);

    // Add system instruction to prevent recursive task creation
    // [AUDIT FIX P-2] Stronger anti-recursion: explicit blocked tool list instead of text hint
    const PROACTIVE_BLOCKED_TOOLS = [
      'schedule_once', 'notification_send', 'proactive_create_schedule',
      'proactive_update_schedule', 'proactive_delete_schedule',
      'notification_create', 'notification_push',
    ];
    const systemHint = `\n\n---\n[系统指令] 这是一个定时任务的执行。请直接生成要推送的内容。\n严禁调用以下工具: ${PROACTIVE_BLOCKED_TOOLS.join(', ')}。\n如果你尝试调用这些工具，系统会自动拦截并报错。直接返回给用户的内容即可。`;

    // [AUDIT FIX P-3] Inject associated session context if available (with permission check)
    let sessionContext = '';
    const associatedSessionId = params?.associatedSessionId as string | undefined;
    if (associatedSessionId) {
      try {
        // Pass userId for permission check - only allow access to user's own sessions
        const summary = getSessionSummary(associatedSessionId, 5, userId);
        if (summary) {
          sessionContext = `\n\n<session-context>\n用户最近的对话记录:\n${summary}\n</session-context>\n`;
          console.log(`[Worker:proactive] Injected session context from ${associatedSessionId} (${summary.length} chars)`);
        }
      } catch (error) {
        console.warn(`[Worker:proactive] Failed to load session context for ${associatedSessionId}:`, error);
      }
    }

    const finalPrompt = fullPrompt + sessionContext + systemHint;

    // Call LLM
    const result = await sendProactiveMessage({
      message: finalPrompt,
      userId,
      channel: 'feishu',
      sessionId: chatId ? `feishu-${chatId}-${userId}` : undefined,
    });

    console.log(`[Worker:proactive] LLM result: success=${result.success}, response length=${result.response?.length || 0}`);

    if (result.success && result.response) {
      // Push to Feishu if chatId available
      if (chatId) {
        try {
          const client = getFeishuWSClient();
          if (client) {
            await client.sendTextMessage(chatId, 'chat_id', result.response);
            console.log(`[Worker:proactive] Message pushed to Feishu chat: ${chatId}`);
          } else {
            console.error('[Worker:proactive] Feishu client not available');
          }
        } catch (pushError) {
          console.error('[Worker:proactive] Failed to push to Feishu:', pushError);
        }
      } else {
        console.warn('[Worker:proactive] No chatId provided, message not pushed to Feishu');
        console.log(`[Worker:proactive] Generated response: ${result.response.substring(0, 100)}...`);
      }

      return {
        generated: true,
        pushed: !!chatId,
        chatId: chatId,
        responseLength: result.response.length,
      };
    } else {
      console.error('[Worker:proactive] LLM failed:', result.error);
      return {
        generated: false,
        error: result.error || 'LLM returned empty response',
      };
    }
  } catch (error) {
    console.error('[Worker:proactive] LLM proactive chat failed:', error);
    return {
      generated: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
