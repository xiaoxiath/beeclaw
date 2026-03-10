/**
 * Default Task Handlers
 * RFC-02: TaskDispatcher default handlers
 */

import type { Task } from './types';
import { sendProactiveMessage, confirmDelivery } from '../session';
import { getMessageGateway } from '../channel/gateway';

/**
 * Register all default task handlers
 */
export function registerDefaultHandlers(): void {
  const dispatcher = getTaskDispatcher();

  // Message handler - processes proactive messages
  dispatcher.registerHandler('message', async (task: Task) => {
    const { message, userId, channel, sessionId, context } = task.payload;

    console.log(`[Handler:message] Processing message for session ${sessionId}`);

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

    console.log(`[Handler:message] Message processed successfully for session ${sessionId}`);
  });

  // Cron handler - executes scheduled tasks
  dispatcher.registerHandler('cron', async (task: Task) => {
    const { handlerName, params } = task.payload;

    console.log(`[Handler:cron] Executing cron task: ${handlerName}`);

    // TODO: Implement cron handler dispatch based on handlerName
    // This could call specific functions for memory compression, goal checks, etc.

    console.log(`[Handler:cron] Cron task completed: ${handlerName}`);
  });

  // Reminder handler - sends reminders to users
  dispatcher.registerHandler('reminder', async (task: Task) => {
    const { userId, channel, message, chatId } = task.payload;

    console.log(`[Handler:reminder] Sending reminder to user ${userId}`);

    const gateway = getMessageGateway();

    // Send reminder via Gateway
    const result = await gateway.postMessage(channel, message, {
      userId,
      metadata: { chatId },
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to send reminder');
    }

    console.log(`[Handler:reminder] Reminder sent to user ${userId}`);
  });

  console.log('[Dispatcher] Default handlers registered');
}

// Import at the end to avoid circular dependency
import { getTaskDispatcher } from './index';
