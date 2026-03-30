/**
 * Feishu Mention System
 *
 * Handle @mentions in messages
 */

import { getLogger } from '../../infra/observability/logger';

const logger = getLogger('feishu:mention');

/**
 * Extract mention targets from message event
 */
export function extractMentionTargets(
  event: FeishuMessageEvent
): MentionTarget[] {
  const targets: MentionTarget[] = [];
  const mentions = event.message?.mentions;

  if (!mentions || !Array.isArray(mentions)) {
    return targets;
  }

  for (const mention of mentions) {
    if (mention.type === 'user' && mention.id && mention.key !== 'bot') {
      targets.push({
        openId: mention.id,
        name: mention.name,
        key: mention.key,
      });
    }
  }

  logger.debug(`Extracted ${targets.length} mention targets`);
  return targets;
}

/**
 * Check if this is a mention-forward request
 * (bot mentioned together with other users)
 */
export function isMentionForwardRequest(
  event: FeishuMessageEvent,
  botOpenId: string
): boolean {
  const targets = extractMentionTargets(event);
  const hasBot = targets.some(t => t.openId === botOpenId);
  const hasOtherUsers = targets.some(t => t.openId !== botOpenId);

  return hasBot && hasOtherUsers;
}

/**
 * Extract message body without mention placeholders
 */
export function extractMessageBody(
  event: FeishuMessageEvent
): string {
  const content = event.message?.content;
  if (!content) return '';

  try {
    // Parse post message
    if (event.message?.message_type === 'post') {
      const postContent = JSON.parse(content);
      const textSegments: string[] = [];

      if (postContent.zh_cn?.content) {
        for (const paragraph of postContent.zh_cn.content) {
          for (const element of paragraph) {
            if (element.tag === 'text' && element.text) {
              textSegments.push(element.text);
            } else if (element.tag === 'at') {
              // Skip @mentions
              continue;
            }
          }
          textSegments.push('\n');
        }
      }

      return textSegments.join('').trim();
    }

    // Parse text message
    if (event.message?.message_type === 'text') {
      const textContent = JSON.parse(content);
      let text = textContent.text || '';

      // Remove @placeholders
      text = text.replace(/<_at.*?>.*?<\/_at>/g, '').trim();

      return text;
    }

    return content;
  } catch (error) {
    logger.error('Failed to extract message body:', error);
    return content || '';
  }
}

/**
 * Format mention for text message
 */
export function formatMentionForText(
  openId: string,
  name?: string
): string {
  return `<at user_id="${openId}">${name || ''}</at>`;
}

/**
 * Format mention for card message
 */
export function formatMentionForCard(
  openId: string
): string {
  return `<at id="${openId}"></at>`;
}

/**
 * Format @all mention for text
 */
export function formatMentionAllForText(): string {
  return `<at user_id="all">所有人</at>`;
}

/**
 * Format @all mention for card
 */
export function formatMentionAllForCard(): string {
  return `<at id="all"></at>`;
}

/**
 * Build mentioned message with @mentions
 */
export function buildMentionedMessage(
  content: string,
  mentionTargets?: MentionTarget[],
  options?: {
    prefix?: string;
    suffix?: string;
  }
): string {
  if (!mentionTargets || mentionTargets.length === 0) {
    return content;
  }

  const mentions = mentionTargets
    .map(t => formatMentionForText(t.openId, t.name))
    .join(' ');

  const parts: string[] = [];

  if (options?.prefix) {
    parts.push(options.prefix);
  }

  parts.push(mentions);
  parts.push(content);

  if (options?.suffix) {
    parts.push(options.suffix);
  }

  return parts.join(' ');
}

/**
 * Build card content with @mentions
 */
export function buildMentionedCardContent(
  content: string,
  mentionTargets?: MentionTarget[],
  options?: {
    title?: string;
  }
): string {
  const parts: string[] = [];

  if (options?.title) {
    parts.push(`**${options.title}**\n`);
  }

  if (mentionTargets && mentionTargets.length > 0) {
    const mentions = mentionTargets
      .map(t => formatMentionForCard(t.openId))
      .join(' ');
    parts.push(mentions);
    parts.push('\n');
  }

  parts.push(content);

  return parts.join('');
}

/**
 * Parse mention from text
 */
export function parseMentionsFromText(
  text: string
): Array<{ openId: string; name?: string }> {
  const mentions: Array<{ openId: string; name?: string }> = [];
  const regex = /<at user_id="([^"]+)">(.*?)<\/at>/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    mentions.push({
      openId: match[1],
      name: match[2] || undefined,
    });
  }

  return mentions;
}

/**
 * Parse mention from card content
 */
export function parseMentionsFromCard(
  content: string
): Array<{ openId: string }> {
  const mentions: Array<{ openId: string }> = [];
  const regex = /<at id="([^"]+)"><\/at>/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    mentions.push({
      openId: match[1],
    });
  }

  return mentions;
}

/**
 * Remove mention placeholders from text
 */
export function stripMentions(text: string): string {
  return text
    .replace(/<at user_id="[^"]+">.*?<\/at>/g, '')
    .replace(/<at id="[^"]+"><\/at>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================
// Types
// ============================================================

export interface MentionTarget {
  openId: string;
  name?: string;
  key?: string;
}

export interface FeishuMessageEvent {
  message?: {
    message_id?: string;
    root_id?: string;
    parent_id?: string;
    chat_id?: string;
    message_type?: string;
    content?: string;
    create_time?: string;
    mentions?: Array<{
      type: string;
      id: string;
      key: string;
      name?: string;
    }>;
    sender?: {
      sender_type?: string;
      sender_id?: {
        open_id?: string;
        user_id?: string;
        union_id?: string;
      };
    };
  };
  sender?: {
    sender_type?: string;
    sender_id?: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
  };
}
