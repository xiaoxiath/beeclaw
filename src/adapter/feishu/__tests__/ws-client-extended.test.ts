/**
 * Extended unit tests for ws-client.ts — covers uncovered branches:
 * - Event dispatcher callbacks (handleMessage, handleMessageRead, etc.)
 * - sendPostMessage/sendMarkdownMessage/sendMarkdownCard on started client
 * - replyPost withdrawn message branch
 * - handleCardCallback
 * - containsMarkdown (additional patterns)
 * - sendCardMessage
 * - loggerLevel variants
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Hoisted mock fns (available inside vi.mock factories) ──────────────

const {
  mockWSClientStart,
  mockLarkClientCreate,
  mockLarkClientReply,
  mockLarkClientPatch,
  mockSendPostMessage,
  mockSendMarkdownMessage,
  mockSendMarkdownCard,
  mockHandleCallback,
  mockDefaultCard,
  capturedRef,
} = vi.hoisted(() => ({
  mockWSClientStart: vi.fn().mockResolvedValue(undefined),
  mockLarkClientCreate: vi.fn().mockResolvedValue({ code: 0, data: { message_id: 'msg_1' } }),
  mockLarkClientReply: vi.fn().mockResolvedValue({ code: 0, data: { message_id: 'msg_reply' } }),
  mockLarkClientPatch: vi.fn().mockResolvedValue({ code: 0 }),
  mockSendPostMessage: vi.fn().mockResolvedValue({ messageId: 'msg_post' }),
  mockSendMarkdownMessage: vi.fn().mockResolvedValue({ messageId: 'msg_md' }),
  mockSendMarkdownCard: vi.fn().mockResolvedValue({ messageId: 'msg_card' }),
  mockHandleCallback: vi.fn().mockResolvedValue(undefined),
  mockDefaultCard: vi.fn((opts: any) => JSON.stringify({ title: opts.title, content: opts.content })),
  capturedRef: { handlers: {} as Record<string, Function> },
}));

vi.mock('../../../infra/observability/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../send', () => ({
  sendPostMessage: (...a: any[]) => mockSendPostMessage(...a),
  sendMarkdownMessage: (...a: any[]) => mockSendMarkdownMessage(...a),
  sendMarkdownCard: (...a: any[]) => mockSendMarkdownCard(...a),
}));

vi.mock('../card-callback-handler', () => ({
  CardCallbackHandler: class MockCCH {
    handleCallback = mockHandleCallback;
  },
}));

vi.mock('@larksuiteoapi/node-sdk', () => ({
  Client: class MockClient {
    im = {
      v1: {
        message: {
          create: (...a: any[]) => mockLarkClientCreate(...a),
          reply: (...a: any[]) => mockLarkClientReply(...a),
          patch: (...a: any[]) => mockLarkClientPatch(...a),
        },
        messageReaction: {
          create: vi.fn().mockResolvedValue({ code: 0, data: { reaction: { reaction_id: 'r1' } } }),
          delete: vi.fn().mockResolvedValue({ code: 0 }),
        },
      },
    };
  },
  WSClient: class MockWSClient {
    start = mockWSClientStart;
  },
  EventDispatcher: class MockEventDispatcher {
    register(handlers: Record<string, Function>) {
      capturedRef.handlers = handlers;
      return this;
    }
  },
  LoggerLevel: { debug: 0, info: 1, warn: 2, error: 3 },
  messageCard: { defaultCard: mockDefaultCard },
}));

import { FeishuWSClient, resetFeishuWSClient } from '../ws-client';
import type { FeishuWSConfig } from '../ws-client';

const testConfig: FeishuWSConfig = {
  appId: 'app_test',
  appSecret: 'secret_test',
  enabled: true,
};

describe('ws-client (extended)', () => {
  let client: FeishuWSClient;

  beforeEach(async () => {
    resetFeishuWSClient();
    capturedRef.handlers = {};
    mockWSClientStart.mockClear();
    mockWSClientStart.mockResolvedValue(undefined);
    mockLarkClientCreate.mockClear();
    mockLarkClientCreate.mockResolvedValue({ code: 0, data: { message_id: 'msg_1' } });
    mockLarkClientReply.mockClear();
    mockLarkClientReply.mockResolvedValue({ code: 0, data: { message_id: 'msg_reply' } });
    mockLarkClientPatch.mockClear();
    mockSendPostMessage.mockClear();
    mockSendMarkdownMessage.mockClear();
    mockSendMarkdownCard.mockClear();
    mockHandleCallback.mockClear();
    mockHandleCallback.mockResolvedValue(undefined);

    client = new FeishuWSClient(testConfig);
    await client.start();
  });

  afterEach(() => {
    try { client.stop(); } catch { /* ignore */ }
  });

  // Helper to access captured event handlers
  function handlers() { return capturedRef.handlers; }

  // ── Event dispatcher: handleMessage ─────────────────────────────────

  describe('event dispatch: handleMessage', () => {
    it('calls registered message handlers', async () => {
      const handler = vi.fn();
      client.onMessage(handler);

      const msgData = {
        message: { chat_id: 'c1', message_id: 'm1', message_type: 'text', content: '{}', create_time: '0' },
        sender: { sender_type: 'user', sender_id: { union_id: 'u1', open_id: 'o1' } },
      };

      await handlers()['im.message.receive_v1'](msgData);
      expect(handler).toHaveBeenCalledWith(msgData);
    });

    it('tracks lastActiveChatId and lastActiveUserId', async () => {
      const msgData = {
        message: { chat_id: 'tracked-chat', message_id: 'm1', message_type: 'text', content: '{}', create_time: '0' },
        sender: { sender_type: 'user', sender_id: { union_id: 'tracked-user' } },
      };

      await handlers()['im.message.receive_v1'](msgData);
      expect(client.lastActiveChatId).toBe('tracked-chat');
      expect(client.lastActiveUserId).toBe('tracked-user');
    });

    it('catches handler errors without throwing', async () => {
      const badHandler = vi.fn().mockRejectedValue(new Error('handler fail'));
      client.onMessage(badHandler);

      const msgData = {
        message: { chat_id: 'c', message_id: 'm', message_type: 'text', content: '{}', create_time: '0' },
        sender: { sender_type: 'user', sender_id: {} },
      };

      await handlers()['im.message.receive_v1'](msgData);
      expect(badHandler).toHaveBeenCalled();
    });
  });

  // ── Event dispatcher: other handlers ────────────────────────────────

  describe('event dispatch: other event handlers', () => {
    it('dispatches message read event', async () => {
      const h = vi.fn();
      client.onMessageRead(h);
      await handlers()['im.message.message_read_v1']({});
      expect(h).toHaveBeenCalled();
    });

    it('dispatches message recalled event', async () => {
      const h = vi.fn();
      client.onMessageRecalled(h);
      await handlers()['im.message.recalled_v1']({});
      expect(h).toHaveBeenCalled();
    });

    it('dispatches reaction created event', async () => {
      const h = vi.fn();
      client.onReactionCreated(h);
      await handlers()['im.message.reaction.created_v1']({});
      expect(h).toHaveBeenCalled();
    });

    it('dispatches reaction deleted event', async () => {
      const h = vi.fn();
      client.onReactionDeleted(h);
      await handlers()['im.message.reaction.deleted_v1']({});
      expect(h).toHaveBeenCalled();
    });

    it('dispatches chat disbanded event', async () => {
      const h = vi.fn();
      client.onChatDisbanded(h);
      await handlers()['im.chat.disbanded_v1']({});
      expect(h).toHaveBeenCalled();
    });

    it('dispatches chat updated event', async () => {
      const h = vi.fn();
      client.onChatUpdated(h);
      await handlers()['im.chat.updated_v1']({});
      expect(h).toHaveBeenCalled();
    });

    it('dispatches chat member added event', async () => {
      const h = vi.fn();
      client.onChatMemberAdded(h);
      await handlers()['im.chat.member.user.added_v1']({});
      expect(h).toHaveBeenCalled();
    });

    it('dispatches chat member deleted event', async () => {
      const h = vi.fn();
      client.onChatMemberDeleted(h);
      await handlers()['im.chat.member.user.deleted_v1']({});
      expect(h).toHaveBeenCalled();
    });

    it('dispatches bot added event', async () => {
      const h = vi.fn();
      client.onBotAdded(h);
      await handlers()['im.chat.member.bot.added_v1']({});
      expect(h).toHaveBeenCalled();
    });

    it('dispatches bot deleted event', async () => {
      const h = vi.fn();
      client.onBotDeleted(h);
      await handlers()['im.chat.member.bot.deleted_v1']({});
      expect(h).toHaveBeenCalled();
    });

    it('dispatches P2P chat created event', async () => {
      const h = vi.fn();
      client.onP2PChatCreated(h);
      await handlers()['p2p_chat_create']({});
      expect(h).toHaveBeenCalled();
    });

    it('dispatches P2P chat entered event', async () => {
      const h = vi.fn();
      client.onP2PChatEntered(h);
      await handlers()['im.chat.access_event.bot_p2p_chat_entered_v1']({});
      expect(h).toHaveBeenCalled();
    });

    // Error catching in each handler type
    it('catches error in message read handler', async () => {
      client.onMessageRead(vi.fn().mockRejectedValue(new Error('x')));
      await handlers()['im.message.message_read_v1']({});
    });

    it('catches error in message recalled handler', async () => {
      client.onMessageRecalled(vi.fn().mockRejectedValue(new Error('x')));
      await handlers()['im.message.recalled_v1']({});
    });

    it('catches error in reaction created handler', async () => {
      client.onReactionCreated(vi.fn().mockRejectedValue(new Error('x')));
      await handlers()['im.message.reaction.created_v1']({});
    });

    it('catches error in reaction deleted handler', async () => {
      client.onReactionDeleted(vi.fn().mockRejectedValue(new Error('x')));
      await handlers()['im.message.reaction.deleted_v1']({});
    });

    it('catches error in chat disbanded handler', async () => {
      client.onChatDisbanded(vi.fn().mockRejectedValue(new Error('x')));
      await handlers()['im.chat.disbanded_v1']({});
    });

    it('catches error in chat updated handler', async () => {
      client.onChatUpdated(vi.fn().mockRejectedValue(new Error('x')));
      await handlers()['im.chat.updated_v1']({});
    });

    it('catches error in chat member added handler', async () => {
      client.onChatMemberAdded(vi.fn().mockRejectedValue(new Error('x')));
      await handlers()['im.chat.member.user.added_v1']({});
    });

    it('catches error in chat member deleted handler', async () => {
      client.onChatMemberDeleted(vi.fn().mockRejectedValue(new Error('x')));
      await handlers()['im.chat.member.user.deleted_v1']({});
    });

    it('catches error in bot added handler', async () => {
      client.onBotAdded(vi.fn().mockRejectedValue(new Error('x')));
      await handlers()['im.chat.member.bot.added_v1']({});
    });

    it('catches error in bot deleted handler', async () => {
      client.onBotDeleted(vi.fn().mockRejectedValue(new Error('x')));
      await handlers()['im.chat.member.bot.deleted_v1']({});
    });

    it('catches error in P2P chat created handler', async () => {
      client.onP2PChatCreated(vi.fn().mockRejectedValue(new Error('x')));
      await handlers()['p2p_chat_create']({});
    });

    it('catches error in P2P chat entered handler', async () => {
      client.onP2PChatEntered(vi.fn().mockRejectedValue(new Error('x')));
      await handlers()['im.chat.access_event.bot_p2p_chat_entered_v1']({});
    });
  });

  // ── Event dispatch: card callback ───────────────────────────────────

  describe('event dispatch: card callback', () => {
    it('dispatches card action to CardCallbackHandler', async () => {
      const data = { action: { tag: 'button', value: { key: 'confirm' } } };
      await handlers()['card.action.trigger'](data);
      expect(mockHandleCallback).toHaveBeenCalledWith(data);
    });

    it('catches card callback handler error', async () => {
      mockHandleCallback.mockRejectedValueOnce(new Error('callback fail'));
      await handlers()['card.action.trigger']({});
      // Should not throw
    });
  });

  // ── send methods on started client ──────────────────────────────────

  describe('send methods on started client', () => {
    it('sendPostMessage delegates to send module', async () => {
      await client.sendPostMessage('r1', 'chat_id', 'content', { title: 'T' });
      expect(mockSendPostMessage).toHaveBeenCalled();
    });

    it('sendMarkdownMessage delegates to send module', async () => {
      await client.sendMarkdownMessage('r1', 'chat_id', '**bold**', { title: 'T' });
      expect(mockSendMarkdownMessage).toHaveBeenCalled();
    });

    it('sendMarkdownCard delegates to send module', async () => {
      await client.sendMarkdownCard('r1', 'chat_id', '**bold**', { title: 'T' });
      expect(mockSendMarkdownCard).toHaveBeenCalled();
    });
  });

  // ── replyPost: withdrawn message branch ─────────────────────────────

  describe('replyPost withdrawn message', () => {
    it('handles withdrawn message (code 230011) gracefully', async () => {
      mockLarkClientReply.mockResolvedValueOnce({ code: 230011, msg: 'withdrawn' });
      await client.replyMarkdown('msg_id', 'Title', '**bold**');
    });

    it('handles not found message (code 231003) gracefully', async () => {
      mockLarkClientReply.mockResolvedValueOnce({ code: 231003, msg: 'not found' });
      await client.replyMarkdown('msg_id', 'Title', 'text');
    });

    it('throws on other replyPost error codes', async () => {
      mockLarkClientReply.mockResolvedValueOnce({ code: 99999, msg: 'other error' });
      await expect(client.replyMarkdown('msg_id', 'T', 'text')).rejects.toThrow('Reply post failed');
    });
  });

  // ── sendCardMessage ─────────────────────────────────────────────────

  describe('sendCardMessage', () => {
    it('sends card message successfully', async () => {
      mockLarkClientCreate.mockResolvedValueOnce({ code: 0, data: { message_id: 'card_1' } });
      await client.sendCardMessage('r1', 'chat_id', 'Card Title', 'Card content');
      expect(mockLarkClientCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ msg_type: 'interactive' }),
        }),
      );
    });

    it('throws on send card failure', async () => {
      mockLarkClientCreate.mockResolvedValueOnce({ code: 500, msg: 'failed' });
      await expect(client.sendCardMessage('r1', 'chat_id', 'T', 'C')).rejects.toThrow('Send card failed');
    });
  });

  // ── replyTextSmart / containsMarkdown ───────────────────────────────

  describe('replyTextSmart / containsMarkdown', () => {
    it('uses post format for strikethrough text', async () => {
      await client.replyTextSmart('msg_1', '~~deleted~~');
      expect(mockLarkClientReply).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ msg_type: 'post' }),
        }),
      );
    });

    it('uses post format for blockquote text', async () => {
      await client.replyTextSmart('msg_1', '> quoted text');
      expect(mockLarkClientReply).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ msg_type: 'post' }),
        }),
      );
    });

    it('uses post format for horizontal rule', async () => {
      await client.replyTextSmart('msg_1', 'text\n---\nmore');
      expect(mockLarkClientReply).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ msg_type: 'post' }),
        }),
      );
    });

    it('uses plain text for simple content without markdown', async () => {
      await client.replyTextSmart('msg_1', 'hello world');
      expect(mockLarkClientReply).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ msg_type: 'text' }),
        }),
      );
    });
  });

  // ── reconnect / stop ────────────────────────────────────────────────

  describe('reconnect logic', () => {
    it('configureReconnect updates options', () => {
      client.configureReconnect({ enabled: false, maxAttempts: 1 });
      const status = client.getReconnectStatus();
      expect(status.intentionalStop).toBe(false);
    });

    it('getReconnectStatus reflects connected state', () => {
      const status = client.getReconnectStatus();
      expect(status.connected).toBe(true);
      expect(status.reconnecting).toBe(false);
    });

    it('stop sets intentionalStop', () => {
      client.stop();
      const status = client.getReconnectStatus();
      expect(status.intentionalStop).toBe(true);
      expect(status.connected).toBe(false);
    });
  });

  // ── start with loggerLevel variants ─────────────────────────────────

  describe('start with loggerLevel variants', () => {
    it('starts with debug loggerLevel', async () => {
      const c = new FeishuWSClient({ ...testConfig, loggerLevel: 'debug' });
      await c.start();
      expect(c.connected).toBe(true);
      c.stop();
    });

    it('starts with info loggerLevel', async () => {
      const c = new FeishuWSClient({ ...testConfig, loggerLevel: 'info' });
      await c.start();
      expect(c.connected).toBe(true);
      c.stop();
    });

    it('starts with warn loggerLevel', async () => {
      const c = new FeishuWSClient({ ...testConfig, loggerLevel: 'warn' });
      await c.start();
      expect(c.connected).toBe(true);
      c.stop();
    });

    it('starts with error loggerLevel', async () => {
      const c = new FeishuWSClient({ ...testConfig, loggerLevel: 'error' });
      await c.start();
      expect(c.connected).toBe(true);
      c.stop();
    });
  });
});
