/**
 * Feishu Message Sending
 *
 * Handles sending various types of messages to Feishu
 */

import type { Client } from '@larksuiteoapi/node-sdk';
import { getLogger } from '../utils/logger';

const logger = getLogger('feishu:send');

/**
 * Send text message to Feishu
 */
export async function sendTextMessage(
  client: Client,
  receiveId: string,
  receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'chat_id',
  text: string
): Promise<{ messageId: string }> {
  try {
    const response = await client.im.message.create({
      params: {
        receive_id_type: receiveIdType,
      },
      data: {
        receive_id: receiveId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to send message: ${response.msg}`);
    }

    logger.info(`✅ Message sent: ${response.data?.message_id}`);
    return { messageId: response.data?.message_id || '' };
  } catch (error) {
    logger.error('Failed to send text message:', error);
    throw error;
  }
}

/**
 * Send post message (rich text) to Feishu
 */
export async function sendPostMessage(
  client: Client,
  receiveId: string,
  receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'chat_id',
  content: string,
  options?: {
    title?: string;
    mentionTargets?: MentionTarget[];
  }
): Promise<{ messageId: string }> {
  try {
    // Build post content with mentions
    const postContent = buildPostContent(content, options?.mentionTargets);

    const response = await client.im.message.create({
      params: {
        receive_id_type: receiveIdType,
      },
      data: {
        receive_id: receiveId,
        msg_type: 'post',
        content: JSON.stringify({
          zh_cn: {
            title: options?.title || '',
            content: postContent,
          },
        }),
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to send post message: ${response.msg}`);
    }

    logger.info(`✅ Post message sent: ${response.data?.message_id}`);
    return { messageId: response.data?.message_id || '' };
  } catch (error) {
    logger.error('Failed to send post message:', error);
    throw error;
  }
}

/**
 * Send interactive card message
 */
export async function sendCardMessage(
  client: Client,
  receiveId: string,
  receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'chat_id',
  card: FeishuCard
): Promise<{ messageId: string }> {
  try {
    const response = await client.im.message.create({
      params: {
        receive_id_type: receiveIdType,
      },
      data: {
        receive_id: receiveId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to send card message: ${response.msg}`);
    }

    logger.info(`✅ Card message sent: ${response.data?.message_id}`);
    return { messageId: response.data?.message_id || '' };
  } catch (error) {
    logger.error('Failed to send card message:', error);
    throw error;
  }
}

/**
 * Send markdown card message (Schema 2.0)
 */
export async function sendMarkdownCard(
  client: Client,
  receiveId: string,
  receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'chat_id',
  markdown: string,
  options?: {
    title?: string;
    mentionTargets?: MentionTarget[];
  }
): Promise<{ messageId: string }> {
  try {
    const card = buildMarkdownCard(markdown, options);
    return await sendCardMessage(client, receiveId, receiveIdType, card);
  } catch (error) {
    logger.error('Failed to send markdown card:', error);
    throw error;
  }
}

/**
 * Edit existing message
 */
export async function editMessage(
  client: Client,
  messageId: string,
  content: string,
  msgType: 'text' | 'post' = 'text'
): Promise<void> {
  try {
    const response = await client.im.message.patch({
      path: {
        message_id: messageId,
      },
      params: {},
      data: {
        msg_type: msgType,
        content: msgType === 'text'
          ? JSON.stringify({ text: content })
          : JSON.stringify({
              zh_cn: {
                content: [[{ tag: 'text', text: content }]],
              },
            }),
      },
    });

    if (response.code !== 0) {
      // Check if message was withdrawn (error codes 230011, 231003)
      if (response.code === 230011 || response.code === 231003) {
        logger.warn(`Message ${messageId} was withdrawn or not found`);
        throw new Error('MESSAGE_WITHDRAWN');
      }
      throw new Error(`Failed to edit message: ${response.msg}`);
    }

    logger.info(`✅ Message edited: ${messageId}`);
  } catch (error) {
    logger.error('Failed to edit message:', error);
    throw error;
  }
}

/**
 * Reply to message
 */
export async function replyMessage(
  client: Client,
  messageId: string,
  content: string,
  msgType: 'text' | 'post' | 'interactive' = 'text',
  options?: {
    mentionTargets?: MentionTarget[];
    card?: FeishuCard;
  }
): Promise<{ messageId: string }> {
  try {
    let messageContent: string;

    if (msgType === 'text') {
      messageContent = JSON.stringify({ text: content });
    } else if (msgType === 'post') {
      const postContent = buildPostContent(content, options?.mentionTargets);
      messageContent = JSON.stringify({
        zh_cn: {
          content: postContent,
        },
      });
    } else if (msgType === 'interactive' && options?.card) {
      messageContent = JSON.stringify(options.card);
    } else {
      throw new Error('Invalid message type or missing card');
    }

    const response = await client.im.message.reply({
      path: {
        message_id: messageId,
      },
      params: {},
      data: {
        msg_type: msgType,
        content: messageContent,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to reply to message: ${response.msg}`);
    }

    logger.info(`✅ Reply sent: ${response.data?.message_id}`);
    return { messageId: response.data?.message_id || '' };
  } catch (error) {
    logger.error('Failed to reply to message:', error);
    throw error;
  }
}

/**
 * Get message by ID
 */
export async function getMessage(
  client: Client,
  messageId: string
): Promise<FeishuMessage> {
  try {
    const response = await client.im.message.get({
      path: {
        message_id: messageId,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to get message: ${response.msg}`);
    }

    return response.data as FeishuMessage;
  } catch (error) {
    logger.error('Failed to get message:', error);
    throw error;
  }
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Build post content from text with mentions
 */
function buildPostContent(
  text: string,
  mentionTargets?: MentionTarget[]
): Array<Array<PostContentElement>> {
  const elements: Array<PostContentElement> = [];

  if (mentionTargets && mentionTargets.length > 0) {
    // Add mentions at the beginning
    for (const target of mentionTargets) {
      elements.push({
        tag: 'at',
        user_id: target.openId,
      });
    }
    elements.push({
      tag: 'text',
      text: ' ',
    });
  }

  // Convert markdown to post elements
  const lines = text.split('\n');
  for (const line of lines) {
    // Simple markdown conversion (can be enhanced)
    if (line.startsWith('**') && line.endsWith('**')) {
      // Bold text
      elements.push({
        tag: 'text',
        text: line.slice(2, -2),
        style: ['bold'],
      });
    } else if (line.startsWith('`') && line.endsWith('`')) {
      // Inline code
      elements.push({
        tag: 'text',
        text: line.slice(1, -1),
        style: ['code'],
      });
    } else {
      // Regular text
      elements.push({
        tag: 'text',
        text: line,
      });
    }
    elements.push({
      tag: 'text',
      text: '\n',
    });
  }

  return [elements];
}

/**
 * Build markdown card (Schema 2.0)
 */
function buildMarkdownCard(
  markdown: string,
  options?: {
    title?: string;
    mentionTargets?: MentionTarget[];
  }
): FeishuCard {
  const elements: CardElement[] = [];

  // Add title if provided
  if (options?.title) {
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**${options.title}**`,
      },
    });
  }

  // Add mentions if provided
  if (options?.mentionTargets && options.mentionTargets.length > 0) {
    const mentionText = options.mentionTargets
      .map(t => `<at id="${t.openId}"></at>`)
      .join(' ');
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: mentionText,
      },
    });
  }

  // Add markdown content
  elements.push({
    tag: 'markdown',
    content: markdown,
  });

  return {
    type: 'template',
    data: {
      template_id: 'AAqkQM2eSAKme',
      template_variable: {
        title: options?.title || '',
        content: markdown,
      },
    },
  };
}

