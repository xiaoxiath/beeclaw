/**
 * Proactive Integration Module
 *
 * Provides Feishu bot integration with memory system
 */

import { initSessionManager, sendProactiveMessage, confirmDelivery } from '../../domain/session';
import { pushNotification } from '../../domain/proactive/pusher';
import { evaluatePatterns } from '../../domain/proactive/triggers';
import { getGoalStore } from '../../domain/agent/goal/store';
import { initFeishuWSClient, getFeishuWSClient } from '../../adapter/feishu';
import type { AIProvider, FeishuConfig } from '../../infra/config/schema';
import { checkPreferenceTriggers, recordQuery } from '../../domain/agent/evolution';
import type { TokenStatsConfig } from '../../domain/agent';
import { MessageDeduplicator } from '../../infra/utils/deduplicator';
import { GracefulShutdown } from '../../infra/utils/graceful-shutdown';
import { getMessageGateway } from '../gateway-channel';
import { SessionMessageQueue } from '../../infra/resilience/session-lock';

// BUG #6 FIX: Replace Set<string> with LRU+TTL deduplicator
const deduplicator = new MessageDeduplicator({
  maxSize: 2000,
  ttlMs: 10 * 60 * 1000,  // 10 minutes
});

// Reference to shutdown manager
const shutdownManager = GracefulShutdown.getInstance({ installSignalHandlers: false });

// Bot start time - only process messages sent after this time
const botStartTime = Date.now();

// Cache tenant access token
let cachedTenantAccessToken: string | null = null;
let tokenExpireTime = 0;

/**
 * Get Feishu tenant access token with caching
 */
async function getTenantAccessToken(): Promise<string> {
  // Return cached token if still valid
  if (cachedTenantAccessToken && Date.now() < tokenExpireTime) {
    return cachedTenantAccessToken;
  }

  const appId = process.env.LARK_BEECLAW_APPID;
  const appSecret = process.env.LARK_BEECLAW_AS;

  if (!appId || !appSecret) {
    throw new Error('Missing Feishu credentials');
  }

  const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      app_id: appId,
      app_secret: appSecret,
    }),
  });

  const data = await response.json();

  if (data.code !== 0) {
    throw new Error(`Failed to get tenant access token: ${data.msg}`);
  }

  // Cache token (expire in 1 hour, but refresh 5 minutes before)
  cachedTenantAccessToken = data.tenant_access_token;
  tokenExpireTime = Date.now() + (data.expire - 300) * 1000;

  return data.tenant_access_token;
}

// Initialize session manager with config (call this during app startup)
export function initProactiveApi(config: {
  provider: AIProvider;
  model: string;
  systemPrompt?: string;
  useTools?: boolean;
  tokenStatsConfig?: Partial<TokenStatsConfig>;
}): void {
  initSessionManager(config);
}

