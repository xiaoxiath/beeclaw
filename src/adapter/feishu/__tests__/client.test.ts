import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { FeishuClient, initFeishuClient, getFeishuClient, resetFeishuClient } from '../client';
import type { MessageEvent, FeishuAuthConfig } from '../types';

describe('FeishuClient', () => {
  const testConfig: FeishuAuthConfig = {
    enabled: true,
    appId: 'test_app_id',
    appSecret: 'test_app_secret',
  };

  let client: FeishuClient;

  beforeEach(() => {
    resetFeishuClient();
    client = new FeishuClient(testConfig);
  });

  afterEach(() => {
    resetFeishuClient();
  });

  describe('constructor', () => {
    test('creates client with config', () => {
      expect(client).toBeDefined();
      expect(client.isEnabled).toBe(true);
    });

    test('respects enabled flag', () => {
      const disabledClient = new FeishuClient({ ...testConfig, enabled: false });
      expect(disabledClient.isEnabled).toBe(false);
    });
  });

  describe('isEnabled', () => {
    test('returns true when enabled', () => {
      expect(client.isEnabled).toBe(true);
    });

    test('returns false when disabled', () => {
      const disabledClient = new FeishuClient({ ...testConfig, enabled: false });
      expect(disabledClient.isEnabled).toBe(false);
    });
  });

  describe('parseMessageContent', () => {
    test('parses text message', () => {
      const event = {
        event: {
          message: {
            content: '{"text":"Hello World"}',
            message_type: 'text',
          },
        },
      } as MessageEvent;

      const content = client.parseMessageContent(event);
      expect(content).toBe('Hello World');
    });

    test('parses plain text content', () => {
      const event = {
        event: {
          message: {
            content: 'Plain text message',
            message_type: 'text',
          },
        },
      } as MessageEvent;

      const content = client.parseMessageContent(event);
      expect(content).toBe('Plain text message');
    });

    test('parses post message', () => {
      const event = {
        event: {
          message: {
            content: JSON.stringify({
              zh_cn: {
                title: '标题',
                content: [[{ text: '段落内容' }]],
              },
            }),
            message_type: 'post',
          },
        },
      } as MessageEvent;

      const content = client.parseMessageContent(event);
      expect(content).toContain('标题');
      expect(content).toContain('段落内容');
    });
  });

  describe('extractUserId', () => {
    test('extracts open_id', () => {
      const event = {
        event: {
          sender: {
            sender_id: {
              open_id: 'ou_xxx',
              user_id: 'user_xxx',
              union_id: 'on_xxx',
            },
          },
        },
      } as MessageEvent;

      const userId = client.extractUserId(event);
      expect(userId).toBe('ou_xxx');
    });

    test('falls back to user_id', () => {
      const event = {
        event: {
          sender: {
            sender_id: {
              user_id: 'user_xxx',
              union_id: 'on_xxx',
            },
          },
        },
      } as MessageEvent;

      const userId = client.extractUserId(event);
      expect(userId).toBe('user_xxx');
    });

    test('falls back to union_id', () => {
      const event = {
        event: {
          sender: {
            sender_id: {
              union_id: 'on_xxx',
            },
          },
        },
      } as MessageEvent;

      const userId = client.extractUserId(event);
      expect(userId).toBe('on_xxx');
    });

    test('returns unknown when no ID available', () => {
      const event = {
        event: {
          sender: {
            sender_id: {},
          },
        },
      } as MessageEvent;

      const userId = client.extractUserId(event);
      expect(userId).toBe('unknown');
    });
  });

  describe('extractChatId', () => {
    test('extracts chat_id', () => {
      const event = {
        event: {
          message: {
            chat_id: 'oc_xxx',
          },
        },
      } as MessageEvent;

      const chatId = client.extractChatId(event);
      expect(chatId).toBe('oc_xxx');
    });
  });

  describe('extractMessageId', () => {
    test('extracts message_id', () => {
      const event = {
        event: {
          message: {
            message_id: 'om_xxx',
          },
        },
      } as MessageEvent;

      const messageId = client.extractMessageId(event);
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

describe('FeishuClient Singleton', () => {
  afterEach(() => {
    resetFeishuClient();
  });

  test('initFeishuClient creates instance', () => {
    const client = initFeishuClient({
      enabled: true,
      appId: 'test',
      appSecret: 'secret',
    });

    expect(client).toBeDefined();
    expect(getFeishuClient()).toBe(client);
  });

  test('getFeishuClient returns null when not initialized', () => {
    resetFeishuClient();
    expect(getFeishuClient()).toBeNull();
  });

  test('resetFeishuClient clears instance', () => {
    initFeishuClient({
      enabled: true,
      appId: 'test',
      appSecret: 'secret',
    });

    expect(getFeishuClient()).not.toBeNull();
    resetFeishuClient();
    expect(getFeishuClient()).toBeNull();
  });
});
