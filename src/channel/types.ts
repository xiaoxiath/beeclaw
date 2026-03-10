/**
 * MessageChannel - Unified messaging interface for multiple channels
 * RFC-01: MessageChannel/Gateway abstraction
 */

/**
 * Channel types supported by the system
 */
export type ChannelType = 'cli' | 'feishu' | 'webhook' | 'api' | 'slack' | 'telegram';

/**
 * Message content can be text or multimodal
 */
export type MessageContent = string | MultimodalContent[];

/**
 * Multimodal content (text + images)
 */
export interface MultimodalContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'low' | 'high' | 'auto';
  };
}

/**
 * Options for posting a new message
 */
export interface PostMessageOptions {
  sessionId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
  replyTo?: string; // Message ID to reply to (if supported)
}

/**
 * Options for replying to a message
 */
export interface ReplyMessageOptions {
  sessionId: string;
  userId?: string;
  chatId?: string; // For channels that use chat IDs (Feishu)
  parentMessageId?: string; // Thread reply (if supported)
  metadata?: Record<string, unknown>;
}

/**
 * Options for updating message content
 */
export interface UpdateMessageOptions {
  sessionId: string;
  messageId: string;
  chatId?: string; // For channels that use chat IDs (Feishu)
}

/**
 * Result of a message operation
 */
export interface MessageResult {
  messageId: string;
  success: boolean;
  error?: string;
}

/**
 * MessageChannel interface - abstracts messaging across different platforms
 *
 * Each channel (CLI, Feishu, Slack, etc.) implements this interface.
 * The MultiChannelMessageGateway routes messages to the appropriate channel.
 */
export interface MessageChannel {
  /**
   * Channel type identifier
   */
  readonly type: ChannelType;

  /**
   * Post a new message to the channel
   */
  postMessage(
    content: MessageContent,
    options?: PostMessageOptions
  ): Promise<MessageResult>;

  /**
   * Reply to a message in the channel
   */
  replyMessage(
    options: ReplyMessageOptions,
    content: MessageContent
  ): Promise<MessageResult>;

  /**
   * Update/edit an existing message (optional - not all channels support this)
   */
  updateMessageContent?(options: UpdateMessageOptions): Promise<void>;

  /**
   * Check if this channel supports message updates
   */
  supportsUpdates(): boolean;

  /**
   * Health check - verify channel is operational
   */
  healthCheck(): Promise<boolean>;
}
