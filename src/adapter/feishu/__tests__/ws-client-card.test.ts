import { describe, test, expect, beforeEach, vi } from 'vitest';

// Mock the Lark SDK to prevent bun: protocol error
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

import { FeishuWSClient } from '../ws-client';

describe('FeishuWSClient Card Methods', () => {
  let client: FeishuWSClient;
  let mockLarkClient: any;

  beforeEach(() => {
    // Create mock Lark client
    mockLarkClient = {
      im: {
        v1: {
          message: {
            reply: vi.fn(() =>
              Promise.resolve({
                code: 0,
                msg: 'success',
                data: {
                  message_id: 'msg_new_123',
                },
              })
            ),
            patch: vi.fn(() =>
              Promise.resolve({
                code: 0,
                msg: 'success',
              })
            ),
          },
        },
      },
    };

    // Create FeishuWSClient
    client = new FeishuWSClient({
      appId: 'test_app_id',
      appSecret: 'test_app_secret',
      enabled: true,
    });

    // Inject mock client
    (client as any).client = mockLarkClient;
  });

  describe('replyCard', () => {
    test('should send card reply and return message ID', async () => {
      const messageId = await client.replyCard('msg_parent', {
        config: { wide_screen_mode: true },
        elements: [{ tag: 'markdown', content: 'Test' }],
      });

      expect(messageId).toBe('msg_new_123');
      expect(mockLarkClient.im.v1.message.reply).toHaveBeenCalledTimes(1);
    });

    test('should accept card as string', async () => {
      const cardString = JSON.stringify({
        config: { wide_screen_mode: true },
        elements: [{ tag: 'markdown', content: 'Test' }],
      });

      const messageId = await client.replyCard('msg_parent', cardString);

      expect(messageId).toBe('msg_new_123');
    });

    test('should handle error code 230011 (message withdrawn)', async () => {
      mockLarkClient.im.v1.message.reply = vi.fn(() =>
        Promise.resolve({
          code: 230011,
          msg: 'message not found',
        })
      );

      await expect(
        client.replyCard('msg_parent', { config: {}, elements: [] })
      ).rejects.toThrow('Message withdrawn');
    });

    test('should handle error code 231003 (message not found)', async () => {
      mockLarkClient.im.v1.message.reply = vi.fn(() =>
        Promise.resolve({
          code: 231003,
          msg: 'message not found',
        })
      );

      await expect(
        client.replyCard('msg_parent', { config: {}, elements: [] })
      ).rejects.toThrow('Message withdrawn');
    });

    test('should throw on other errors', async () => {
      mockLarkClient.im.v1.message.reply = vi.fn(() =>
        Promise.resolve({
          code: 400,
          msg: 'Bad request',
        })
      );

      await expect(
        client.replyCard('msg_parent', { config: {}, elements: [] })
      ).rejects.toThrow('Reply card failed');
    });

    test('should throw if client not initialized', async () => {
      (client as any).client = null;

      await expect(
        client.replyCard('msg_parent', { config: {}, elements: [] })
      ).rejects.toThrow('Client not initialized');
    });
  });

  describe('patchCard', () => {
    test('should update card message', async () => {
      await client.patchCard('msg_123', {
        config: { wide_screen_mode: true },
        elements: [{ tag: 'markdown', content: 'Updated' }],
      });

      expect(mockLarkClient.im.v1.message.patch).toHaveBeenCalledTimes(1);

      const call = mockLarkClient.im.v1.message.patch.mock.calls[0];
      expect(call[0].path.message_id).toBe('msg_123');
    });

    test('should accept card as string', async () => {
      const cardString = JSON.stringify({
        config: { wide_screen_mode: true },
        elements: [{ tag: 'markdown', content: 'Updated' }],
      });

      await client.patchCard('msg_123', cardString);

      expect(mockLarkClient.im.v1.message.patch).toHaveBeenCalledTimes(1);
    });

    test('should handle error code 230011 (message withdrawn)', async () => {
      mockLarkClient.im.v1.message.patch = vi.fn(() =>
        Promise.resolve({
          code: 230011,
          msg: 'message not found',
        })
      );

      await expect(
        client.patchCard('msg_123', { config: {}, elements: [] })
      ).rejects.toThrow('Message withdrawn');
    });

    test('should handle error code 231003 (message not found)', async () => {
      mockLarkClient.im.v1.message.patch = vi.fn(() =>
        Promise.resolve({
          code: 231003,
          msg: 'message not found',
        })
      );

      await expect(
        client.patchCard('msg_123', { config: {}, elements: [] })
      ).rejects.toThrow('Message withdrawn');
    });

    test('should throw on other errors', async () => {
      mockLarkClient.im.v1.message.patch = vi.fn(() =>
        Promise.resolve({
          code: 500,
          msg: 'Internal error',
        })
      );

      await expect(
        client.patchCard('msg_123', { config: {}, elements: [] })
      ).rejects.toThrow('Patch card failed');
    });

    test('should throw if client not initialized', async () => {
      (client as any).client = null;

      await expect(
        client.patchCard('msg_123', { config: {}, elements: [] })
      ).rejects.toThrow('Client not initialized');
    });
  });

  describe('Card Schema 2.0 Integration', () => {
    test('should support streaming mode in card config', async () => {
      const streamingCard = {
        schema: '2.0',
        config: {
          streaming_mode: true,
          width_mode: 'fill',
        },
        body: {
          elements: [
            {
              tag: 'markdown',
              content: 'Streaming content',
            },
          ],
        },
      };

      await client.replyCard('msg_parent', streamingCard as any);

      const call = mockLarkClient.im.v1.message.reply.mock.calls[0];
      const sentCard = JSON.parse(call[0].data.content);
      expect(sentCard.schema).toBe('2.0');
      expect(sentCard.config.streaming_mode).toBe(true);
    });

    test('should update card during streaming', async () => {
      // Initial reply
      const initialCard = {
        schema: '2.0',
        config: { streaming_mode: true },
        body: { elements: [] },
      };
      const messageId = await client.replyCard('msg_parent', initialCard as any);

      // Update with new content
      const updatedCard = {
        schema: '2.0',
        config: { streaming_mode: true },
        body: {
          elements: [{ tag: 'markdown', content: 'New content' }],
        },
      };
      await client.patchCard(messageId, updatedCard as any);

      expect(mockLarkClient.im.v1.message.patch).toHaveBeenCalledTimes(1);
    });
  });
});
