/**
 * Tests for ws-client.ts
 *
 * Tests FeishuWSClient class: constructor, event handler registration/removal,
 * message parsing, user/chat/message ID extraction, card building,
 * singleton management, and reconnect configuration.
 *
 * Heavy SDK interactions (start/stop/send) are tested via mocks.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock logger
vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    debug: vi.fn(() => {}),
    info: vi.fn(() => {}),
    warn: vi.fn(() => {}),
    error: vi.fn(() => {}),
  },
}));

// Mock send functions
vi.mock('../send', () => ({
  sendPostMessage: vi.fn(() => Promise.resolve({ messageId: 'msg_post' })),
  sendMarkdownMessage: vi.fn(() => Promise.resolve({ messageId: 'msg_md' })),
  sendMarkdownCard: vi.fn(() => Promise.resolve({ messageId: 'msg_card' })),
}));

// Mock CardCallbackHandler
vi.mock('../card-callback-handler', () => ({
  CardCallbackHandler: class MockCardCallbackHandler {
    handleCallback = vi.fn(() => Promise.resolve());
  },
}));

// Mock Lark SDK
const mockWSClientStart = vi.fn(() => Promise.resolve());
const mockLarkClientCreate = vi.fn(() => Promise.resolve({ code: 0, data: { message_id: 'msg_1' } }));
const mockLarkClientReply = vi.fn(() => Promise.resolve({ code: 0, data: { message_id: 'msg_reply' } }));
const mockLarkClientPatch = vi.fn(() => Promise.resolve({ code: 0 }));
const mockReactionCreate = vi.fn(() => Promise.resolve({ code: 0, data: { reaction: { reaction_id: 'r_1' } } }));
const mockReactionDelete = vi.fn(() => Promise.resolve({ code: 0 }));

vi.mock('@larksuiteoapi/node-sdk', () => ({
  Client: class MockClient {
    im = {
      v1: {
        message: {
          create: mockLarkClientCreate,
          reply: mockLarkClientReply,
          patch: mockLarkClientPatch,
        },
        messageReaction: {
          create: mockReactionCreate,
          delete: mockReactionDelete,
        },
      },
    };
  },
  WSClient: class MockWSClient {
    start = mockWSClientStart;
  },
  EventDispatcher: class MockEventDispatcher {
    constructor() {}
    register(handlers: any) {
      return this;
    }
  },
  LoggerLevel: {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  },
  messageCard: {
    defaultCard: vi.fn((opts: any) => JSON.stringify({ title: opts.title, content: opts.content })),
  },
}));

import {
  FeishuWSClient,
  initFeishuWSClient,
  getFeishuWSClient,
  resetFeishuWSClient,
} from '../ws-client';
import type { MessageEventData, FeishuWSConfig } from '../ws-client';

const testConfig: FeishuWSConfig = {
  appId: 'app_test',
  appSecret: 'secret_test',
  enabled: true,
};

describe('ws-client', () => {
  beforeEach(() => {
    resetFeishuWSClient();
    mockWSClientStart.mockClear();
    mockLarkClientCreate.mockClear();
    mockLarkClientReply.mockClear();
    mockLarkClientPatch.mockClear();
    mockReactionCreate.mockClear();
    mockReactionDelete.mockClear();
    mockWSClientStart.mockResolvedValue(undefined);
    mockLarkClientCreate.mockResolvedValue({ code: 0, data: { message_id: 'msg_1' } });
    mockLarkClientReply.mockResolvedValue({ code: 0, data: { message_id: 'msg_reply' } });
    mockLarkClientPatch.mockResolvedValue({ code: 0 });
    mockReactionCreate.mockResolvedValue({ code: 0, data: { reaction: { reaction_id: 'r_1' } } });
    mockReactionDelete.mockResolvedValue({ code: 0 });
  });

  afterEach(() => {
    resetFeishuWSClient();
  });

  // ===================== Constructor & Properties =====================
  describe('constructor & properties', () => {
    it('creates client with config', () => {
      const client = new FeishuWSClient(testConfig);
      expect(client).toBeDefined();
      expect(client.isEnabled).toBe(true);
      expect(client.connected).toBe(false);
    });

    it('respects enabled=false', () => {
      const client = new FeishuWSClient({ ...testConfig, enabled: false });
      expect(client.isEnabled).toBe(false);
    });

    it('lastActiveChatId and lastActiveUserId are null initially', () => {
      const client = new FeishuWSClient(testConfig);
      expect(client.lastActiveChatId).toBeNull();
      expect(client.lastActiveUserId).toBeNull();
    });
  });

  // ===================== Event Handler Registration =====================
  describe('event handler registration', () => {
    it('registers and removes message handler', () => {
      const client = new FeishuWSClient(testConfig);
      const handler = vi.fn(() => {});
      client.onMessage(handler);
      client.offMessage(handler);
    });

    it('registers and removes message read handler', () => {
      const client = new FeishuWSClient(testConfig);
      const handler = vi.fn(() => {});
      client.onMessageRead(handler);
      client.offMessageRead(handler);
    });

    it('registers and removes message recalled handler', () => {
      const client = new FeishuWSClient(testConfig);
      const handler = vi.fn(() => {});
      client.onMessageRecalled(handler);
      client.offMessageRecalled(handler);
    });

    it('registers and removes reaction handlers', () => {
      const client = new FeishuWSClient(testConfig);
      const h1 = vi.fn(() => {});
      const h2 = vi.fn(() => {});
      client.onReactionCreated(h1);
      client.offReactionCreated(h1);
      client.onReactionDeleted(h2);
      client.offReactionDeleted(h2);
    });

    it('registers chat event handlers', () => {
      const client = new FeishuWSClient(testConfig);
      client.onChatDisbanded(vi.fn(() => {}));
      client.onChatUpdated(vi.fn(() => {}));
      client.onChatMemberAdded(vi.fn(() => {}));
      client.onChatMemberDeleted(vi.fn(() => {}));
    });

    it('registers bot event handlers', () => {
      const client = new FeishuWSClient(testConfig);
      client.onBotAdded(vi.fn(() => {}));
      client.onBotDeleted(vi.fn(() => {}));
    });

    it('registers P2P event handlers', () => {
      const client = new FeishuWSClient(testConfig);
      client.onP2PChatCreated(vi.fn(() => {}));
      client.onP2PChatEntered(vi.fn(() => {}));
    });

    it('offMessage is safe for unregistered handler', () => {
      const client = new FeishuWSClient(testConfig);
      client.offMessage(vi.fn(() => {})); // Should not throw
    });
  });

  // ===================== start / stop =====================
  describe('start', () => {
    it('skips start when disabled', async () => {
      const client = new FeishuWSClient({ ...testConfig, enabled: false });
      await client.start();
      expect(client.connected).toBe(false);
      expect(mockWSClientStart).not.toHaveBeenCalled();
    });

    it('throws when appId is missing', async () => {
      const client = new FeishuWSClient({ ...testConfig, appId: '' });
      await expect(client.start()).rejects.toThrow('Missing appId or appSecret');
    });

    it('throws when appSecret is missing', async () => {
      const client = new FeishuWSClient({ ...testConfig, appSecret: '' });
      await expect(client.start()).rejects.toThrow('Missing appId or appSecret');
    });

    it('connects successfully', async () => {
      const client = new FeishuWSClient(testConfig);
      await client.start();
      expect(client.connected).toBe(true);
    });

    it('sets connected=false and schedules reconnect on failure', async () => {
      mockWSClientStart.mockRejectedValueOnce(new Error('connection failed'));
      const client = new FeishuWSClient(testConfig);
      await expect(client.start()).rejects.toThrow('connection failed');
      expect(client.connected).toBe(false);
    });
  });

  describe('stop', () => {
    it('stops and disconnects', async () => {
      const client = new FeishuWSClient(testConfig);
      await client.start();
      expect(client.connected).toBe(true);
      client.stop();
      expect(client.connected).toBe(false);
    });

    it('stop is safe when not started', () => {
      const client = new FeishuWSClient(testConfig);
      client.stop(); // Should not throw
    });
  });

  // ===================== configureReconnect / getReconnectStatus =====================
  describe('reconnect configuration', () => {
    it('configures reconnect options', () => {
      const client = new FeishuWSClient(testConfig);
      client.configureReconnect({
        enabled: false,
        maxAttempts: 5,
        initialDelayMs: 2000,
      });
      const status = client.getReconnectStatus();
      expect(status.connected).toBe(false);
      expect(status.intentionalStop).toBe(false);
    });

    it('returns reconnect status', async () => {
      const client = new FeishuWSClient(testConfig);
      await client.start();
      const status = client.getReconnectStatus();
      expect(status.connected).toBe(true);
      expect(status.reconnecting).toBe(false);
      expect(status.attempt).toBe(0);
    });
  });

  // ===================== parseMessageContent =====================
  describe('parseMessageContent', () => {
    let client: FeishuWSClient;

    beforeEach(() => {
      client = new FeishuWSClient(testConfig);
    });

    it('parses text message', () => {
      const data = {
        message: { content: JSON.stringify({ text: 'Hello World' }) },
      } as MessageEventData;
      expect(client.parseMessageContent(data)).toBe('Hello World');
    });

    it('parses rich text message with title', () => {
      const data = {
        message: {
          content: JSON.stringify({
            title: 'Title',
            content: [[{ text: 'Body' }]],
          }),
        },
      } as MessageEventData;
      expect(client.parseMessageContent(data)).toContain('Title');
      expect(client.parseMessageContent(data)).toContain('Body');
    });

    it('returns empty string for missing content', () => {
      const data = { message: {} } as MessageEventData;
      expect(client.parseMessageContent(data)).toBe('');
    });

    it('returns raw content on parse failure', () => {
      const data = { message: { content: 'not-json' } } as MessageEventData;
      expect(client.parseMessageContent(data)).toBe('not-json');
    });

    it('returns raw content for unknown structure', () => {
      const data = {
        message: { content: JSON.stringify({ unknown: true }) },
      } as MessageEventData;
      expect(client.parseMessageContent(data)).toBe(JSON.stringify({ unknown: true }));
    });
  });

  // ===================== extract* methods =====================
  describe('extract methods', () => {
    let client: FeishuWSClient;

    beforeEach(() => {
      client = new FeishuWSClient(testConfig);
    });

    it('extractUserId returns open_id', () => {
      const data = { sender: { sender_id: { open_id: 'ou_1' } } } as MessageEventData;
      expect(client.extractUserId(data)).toBe('ou_1');
    });

    it('extractUserId falls back to user_id', () => {
      const data = { sender: { sender_id: { user_id: 'u_1' } } } as MessageEventData;
      expect(client.extractUserId(data)).toBe('u_1');
    });

    it('extractUserId falls back to union_id', () => {
      const data = { sender: { sender_id: { union_id: 'un_1' } } } as MessageEventData;
      expect(client.extractUserId(data)).toBe('un_1');
    });

    it('extractUserId returns "unknown" for missing sender', () => {
      const data = { sender: {} } as MessageEventData;
      expect(client.extractUserId(data)).toBe('unknown');
    });

    it('extractChatId returns chat_id', () => {
      const data = { message: { chat_id: 'oc_1' } } as MessageEventData;
      expect(client.extractChatId(data)).toBe('oc_1');
    });

    it('extractChatId returns empty for missing message', () => {
      const data = {} as MessageEventData;
      expect(client.extractChatId(data)).toBe('');
    });

    it('extractMessageId returns message_id', () => {
      const data = { message: { message_id: 'msg_1' } } as MessageEventData;
      expect(client.extractMessageId(data)).toBe('msg_1');
    });

    it('extractMessageType returns message_type', () => {
      const data = { message: { message_type: 'post' } } as MessageEventData;
      expect(client.extractMessageType(data)).toBe('post');
    });

    it('extractMessageType defaults to "text"', () => {
      const data = { message: {} } as MessageEventData;
      expect(client.extractMessageType(data)).toBe('text');
    });
  });

  // ===================== buildSimpleCard / buildSectionCard =====================
  describe('card building', () => {
    let client: FeishuWSClient;

    beforeEach(() => {
      client = new FeishuWSClient(testConfig);
    });

    it('buildSimpleCard returns valid JSON', () => {
      const card = client.buildSimpleCard('Title', '**content**');
      const parsed = JSON.parse(card);
      expect(parsed.header.title.content).toBe('Title');
      expect(parsed.elements[0].content).toBe('**content**');
    });

    it('buildSimpleCard uses custom color', () => {
      const card = client.buildSimpleCard('T', 'C', 'green');
      const parsed = JSON.parse(card);
      expect(parsed.header.template).toBe('green');
    });

    it('buildSimpleCard defaults to blue', () => {
      const card = client.buildSimpleCard('T', 'C');
      const parsed = JSON.parse(card);
      expect(parsed.header.template).toBe('blue');
    });

    it('buildSectionCard returns valid JSON with sections', () => {
      const card = client.buildSectionCard('Title', [
        { header: 'H1', content: 'C1' },
        { content: 'C2' },
      ]);
      const parsed = JSON.parse(card);
      expect(parsed.header.title.content).toBe('Title');
      expect(parsed.elements.length).toBeGreaterThanOrEqual(2);
    });

    it('buildSectionCard removes trailing hr', () => {
      const card = client.buildSectionCard('T', [{ content: 'C' }]);
      const parsed = JSON.parse(card);
      const lastElem = parsed.elements[parsed.elements.length - 1];
      expect(lastElem.tag).not.toBe('hr');
    });
  });

  // ===================== Singleton Management =====================
  describe('singleton management', () => {
    it('initFeishuWSClient creates and returns client', () => {
      const client = initFeishuWSClient(testConfig);
      expect(client).toBeInstanceOf(FeishuWSClient);
      expect(getFeishuWSClient()).toBe(client);
    });

    it('getFeishuWSClient returns null before init', () => {
      expect(getFeishuWSClient()).toBeNull();
    });

    it('resetFeishuWSClient clears instance', async () => {
      const client = initFeishuWSClient(testConfig);
      await client.start();
      resetFeishuWSClient();
      expect(getFeishuWSClient()).toBeNull();
    });
  });

  // ===================== Send methods (require started client) =====================
  describe('send methods', () => {
    let client: FeishuWSClient;

    beforeEach(async () => {
      client = new FeishuWSClient(testConfig);
      await client.start();
    });

    afterEach(() => {
      client.stop();
    });

    it('sendTextMessage sends text', async () => {
      await client.sendTextMessage('oc_1', 'chat_id', 'Hello');
      expect(mockLarkClientCreate).toHaveBeenCalledTimes(1);
    });

    it('sendTextMessage throws on error code', async () => {
      mockLarkClientCreate.mockResolvedValue({ code: 99999, msg: 'fail' });
      await expect(client.sendTextMessage('oc_1', 'chat_id', 'Hello'))
        .rejects.toThrow('Send message failed');
    });

    it('replyText replies to message', async () => {
      await client.replyText('msg_parent', 'Reply');
      expect(mockLarkClientReply).toHaveBeenCalledTimes(1);
    });

    it('replyText handles withdrawn message gracefully', async () => {
      mockLarkClientReply.mockResolvedValue({ code: 230011, msg: 'withdrawn' });
      // Should not throw
      await client.replyText('msg_parent', 'Reply');
    });

    it('replyText throws on other errors', async () => {
      mockLarkClientReply.mockResolvedValue({ code: 99999, msg: 'fail' });
      await expect(client.replyText('msg_parent', 'Reply'))
        .rejects.toThrow('Reply message failed');
    });

    it('sendCard sends card and returns message_id', async () => {
      const msgId = await client.sendCard('oc_1', 'chat_id', '{"elements":[]}');
      expect(msgId).toBe('msg_1');
    });

    it('sendCard accepts object card', async () => {
      const msgId = await client.sendCard('oc_1', 'chat_id', { elements: [] } as any);
      expect(msgId).toBe('msg_1');
    });

    it('sendCard throws on error', async () => {
      mockLarkClientCreate.mockResolvedValue({ code: 99999, msg: 'fail' });
      await expect(client.sendCard('oc_1', 'chat_id', '{}'))
        .rejects.toThrow('Send card failed');
    });

    it('replyCard replies with card', async () => {
      const msgId = await client.replyCard('msg_1', '{"elements":[]}');
      expect(msgId).toBe('msg_reply');
    });

    it('replyCard handles withdrawn message', async () => {
      mockLarkClientReply.mockResolvedValue({ code: 230011, msg: 'withdrawn' });
      await expect(client.replyCard('msg_1', '{}'))
        .rejects.toThrow('Message withdrawn');
    });

    it('patchCard updates card', async () => {
      await client.patchCard('msg_1', '{"elements":[]}');
      expect(mockLarkClientPatch).toHaveBeenCalledTimes(1);
    });

    it('patchCard throws on error', async () => {
      mockLarkClientPatch.mockResolvedValue({ code: 99999, msg: 'fail' });
      await expect(client.patchCard('msg_1', '{}'))
        .rejects.toThrow('Patch card failed');
    });

    it('patchCard handles withdrawn', async () => {
      mockLarkClientPatch.mockResolvedValue({ code: 230011, msg: 'withdrawn' });
      await expect(client.patchCard('msg_1', '{}'))
        .rejects.toThrow('Message withdrawn');
    });

    it('addReaction returns reaction_id', async () => {
      const id = await client.addReaction('msg_1', 'THUMBSUP');
      expect(id).toBe('r_1');
    });

    it('addReaction returns null on error', async () => {
      mockReactionCreate.mockResolvedValue({ code: 99999, msg: 'fail' });
      const id = await client.addReaction('msg_1', 'THUMBSUP');
      expect(id).toBeNull();
    });

    it('addReaction returns null on exception', async () => {
      mockReactionCreate.mockRejectedValue(new Error('network'));
      const id = await client.addReaction('msg_1', 'THUMBSUP');
      expect(id).toBeNull();
    });

    it('deleteReaction deletes reaction', async () => {
      await client.deleteReaction('msg_1', 'r_1');
      expect(mockReactionDelete).toHaveBeenCalledTimes(1);
    });

    it('deleteReaction handles error gracefully', async () => {
      mockReactionDelete.mockResolvedValue({ code: 99999, msg: 'fail' });
      await client.deleteReaction('msg_1', 'r_1'); // Should not throw
    });

    it('deleteReaction handles exception gracefully', async () => {
      mockReactionDelete.mockRejectedValue(new Error('network'));
      await client.deleteReaction('msg_1', 'r_1'); // Should not throw
    });
  });

  // ===================== Methods that require client to be null =====================
  describe('methods before start', () => {
    it('sendTextMessage throws when not started', async () => {
      const client = new FeishuWSClient(testConfig);
      await expect(client.sendTextMessage('oc_1', 'chat_id', 'Hi'))
        .rejects.toThrow('Client not initialized');
    });

    it('replyText throws when not started', async () => {
      const client = new FeishuWSClient(testConfig);
      await expect(client.replyText('msg_1', 'Hi'))
        .rejects.toThrow('Client not initialized');
    });

    it('sendCard throws when not started', async () => {
      const client = new FeishuWSClient(testConfig);
      await expect(client.sendCard('oc_1', 'chat_id', '{}'))
        .rejects.toThrow('Client not initialized');
    });

    it('patchCard throws when not started', async () => {
      const client = new FeishuWSClient(testConfig);
      await expect(client.patchCard('msg_1', '{}'))
        .rejects.toThrow('Client not initialized');
    });

    it('addReaction throws when not started', async () => {
      const client = new FeishuWSClient(testConfig);
      await expect(client.addReaction('msg_1', 'THUMBSUP'))
        .rejects.toThrow('Client not initialized');
    });

    it('deleteReaction throws when not started', async () => {
      const client = new FeishuWSClient(testConfig);
      await expect(client.deleteReaction('msg_1', 'r_1'))
        .rejects.toThrow('Client not initialized');
    });

    it('sendPostMessage throws when not started', async () => {
      const client = new FeishuWSClient(testConfig);
      await expect(client.sendPostMessage('oc_1', 'chat_id', 'content'))
        .rejects.toThrow('Client not initialized');
    });

    it('sendMarkdownMessage throws when not started', async () => {
      const client = new FeishuWSClient(testConfig);
      await expect(client.sendMarkdownMessage('oc_1', 'chat_id', '**md**'))
        .rejects.toThrow('Client not initialized');
    });

    it('sendMarkdownCard throws when not started', async () => {
      const client = new FeishuWSClient(testConfig);
      await expect(client.sendMarkdownCard('oc_1', 'chat_id', '**md**'))
        .rejects.toThrow('Client not initialized');
    });

    it('replyCard throws when not started', async () => {
      const client = new FeishuWSClient(testConfig);
      await expect(client.replyCard('msg_1', '{}'))
        .rejects.toThrow('Client not initialized');
    });

    it('replyPost throws when not started', async () => {
      const client = new FeishuWSClient(testConfig);
      await expect(client.replyPost('msg_1', { blocks: [] }))
        .rejects.toThrow('Client not initialized');
    });

    it('sendCardMessage throws when not started', async () => {
      const client = new FeishuWSClient(testConfig);
      await expect(client.sendCardMessage('oc_1', 'chat_id', 'Title', 'Content'))
        .rejects.toThrow('Client not initialized');
    });
  });

  // ===================== replyTextSmart =====================
  describe('replyTextSmart', () => {
    let client: FeishuWSClient;

    beforeEach(async () => {
      client = new FeishuWSClient(testConfig);
      await client.start();
    });

    afterEach(() => {
      client.stop();
    });

    it('uses plain text for simple content', async () => {
      await client.replyTextSmart('msg_1', 'Hello world');
      expect(mockLarkClientReply).toHaveBeenCalledTimes(1);
      const call = mockLarkClientReply.mock.calls[0][0];
      expect(call.data.msg_type).toBe('text');
    });

    it('uses post format for markdown content with bold', async () => {
      await client.replyTextSmart('msg_1', 'Hello **world**');
      expect(mockLarkClientReply).toHaveBeenCalledTimes(1);
      const call = mockLarkClientReply.mock.calls[0][0];
      expect(call.data.msg_type).toBe('post');
    });

    it('detects code blocks as markdown', async () => {
      await client.replyTextSmart('msg_1', 'Run `npm install`');
      const call = mockLarkClientReply.mock.calls[0][0];
      expect(call.data.msg_type).toBe('post');
    });

    it('detects headings as markdown', async () => {
      await client.replyTextSmart('msg_1', '# Title\nBody');
      const call = mockLarkClientReply.mock.calls[0][0];
      expect(call.data.msg_type).toBe('post');
    });

    it('detects lists as markdown', async () => {
      await client.replyTextSmart('msg_1', '- item 1\n- item 2');
      const call = mockLarkClientReply.mock.calls[0][0];
      expect(call.data.msg_type).toBe('post');
    });

    it('detects links as markdown', async () => {
      await client.replyTextSmart('msg_1', 'Visit [Google](https://google.com)');
      const call = mockLarkClientReply.mock.calls[0][0];
      expect(call.data.msg_type).toBe('post');
    });
  });

  // ===================== Type exports =====================
  describe('type exports', () => {
    it('MessageEventData is constructible', () => {
      const data: MessageEventData = {
        sender: { sender_id: { open_id: 'ou_1' } },
        message: {
          message_id: 'msg_1',
          create_time: '123',
          chat_id: 'oc_1',
          chat_type: 'p2p',
          message_type: 'text',
          content: '{}',
        },
      };
      expect(data.message.message_id).toBe('msg_1');
    });
  });
});
