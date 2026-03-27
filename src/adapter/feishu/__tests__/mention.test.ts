/**
 * Tests for mention.ts
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../infra/observability/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(() => {}),
    info: vi.fn(() => {}),
    warn: vi.fn(() => {}),
    error: vi.fn(() => {}),
  }),
}));

import {
  extractMentionTargets,
  isMentionForwardRequest,
  extractMessageBody,
  formatMentionForText,
  formatMentionForCard,
  formatMentionAllForText,
  formatMentionAllForCard,
  buildMentionedMessage,
  buildMentionedCardContent,
  parseMentionsFromText,
  parseMentionsFromCard,
  stripMentions,
} from '../mention';
import type { FeishuMessageEvent } from '../mention';

describe('mention', () => {
  // ===================== extractMentionTargets =====================
  describe('extractMentionTargets', () => {
    it('returns empty array for no mentions', () => {
      const event: FeishuMessageEvent = { message: { mentions: [] } };
      expect(extractMentionTargets(event)).toEqual([]);
    });

    it('returns empty array when mentions is undefined', () => {
      const event: FeishuMessageEvent = { message: {} };
      expect(extractMentionTargets(event)).toEqual([]);
    });

    it('returns empty array when message is undefined', () => {
      const event: FeishuMessageEvent = {};
      expect(extractMentionTargets(event)).toEqual([]);
    });

    it('extracts user mentions, skipping bots', () => {
      const event: FeishuMessageEvent = {
        message: {
          mentions: [
            { type: 'user', id: 'ou_user1', key: 'user1', name: 'Alice' },
            { type: 'user', id: 'ou_bot', key: 'bot', name: 'Bot' },
            { type: 'user', id: 'ou_user2', key: 'user2', name: 'Bob' },
            { type: 'group', id: 'og_group', key: 'grp' },
          ],
        },
      };
      const targets = extractMentionTargets(event);
      expect(targets).toHaveLength(2);
      expect(targets[0].openId).toBe('ou_user1');
      expect(targets[1].openId).toBe('ou_user2');
    });

    it('skips mentions without id', () => {
      const event: FeishuMessageEvent = {
        message: {
          mentions: [
            { type: 'user', id: '', key: 'user1', name: 'Alice' },
          ],
        },
      };
      expect(extractMentionTargets(event)).toEqual([]);
    });
  });

  // ===================== isMentionForwardRequest =====================
  describe('isMentionForwardRequest', () => {
    it('returns true when bot + other users mentioned', () => {
      const event: FeishuMessageEvent = {
        message: {
          mentions: [
            { type: 'user', id: 'ou_bot', key: 'user_bot', name: 'Bot' },
            { type: 'user', id: 'ou_user', key: 'user', name: 'Alice' },
          ],
        },
      };
      expect(isMentionForwardRequest(event, 'ou_bot')).toBe(true);
    });

    it('returns false when only bot mentioned', () => {
      const event: FeishuMessageEvent = {
        message: {
          mentions: [
            { type: 'user', id: 'ou_bot', key: 'user_bot', name: 'Bot' },
          ],
        },
      };
      expect(isMentionForwardRequest(event, 'ou_bot')).toBe(false);
    });

    it('returns false when bot not mentioned', () => {
      const event: FeishuMessageEvent = {
        message: {
          mentions: [
            { type: 'user', id: 'ou_user', key: 'user', name: 'Alice' },
          ],
        },
      };
      expect(isMentionForwardRequest(event, 'ou_bot')).toBe(false);
    });
  });

  // ===================== extractMessageBody =====================
  describe('extractMessageBody', () => {
    it('returns empty string for missing content', () => {
      expect(extractMessageBody({ message: {} })).toBe('');
      expect(extractMessageBody({})).toBe('');
    });

    it('extracts text from text message', () => {
      const event: FeishuMessageEvent = {
        message: {
          message_type: 'text',
          content: JSON.stringify({ text: 'Hello <_at>@bot</_at> world' }),
        },
      };
      expect(extractMessageBody(event)).toBe('Hello  world');
    });

    it('extracts text from post message', () => {
      const event: FeishuMessageEvent = {
        message: {
          message_type: 'post',
          content: JSON.stringify({
            zh_cn: {
              content: [
                [
                  { tag: 'text', text: 'Hello ' },
                  { tag: 'at', user_id: 'ou_123' },
                  { tag: 'text', text: 'world' },
                ],
              ],
            },
          }),
        },
      };
      expect(extractMessageBody(event)).toBe('Hello world');
    });

    it('returns raw content for unknown message type', () => {
      const event: FeishuMessageEvent = {
        message: {
          message_type: 'image',
          content: 'image_key_123',
        },
      };
      expect(extractMessageBody(event)).toBe('image_key_123');
    });

    it('handles malformed JSON gracefully', () => {
      const event: FeishuMessageEvent = {
        message: {
          message_type: 'text',
          content: 'not json',
        },
      };
      expect(extractMessageBody(event)).toBe('not json');
    });
  });

  // ===================== formatMention* =====================
  describe('formatMentionForText', () => {
    it('formats mention with name', () => {
      expect(formatMentionForText('ou_123', 'Alice')).toBe('<at user_id="ou_123">Alice</at>');
    });
    it('formats mention without name', () => {
      expect(formatMentionForText('ou_123')).toBe('<at user_id="ou_123"></at>');
    });
  });

  describe('formatMentionForCard', () => {
    it('formats card mention', () => {
      expect(formatMentionForCard('ou_123')).toBe('<at id="ou_123"></at>');
    });
  });

  describe('formatMentionAllForText', () => {
    it('formats @all for text', () => {
      expect(formatMentionAllForText()).toContain('user_id="all"');
    });
  });

  describe('formatMentionAllForCard', () => {
    it('formats @all for card', () => {
      expect(formatMentionAllForCard()).toContain('id="all"');
    });
  });

  // ===================== buildMentionedMessage =====================
  describe('buildMentionedMessage', () => {
    it('returns content as-is when no mentions', () => {
      expect(buildMentionedMessage('hello')).toBe('hello');
      expect(buildMentionedMessage('hello', [])).toBe('hello');
    });

    it('prepends mentions to content', () => {
      const result = buildMentionedMessage('content', [
        { openId: 'ou_1', name: 'A' },
        { openId: 'ou_2', name: 'B' },
      ]);
      expect(result).toContain('<at user_id="ou_1">A</at>');
      expect(result).toContain('<at user_id="ou_2">B</at>');
      expect(result).toContain('content');
    });

    it('supports prefix and suffix', () => {
      const result = buildMentionedMessage('content', [{ openId: 'ou_1' }], {
        prefix: 'PRE',
        suffix: 'SUF',
      });
      expect(result).toMatch(/^PRE /);
      expect(result).toMatch(/ SUF$/);
    });
  });

  // ===================== buildMentionedCardContent =====================
  describe('buildMentionedCardContent', () => {
    it('returns content only when no mentions/title', () => {
      expect(buildMentionedCardContent('body')).toBe('body');
    });

    it('includes title and mentions', () => {
      const result = buildMentionedCardContent('body', [{ openId: 'ou_1' }], {
        title: 'Title',
      });
      expect(result).toContain('**Title**');
      expect(result).toContain('<at id="ou_1"></at>');
      expect(result).toContain('body');
    });
  });

  // ===================== parseMentionsFromText =====================
  describe('parseMentionsFromText', () => {
    it('parses mentions from text', () => {
      const text = '<at user_id="ou_1">Alice</at> said <at user_id="ou_2">Bob</at>';
      const mentions = parseMentionsFromText(text);
      expect(mentions).toHaveLength(2);
      expect(mentions[0]).toEqual({ openId: 'ou_1', name: 'Alice' });
      expect(mentions[1]).toEqual({ openId: 'ou_2', name: 'Bob' });
    });

    it('returns empty for no mentions', () => {
      expect(parseMentionsFromText('Hello world')).toEqual([]);
    });

    it('handles empty name', () => {
      const text = '<at user_id="ou_1"></at>';
      const mentions = parseMentionsFromText(text);
      expect(mentions).toHaveLength(1);
      expect(mentions[0].name).toBeUndefined();
    });
  });

  // ===================== parseMentionsFromCard =====================
  describe('parseMentionsFromCard', () => {
    it('parses card mentions', () => {
      const content = '<at id="ou_1"></at> <at id="ou_2"></at>';
      const mentions = parseMentionsFromCard(content);
      expect(mentions).toHaveLength(2);
      expect(mentions[0].openId).toBe('ou_1');
    });

    it('returns empty for no mentions', () => {
      expect(parseMentionsFromCard('no mentions')).toEqual([]);
    });
  });

  // ===================== stripMentions =====================
  describe('stripMentions', () => {
    it('strips text mentions', () => {
      const text = 'Hello <at user_id="ou_1">Alice</at> world';
      expect(stripMentions(text)).toBe('Hello world');
    });

    it('strips card mentions', () => {
      const text = 'Hello <at id="ou_1"></at> world';
      expect(stripMentions(text)).toBe('Hello world');
    });

    it('handles mixed mentions', () => {
      const text = '<at user_id="ou_1">A</at> <at id="ou_2"></at> text';
      expect(stripMentions(text)).toBe('text');
    });

    it('handles no mentions', () => {
      expect(stripMentions('Hello world')).toBe('Hello world');
    });
  });
});
