/**
 * Tests for send.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../infra/observability/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(() => {}),
    info: vi.fn(() => {}),
    warn: vi.fn(() => {}),
    error: vi.fn(() => {}),
  }),
}));

import {
  sendTextMessage,
  sendPostMessage,
  sendMarkdownMessage,
  sendCardMessage,
  sendMarkdownCard,
  editMessage,
  replyMessage,
  getMessage,
} from '../send';

function makeClient(overrides: Record<string, any> = {}) {
  return {
    im: {
      message: {
        create: vi.fn(() => Promise.resolve({ code: 0, data: { message_id: 'msg_resp' } })),
        patch: vi.fn(() => Promise.resolve({ code: 0 })),
        reply: vi.fn(() => Promise.resolve({ code: 0, data: { message_id: 'msg_reply' } })),
        get: vi.fn(() => Promise.resolve({ code: 0, data: { message_id: 'msg_get', content: '{}' } })),
      },
    },
    ...overrides,
  } as any;
}

describe('send', () => {
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    client = makeClient();
  });

  // ===================== sendTextMessage =====================
  describe('sendTextMessage', () => {
    it('sends text message and returns messageId', async () => {
      const result = await sendTextMessage(client, 'oc_1', 'chat_id', 'Hello');
      expect(result.messageId).toBe('msg_resp');
      expect(client.im.message.create).toHaveBeenCalledTimes(1);
      const call = client.im.message.create.mock.calls[0][0];
      expect(call.data.msg_type).toBe('text');
      expect(JSON.parse(call.data.content)).toEqual({ text: 'Hello' });
    });

    it('throws on withdrawn error code 230011', async () => {
      client.im.message.create.mockResolvedValue({ code: 230011, msg: 'withdrawn' });
      await expect(sendTextMessage(client, 'oc_1', 'chat_id', 'Hi'))
        .rejects.toThrow('MESSAGE_WITHDRAWN');
    });

    it('throws on withdrawn error code 231003', async () => {
      client.im.message.create.mockResolvedValue({ code: 231003, msg: 'not found' });
      await expect(sendTextMessage(client, 'oc_1', 'chat_id', 'Hi'))
        .rejects.toThrow('MESSAGE_WITHDRAWN');
    });

    it('throws on other error codes', async () => {
      client.im.message.create.mockResolvedValue({ code: 99999, msg: 'bad request' });
      await expect(sendTextMessage(client, 'oc_1', 'chat_id', 'Hi'))
        .rejects.toThrow('Failed to send message: bad request');
    });

    it('throws on network error', async () => {
      client.im.message.create.mockRejectedValue(new Error('network'));
      await expect(sendTextMessage(client, 'oc_1', 'chat_id', 'Hi'))
        .rejects.toThrow('network');
    });

    it('returns empty messageId when response data has no message_id', async () => {
      client.im.message.create.mockResolvedValue({ code: 0, data: {} });
      const result = await sendTextMessage(client, 'oc_1', 'chat_id', 'Hi');
      expect(result.messageId).toBe('');
    });
  });

  // ===================== sendPostMessage =====================
  describe('sendPostMessage', () => {
    it('sends post message with title', async () => {
      const result = await sendPostMessage(client, 'oc_1', 'chat_id', 'Content', { title: 'Title' });
      expect(result.messageId).toBe('msg_resp');
      const call = client.im.message.create.mock.calls[0][0];
      expect(call.data.msg_type).toBe('post');
      const parsed = JSON.parse(call.data.content);
      expect(parsed.zh_cn.title).toBe('Title');
    });

    it('sends post with mention targets', async () => {
      await sendPostMessage(client, 'oc_1', 'chat_id', 'Content', {
        mentionTargets: [{ openId: 'ou_1', name: 'Alice' }],
      });
      const call = client.im.message.create.mock.calls[0][0];
      const parsed = JSON.parse(call.data.content);
      // Should contain at element
      const elements = parsed.zh_cn.content[0];
      expect(elements.some((e: any) => e.tag === 'at')).toBe(true);
    });

    it('throws MESSAGE_WITHDRAWN on code 230011', async () => {
      client.im.message.create.mockResolvedValue({ code: 230011, msg: 'withdrawn' });
      await expect(sendPostMessage(client, 'oc_1', 'chat_id', 'C'))
        .rejects.toThrow('MESSAGE_WITHDRAWN');
    });
  });

  // ===================== sendMarkdownMessage =====================
  describe('sendMarkdownMessage', () => {
    it('sends markdown message using md tag', async () => {
      await sendMarkdownMessage(client, 'oc_1', 'chat_id', '**bold**', { title: 'T' });
      const call = client.im.message.create.mock.calls[0][0];
      expect(call.data.msg_type).toBe('post');
      const parsed = JSON.parse(call.data.content);
      expect(parsed.zh_cn.content[0][0].tag).toBe('md');
      expect(parsed.zh_cn.content[0][0].text).toBe('**bold**');
    });

    it('throws MESSAGE_WITHDRAWN on code 231003', async () => {
      client.im.message.create.mockResolvedValue({ code: 231003, msg: 'not found' });
      await expect(sendMarkdownMessage(client, 'oc_1', 'chat_id', 'md'))
        .rejects.toThrow('MESSAGE_WITHDRAWN');
    });
  });

  // ===================== sendCardMessage =====================
  describe('sendCardMessage', () => {
    it('sends card message', async () => {
      const card = { type: 'interactive' as const, elements: [] };
      await sendCardMessage(client, 'oc_1', 'chat_id', card as any);
      const call = client.im.message.create.mock.calls[0][0];
      expect(call.data.msg_type).toBe('interactive');
    });

    it('throws on error', async () => {
      client.im.message.create.mockResolvedValue({ code: 99999, msg: 'fail' });
      await expect(sendCardMessage(client, 'oc_1', 'chat_id', {} as any))
        .rejects.toThrow('Failed to send card message');
    });
  });

  // ===================== sendMarkdownCard =====================
  describe('sendMarkdownCard', () => {
    it('builds and sends markdown card', async () => {
      await sendMarkdownCard(client, 'oc_1', 'chat_id', '**hi**', { title: 'T' });
      expect(client.im.message.create).toHaveBeenCalledTimes(1);
    });
  });

  // ===================== editMessage =====================
  describe('editMessage', () => {
    it('edits text message', async () => {
      await editMessage(client, 'msg_1', 'new text');
      const call = client.im.message.patch.mock.calls[0][0];
      expect(call.path.message_id).toBe('msg_1');
      expect(call.data.content).toBeDefined();
    });

    it('edits post message', async () => {
      await editMessage(client, 'msg_1', 'new content', 'post');
      const call = client.im.message.patch.mock.calls[0][0];
      expect(call.data.content).toBeDefined();
    });

    it('throws MESSAGE_WITHDRAWN on 230011', async () => {
      client.im.message.patch.mockResolvedValue({ code: 230011, msg: 'withdrawn' });
      await expect(editMessage(client, 'msg_1', 'text')).rejects.toThrow('MESSAGE_WITHDRAWN');
    });

    it('throws on other error', async () => {
      client.im.message.patch.mockResolvedValue({ code: 50001, msg: 'fail' });
      await expect(editMessage(client, 'msg_1', 'text')).rejects.toThrow('Failed to edit message');
    });
  });

  // ===================== replyMessage =====================
  describe('replyMessage', () => {
    it('replies with text', async () => {
      const result = await replyMessage(client, 'msg_1', 'reply text');
      expect(result.messageId).toBe('msg_reply');
      const call = client.im.message.reply.mock.calls[0][0];
      expect(call.data.msg_type).toBe('text');
    });

    it('replies with post and mentions', async () => {
      await replyMessage(client, 'msg_1', 'post content', 'post', {
        mentionTargets: [{ openId: 'ou_1' }],
      });
      const call = client.im.message.reply.mock.calls[0][0];
      expect(call.data.msg_type).toBe('post');
    });

    it('replies with interactive card', async () => {
      const card = { type: 'interactive' as const };
      await replyMessage(client, 'msg_1', '', 'interactive', { card: card as any });
      const call = client.im.message.reply.mock.calls[0][0];
      expect(call.data.msg_type).toBe('interactive');
    });

    it('throws on invalid interactive without card', async () => {
      await expect(replyMessage(client, 'msg_1', '', 'interactive'))
        .rejects.toThrow('Invalid message type or missing card');
    });

    it('throws MESSAGE_WITHDRAWN on 231003', async () => {
      client.im.message.reply.mockResolvedValue({ code: 231003, msg: 'withdrawn' });
      await expect(replyMessage(client, 'msg_1', 'text')).rejects.toThrow('MESSAGE_WITHDRAWN');
    });
  });

  // ===================== getMessage =====================
  describe('getMessage', () => {
    it('gets message by id', async () => {
      const result = await getMessage(client, 'msg_1');
      expect(result).toBeDefined();
    });

    it('throws on error', async () => {
      client.im.message.get.mockResolvedValue({ code: 99999, msg: 'not found' });
      await expect(getMessage(client, 'msg_1')).rejects.toThrow('Failed to get message');
    });
  });

  // ===================== exported types =====================
  describe('exported types', () => {
    it('MentionTarget is constructible', () => {
      const target: import('../send').MentionTarget = { openId: 'ou_1', name: 'A' };
      expect(target.openId).toBe('ou_1');
    });

    it('PostContentElement is constructible', () => {
      const elem: import('../send').PostContentElement = { tag: 'text', text: 'hi' };
      expect(elem.tag).toBe('text');
    });
  });
});
