import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the Lark SDK to prevent actual connections
vi.mock('@larksuiteoapi/node-sdk', () => ({
  Client: vi.fn().mockImplementation(() => ({})),
  WSClient: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
  })),
  LoggerLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
}));

vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../send', () => ({
  sendPostMessage: vi.fn(),
  sendMarkdownMessage: vi.fn(),
  sendMarkdownCard: vi.fn(),
}));

vi.mock('../card-callback-handler', () => ({
  CardCallbackHandler: vi.fn().mockImplementation(() => ({})),
}));

import {
  FeishuWSClient,
  initFeishuWSClient,
  getFeishuWSClient,
  resetFeishuWSClient,
} from '../ws-client';
import type { FeishuAuthConfig } from '../types';
import type { MessageEventData } from '../ws-client';

describe('FeishuWSClient', () => {
  const testConfig = {
    enabled: true,
    appId: 'test_app_id',
    appSecret: 'test_app_secret',
  };

  let client: FeishuWSClient;

  beforeEach(() => {
    resetFeishuWSClient();
    client = new FeishuWSClient(testConfig);
  });

  afterEach(() => {
    resetFeishuWSClient();
  });

  describe('constructor', () => {
    test('creates client with config', () => {
      expect(client).toBeDefined();
      expect(client.isEnabled).toBe(true);
    });

    test('respects enabled flag', () => {
      const disabledClient = new FeishuWSClient({ ...testConfig, enabled: false });
      expect(disabledClient.isEnabled).toBe(false);
    });
  });

  describe('isEnabled', () => {
    test('returns true when enabled', () => {
      expect(client.isEnabled).toBe(true);
    });

    test('returns false when disabled', () => {
      const disabledClient = new FeishuWSClient({ ...testConfig, enabled: false });
      expect(disabledClient.isEnabled).toBe(false);
    });
  });

  describe('parseMessageContent', () => {
    test('parses text message', () => {
      const data = {
        message: {
          content: '{"text":"Hello World"}',
          message_type: 'text',
          message_id: 'msg_1',
          create_time: '123',
          chat_id: 'oc_1',
          chat_type: 'p2p',
        },
      } as unknown as MessageEventData;

      const content = client.parseMessageContent(data);
      expect(content).toBe('Hello World');
    });

    test('parses plain text content', () => {
      const data = {
        message: {
          content: 'Plain text message',
          message_type: 'text',
          message_id: 'msg_1',
          create_time: '123',
          chat_id: 'oc_1',
          chat_type: 'p2p',
        },
      } as unknown as MessageEventData;

      const content = client.parseMessageContent(data);
      expect(content).toBe('Plain text message');
    });

    test('parses rich text message', () => {
      const data = {
        message: {
          content: JSON.stringify({
            title: '标题',
            content: [[{ text: '段落内容' }]],
          }),
          message_type: 'post',
          message_id: 'msg_1',
          create_time: '123',
          chat_id: 'oc_1',
          chat_type: 'p2p',
        },
      } as unknown as MessageEventData;

      const content = client.parseMessageContent(data);
      expect(content).toContain('标题');
      expect(content).toContain('段落内容');
    });
  });

  describe('extractUserId', () => {
    test('extracts open_id', () => {
      const data = {
        sender: {
          sender_id: {
            open_id: 'ou_xxx',
            user_id: 'user_xxx',
            union_id: 'on_xxx',
          },
        },
      } as unknown as MessageEventData;

      const userId = client.extractUserId(data);
      expect(userId).toBe('ou_xxx');
    });

    test('falls back to user_id', () => {
      const data = {
        sender: {
          sender_id: {
            user_id: 'user_xxx',
            union_id: 'on_xxx',
          },
        },
      } as unknown as MessageEventData;

      const userId = client.extractUserId(data);
      expect(userId).toBe('user_xxx');
    });

    test('falls back to union_id', () => {
      const data = {
        sender: {
          sender_id: {
            union_id: 'on_xxx',
          },
        },
      } as unknown as MessageEventData;

      const userId = client.extractUserId(data);
      expect(userId).toBe('on_xxx');
    });

    test('returns unknown when no ID available', () => {
      const data = {
        sender: {
          sender_id: {},
        },
      } as unknown as MessageEventData;

      const userId = client.extractUserId(data);
      expect(userId).toBe('unknown');
    });
  });

  describe('extractChatId', () => {
    test('extracts chat_id', () => {
      const data = {
        message: {
          chat_id: 'oc_xxx',
        },
      } as unknown as MessageEventData;

      const chatId = client.extractChatId(data);
      expect(chatId).toBe('oc_xxx');
    });
  });

  describe('extractMessageId', () => {
    test('extracts message_id', () => {
      const data = {
        message: {
          message_id: 'om_xxx',
        },
      } as unknown as MessageEventData;

      const messageId = client.extractMessageId(data);
      expect(messageId).toBe('om_xxx');
    });
  });

  // Note: API calls require network access and valid credentials
  // These tests are skipped in unit tests
  describe('API calls (integration)', () => {
    test.skip('getTenantAccessToken makes API call', async () => {
      // This would require a mock server or real credentials
    });

    test.skip('sendTextMessage sends message', async () => {
      // This would require a mock server or real credentials
    });

    test.skip('replyText replies to message', async () => {
      // This would require a mock server or real credentials
    });

    test.skip('getUserInfo fetches user', async () => {
      // This would require a mock server or real credentials
    });

    test.skip('getChatInfo fetches chat', async () => {
      // This would require a mock server or real credentials
    });
  });
});

describe('FeishuWSClient Singleton', () => {
  afterEach(() => {
    resetFeishuWSClient();
  });

  test('initFeishuWSClient creates instance', () => {
    const client = initFeishuWSClient({
      enabled: true,
      appId: 'test',
      appSecret: 'test_secret',
    });

    expect(client).toBeDefined();
    expect(getFeishuWSClient()).toBe(client);
  });

  test('getFeishuWSClient returns null when not initialized', () => {
    resetFeishuWSClient();
    expect(getFeishuWSClient()).toBeNull();
  });

  test('resetFeishuWSClient clears instance', () => {
    initFeishuWSClient({
      enabled: true,
      appId: 'test',
      appSecret: 'test_secret',
    });

    expect(getFeishuWSClient()).not.toBeNull();
    resetFeishuWSClient();
    expect(getFeishuWSClient()).toBeNull();
  });
});
