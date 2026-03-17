/**
 * Streaming Message Controller
 *
 * Manages streaming message lifecycle with debounced updates.
 * Uses message.patch API for real-time card updates.
 */

import type { ContentBlock } from '../../../types/content-block';
import { renderMessageCard } from './message-renderer';
import type { FeishuWSClient } from '../ws-client';

/**
 * StreamingController options
 */
export interface StreamingControllerOptions {
  /**
   * Feishu API client
   */
  client: FeishuWSClient;

  /**
   * Parent message ID (to reply to)
   */
  parentMessageId: string;

  /**
   * Chat ID
   */
  chatId: string;

  /**
   * Debounce interval in milliseconds
   * @default 500
   */
  debounceMs?: number;

  /**
   * Reply in thread
   */
  replyInThread?: boolean;
}

/**
 * Streaming message state
 */
interface StreamingState {
  /**
   * Message ID of the card
   */
  messageId?: string;

  /**
   * Content blocks accumulated
   */
  blocks: ContentBlock[];

  /**
   * Whether streaming is finished
   */
  finished: boolean;

  /**
   * Last update timestamp
   */
  lastUpdate: number;

  /**
   * Pending update timer
   */
  updateTimer?: Timer;

  /**
   * Initial message sent
   */
  initialized: boolean;

  /**
   * Pending initialization promise (prevents race conditions)
   */
  initPromise?: Promise<void>;
}

/**
 * Streaming Message Controller
 * Manages real-time card updates with debouncing
 */
export class StreamingMessageController {
  private options: StreamingControllerOptions;
  private state: StreamingState;
  private debounceMs: number;

  constructor(options: StreamingControllerOptions) {
    this.options = options;
    this.debounceMs = options.debounceMs ?? 500;

    this.state = {
      blocks: [],
      finished: false,
      lastUpdate: 0,
      initialized: false,
    };
  }

  /**
   * Push a new content block
   * Debounces updates to avoid API spam
   */
  async pushContent(block: ContentBlock): Promise<void> {
    // Add block to state
    this.state.blocks.push(block);

    // Send initial message if not done
    if (!this.state.initialized) {
      // If initialization is already in progress, wait for it
      if (this.state.initPromise) {
        await this.state.initPromise;
        // After waiting, schedule update for this new block
        this.scheduleUpdate();
        return;
      }

      // Start initialization and store promise
      this.state.initPromise = this.sendInitialMessage();
      await this.state.initPromise;
      return;
    }

    // Debounce subsequent updates
    this.scheduleUpdate();
  }

  /**
   * Finish streaming
   * Sends final update with collapsed panels
   */
  async finish(): Promise<void> {
    this.state.finished = true;

    // Clear any pending timer
    if (this.state.updateTimer) {
      clearTimeout(this.state.updateTimer);
      this.state.updateTimer = undefined;
    }

    // Send final update immediately
    await this.sendUpdate(true);
  }

  /**
   * Send initial card message
   */
  private async sendInitialMessage(): Promise<void> {
    try {
      // Render initial card
      const card = renderMessageCard(this.state.blocks, { streaming: true });

      // Debug: Log the full card JSON
      console.log('[StreamingController] 📤 Card JSON:', JSON.stringify(card, null, 2));

      // Send message
      const messageId = await this.options.client.replyCard(
        this.options.parentMessageId,
        card,
        { replyInThread: this.options.replyInThread }
      );

      this.state.messageId = messageId;
      this.state.initialized = true;
      this.state.lastUpdate = Date.now();
    } catch (error) {
      console.error('[StreamingController] Failed to send initial card message:', error);
      throw error;
    }
  }

  /**
   * Schedule debounced update
   */
  private scheduleUpdate(): void {
    // Clear existing timer
    if (this.state.updateTimer) {
      clearTimeout(this.state.updateTimer);
    }

    // Schedule new update
    this.state.updateTimer = setTimeout(() => {
      this.sendUpdate(false);
    }, this.debounceMs) as any;
  }

  /**
   * Send card update via message.patch
   */
  private async sendUpdate(isFinal: boolean): Promise<void> {
    if (!this.state.messageId) {
      // This can happen if:
      // 1. Initial message failed to send
      // 2. Update was scheduled before initialization completed
      // 3. Message was withdrawn before update
      console.debug('[StreamingController] Skipping update: no message ID (initialization may still be in progress or failed)');
      return;
    }

    try {
      // Render updated card
      const card = renderMessageCard(this.state.blocks, {
        streaming: !isFinal, // Collapse panels on final update
      });

      // Patch message
      await this.options.client.patchCard(this.state.messageId, card);

      this.state.lastUpdate = Date.now();
    } catch (error: any) {
      // Handle specific errors
      if (this.isMessageRevokedError(error)) {
        console.warn('Message was revoked, stopping updates');
        this.state.finished = true;
        return;
      }

      console.error('Failed to update card:', error);
      // Don't throw - allow retry on next update
    }
  }

  /**
   * Check if error is message revoked error
   * Feishu error codes: 230011, 231003
   */
  private isMessageRevokedError(error: any): boolean {
    const code = error?.code || error?.data?.code;
    return code === 230011 || code === 231003;
  }

  /**
   * Get current blocks (for debugging)
   */
  getBlocks(): ContentBlock[] {
    return [...this.state.blocks];
  }

  /**
   * Check if streaming is finished
   */
  isFinished(): boolean {
    return this.state.finished;
  }

  /**
   * Get message ID
   */
  getMessageId(): string | undefined {
    return this.state.messageId;
  }
}