// Initialize Feishu WebSocket integration (Long connection mode)
export async function initFeishuWSIntegration(config: FeishuConfig): Promise<void> {
  if (!config.appId || !config.appSecret) {
    console.log('[FeishuWS] Missing appId or appSecret');
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

  wsClient.onMessage(async (data) => {
    const client = getFeishuWSClient();
    if (!client) {
      console.error('[FeishuWS] Client not initialized');
      return;
    }

    const userId = client.extractUserId(data);
    const chatId = client.extractChatId(data);
    const messageId = client.extractMessageId(data);
    const messageText = client.parseMessageContent(data);

    // Extract openId explicitly for user authorization
    const openId = data.sender?.sender_id?.open_id || userId;

    // Log raw event for debugging
    console.log(`[FeishuWS:${process.pid}] 📨 Raw event: messageId=${messageId}, chatId=${chatId}, sender_type=${data.sender?.sender_type}, message_type=${data.message?.message_type}`);

    // Ignore messages from bot itself (early check)
    if (data.sender?.sender_type === 'app') {
      console.log(`[FeishuWS:${process.pid}] Ignoring message from bot itself`);
      return;
    }

    // Get message timestamp (in milliseconds)
    const messageTimeStr = data.message?.create_time;
    const messageTime = messageTimeStr ? parseInt(messageTimeStr, 10) : Date.now();

    // Only process messages sent after bot started
    // This filters out historical messages pushed by Feishu on connection
    if (messageTime < botStartTime) {
      const ageSeconds = Math.round((botStartTime - messageTime) / 1000);
      console.log(`[FeishuWS:${process.pid}] Ignoring pre-startup message (${ageSeconds}s old): ${messageText.substring(0, 20)}...`);
      return;
    }

    // Check if message contains image
    const isImageMessage = data.message?.message_type === 'image';

    // FIX: Use per-chatId queue to ensure sequential processing within the same chat
    // This prevents message ordering issues in both private chats and group chats
    await messageQueue.enqueue(`chat-${chatId}`, async () => {
      // All message processing happens inside this queue to ensure ordering

      // Double-check deduplication (in case message was processed while waiting in queue)
      if (deduplicator.isDuplicate(messageId)) {
        console.log(`[FeishuWS:${process.pid}] Duplicate message ${messageId} (second check), skipping`);
        return;
      }

      // Process image message if needed
      let imageBase64: string | null = null;
      if (isImageMessage) {
        console.log(`[FeishuWS:${process.pid}] 📷 Image message detected`);

        try {
          // Extract image key and download
          const content = JSON.parse(data.message.content);
          const imageKey = content.image_key;

          if (imageKey) {
            console.log(`[FeishuWS:${process.pid}] Downloading image: ${imageKey}`);

            // Download image from user message using "Get Message Resources" API
            // API: GET /open-apis/im/v1/messages/:message_id/resources/:file_key?type=image
            // Note: This is different from downloading bot-uploaded images
            const imageResponse = await fetch(
              `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${imageKey}?type=image`,
              {
                method: 'GET',  // Use GET, not POST
                headers: {
                  'Authorization': `Bearer ${await getTenantAccessToken()}`,
                },
              }
            );

            if (imageResponse.ok) {
              const arrayBuffer = await imageResponse.arrayBuffer();
              imageBase64 = Buffer.from(arrayBuffer).toString('base64');
              console.log(`[FeishuWS:${process.pid}] ✅ Image downloaded (${Math.round(imageBase64.length / 1024)}KB)`);
            } else {
              const errorText = await imageResponse.text();
              console.error(`[FeishuWS:${process.pid}] ❌ Failed to download image: ${imageResponse.status} - ${errorText}`);
            }
          }
        } catch (error) {
          console.error(`[FeishuWS:${process.pid}] ❌ Error processing image:`, error);
        }
      }

      // Ignore empty messages (unless it's an image message)
      if ((!messageText || messageText.trim().length === 0) && !imageBase64) {
        console.log(`[FeishuWS:${process.pid}] Ignoring empty message`);
        return;
      }

      console.log(`[FeishuWS:${process.pid}] Message from ${userId} in chat ${chatId}: ${messageText.substring(0, 50)}...`);

      // Send immediate feedback to acknowledge receipt
      // Add reaction emoji for instant feedback
      const reactions = ['Typing', 'Get', 'LGTM', 'Coffee', 'Status_PrivateMessage', 'OK'];
      const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];
      let reactionId: string | null = null;
      try {
        reactionId = await client.addReaction(messageId, randomReaction);
      } catch (error) {
        console.log(`[FeishuWS:${process.pid}] Failed to add reaction (non-critical):`, error);
      }

      // Create consistent session ID for conversation continuity
      const sessionId = `feishu-${chatId}-${userId}`;

      // Build multimodal message content (image + text)
      let messageContent: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
      if (imageBase64) {
        // Image message - build multimodal content
        const dataUrl = `data:image/jpeg;base64,${imageBase64}`;
        const textPrompt = (messageText && !messageText.includes('{') && messageText.trim().length > 0)
          ? messageText
          : '请识别并分析这张图片';

        messageContent = [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: textPrompt }
        ];
        console.log(`[FeishuWS:${process.pid}] 📷 Built multimodal message with image (${Math.round(imageBase64.length / 1024)}KB) and text: "${textPrompt.substring(0, 50)}..."`);
      } else {
        // Text-only message
        messageContent = messageText;
      }

      // Process message through session manager
      console.log(`[FeishuWS:${process.pid}] Processing message with session ${sessionId}...`);
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
        console.error(`[FeishuWS:${process.pid}] ❌ Failed to process message: ${result.error || 'Unknown error'}`);
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
            console.log(`[FeishuWS:${process.pid}] ⚠️  Message ${messageId} was withdrawn, error reply skipped`);
          } else {
            console.error(`[FeishuWS:${process.pid}] Failed to send error reply:`, replyError);
          }
        }
        return;
      }

      if (!result.response) {
        console.error(`[FeishuWS:${process.pid}] ❌ Empty response from agent`);
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
            console.log(`[FeishuWS:${process.pid}] ⚠️  Message ${messageId} was withdrawn, error reply skipped`);
          } else {
            console.error(`[FeishuWS:${process.pid}] Failed to send empty response reply:`, replyError);
          }
        }
        return;
      }

      // Reply to the message directly via Gateway
      // NOTE: If Card V2 was used, skip sending text message (Card V2 already sent via StreamingMessageController)
      if (result.usedCardV2) {
        console.log(`[FeishuWS:${process.pid}] ✅ Card V2 already sent, skipping text reply`);

        // Remove the reaction since reply is complete
        if (reactionId) {
          try {
            await client.deleteReaction(messageId, reactionId);
          } catch (error) {
            console.log(`[FeishuWS:${process.pid}] Failed to remove reaction (non-critical):`, error);
          }
        }

        // Mark response as delivered
        if (result.sessionId) {
          confirmDelivery(result.sessionId);
        }

        return; // Exit early - Card V2 message already sent
      }

      try {
        console.log(`[FeishuWS:${process.pid}] Replying to message ${messageId} (${result.response.length} chars)...`);

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

        console.log(`[FeishuWS:${process.pid}] ✅ Reply sent successfully via Gateway`);

        // Remove the reaction since reply is complete
        if (reactionId) {
          try {
            await client.deleteReaction(messageId, reactionId);
          } catch (error) {
            console.log(`[FeishuWS:${process.pid}] Failed to remove reaction (non-critical):`, error);
          }
        }

        // Mark response as delivered (for tracking purposes)
        // BUG #2 FIX: Use confirmDelivery() instead of separate markResponseDelivered()
        if (result.sessionId) {
          confirmDelivery(result.sessionId);
        }
      } catch (error) {
        // Check if error is due to withdrawn message
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes('230011') || errorMsg.includes('231003') || errorMsg.includes('withdrawn')) {
          console.log(`[FeishuWS:${process.pid}] ⚠️  Message ${messageId} was withdrawn by user, reply skipped`);
          return; // Exit gracefully - no need to retry or send error message
        }

        console.error(`[FeishuWS:${process.pid}] ❌ Reply failed:`, error);
        // BUG #2 FIX: Do NOT confirm delivery - leave pendingRecovery=true so recovery can retry
        console.warn(`[FeishuWS:${process.pid}] Message ${messageId} will be retried on recovery (delivery failed)`);
        // Try fallback with simple text via direct client (fallback to old behavior)
        try {
          // Strip markdown for fallback
          const plainText = result.response
            .replace(/\*\*/g, '')
            .replace(/`/g, '')
            .replace(/\n/g, '\n');
          await client.replyText(messageId, plainText);
          console.log(`[FeishuWS:${process.pid}] ✅ Fallback reply sent via direct client`);
        } catch (fallbackError) {
          console.error(`[FeishuWS:${process.pid}] ❌ Fallback reply also failed:`, fallbackError);
        }
      }

      // Self-evolution: Check for preference expressions
      try {
        const preferenceTrigger = checkPreferenceTriggers(messageText, []);
        if (preferenceTrigger && preferenceTrigger.hasPreference) {
          console.log(`[Evolution] Detected preference:`, preferenceTrigger.expressions);
        }

        // Record query for pattern detection
        recordQuery(messageText, {
          channel: 'feishu',
          userId: openId,
          sessionId: sessionId,
        });
      } catch (error) {
        // Non-critical - evolution should not block message processing
        console.log('[Evolution] Analysis failed (non-critical):', error);
      }
    }); // End of messageQueue.enqueue
  });

  // Start WebSocket connection
  try {
    console.log(`[FeishuWS:${process.pid}] Bot started at ${new Date(botStartTime).toISOString()}`);
    await wsClient.start();
    console.log(`[FeishuWS:${process.pid}] Integration initialized (Long connection mode)`);
  } catch (error) {
    console.error('[FeishuWS] Failed to start:', error);
    throw error;
  }
}

// Export utilities for external use
export { sendProactiveMessage, pushNotification, evaluatePatterns, getGoalStore };
