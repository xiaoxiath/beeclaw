/**
 * Default Task Handlers
 * RFC-02: TaskDispatcher default handlers
 */

import { logger } from '../../infra/observability/logger';
import type { Task } from './types';
import type { ProactiveJobData } from '../../domain/proactive/types';
import { sendProactiveMessage, confirmDelivery } from '../../domain/session';
import { getMessageGateway } from '../gateway-channel';
import {
  handleRunSkillJob,
  handleLlmProactiveChatJob,
  handleSelfEvolutionJob,
  handleMemoryCompressJob,
  handleGoalProgressCheckJob,
  handleCustomJob,
  handleSendReminderJob,
} from '../../domain/proactive/job-handlers';

/**
 * Register all default task handlers
 */
export function registerDefaultHandlers(): void {
  const dispatcher = getTaskDispatcher();

  // Message handler - processes proactive messages
  dispatcher.registerHandler('message', async (task: Task) => {
    const { message, userId, channel, sessionId, context } = task.payload;

    logger.debug(`[Handler:message] Processing message for session ${sessionId}`);

    // Process message through session manager
    const result = await sendProactiveMessage({
      message,
      userId,
      channel,
      sessionId,
      context,
    });

    if (!result.success) {
      throw new Error(result.error || 'Message processing failed');
    }

    // If response exists and channel is specified, send via Gateway
    if (result.response && result.success && channel) {
      const gateway = getMessageGateway();

      // Send reply via Gateway
      const replyResult = await gateway.replyMessage(channel, {
        sessionId: sessionId!,
        userId,
        chatId: context?.chatId,
        parentMessageId: context?.messageId,
      }, result.response);

      if (!replyResult.success) {
        throw new Error(replyResult.error || 'Failed to send reply via Gateway');
      }

      // Confirm delivery
      if (sessionId) {
        confirmDelivery(sessionId);
      }
    }

    logger.info(`[Handler:message] Message processed successfully for session ${sessionId}`);
  });

  // Cron handler - executes scheduled tasks
  dispatcher.registerHandler('cron', async (task: Task) => {
    const { handlerName, params } = task.payload;

    logger.debug(`[Handler:cron] Executing cron task: ${handlerName}`);

    // Build ProactiveJobData from task payload
    const jobData: ProactiveJobData = {
      scheduleId: task.id || 'cron-task',
      taskType: handlerName,
      params: params || {},
      triggeredAt: new Date().toISOString(),
      triggeredBy: 'cron',
    };

    // Dispatch to specific job handler based on handlerName
    try {
      switch (handlerName) {
        case 'memory_compress':
          await handleMemoryCompressJob();
          break;

        case 'llm_proactive_chat':
          await handleLlmProactiveChatJob(jobData);
          break;

        case 'self_evolution':
          await handleSelfEvolutionJob(jobData);
          break;

        case 'run_skill':
          await handleRunSkillJob(jobData);
          break;

        case 'check_goal_progress':
          await handleGoalProgressCheckJob();
          break;

        case 'send_reminder':
          await handleSendReminderJob(jobData);
          break;

        case 'custom':
          await handleCustomJob(jobData);
          break;

        default:
          logger.warn(`[Handler:cron] Unknown handler: ${handlerName}`);
          throw new Error(`Unknown cron handler: ${handlerName}`);
      }

      logger.info(`[Handler:cron] ✅ Cron task completed: ${handlerName}`);
    } catch (error) {
      logger.error(`[Handler:cron] ❌ Cron task failed: ${handlerName}`, error);
      throw error;
    }
  });

  // Reminder handler - sends reminders to users
  dispatcher.registerHandler('reminder', async (task: Task) => {
    const { userId, channel, message, chatId } = task.payload;

    logger.debug(`[Handler:reminder] Sending reminder to user ${userId}`);

    const gateway = getMessageGateway();

    // Send reminder via Gateway
    const result = await gateway.postMessage(channel, message, {
      userId,
      metadata: { chatId },
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to send reminder');
    }

    logger.debug(`[Handler:reminder] Reminder sent to user ${userId}`);
  });

  logger.debug('[Dispatcher] Default handlers registered');
}

// Import at the end to avoid circular dependency
import { getTaskDispatcher } from './index';
