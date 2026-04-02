/**
 * Feishu WebSocket Integration Module
 *
 * Handles the Feishu long-connection (WebSocket) message processing loop.
 * Manages message deduplication, queuing, reaction feedback, and reply delivery.
 */

import { sendProactiveMessage, confirmDelivery, isMessageProcessed, markMessageProcessing, markMessageCompleted, markMessageFailed, getCachedAgentResponse } from '../../../domain/session';
import { initFeishuWSClient, getFeishuWSClient } from '../../../adapter/feishu';
import type { FeishuConfig } from '../../../infra/config/schema';
import { checkPreferenceTriggers, recordQuery } from '../../../domain/agent/evolution';
import { getMessageGateway } from '../../gateway-channel';
import { SessionMessageQueue } from '../../../infra/resilience/session-lock';
import { logger } from '../../../infra/observability/logger';

import { downloadFeishuImage, buildMultimodalContent } from './image-handler';

// Bot start time - only process messages sent after this time
const botStartTime = Date.now();

// Initialize Feishu WebSocket integration (Long connection mode)
export async function initFeishuWSIntegration(config: FeishuConfig): Promise<void> {
  if (!config.appId || !config.appSecret) {
    logger.warn('[FeishuWS] Missing appId or appSecret');
    return;
  }

  const wsClient = initFeishuWSClient({
    appId: config.appId,
    appSecret: config.appSecret,
    enabled: true,
    loggerLevel: config.logLevel || 'error',
  });

  // Register message handler
  // FIX: Process messages per chatId sequentially to avoid message ordering issues
  const messageQueue = SessionMessageQueue.getInstance();

  logger.debug('[FeishuWS] Registering onMessage handler...');

  wsClient.onMessage(async (data) => {
    logger.debug('[FeishuWS] onMessage callback triggered');
    logger.debug('[FeishuWS] Callback received data:', {
      hasMessage: !!data.message,
      hasSender: !!data.sender,
      messageType: data.message?.message_type,
    });

    const client = getFeishuWSClient();
    if (!client) {
      logger.error('[FeishuWS] Client not initialized');
      return;
    }

    const userId = client.extractUserId(data);
    const chatId = client.extractChatId(data);
    const messageId = client.extractMessageId(data);
    const messageText = client.parseMessageContent(data);

    // Extract openId explicitly for user authorization
    const openId = data.sender?.sender_id?.open_id || userId;

    // Log raw event for debugging
    logger.debug(`[FeishuWS:${process.pid}] Raw event: messageId=${messageId}, chatId=${chatId}, sender_type=${data.sender?.sender_type}, message_type=${data.message?.message_type}`);

    // Ignore messages from bot itself (early check)
    if (data.sender?.sender_type === 'app') {
      logger.debug(`[FeishuWS:${process.pid}] Ignoring message from bot itself`);
      return;
    }

    // Get message timestamp (in milliseconds)
    const messageTimeStr = data.message?.create_time;
    const messageTime = messageTimeStr ? parseInt(messageTimeStr, 10) : Date.now();

    logger.debug('[FeishuWS] Time check:', {
      messageTime,
      botStartTime,
      messageTimeStr,
      diff: messageTime - botStartTime,
      willFilter: messageTime < botStartTime,
    });

    // Only process messages sent after bot started
    // This filters out historical messages pushed by Feishu on connection
    if (messageTime < botStartTime) {
      const ageSeconds = Math.round((botStartTime - messageTime) / 1000);
      logger.debug(`[FeishuWS:${process.pid}] Ignoring pre-startup message (${ageSeconds}s old): ${messageText.substring(0, 20)}...`);
      return;
    }

    // Check if message contains image
    const isImageMessage = data.message?.message_type === 'image';

    // FIX: Use per-chatId queue to ensure sequential processing within the same chat
    // This prevents message ordering issues in both private chats and group chats
    await messageQueue.enqueue(`chat-${chatId}`, async () => {
      // All message processing happens inside this queue to ensure ordering

      // [PERSISTENT DEDUPLICATION] Check if message was already processed
      // Uses session-based storage (survives restarts) with 24-hour TTL
      const sessionId = `feishu-${chatId}-${userId}`;
      if (isMessageProcessed(sessionId, messageId)) {
        logger.debug(`[FeishuWS:${process.pid}] Duplicate message ${messageId} (already processed), skipping`);
        return;
      }

      // [FIX-2] Check if we have a cached agent response from a previous failed delivery.
      // If so, skip agent re-execution entirely and jump straight to delivery.
      const cachedResult = getCachedAgentResponse(sessionId, messageId);
      if (cachedResult) {
        logger.info(`[FeishuWS:${process.pid}] Found cached agent response for ${messageId}, attempting delivery-only retry`);
        // Mark as processing for this delivery attempt
        markMessageProcessing(sessionId, messageId);
        try {
          if (cachedResult.usedCardV2) {
            // Card V2 already sent in previous attempt — mark completed
            markMessageCompleted(sessionId, messageId, cachedResult.response, true);
            logger.info(`[FeishuWS:${process.pid}] Cached Card V2 response — marked completed`);
          } else {
            const gateway = getMessageGateway();
            const replyResult = await gateway.replyMessage('feishu', {
              sessionId, userId, chatId, parentMessageId: messageId,
            }, cachedResult.response);
            if (!replyResult.success) throw new Error(replyResult.error || 'Cached reply failed');
            markMessageCompleted(sessionId, messageId, cachedResult.response, false);
            logger.info(`[FeishuWS:${process.pid}] Cached response delivered successfully`);
          }
        } catch (deliveryError) {
          logger.error(`[FeishuWS:${process.pid}] Cached delivery retry also failed:`, deliveryError);
          markMessageFailed(sessionId, messageId, String(deliveryError), cachedResult.response, cachedResult.usedCardV2);
        }
        return;
      }

      // [FIX-1] Mark message as 'processing' BEFORE agent execution.
      // This closes the race window: any Feishu re-delivery arriving while
      // the agent is running will see 'processing' and skip.
      markMessageProcessing(sessionId, messageId);

      // Process image message if needed
      let imageBase64: string | null = null;
      if (isImageMessage) {
        logger.info(`[FeishuWS:${process.pid}] Image message detected`);
        imageBase64 = await downloadFeishuImage(messageId, data.message.content, process.pid);
      }

      // Ignore empty messages (unless it's an image message)
      if ((!messageText || messageText.trim().length === 0) && !imageBase64) {
        logger.debug(`[FeishuWS:${process.pid}] Ignoring empty message`);
        return;
      }

      logger.info(`[FeishuWS:${process.pid}] Message from ${userId} in chat ${chatId}: ${messageText.substring(0, 50)}...`);

      // Send immediate feedback to acknowledge receipt
      // Add reaction emoji for instant feedback
      const reactions = ['Typing', 'Get', 'LGTM', 'Coffee', 'Status_PrivateMessage', 'OK'];
      const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];
      let reactionId: string | null = null;
      try {
        reactionId = await client.addReaction(messageId, randomReaction);
      } catch (error) {
        logger.debug(`[FeishuWS:${process.pid}] Failed to add reaction (non-critical):`, error);
      }

      // Build multimodal message content (image + text)
      const messageContent = buildMultimodalContent(imageBase64, messageText, process.pid);

      // Process message through session manager
      logger.debug(`[FeishuWS:${process.pid}] Processing message with session ${sessionId}...`);
      const result = await sendProactiveMessage({
        message: messageContent,
        userId,
        channel: 'feishu',
        sessionId,
        context: {
          openId,
          chatId,
          messageId,
          parentMessageId: messageId, // Required for Card V2 streaming
        },
      });

      // Log result for debugging
      if (!result.success) {
        logger.error(`[FeishuWS:${process.pid}] Failed to process message: ${result.error || 'Unknown error'}`);
        // Send error notification to user via Gateway
        try {
          const gateway = getMessageGateway();
          await gateway.replyMessage('feishu', {
            sessionId,
            userId,
            chatId,
            parentMessageId: messageId,
          }, `处理消息时出错：${result.error || '未知错误'}。请稍后重试。`);
        } catch (replyError) {
          // Check if error is due to withdrawn message
          const errorMsg = replyError instanceof Error ? replyError.message : String(replyError);
          if (errorMsg.includes('230011') || errorMsg.includes('231003') || errorMsg.includes('withdrawn')) {
            logger.warn(`[FeishuWS:${process.pid}] Message ${messageId} was withdrawn, error reply skipped`);
          } else {
            logger.error(`[FeishuWS:${process.pid}] Failed to send error reply:`, replyError);
          }
        }
        return;
      }

      if (!result.response) {
        logger.error(`[FeishuWS:${process.pid}] Empty response from agent`);
        try {
          const gateway = getMessageGateway();
          await gateway.replyMessage('feishu', {
            sessionId,
            userId,
            chatId,
            parentMessageId: messageId,
          }, '收到消息，但无法生成回复。请稍后重试。');
        } catch (replyError) {
          // Check if error is due to withdrawn message
          const errorMsg = replyError instanceof Error ? replyError.message : String(replyError);
          if (errorMsg.includes('230011') || errorMsg.includes('231003') || errorMsg.includes('withdrawn')) {
            logger.warn(`[FeishuWS:${process.pid}] Message ${messageId} was withdrawn, error reply skipped`);
          } else {
            logger.error(`[FeishuWS:${process.pid}] Failed to send empty response reply:`, replyError);
          }
        }
        return;
      }

      // Reply to the message directly via Gateway
      // NOTE: If Card V2 was used, skip sending text message (Card V2 already sent via StreamingMessageController)
      if (result.usedCardV2) {
        logger.info(`[FeishuWS:${process.pid}] Card V2 already sent, skipping text reply`);

        // [FIX-1] Mark completed with cached response
        markMessageCompleted(sessionId, messageId, result.response, true);

        // Remove the reaction since reply is complete
        if (reactionId) {
          try {
            await client.deleteReaction(messageId, reactionId);
          } catch (error) {
            logger.debug(`[FeishuWS:${process.pid}] Failed to remove reaction (non-critical):`, error);
          }
        }

        // Mark response as delivered
        if (result.sessionId) {
          confirmDelivery(result.sessionId);
        }

        return; // Exit early - Card V2 message already sent
      }

      try {
        logger.info(`[FeishuWS:${process.pid}] Replying to message ${messageId} (${result.response.length} chars)...`);

        // Send reply via Gateway (always send new message - can't update text messages in Feishu)
        const gateway = getMessageGateway();
        const replyResult = await gateway.replyMessage('feishu', {
          sessionId,
          userId,
          chatId,
          parentMessageId: messageId,
        }, result.response);

        if (!replyResult.success) {
          throw new Error(replyResult.error || 'Reply failed');
        }

        logger.info(`[FeishuWS:${process.pid}] Reply sent successfully via Gateway`);

        // [FIX-1] Mark completed with cached response
        markMessageCompleted(sessionId, messageId, result.response, false);

        // Remove the reaction since reply is complete
        if (reactionId) {
          try {
            await client.deleteReaction(messageId, reactionId);
          } catch (error) {
            logger.debug(`[FeishuWS:${process.pid}] Failed to remove reaction (non-critical):`, error);
          }
        }

        // Mark response as delivered (for tracking purposes)
        if (result.sessionId) {
          confirmDelivery(result.sessionId);
        }
      } catch (error) {
        // Check if error is due to withdrawn message
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes('230011') || errorMsg.includes('231003') || errorMsg.includes('withdrawn')) {
          logger.warn(`[FeishuWS:${process.pid}] Message ${messageId} was withdrawn by user, reply skipped`);
          return; // Exit gracefully - no need to retry or send error message
        }

        logger.error(`[FeishuWS:${process.pid}] Reply failed:`, error);
        // [FIX-2] Cache the agent response and mark as failed for delivery-only retry.
        // Next time Feishu re-delivers this message, getCachedAgentResponse() will
        // return this response, avoiding full agent re-execution.
        markMessageFailed(sessionId, messageId, errorMsg, result.response, result.usedCardV2 || false);
        logger.warn(`[FeishuWS:${process.pid}] Message ${messageId} delivery failed. Response cached for retry.`);
        // Try fallback with simple text via direct client (fallback to old behavior)
        try {
          // Strip markdown for fallback
          const plainText = result.response
            .replace(/\*\*/g, '')
            .replace(/`/g, '')
            .replace(/\n/g, '\n');
          await client.replyText(messageId, plainText);
          logger.info(`[FeishuWS:${process.pid}] Fallback reply sent via direct client`);
        } catch (fallbackError) {
          logger.error(`[FeishuWS:${process.pid}] Fallback reply also failed:`, fallbackError);
        }
      }

      // Self-evolution: Check for preference expressions
      try {
        const preferenceTrigger = checkPreferenceTriggers(messageText, []);
        if (preferenceTrigger && preferenceTrigger.hasPreference) {
          logger.debug(`[Evolution] Detected preference:`, preferenceTrigger.expressions);
        }

        // Record query for pattern detection
        recordQuery(messageText, {
          channel: 'feishu',
          userId: openId,
          sessionId: sessionId,
        });
      } catch (error) {
        // Non-critical - evolution should not block message processing
        logger.debug('[Evolution] Analysis failed (non-critical):', error);
      }
    }); // End of messageQueue.enqueue
  });

  // Start WebSocket connection
  try {
    logger.info(`[FeishuWS:${process.pid}] Starting WebSocket connection...`);
    logger.info(`[FeishuWS:${process.pid}] Bot start time: ${new Date(botStartTime).toISOString()} (${botStartTime})`);
    await wsClient.start();
    logger.info(`[FeishuWS:${process.pid}] Integration initialized (Long connection mode)`);
    logger.debug(`[FeishuWS:${process.pid}] Connection status:`, {
      connected: wsClient.connected,
      enabled: wsClient.isEnabled,
    });
  } catch (error) {
    logger.error('[FeishuWS] Failed to start:', error);
    throw error;
  }
}
