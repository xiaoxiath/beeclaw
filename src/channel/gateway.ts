/**
 * MultiChannelMessageGateway - Routes messages to appropriate channels
 * RFC-01: MessageChannel/Gateway abstraction
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

/**
 * MultiChannelMessageGateway - Central routing for all message channels
 *
 * This class provides a unified interface for sending messages across
 * different platforms (CLI, Feishu, Slack, etc.).
 *
 * Usage:
 *   const gateway = getMessageGateway();
 *   gateway.registerChannel(new CLIChannel());
 *   gateway.registerChannel(new FeishuChannel());
 *
 *   await gateway.replyMessage('feishu', options, content);
 */
export class MultiChannelMessageGateway {
  private channels: Map<ChannelType, MessageChannel> = new Map();

  /**
   * Register a channel with the gateway
   */
  registerChannel(channel: MessageChannel): void {
    this.channels.set(channel.type, channel);
    console.log(`[Gateway] Registered channel: ${channel.type}`);
  }

  /**
   * Unregister a channel from the gateway
   */
  unregisterChannel(channelType: ChannelType): void {
    this.channels.delete(channelType);
    console.log(`[Gateway] Unregistered channel: ${channelType}`);
  }

  /**
   * Get a registered channel by type
   */
  getChannel(channelType: ChannelType): MessageChannel | undefined {
    return this.channels.get(channelType);
  }

  /**
   * Post a message to a specific channel
   */
  async postMessage(
    channelType: ChannelType,
    content: MessageContent,
    options?: PostMessageOptions
  ): Promise<MessageResult> {
    const channel = this.channels.get(channelType);
    if (!channel) {
      return {
        messageId: '',
        success: false,
        error: `Channel not found: ${channelType}`,
      };
    }

    return channel.postMessage(content, options);
  }

  /**
   * Reply to a message on a specific channel
   */
  async replyMessage(
    channelType: ChannelType,
    options: ReplyMessageOptions,
    content: MessageContent
  ): Promise<MessageResult> {
    const channel = this.channels.get(channelType);
    if (!channel) {
      return {
        messageId: '',
        success: false,
        error: `Channel not found: ${channelType}`,
      };
    }

    return channel.replyMessage(options, content);
  }

  /**
   * Update a message on a specific channel (if supported)
   */
  async updateMessageContent(
    channelType: ChannelType,
    options: UpdateMessageOptions
  ): Promise<void> {
    const channel = this.channels.get(channelType);
    if (!channel) {
      throw new Error(`Channel not found: ${channelType}`);
    }

    if (!channel.supportsUpdates() || !channel.updateMessageContent) {
      throw new Error(`Channel ${channelType} does not support message updates`);
    }

    return channel.updateMessageContent(options);
  }

  /**
   * Check health of all registered channels
   */
  async healthCheckAll(): Promise<Record<ChannelType, boolean>> {
    const results: Record<ChannelType, boolean> = {} as any;

    for (const [type, channel] of this.channels) {
      try {
        results[type] = await channel.healthCheck();
      } catch {
        results[type] = false;
      }
    }

    return results;
  }

  /**
   * Get list of registered channel types
   */
  getRegisteredChannels(): ChannelType[] {
    return Array.from(this.channels.keys());
  }
}

// Singleton instance
let _gateway: MultiChannelMessageGateway | null = null;

/**
 * Get the singleton gateway instance
 */
export function getMessageGateway(): MultiChannelMessageGateway {
  if (!_gateway) {
    _gateway = new MultiChannelMessageGateway();
  }
  return _gateway;
}

/**
 * Reset the gateway (for testing)
 */
export function resetMessageGateway(): void {
  _gateway = null;
}
