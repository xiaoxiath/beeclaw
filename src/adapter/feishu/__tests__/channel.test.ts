/**
 * Tests for FeishuChannel (channel.ts)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock logger
vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    debug: vi.fn(() => {}),
    info: vi.fn(() => {}),
    warn: vi.fn(() => {}),
    error: vi.fn(() => {}),
  },
}));

const { mockSendTextMessage, mockReplyTextSmart, mockGetFeishuWSClient } = vi.hoisted(() => ({
  mockSendTextMessage: vi.fn(() => Promise.resolve({ data: { message_id: 'msg_123' } })),
  mockReplyTextSmart: vi.fn(() => Promise.resolve()),
  mockGetFeishuWSClient: vi.fn(() => ({
    sendTextMessage: (() => Promise.resolve({ data: { message_id: 'msg_123' } })) as any,
    replyTextSmart: (() => Promise.resolve()) as any,
  })),
}));

vi.mock('../index', () => ({
  getFeishuWSClient: mockGetFeishuWSClient,
}));

import { FeishuChannel } from '../channel';

describe('FeishuChannel', () => {
  let channel: FeishuChannel;

  beforeEach(() => {
    channel = new FeishuChannel();
    mockSendTextMessage.mockClear();
    mockReplyTextSmart.mockClear();
    mockGetFeishuWSClient.mockClear();
    mockGetFeishuWSClient.mockReturnValue({
      sendTextMessage: mockSendTextMessage,
      replyTextSmart: mockReplyTextSmart,
    });
    mockSendTextMessage.mockResolvedValue({ data: { message_id: 'msg_123' } });
    mockReplyTextSmart.mockResolvedValue(undefined);
  });

  describe('type', () => {
    it('returns "feishu"', () => {
      expect(channel.type).toBe('feishu');
    });
  });

  describe('supportsUpdates', () => {
    it('returns false for text messages', () => {
      expect(channel.supportsUpdates()).toBe(false);
    });
  });

  describe('postMessage', () => {
    it('sends text message with chatId', async () => {
      const result = await channel.postMessage('Hello', {
        metadata: { chatId: 'chat_1' },
      });
      expect(result.success).toBe(true);
      expect(result.messageId).toMatch(/^feishu-\d+$/);
      expect(mockSendTextMessage).toHaveBeenCalledWith('chat_1', 'chat_id', 'Hello');
    });

    it('returns error when client is not initialized', async () => {
      mockGetFeishuWSClient.mockReturnValue(null);
      const result = await channel.postMessage('Hello', {
        metadata: { chatId: 'chat_1' },
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not initialized');
    });

    it('returns error when chatId is missing', async () => {
      const result = await channel.postMessage('Hello', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('chatId required');
    });

    it('returns error when no options provided', async () => {
      const result = await channel.postMessage('Hello');
      expect(result.success).toBe(false);
      expect(result.error).toContain('chatId required');
    });

    it('generates fallback messageId when response has none', async () => {
      mockSendTextMessage.mockResolvedValue({ data: {} });
      const result = await channel.postMessage('Hello', {
        metadata: { chatId: 'chat_1' },
      });
      expect(result.success).toBe(true);
      expect(result.messageId).toMatch(/^feishu-/);
    });

    it('converts multimodal content with text parts', async () => {
      const content = [
        { type: 'text' as const, text: 'Hello' },
        { type: 'text' as const, text: 'World' },
      ];
      await channel.postMessage(content, { metadata: { chatId: 'chat_1' } });
      expect(mockSendTextMessage).toHaveBeenCalledWith('chat_1', 'chat_id', 'Hello\nWorld');
    });

    it('converts multimodal content with image_url (http)', async () => {
      const content = [
        { type: 'text' as const, text: 'Look:' },
        { type: 'image_url' as const, image_url: { url: 'https://example.com/img.png' } },
      ];
      await channel.postMessage(content, { metadata: { chatId: 'chat_1' } });
      expect(mockSendTextMessage).toHaveBeenCalledWith(
        'chat_1',
        'chat_id',
        'Look:\n[图片: https://example.com/img.png]'
      );
    });

    it('converts multimodal content with image_url string', async () => {
      const content = [
        { type: 'image_url' as const, image_url: 'https://example.com/img.png' },
      ];
      await channel.postMessage(content, { metadata: { chatId: 'chat_1' } });
      expect(mockSendTextMessage).toHaveBeenCalledWith(
        'chat_1',
        'chat_id',
        '[图片: https://example.com/img.png]'
      );
    });

    it('converts multimodal content with base64 image to placeholder', async () => {
      const content = [
        { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,abc' } },
      ];
      await channel.postMessage(content, { metadata: { chatId: 'chat_1' } });
      expect(mockSendTextMessage).toHaveBeenCalledWith('chat_1', 'chat_id', '[图片]');
    });
  });

  describe('replyMessage', () => {
    it('replies to message with text', async () => {
      const result = await channel.replyMessage(
        { sessionId: 's1', parentMessageId: 'msg_parent' },
        'Reply text'
      );
      expect(result.success).toBe(true);
      expect(result.messageId).toMatch(/^feishu-reply-/);
      expect(mockReplyTextSmart).toHaveBeenCalledWith('msg_parent', 'Reply text');
    });

    it('returns error when client is null', async () => {
      mockGetFeishuWSClient.mockReturnValue(null);
      const result = await channel.replyMessage(
        { sessionId: 's1', parentMessageId: 'msg_parent' },
        'Reply text'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('not initialized');
    });

    it('returns error when parentMessageId is missing', async () => {
      const result = await channel.replyMessage(
        { sessionId: 's1' },
        'Reply text'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('parentMessageId required');
    });

    it('handles withdrawn message error (230011)', async () => {
      mockReplyTextSmart.mockRejectedValue(new Error('code 230011 message withdrawn'));
      const result = await channel.replyMessage(
        { sessionId: 's1', parentMessageId: 'msg_parent' },
        'Reply text'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('withdrawn');
    });

    it('handles withdrawn message error (231003)', async () => {
      mockReplyTextSmart.mockRejectedValue(new Error('error 231003'));
      const result = await channel.replyMessage(
        { sessionId: 's1', parentMessageId: 'msg_parent' },
        'Reply text'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('withdrawn');
    });

    it('handles withdrawn keyword in error', async () => {
      mockReplyTextSmart.mockRejectedValue(new Error('Message was withdrawn by sender'));
      const result = await channel.replyMessage(
        { sessionId: 's1', parentMessageId: 'msg_parent' },
        'Reply text'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('withdrawn');
    });

    it('handles generic error', async () => {
      mockReplyTextSmart.mockRejectedValue(new Error('network fail'));
      const result = await channel.replyMessage(
        { sessionId: 's1', parentMessageId: 'msg_parent' },
        'Reply text'
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe('network fail');
    });

    it('handles non-Error throw', async () => {
      mockReplyTextSmart.mockRejectedValue('string error');
      const result = await channel.replyMessage(
        { sessionId: 's1', parentMessageId: 'msg_parent' },
        'Reply text'
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  describe('updateMessageContent', () => {
    it('does not throw', async () => {
      await channel.updateMessageContent({
        sessionId: 's1',
        messageId: 'msg_1',
      });
    });
  });

  describe('healthCheck', () => {
    it('returns true when client exists', async () => {
      mockGetFeishuWSClient.mockReturnValue({ some: 'client' });
      expect(await channel.healthCheck()).toBe(true);
    });

    it('returns false when client is null', async () => {
      mockGetFeishuWSClient.mockReturnValue(null);
      expect(await channel.healthCheck()).toBe(false);
    });

    it('returns false on exception', async () => {
      mockGetFeishuWSClient.mockImplementation(() => { throw new Error('boom'); });
      expect(await channel.healthCheck()).toBe(false);
    });
  });
});
