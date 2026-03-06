/**
 * Proactive Integration Module
 *
 * Provides Feishu bot integration with memory system
 */

import { initSessionManager, sendProactiveMessage } from '../session';
import { pushNotification } from '../proactive/pusher';
import { evaluatePatterns } from '../proactive/triggers';
import { getGoalStore } from '../goal/store';
import { initFeishuWSClient, getFeishuWSClient } from '../feishu';
import type { AIProvider, FeishuConfig } from '../config/schema';
import { analyzeForTriggers, checkPreferenceTriggers, recordQuery } from '../evolution';
import type { TokenStatsConfig } from '../agent';

// Message deduplication - track processed message IDs
const processedMessages = new Set<string>();
const MAX_PROCESSED_CACHE = 1000;

// Track last processed message time per chat to filter old messages
const lastProcessedTimePerChat = new Map<string, number>();

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

  const data = await response.json() as any;

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

    // Log raw event for debugging
    console.log(`[FeishuWS:${process.pid}] 📨 Raw event: messageId=${messageId}, chatId=${chatId}, sender_type=${data.sender?.sender_type}, message_type=${data.message?.message_type}`);

    // Check if message contains image
    const isImageMessage = data.message?.message_type === 'image';
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

    // Ignore messages from bot itself
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

    // Check if this message is older than the last processed message in this chat
    const lastTime = lastProcessedTimePerChat.get(chatId) || 0;
    if (messageTime < lastTime) {
      console.log(`[FeishuWS:${process.pid}] Ignoring old message in chat (${messageTime} < ${lastTime}): ${messageText.substring(0, 20)}...`);
      return;
    }

    // Deduplicate messages (Feishu may send duplicate events)
    if (processedMessages.has(messageId)) {
      console.log(`[FeishuWS:${process.pid}] Duplicate message ${messageId}, skipping`);
      return;
    }

    // Add to processed cache
    processedMessages.add(messageId);

    // Update last processed time for this chat
    lastProcessedTimePerChat.set(chatId, messageTime);

    // Prevent memory leak - clear old entries if cache is too large
    if (processedMessages.size > MAX_PROCESSED_CACHE) {
      const entries = Array.from(processedMessages);
      entries.slice(0, entries.length - MAX_PROCESSED_CACHE).forEach(id => {
        processedMessages.delete(id);
      });
    }

    console.log(`[FeishuWS:${process.pid}] Message from ${userId} in chat ${chatId}: ${messageText.substring(0, 50)}...`);

    // Send immediate feedback to acknowledge receipt
    // Add reaction emoji for instant feedback
    const reactions = ['Typing', 'Get', 'LGTM', 'Coffee', 'Status_PrivateMessage', 'OK'];
    const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];
    try {
      await client.addReaction(messageId, randomReaction);
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
        chatId,
        messageId,
      },
    });

    // Log result for debugging
    if (!result.success) {
      console.error(`[FeishuWS:${process.pid}] ❌ Failed to process message: ${result.error || 'Unknown error'}`);
      // Send error notification to user
      try {
        await client.replyText(messageId, `处理消息时出错：${result.error || '未知错误'}。请稍后重试。`);
      } catch (replyError) {
        console.error(`[FeishuWS:${process.pid}] Failed to send error reply:`, replyError);
      }
      return;
    }

    if (!result.response) {
      console.error(`[FeishuWS:${process.pid}] ❌ Empty response from agent`);
      try {
        await client.replyText(messageId, '收到消息，但无法生成回复。请稍后重试。');
      } catch (replyError) {
        console.error(`[FeishuWS:${process.pid}] Failed to send empty response reply:`, replyError);
      }
      return;
    }

    // Reply to the message directly
    try {
      console.log(`[FeishuWS:${process.pid}] Replying to message ${messageId} (${result.response.length} chars)...`);

      // Always send new message (can't update text messages in Feishu)
      await client.replyTextSmart(messageId, result.response);
      console.log(`[FeishuWS:${process.pid}] ✅ Reply sent successfully`);

      // Mark response as delivered (for tracking purposes)
      // Note: pendingRecovery was already cleared when AI responded (in session/index.ts)
      if (result.sessionId) {
        const { markResponseDelivered } = await import('../session');
        markResponseDelivered(result.sessionId);
      }
    } catch (error) {
      console.error(`[FeishuWS:${process.pid}] ❌ Reply failed:`, error);
      // Try fallback with simple text
      try {
        // Strip markdown for fallback
        const plainText = result.response
          .replace(/\*\*/g, '')
          .replace(/`/g, '')
          .replace(/\n/g, '\n');
        await client.replyText(messageId, plainText);
        console.log(`[FeishuWS:${process.pid}] ✅ Fallback reply sent`);
      } catch (fallbackError) {
        console.error(`[FeishuWS:${process.pid}] ❌ Fallback reply also failed:`, fallbackError);
      }
    }

    // Self-evolution: Analyze message for reflection triggers
    try {
      const trigger = analyzeForTriggers(messageText, {});
      if (trigger) {
        console.log(`[Evolution] Detected trigger: ${trigger.type} (${trigger.severity})`);
        // Store trigger for later reflection (could trigger skill improvement)
        // In a full implementation, this would queue a reflection task
      }

      // Check for preference expressions
      const preferenceTrigger = checkPreferenceTriggers(messageText, []);
      if (preferenceTrigger && preferenceTrigger.hasPreference) {
        console.log(`[Evolution] Detected preference:`, preferenceTrigger.expressions);
      }

      // Record query for pattern detection
      recordQuery(messageText);
    } catch (error) {
      // Non-critical - evolution should not block message processing
      console.log('[Evolution] Analysis failed (non-critical):', error);
    }
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
