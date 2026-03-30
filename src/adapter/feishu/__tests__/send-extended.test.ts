/**
 * Extended tests for send.ts - covering uncovered branches
 * Focuses on: buildPostContent markdown parsing, buildMarkdownCard, 
 * editMessage post type, replyMessage branches, withdrawn codes, empty data paths
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

describe('send-extended', () => {
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    client = makeClient();
  });

  // =====================================================
  // buildPostContent - via sendPostMessage
  // =====================================================
  describe('buildPostContent markdown parsing', () => {
    it('parses ### h3 headers as bold', async () => {
      await sendPostMessage(client, 'oc_1', 'chat_id', '### Heading Three');
      const call = client.im.message.create.mock.calls[0][0];
      const parsed = JSON.parse(call.data.content);
      const elements = parsed.zh_cn.content[0];
      const h3 = elements.find((e: any) => e.text === 'Heading Three' && e.style?.includes('bold'));
      expect(h3).toBeDefined();
    });

    it('parses ## h2 headers as bold', async () => {
      await sendPostMessage(client, 'oc_1', 'chat_id', '## Heading Two');
      const call = client.im.message.create.mock.calls[0][0];
      const parsed = JSON.parse(call.data.content);
      const elements = parsed.zh_cn.content[0];
      const h2 = elements.find((e: any) => e.text === 'Heading Two' && e.style?.includes('bold'));
      expect(h2).toBeDefined();
    });

    it('parses # h1 headers as bold', async () => {
      await sendPostMessage(client, 'oc_1', 'chat_id', '# Heading One');
      const call = client.im.message.create.mock.calls[0][0];
      const parsed = JSON.parse(call.data.content);
      const elements = parsed.zh_cn.content[0];
      const h1 = elements.find((e: any) => e.text === 'Heading One' && e.style?.includes('bold'));
      expect(h1).toBeDefined();
    });

    it('parses - unordered list items', async () => {
      await sendPostMessage(client, 'oc_1', 'chat_id', '- Item one');
      const call = client.im.message.create.mock.calls[0][0];
      const parsed = JSON.parse(call.data.content);
      const elements = parsed.zh_cn.content[0];
      const li = elements.find((e: any) => e.text === '• Item one');
      expect(li).toBeDefined();
    });

    it('parses * unordered list items', async () => {
      await sendPostMessage(client, 'oc_1', 'chat_id', '* Star item');
      const call = client.im.message.create.mock.calls[0][0];
      const parsed = JSON.parse(call.data.content);
      const elements = parsed.zh_cn.content[0];
      const li = elements.find((e: any) => e.text === '• Star item');
      expect(li).toBeDefined();
    });

    it('parses numbered list items', async () => {
      await sendPostMessage(client, 'oc_1', 'chat_id', '1. First item\n2. Second item');
      const call = client.im.message.create.mock.calls[0][0];
      const parsed = JSON.parse(call.data.content);
      const elements = parsed.zh_cn.content[0];
      const n1 = elements.find((e: any) => e.text === '1. First item');
      const n2 = elements.find((e: any) => e.text === '2. Second item');
      expect(n1).toBeDefined();
      expect(n2).toBeDefined();
    });

    it('parses blockquotes as italic', async () => {
      await sendPostMessage(client, 'oc_1', 'chat_id', '> Quoted text');
      const call = client.im.message.create.mock.calls[0][0];
      const parsed = JSON.parse(call.data.content);
      const elements = parsed.zh_cn.content[0];
      const bq = elements.find((e: any) => e.text === 'Quoted text' && e.style?.includes('italic'));
      expect(bq).toBeDefined();
    });

    it('parses bold text with **', async () => {
      await sendPostMessage(client, 'oc_1', 'chat_id', 'Hello **world** today');
      const call = client.im.message.create.mock.calls[0][0];
      const parsed = JSON.parse(call.data.content);
      const elements = parsed.zh_cn.content[0];
      const bold = elements.find((e: any) => e.text === 'world' && e.style?.includes('bold'));
      const plain1 = elements.find((e: any) => e.text === 'Hello ');
      const plain2 = elements.find((e: any) => e.text === ' today');
      expect(bold).toBeDefined();
      expect(plain1).toBeDefined();
      expect(plain2).toBeDefined();
    });

    it('parses inline code with backticks', async () => {
      await sendPostMessage(client, 'oc_1', 'chat_id', 'Run `npm install` now');
      const call = client.im.message.create.mock.calls[0][0];
      const parsed = JSON.parse(call.data.content);
      const elements = parsed.zh_cn.content[0];
      const code = elements.find((e: any) => e.text === 'npm install' && e.style?.includes('code'));
      const before = elements.find((e: any) => e.text === 'Run ');
      const after = elements.find((e: any) => e.text === ' now');
      expect(code).toBeDefined();
      expect(before).toBeDefined();
      expect(after).toBeDefined();
    });

    it('parses links as plain text', async () => {
      await sendPostMessage(client, 'oc_1', 'chat_id', '[Click here](https://example.com)');
      const call = client.im.message.create.mock.calls[0][0];
      const parsed = JSON.parse(call.data.content);
      const elements = parsed.zh_cn.content[0];
      const link = elements.find((e: any) => e.text?.includes(']('));
      expect(link).toBeDefined();
    });

    it('parses regular text lines', async () => {
      await sendPostMessage(client, 'oc_1', 'chat_id', 'Plain text line');
      const call = client.im.message.create.mock.calls[0][0];
      const parsed = JSON.parse(call.data.content);
      const elements = parsed.zh_cn.content[0];
      const plain = elements.find((e: any) => e.text === 'Plain text line');
      expect(plain).toBeDefined();
    });

    it('skips empty lines', async () => {
      await sendPostMessage(client, 'oc_1', 'chat_id', 'Line 1\n\nLine 2');
      const call = client.im.message.create.mock.calls[0][0];
      const parsed = JSON.parse(call.data.content);
      const elements = parsed.zh_cn.content[0];
      // Should have: "Line 1", "\n", "\n", "Line 2" (empty line skipped, but newlines preserved)
      const l1 = elements.find((e: any) => e.text === 'Line 1');
      const l2 = elements.find((e: any) => e.text === 'Line 2');
      expect(l1).toBeDefined();
      expect(l2).toBeDefined();
    });

    it('adds newlines between lines except last', async () => {
      await sendPostMessage(client, 'oc_1', 'chat_id', 'A\nB\nC');
      const call = client.im.message.create.mock.calls[0][0];
      const parsed = JSON.parse(call.data.content);
      const elements = parsed.zh_cn.content[0];
      const newlines = elements.filter((e: any) => e.text === '\n');
      // 3 lines => 2 newlines between them (after A and after B)
      expect(newlines.length).toBe(2);
    });

    it('handles multiple mentions', async () => {
      await sendPostMessage(client, 'oc_1', 'chat_id', 'Hello', {
        mentionTargets: [
          { openId: 'ou_1', name: 'Alice' },
          { openId: 'ou_2', name: 'Bob' },
        ],
      });
      const call = client.im.message.create.mock.calls[0][0];
      const parsed = JSON.parse(call.data.content);
      const elements = parsed.zh_cn.content[0];
      const ats = elements.filter((e: any) => e.tag === 'at');
      expect(ats).toHaveLength(2);
      expect(ats[0].user_id).toBe('ou_1');
      expect(ats[1].user_id).toBe('ou_2');
      // Space after mentions
      const space = elements.find((e: any) => e.tag === 'text' && e.text === ' ');
      expect(space).toBeDefined();
    });

    it('handles content without mentions', async () => {
      await sendPostMessage(client, 'oc_1', 'chat_id', 'No mentions');
      const call = client.im.message.create.mock.calls[0][0];
      const parsed = JSON.parse(call.data.content);
      const elements = parsed.zh_cn.content[0];
      const ats = elements.filter((e: any) => e.tag === 'at');
      expect(ats).toHaveLength(0);
    });

    it('handles empty mentions array', async () => {
      await sendPostMessage(client, 'oc_1', 'chat_id', 'No mentions', {
        mentionTargets: [],
      });
      const call = client.im.message.create.mock.calls[0][0];
      const parsed = JSON.parse(call.data.content);
      const elements = parsed.zh_cn.content[0];
      const ats = elements.filter((e: any) => e.tag === 'at');
      expect(ats).toHaveLength(0);
    });

    it('uses default empty title when not provided', async () => {
      await sendPostMessage(client, 'oc_1', 'chat_id', 'Content');
      const call = client.im.message.create.mock.calls[0][0];
      const parsed = JSON.parse(call.data.content);
      expect(parsed.zh_cn.title).toBe('');
    });

    it('handles mixed markdown content', async () => {
      const md = '# Title\n\n- Item 1\n* Item 2\n\n> Quote\n\n1. Num\n\nPlain **bold** `code`';
      await sendPostMessage(client, 'oc_1', 'chat_id', md);
      const call = client.im.message.create.mock.calls[0][0];
      const parsed = JSON.parse(call.data.content);
      const elements = parsed.zh_cn.content[0];

      // Verify different element types exist
      const hasH1 = elements.some((e: any) => e.text === 'Title' && e.style?.includes('bold'));
      const hasBullet = elements.some((e: any) => e.text?.startsWith('• '));
      const hasQuote = elements.some((e: any) => e.text === 'Quote' && e.style?.includes('italic'));
      const hasNum = elements.some((e: any) => e.text === '1. Num');
      expect(hasH1).toBe(true);
      expect(hasBullet).toBe(true);
      expect(hasQuote).toBe(true);
      expect(hasNum).toBe(true);
    });
  });

  // =====================================================
  // buildMarkdownCard - via sendMarkdownCard
  // =====================================================
  describe('buildMarkdownCard construction', () => {
    it('builds card with title', async () => {
      await sendMarkdownCard(client, 'oc_1', 'chat_id', 'Content', { title: 'My Title' });
      const call = client.im.message.create.mock.calls[0][0];
      const card = JSON.parse(call.data.content);
      // Should have title div element
      const titleEl = card.elements?.find(
        (e: any) => e.tag === 'div' && e.text?.content?.includes('My Title')
      );
      expect(titleEl).toBeDefined();
      expect(titleEl.text.tag).toBe('lark_md');
      expect(titleEl.text.content).toContain('**My Title**');
    });

    it('builds card without title', async () => {
      await sendMarkdownCard(client, 'oc_1', 'chat_id', 'Content');
      const call = client.im.message.create.mock.calls[0][0];
      const card = JSON.parse(call.data.content);
      // Should NOT have title div element
      const titleEl = card.elements?.find(
        (e: any) => e.tag === 'div' && e.text?.content?.includes('**')
      );
      expect(titleEl).toBeUndefined();
    });

    it('builds card with mention targets', async () => {
      await sendMarkdownCard(client, 'oc_1', 'chat_id', 'Content', {
        mentionTargets: [{ openId: 'ou_1' }, { openId: 'ou_2' }],
      });
      const call = client.im.message.create.mock.calls[0][0];
      const card = JSON.parse(call.data.content);
      const mentionEl = card.elements?.find(
        (e: any) => e.tag === 'div' && e.text?.content?.includes('<at id=')
      );
      expect(mentionEl).toBeDefined();
      expect(mentionEl.text.content).toContain('ou_1');
      expect(mentionEl.text.content).toContain('ou_2');
    });

    it('builds card without mention targets', async () => {
      await sendMarkdownCard(client, 'oc_1', 'chat_id', 'Content');
      const call = client.im.message.create.mock.calls[0][0];
      const card = JSON.parse(call.data.content);
      const mentionEl = card.elements?.find(
        (e: any) => e.tag === 'div' && e.text?.content?.includes('<at id=')
      );
      expect(mentionEl).toBeUndefined();
    });

    it('builds card with empty mention targets array', async () => {
      await sendMarkdownCard(client, 'oc_1', 'chat_id', 'Content', {
        mentionTargets: [],
      });
      const call = client.im.message.create.mock.calls[0][0];
      const card = JSON.parse(call.data.content);
      const mentionEl = card.elements?.find(
        (e: any) => e.tag === 'div' && e.text?.content?.includes('<at id=')
      );
      expect(mentionEl).toBeUndefined();
    });

    it('includes markdown content element', async () => {
      await sendMarkdownCard(client, 'oc_1', 'chat_id', '**hello**');
      const call = client.im.message.create.mock.calls[0][0];
      const card = JSON.parse(call.data.content);
      const mdEl = card.elements?.find(
        (e: any) => e.tag === 'markdown' && e.content === '**hello**'
      );
      expect(mdEl).toBeDefined();
    });

    it('sets card type and config', async () => {
      await sendMarkdownCard(client, 'oc_1', 'chat_id', 'text');
      const call = client.im.message.create.mock.calls[0][0];
      const card = JSON.parse(call.data.content);
      expect(card.type).toBe('interactive');
      expect(card.config.wide_screen_mode).toBe(true);
      expect(card.config.enable_forward).toBe(true);
    });

    it('builds card with both title and mentions', async () => {
      await sendMarkdownCard(client, 'oc_1', 'chat_id', 'Content', {
        title: 'Report',
        mentionTargets: [{ openId: 'ou_1' }],
      });
      const call = client.im.message.create.mock.calls[0][0];
      const card = JSON.parse(call.data.content);
      // Should have 3 elements: title div, mention div, markdown
      expect(card.elements?.length).toBe(3);
    });
  });

  // =====================================================
  // sendMarkdownCard error handling
  // =====================================================
  describe('sendMarkdownCard error paths', () => {
    it('throws and logs on card send failure', async () => {
      client.im.message.create.mockResolvedValue({ code: 99999, msg: 'card failed' });
      await expect(sendMarkdownCard(client, 'oc_1', 'chat_id', 'md'))
        .rejects.toThrow('Failed to send card message');
    });

    it('throws MESSAGE_WITHDRAWN on code 230011', async () => {
      client.im.message.create.mockResolvedValue({ code: 230011, msg: 'withdrawn' });
      await expect(sendMarkdownCard(client, 'oc_1', 'chat_id', 'md'))
        .rejects.toThrow('MESSAGE_WITHDRAWN');
    });

    it('throws on network error', async () => {
      client.im.message.create.mockRejectedValue(new Error('network'));
      await expect(sendMarkdownCard(client, 'oc_1', 'chat_id', 'md'))
        .rejects.toThrow('network');
    });
  });

  // =====================================================
  // sendMarkdownMessage additional branches
  // =====================================================
  describe('sendMarkdownMessage additional branches', () => {
    it('uses empty title when not provided', async () => {
      await sendMarkdownMessage(client, 'oc_1', 'chat_id', '**md**');
      const call = client.im.message.create.mock.calls[0][0];
      const parsed = JSON.parse(call.data.content);
      expect(parsed.zh_cn.title).toBe('');
    });

    it('throws on other error codes', async () => {
      client.im.message.create.mockResolvedValue({ code: 50001, msg: 'bad' });
      await expect(sendMarkdownMessage(client, 'oc_1', 'chat_id', 'md'))
        .rejects.toThrow('Failed to send markdown message');
    });

    it('throws on network error', async () => {
      client.im.message.create.mockRejectedValue(new Error('timeout'));
      await expect(sendMarkdownMessage(client, 'oc_1', 'chat_id', 'md'))
        .rejects.toThrow('timeout');
    });

    it('returns empty messageId when response data has no message_id', async () => {
      client.im.message.create.mockResolvedValue({ code: 0, data: {} });
      const result = await sendMarkdownMessage(client, 'oc_1', 'chat_id', 'md');
      expect(result.messageId).toBe('');
    });
  });

  // =====================================================
  // sendPostMessage additional branches
  // =====================================================
  describe('sendPostMessage additional branches', () => {
    it('throws on other error code (231003)', async () => {
      client.im.message.create.mockResolvedValue({ code: 231003, msg: 'not found' });
      await expect(sendPostMessage(client, 'oc_1', 'chat_id', 'content'))
        .rejects.toThrow('MESSAGE_WITHDRAWN');
    });

    it('throws on non-withdrawn error', async () => {
      client.im.message.create.mockResolvedValue({ code: 40001, msg: 'bad' });
      await expect(sendPostMessage(client, 'oc_1', 'chat_id', 'content'))
        .rejects.toThrow('Failed to send post message');
    });

    it('throws on network error', async () => {
      client.im.message.create.mockRejectedValue(new Error('connection'));
      await expect(sendPostMessage(client, 'oc_1', 'chat_id', 'content'))
        .rejects.toThrow('connection');
    });

    it('returns empty messageId when data has no message_id', async () => {
      client.im.message.create.mockResolvedValue({ code: 0, data: {} });
      const result = await sendPostMessage(client, 'oc_1', 'chat_id', 'content');
      expect(result.messageId).toBe('');
    });
  });

  // =====================================================
  // sendCardMessage additional branches
  // =====================================================
  describe('sendCardMessage additional branches', () => {
    it('throws MESSAGE_WITHDRAWN on code 230011', async () => {
      client.im.message.create.mockResolvedValue({ code: 230011, msg: 'withdrawn' });
      await expect(sendCardMessage(client, 'oc_1', 'chat_id', {} as any))
        .rejects.toThrow('MESSAGE_WITHDRAWN');
    });

    it('throws MESSAGE_WITHDRAWN on code 231003', async () => {
      client.im.message.create.mockResolvedValue({ code: 231003, msg: 'not found' });
      await expect(sendCardMessage(client, 'oc_1', 'chat_id', {} as any))
        .rejects.toThrow('MESSAGE_WITHDRAWN');
    });

    it('throws on network error', async () => {
      client.im.message.create.mockRejectedValue(new Error('fail'));
      await expect(sendCardMessage(client, 'oc_1', 'chat_id', {} as any))
        .rejects.toThrow('fail');
    });

    it('returns empty messageId when data has no message_id', async () => {
      client.im.message.create.mockResolvedValue({ code: 0, data: {} });
      const result = await sendCardMessage(client, 'oc_1', 'chat_id', {} as any);
      expect(result.messageId).toBe('');
    });
  });

  // =====================================================
  // editMessage additional branches
  // =====================================================
  describe('editMessage additional branches', () => {
    it('edits message with post format', async () => {
      await editMessage(client, 'msg_1', 'Updated content', 'post');
      const call = client.im.message.patch.mock.calls[0][0];
      const content = JSON.parse(call.data.content);
      expect(content.zh_cn.content[0][0].tag).toBe('text');
      expect(content.zh_cn.content[0][0].text).toBe('Updated content');
    });

    it('edits message with text format (default)', async () => {
      await editMessage(client, 'msg_1', 'New text');
      const call = client.im.message.patch.mock.calls[0][0];
      const content = JSON.parse(call.data.content);
      expect(content.text).toBe('New text');
    });

    it('throws MESSAGE_WITHDRAWN on code 231003', async () => {
      client.im.message.patch.mockResolvedValue({ code: 231003, msg: 'not found' });
      await expect(editMessage(client, 'msg_1', 'text')).rejects.toThrow('MESSAGE_WITHDRAWN');
    });

    it('throws on network error', async () => {
      client.im.message.patch.mockRejectedValue(new Error('timeout'));
      await expect(editMessage(client, 'msg_1', 'text')).rejects.toThrow('timeout');
    });
  });

  // =====================================================
  // replyMessage additional branches
  // =====================================================
  describe('replyMessage additional branches', () => {
    it('replies with post content and no mentions', async () => {
      const result = await replyMessage(client, 'msg_1', 'Post content', 'post');
      expect(result.messageId).toBe('msg_reply');
      const call = client.im.message.reply.mock.calls[0][0];
      expect(call.data.msg_type).toBe('post');
      const content = JSON.parse(call.data.content);
      expect(content.zh_cn).toBeDefined();
    });

    it('throws MESSAGE_WITHDRAWN on code 230011', async () => {
      client.im.message.reply.mockResolvedValue({ code: 230011, msg: 'withdrawn' });
      await expect(replyMessage(client, 'msg_1', 'text')).rejects.toThrow('MESSAGE_WITHDRAWN');
    });

    it('throws on other error code', async () => {
      client.im.message.reply.mockResolvedValue({ code: 50001, msg: 'fail' });
      await expect(replyMessage(client, 'msg_1', 'text')).rejects.toThrow('Failed to reply to message');
    });

    it('throws on network error', async () => {
      client.im.message.reply.mockRejectedValue(new Error('conn'));
      await expect(replyMessage(client, 'msg_1', 'text')).rejects.toThrow('conn');
    });

    it('returns empty messageId when response data has no message_id', async () => {
      client.im.message.reply.mockResolvedValue({ code: 0, data: {} });
      const result = await replyMessage(client, 'msg_1', 'text');
      expect(result.messageId).toBe('');
    });
  });

  // =====================================================
  // getMessage additional branches
  // =====================================================
  describe('getMessage additional branches', () => {
    it('throws on network error', async () => {
      client.im.message.get.mockRejectedValue(new Error('timeout'));
      await expect(getMessage(client, 'msg_1')).rejects.toThrow('timeout');
    });
  });

  // =====================================================
  // receive_id_type param verification
  // =====================================================
  describe('receive_id_type parameter', () => {
    it('passes open_id type correctly', async () => {
      await sendTextMessage(client, 'ou_1', 'open_id', 'Hi');
      const call = client.im.message.create.mock.calls[0][0];
      expect(call.params.receive_id_type).toBe('open_id');
      expect(call.data.receive_id).toBe('ou_1');
    });

    it('passes user_id type correctly', async () => {
      await sendTextMessage(client, 'uid_1', 'user_id', 'Hi');
      const call = client.im.message.create.mock.calls[0][0];
      expect(call.params.receive_id_type).toBe('user_id');
    });

    it('passes union_id type correctly', async () => {
      await sendTextMessage(client, 'union_1', 'union_id', 'Hi');
      const call = client.im.message.create.mock.calls[0][0];
      expect(call.params.receive_id_type).toBe('union_id');
    });
  });
});