// ============================================================
// Types
// ============================================================

export interface MentionTarget {
  openId: string;
  name?: string;
}

export interface PostContentElement {
  tag: 'text' | 'at' | 'a' | 'img';
  text?: string;
  user_id?: string;
  href?: string;
  image_key?: string;
  style?: string[];
}

export interface FeishuCard {
  type: 'template' | 'interactive';
  data?: {
    template_id: string;
    template_variable: Record<string, unknown>;
  };
  config?: {
    wide_screen_mode?: boolean;
    enable_forward?: boolean;
  };
  elements?: CardElement[];
}

export interface CardElement {
  tag: 'div' | 'markdown' | 'note' | 'hr' | 'action';
  text?: {
    tag: 'plain_text' | 'lark_md';
    content: string;
  };
  content?: string;
  actions?: CardAction[];
}

export interface CardAction {
  tag: 'button';
  text: {
    tag: 'plain_text';
    content: string;
  };
  type: 'primary' | 'default' | 'danger';
  value: Record<string, unknown>;
}

export interface FeishuMessage {
  message_id: string;
  root_id?: string;
  parent_id?: string;
  chat_id: string;
  msg_type: string;
  create_time: string;
  content: string;
  sender: {
    id: string;
    id_type: string;
    sender_type: string;
  };
}
