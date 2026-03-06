/**
 * Feishu Official Plugin Wrapper
 *
 * This plugin wraps the official Feishu OpenClaw plugin functionality
 * and integrates it with Beeclaw's existing Feishu client.
 */

import type { OpenClawPluginApi, PluginRuntime } from '../../src/plugins/types';

export default {
  id: 'feishu-official',
  name: 'Feishu Official Plugin Wrapper',
  version: '1.0.0',
  kind: 'tool' as const,

  /**
   * Register tools and hooks
   */
  register(api: OpenClawPluginApi, runtime: PluginRuntime) {
    runtime.logging.info('[FeishuOfficial] Registering plugin...');

    // ========================================
    // Tool 1: Send Message
    // ========================================
    api.registerTool({
      name: 'feishu_send_message',
      description: 'Send a text message to a Feishu chat',
      parameters: {
        type: 'object',
        properties: {
          chatId: {
            type: 'string',
            description: 'The chat ID to send message to'
          },
          message: {
            type: 'string',
            description: 'The message content to send'
          },
          messageType: {
            type: 'string',
            enum: ['text', 'post'],
            description: 'Type of message (text or post/markdown)',
            default: 'text'
          }
        },
        required: ['chatId', 'message']
      },
      execute: async (params: any) => {
        runtime.logging.info(`[FeishuOfficial] Sending message to ${params.chatId}`);

        try {
          // Import Beeclaw's Feishu client
          const { getFeishuWSClient } = await import('../../feishu');
          const client = getFeishuWSClient();

          if (!client) {
            return {
              success: false,
              error: 'Feishu client not initialized. Check your configuration.'
            };
          }

          // Send message based on type
          if (params.messageType === 'post') {
            await client.sendPostMessage(params.chatId, 'chat_id', params.message);
          } else {
            await client.sendTextMessage(params.chatId, 'chat_id', params.message);
          }

          runtime.logging.info('[FeishuOfficial] Message sent successfully');

          return {
            success: true,
            message: 'Message sent successfully'
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          runtime.logging.error('[FeishuOfficial] Failed to send message:', errorMsg);

          return {
            success: false,
            error: errorMsg
          };
        }
      }
    });

    // ========================================
    // Tool 2: Send Card Message
    // ========================================
    api.registerTool({
      name: 'feishu_send_card',
      description: 'Send an interactive card message to Feishu',
      parameters: {
        type: 'object',
        properties: {
          chatId: {
            type: 'string',
            description: 'The chat ID to send card to'
          },
          card: {
            type: 'object',
            description: 'Card message content (JSON format)'
          },
          title: {
            type: 'string',
            description: 'Card title (optional)'
          }
        },
        required: ['chatId', 'card']
      },
      execute: async (params: any) => {
        runtime.logging.info(`[FeishuOfficial] Sending card to ${params.chatId}`);

        try {
          const { getFeishuWSClient } = await import('../../feishu');
          const client = getFeishuWSClient();

          if (!client) {
            return { success: false, error: 'Feishu client not initialized' };
          }

          await client.sendPostMessage(params.chatId, 'chat_id', params.card, {
            title: params.title
          });

          return { success: true, message: 'Card sent successfully' };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      }
    });

    // ========================================
    // Tool 3: Batch Send Messages
    // ========================================
    api.registerTool({
      name: 'feishu_batch_send',
      description: 'Send the same message to multiple Feishu chats',
      parameters: {
        type: 'object',
        properties: {
          chatIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of chat IDs to send to'
          },
          message: {
            type: 'string',
            description: 'Message content to send'
          }
        },
        required: ['chatIds', 'message']
      },
      execute: async (params: any) => {
        runtime.logging.info(`[FeishuOfficial] Batch sending to ${params.chatIds.length} chats`);

        const { getFeishuWSClient } = await import('../../feishu');
        const client = getFeishuWSClient();

        if (!client) {
          return { success: false, error: 'Feishu client not initialized' };
        }

        const results = [];

        for (const chatId of params.chatIds) {
          try {
            await client.sendTextMessage(chatId, 'chat_id', params.message);
            results.push({ chatId, success: true });
          } catch (error) {
            results.push({
              chatId,
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }

        const successCount = results.filter(r => r.success).length;

        return {
          success: true,
          sent: successCount,
          failed: results.length - successCount,
          results
        };
      }
    });

    // ========================================
    // Hook: Message Received
    // ========================================
    api.on('message_received', async (event) => {
      // Track message statistics
      const stats = runtime.state.get('feishu_stats') || {
        totalMessages: 0,
        lastMessageTime: null
      };

      stats.totalMessages++;
      stats.lastMessageTime = event.timestamp;

      runtime.state.set('feishu_stats', stats);

      runtime.logging.info('[FeishuOfficial] Message received:', {
        total: stats.totalMessages,
        time: event.timestamp
      });
    });

    // ========================================
    // Hook: Tool Call Tracking
    // ========================================
    api.on('before_tool_call', async (event) => {
      // Track Feishu tool usage
      if (event.toolName.startsWith('feishu_')) {
        const usage = runtime.state.get('feishu_tool_usage') || {};
        usage[event.toolName] = (usage[event.toolName] || 0) + 1;
        runtime.state.set('feishu_tool_usage', usage);

        runtime.logging.info(`[FeishuOfficial] Tool called: ${event.toolName}`);
      }
    });

    api.on('after_tool_call', async (event) => {
      // Track tool success/failure
      if (event.toolName.startsWith('feishu_')) {
        const result = event.result as { success: boolean };

        const errors = runtime.state.get('feishu_errors') || [];

        if (!result.success) {
          errors.push({
            tool: event.toolName,
            error: result.error,
            timestamp: event.timestamp
          });

          // Keep only last 100 errors
          if (errors.length > 100) {
            errors.shift();
          }

          runtime.state.set('feishu_errors', errors);

          runtime.logging.warn(`[FeishuOfficial] Tool failed: ${event.toolName}`, result.error);
        }
      }
    });

    // ========================================
    // Hook: Session Tracking
    // ========================================
    api.on('session_start', async (event) => {
      if (event.channel === 'feishu') {
        runtime.state.set(`feishu_session_${event.sessionId}`, {
          startTime: Date.now(),
          userId: event.userId,
          messageCount: 0
        });

        runtime.logging.info(`[FeishuOfficial] Session started: ${event.sessionId}`);
      }
    });

    api.on('session_end', async (event) => {
      if (event.channel === 'feishu') {
        const sessionData = runtime.state.get(`feishu_session_${event.sessionId}`);

        if (sessionData) {
          const duration = Date.now() - sessionData.startTime;

          runtime.logging.info(`[FeishuOfficial] Session ended:`, {
            sessionId: event.sessionId,
            duration: `${Math.round(duration / 1000)}s`,
            messages: event.messageCount
          });

          // Clean up session state
          runtime.state.delete(`feishu_session_${event.sessionId}`);
        }
      }
    });

    // ========================================
    // Hook: Agent End - Summary
    // ========================================
    api.on('agent_end', async (event) => {
      // Check if there were any Feishu tool errors
      const errors = runtime.state.get('feishu_errors') || [];
      const recentErrors = errors.filter((e: any) => {
        const errorTime = new Date(e.timestamp).getTime();
        return Date.now() - errorTime < 60000; // Last minute
      });

      if (recentErrors.length > 0) {
        runtime.logging.warn(`[FeishuOfficial] Agent ended with ${recentErrors.length} recent Feishu errors`);
      }

      // Log tool usage summary
      const usage = runtime.state.get('feishu_tool_usage') || {};
      const totalUsage = Object.values(usage).reduce((sum: number, count: any) => sum + count, 0);

      if (totalUsage > 0) {
        runtime.logging.info(`[FeishuOfficial] Tool usage summary:`, usage);
      }
    });

    runtime.logging.info('[FeishuOfficial] Plugin registered successfully');
    runtime.logging.info('[FeishuOfficial] Available tools: feishu_send_message, feishu_send_card, feishu_batch_send');
  },

  /**
   * Plugin activation
   */
  activate() {
    console.log('[FeishuOfficial] 🚀 Plugin activated');
    console.log('[FeishuOfficial] This plugin wraps Beeclaw\'s Feishu client with OpenClaw plugin interface');
  },

  /**
   * Plugin deactivation
   */
  deactivate() {
    console.log('[FeishuOfficial] 👋 Plugin deactivated');
  }
};
