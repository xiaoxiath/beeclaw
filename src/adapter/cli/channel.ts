/**
 * CLI Channel - Console-based messaging for CLI mode
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
} from '../../types';

/**
 * CLI channel - outputs messages to console
 */
export class CLIChannel implements MessageChannel {
  readonly type: ChannelType = 'cli';

  async postMessage(
    content: MessageContent,
    options?: PostMessageOptions
  ): Promise<MessageResult> {
    try {
      const text = this.contentToString(content);
      console.log(`\n${text}\n`);

      return {
        messageId: `cli-${Date.now()}`,
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
    // CLI doesn't distinguish between post and reply
    return this.postMessage(content, { sessionId: options.sessionId });
  }

  async updateMessageContent(options: UpdateMessageOptions): Promise<void> {
    // CLI doesn't support message updates
    console.log(`[CLI] Message update requested for ${options.messageId} (not supported)`);
  }

  supportsUpdates(): boolean {
    return false;
  }

  async healthCheck(): Promise<boolean> {
    // Console is always available
    return true;
  }

  /**
   * Convert MessageContent to string for console output
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
        parts.push('[Image]');
      }
    }
    return parts.join('\n');
  }
}
