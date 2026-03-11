/**
 * Feishu Channel - Feishu/Lark messaging integration
 * RFC-01: MessageChannel implementation
 */

import type {
  MessageChannel,
  ChannelType,
  MessageContent,
  PostMessageOptions,
  ReplyMessageOptions,
  UpdateMessageOptions,
  MessageResult,
} from './types';
import { getFeishuWSClient } from './index';

/**
 * Feishu channel - sends messages via Feishu/Lark API
 */
export class FeishuChannel implements MessageChannel {
  readonly type: ChannelType = 'feishu';

  async postMessage(
    content: MessageContent,
    options?: PostMessageOptions
  ): Promise<MessageResult> {
    try {
      const client = getFeishuWSClient();
      if (!client) {
        throw new Error('Feishu client not initialized');
      }

      const text = this.contentToString(content);
      const chatId = options?.metadata?.chatId as string;

      if (!chatId) {
        throw new Error('chatId required for Feishu messages');
      }

      const response = await client.sendTextMessage(chatId, 'chat_id', text);

      return {
        messageId: response.data?.message_id || `feishu-${Date.now()}`,
        success: true,
      };
    } catch (error) {
      return {
        messageId: '',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async replyMessage(
    options: ReplyMessageOptions,
    content: MessageContent
  ): Promise<MessageResult> {
    try {
      const client = getFeishuWSClient();
      if (!client) {
        throw new Error('Feishu client not initialized');
      }

      const text = this.contentToString(content);
      const parentMessageId = options.parentMessageId;

      if (!parentMessageId) {
        throw new Error('parentMessageId required for Feishu replies');
      }

      // Use smart reply (handles markdown formatting)
      await client.replyTextSmart(parentMessageId, text);

      return {
        messageId: `feishu-reply-${Date.now()}`,
        success: true,
      };
    } catch (error) {
      // Check for withdrawn message errors
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes('230011') || errorMsg.includes('231003') || errorMsg.includes('withdrawn')) {
        return {
          messageId: '',
          success: false,
          error: 'Message was withdrawn by user',
        };
      }

      return {
        messageId: '',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async updateMessageContent(options: UpdateMessageOptions): Promise<void> {
    // Note: Card V2 streaming updates are handled by StreamingMessageController directly
    // via FeishuWSClient.patchCard(), not through this channel
    console.log(`[Feishu] Message update requested for ${options.messageId} (not supported for text messages)`);
  }

  supportsUpdates(): boolean {
    // Note: Card V2 supports updates via StreamingMessageController + FeishuWSClient.patchCard()
    // This method returns false for traditional text messages
    // Card V2 updates bypass this channel and go directly to FeishuWSClient
    return false; // Feishu doesn't support updating text messages
  }

  async healthCheck(): Promise<boolean> {
    try {
      const client = getFeishuWSClient();
      return client !== null;
    } catch {
      return false;
    }
  }

  /**
   * Convert MessageContent to string for Feishu
   */
  private contentToString(content: MessageContent): string {
    if (typeof content === 'string') {
      return content;
    }

    // Multimodal content
    const parts: string[] = [];
    for (const part of content) {
      if (part.type === 'text' && part.text) {
        parts.push(part.text);
      } else if (part.type === 'image_url') {
        parts.push('[图片]');
      }
    }
    return parts.join('\n');
  }
}
