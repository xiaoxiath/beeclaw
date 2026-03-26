/**
 * Web Channel - HTTP/SSE-based messaging for Web UI
 * RFC-01: MessageChannel implementation
 *
 * Routes messages back to connected web clients via an in-memory
 * event bus. The chat route (`server/routes/chat.ts`) subscribes to
 * this bus and streams responses through SSE.
 */

import { logger } from '../../infra/observability/logger';
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
 * Listener callback registered by SSE routes to receive outbound messages.
 */
export type WebMessageListener = (event: WebMessageEvent) => void;

export interface WebMessageEvent {
  type: 'post' | 'reply' | 'update';
  content: MessageContent;
  sessionId?: string;
  messageId: string;
  parentMessageId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * WebChannel - delivers messages to web clients through an event bus.
 *
 * Usage:
 *   const channel = new WebChannel();
 *   gateway.registerChannel(channel);
 *
 *   // In an SSE handler:
 *   channel.addListener(sessionId, (event) => stream.writeSSE(...));
 */
export class WebChannel implements MessageChannel {
  readonly type: ChannelType = 'web' as ChannelType;

  /** sessionId -> Set<listener> */
  private listeners: Map<string, Set<WebMessageListener>> = new Map();

  // ---------- MessageChannel interface ----------

  async postMessage(
    content: MessageContent,
    options?: PostMessageOptions
  ): Promise<MessageResult> {
    const messageId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sessionId = options?.sessionId;

    try {
      const event: WebMessageEvent = {
        type: 'post',
        content,
        sessionId,
        messageId,
        metadata: options?.metadata,
      };

      this.emit(sessionId, event);

      logger.debug(`[WebChannel] postMessage id=${messageId} session=${sessionId ?? 'broadcast'}`);

      return { messageId, success: true };
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
    const messageId = `web-reply-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      const event: WebMessageEvent = {
        type: 'reply',
        content,
        sessionId: options.sessionId,
        messageId,
        parentMessageId: options.parentMessageId,
        metadata: options.metadata,
      };

      this.emit(options.sessionId, event);

      logger.debug(
        `[WebChannel] replyMessage id=${messageId} session=${options.sessionId} parent=${options.parentMessageId ?? 'none'}`
      );

      return { messageId, success: true };
    } catch (error) {
      return {
        messageId: '',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async updateMessageContent(options: UpdateMessageOptions): Promise<void> {
    // Web clients can receive update events to patch existing messages
    // (e.g. streaming token-by-token updates via SSE).
    const event: WebMessageEvent = {
      type: 'update',
      content: '', // content comes from the caller's streaming handler
      sessionId: options.sessionId,
      messageId: options.messageId,
    };

    this.emit(options.sessionId, event);

    logger.debug(
      `[WebChannel] updateMessageContent id=${options.messageId} session=${options.sessionId}`
    );
  }

  supportsUpdates(): boolean {
    // Web UI supports live updates via SSE streaming
    return true;
  }

  async healthCheck(): Promise<boolean> {
    // The web channel is always available as long as the server is running
    return true;
  }

  // ---------- Event bus for SSE routes ----------

  /**
   * Register a listener for a specific session (or '*' for all sessions).
   * Returns a cleanup function to remove the listener.
   */
  addListener(sessionId: string, listener: WebMessageListener): () => void {
    if (!this.listeners.has(sessionId)) {
      this.listeners.set(sessionId, new Set());
    }
    this.listeners.get(sessionId)!.add(listener);

    return () => {
      const set = this.listeners.get(sessionId);
      if (set) {
        set.delete(listener);
        if (set.size === 0) {
          this.listeners.delete(sessionId);
        }
      }
    };
  }

  /**
   * Number of active listener sessions (useful for status/health endpoints).
   */
  get activeListenerCount(): number {
    let count = 0;
    for (const set of this.listeners.values()) {
      count += set.size;
    }
    return count;
  }

  // ---------- Internal helpers ----------

  private emit(sessionId: string | undefined, event: WebMessageEvent): void {
    // Emit to session-specific listeners
    if (sessionId) {
      const sessionListeners = this.listeners.get(sessionId);
      if (sessionListeners) {
        for (const listener of sessionListeners) {
          try {
            listener(event);
          } catch (err) {
            logger.error(`[WebChannel] Listener error for session ${sessionId}:`, err);
          }
        }
      }
    }

    // Also emit to wildcard listeners
    const wildcardListeners = this.listeners.get('*');
    if (wildcardListeners) {
      for (const listener of wildcardListeners) {
        try {
          listener(event);
        } catch (err) {
          logger.error('[WebChannel] Wildcard listener error:', err);
        }
      }
    }
  }
}

// ---------- Singleton ----------

let _webChannel: WebChannel | null = null;

/**
 * Get the singleton WebChannel instance.
 */
export function getWebChannel(): WebChannel {
  if (!_webChannel) {
    _webChannel = new WebChannel();
  }
  return _webChannel;
}

/**
 * Reset the singleton (for testing).
 */
export function resetWebChannel(): void {
  _webChannel = null;
}
