/**
 * Tests for types/channel.ts
 *
 * This file defines interfaces and type aliases.
 * Tests verify that the exports are accessible and that
 * objects conforming to the interfaces work correctly.
 */
import { describe, it, expect, vi } from 'vitest';

import type {
  ChannelType,
  MessageChannel,
  MessageContent,
  MultimodalContent,
  PostMessageOptions,
  ReplyMessageOptions,
  UpdateMessageOptions,
  MessageResult,
} from '../channel';

describe('types/channel', () => {
  describe('ChannelType', () => {
    it('allows valid channel types', () => {
      const types: ChannelType[] = ['cli', 'feishu', 'web', 'webhook', 'api'];
      expect(types).toHaveLength(5);
    });
  });

  describe('MessageContent', () => {
    it('accepts string content', () => {
      const content: MessageContent = 'hello world';
      expect(typeof content).toBe('string');
    });

    it('accepts multimodal content array', () => {
      const content: MessageContent = [
        { type: 'text', text: 'hello' },
        { type: 'image_url', image_url: { url: 'http://example.com/img.png', detail: 'auto' } },
      ];
      expect(Array.isArray(content)).toBe(true);
      expect(content).toHaveLength(2);
    });
  });

  describe('MultimodalContent', () => {
    it('supports text type', () => {
      const part: MultimodalContent = { type: 'text', text: 'hello' };
      expect(part.type).toBe('text');
      expect(part.text).toBe('hello');
    });

    it('supports image_url type', () => {
      const part: MultimodalContent = {
        type: 'image_url',
        image_url: { url: 'http://img.png', detail: 'high' },
      };
      expect(part.type).toBe('image_url');
      expect(part.image_url?.url).toBe('http://img.png');
      expect(part.image_url?.detail).toBe('high');
    });
  });

  describe('PostMessageOptions', () => {
    it('allows all optional fields', () => {
      const opts: PostMessageOptions = {
        sessionId: 's1',
        userId: 'u1',
        metadata: { key: 'val' },
        replyTo: 'msg-1',
      };
      expect(opts.sessionId).toBe('s1');
    });

    it('allows empty options', () => {
      const opts: PostMessageOptions = {};
      expect(opts).toEqual({});
    });
  });

  describe('ReplyMessageOptions', () => {
    it('requires sessionId', () => {
      const opts: ReplyMessageOptions = { sessionId: 's1' };
      expect(opts.sessionId).toBe('s1');
    });

    it('allows optional fields', () => {
      const opts: ReplyMessageOptions = {
        sessionId: 's1',
        userId: 'u1',
        chatId: 'c1',
        parentMessageId: 'pm1',
        metadata: { x: 1 },
      };
      expect(opts.chatId).toBe('c1');
    });
  });

  describe('UpdateMessageOptions', () => {
    it('requires sessionId and messageId', () => {
      const opts: UpdateMessageOptions = {
        sessionId: 's1',
        messageId: 'm1',
      };
      expect(opts.sessionId).toBe('s1');
      expect(opts.messageId).toBe('m1');
    });

    it('allows optional chatId', () => {
      const opts: UpdateMessageOptions = {
        sessionId: 's1',
        messageId: 'm1',
        chatId: 'c1',
      };
      expect(opts.chatId).toBe('c1');
    });
  });

  describe('MessageResult', () => {
    it('represents success', () => {
      const result: MessageResult = {
        messageId: 'msg-123',
        success: true,
      };
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('represents failure with error', () => {
      const result: MessageResult = {
        messageId: '',
        success: false,
        error: 'timeout',
      };
      expect(result.success).toBe(false);
      expect(result.error).toBe('timeout');
    });
  });

  describe('MessageChannel interface conformance', () => {
    it('can create an object that conforms to MessageChannel', async () => {
      const channel: MessageChannel = {
        type: 'cli' as ChannelType,
        async postMessage(content, _options?) {
          return { messageId: '1', success: true };
        },
        async replyMessage(_options, content) {
          return { messageId: '2', success: true };
        },
        supportsUpdates() {
          return false;
        },
        async healthCheck() {
          return true;
        },
      };

      expect(channel.type).toBe('cli');
      const postResult = await channel.postMessage('test');
      expect(postResult.success).toBe(true);
      const replyResult = await channel.replyMessage({ sessionId: 's' }, 'reply');
      expect(replyResult.success).toBe(true);
      expect(channel.supportsUpdates()).toBe(false);
      expect(await channel.healthCheck()).toBe(true);
    });
  });
});
