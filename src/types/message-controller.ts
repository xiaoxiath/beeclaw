/**
 * Message Controller Interface
 *
 * Abstraction for message streaming and updates.
 * Decouples session layer from specific channel implementations (Feishu, CLI, Web).
 */

import type { ContentBlock } from './content-block';

/**
 * Interface for message content streaming
 */
export interface IMessageController {
  /**
   * Push a content block to the streaming message
   */
  pushContent(block: ContentBlock): Promise<void>;

  /**
   * Finish streaming and finalize the message
   */
  finish(): Promise<void>;
}

/**
 * Factory function type for creating message controllers
 */
export type MessageControllerFactory = (
  channelId: string,
  messageId: string,
  options?: Record<string, unknown>
) => IMessageController | null;
