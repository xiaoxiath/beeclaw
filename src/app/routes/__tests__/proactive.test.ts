/**
 * Tests for routes/proactive.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Use vi.hoisted for all mock variables referenced inside vi.mock factories
const mocks = vi.hoisted(() => {
  const wsClient = {
    onMessage: vi.fn((_handler: any) => {}),
    start: vi.fn(() => Promise.resolve()),
    connected: true,
    isEnabled: true,
    extractUserId: vi.fn((data: any) => data.sender?.sender_id?.user_id || 'user-1'),
    extractChatId: vi.fn((data: any) => data.message?.chat_id || 'chat-1'),
    extractMessageId: vi.fn((data: any) => data.message?.message_id || 'msg-1'),
    parseMessageContent: vi.fn((data: any) => {
      try {
        const c = JSON.parse(data.message?.content || '{}');
        return c.text || '';
      } catch { return data.message?.content || ''; }
    }),
    addReaction: vi.fn(() => Promise.resolve('reaction-1')),
    deleteReaction: vi.fn(() => Promise.resolve()),
    replyText: vi.fn(() => Promise.resolve()),
  };

  const mockGatewayReply = vi.fn(() => Promise.resolve({ success: true }));
  const mockGateway = {
    replyMessage: mockGatewayReply,
  };

  return {
    mockInitSessionManager: vi.fn(),
    mockSendProactiveMessage: vi.fn(() => Promise.resolve({ success: true, response: 'AI reply', sessionId: 'sess-1' })),
    mockConfirmDelivery: vi.fn(),
    mockIsMessageProcessed: vi.fn(() => false),
    mockMarkMessageProcessing: vi.fn(),
    mockMarkMessageCompleted: vi.fn(),
    mockMarkMessageFailed: vi.fn(),
    mockGetCachedAgentResponse: vi.fn(() => null),
    mockPushNotification: vi.fn(() => Promise.resolve({ success: true })),
    mockEvaluatePatterns: vi.fn(() => []),
    mockGoalStore: { list: vi.fn(() => []) },
    wsClient,
    mockInitFeishuWSClient: vi.fn(() => wsClient),
    mockGetFeishuWSClient: vi.fn(() => wsClient),
    mockLogger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    mockCheckPreferenceTriggers: vi.fn(() => null),
    mockRecordQuery: vi.fn(),
    mockGatewayReply,
    mockGateway,
    mockGetMessageGateway: vi.fn(() => mockGateway),
    mockSessionMessageQueueEnqueue: vi.fn((_key: string, fn: () => Promise<void>) => fn()),
  };
});

vi.mock('../../../domain/session', () => ({
  initSessionManager: mocks.mockInitSessionManager,
  sendProactiveMessage: (...a: any[]) => mocks.mockSendProactiveMessage(...a),
  confirmDelivery: (...a: any[]) => mocks.mockConfirmDelivery(...a),
  isMessageProcessed: (...a: any[]) => mocks.mockIsMessageProcessed(...a),
  markMessageProcessing: (...a: any[]) => mocks.mockMarkMessageProcessing(...a),
  markMessageCompleted: (...a: any[]) => mocks.mockMarkMessageCompleted(...a),
  markMessageFailed: (...a: any[]) => mocks.mockMarkMessageFailed(...a),
  getCachedAgentResponse: (...a: any[]) => mocks.mockGetCachedAgentResponse(...a),
}));

vi.mock('../../../domain/proactive/pusher', () => ({
  pushNotification: (...a: any[]) => mocks.mockPushNotification(...a),
}));

vi.mock('../../../domain/proactive/triggers', () => ({
  evaluatePatterns: (...a: any[]) => mocks.mockEvaluatePatterns(...a),
}));

vi.mock('../../../domain/agent/goal/store', () => ({
  getGoalStore: () => mocks.mockGoalStore,
}));

vi.mock('../../../adapter/feishu', () => ({
  initFeishuWSClient: (...a: any[]) => mocks.mockInitFeishuWSClient(...a),
  getFeishuWSClient: (...a: any[]) => mocks.mockGetFeishuWSClient(...a),
}));

vi.mock('../../../infra/observability/logger', () => ({
  logger: mocks.mockLogger,
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

vi.mock('../../../domain/agent/evolution', () => ({
  checkPreferenceTriggers: (...a: any[]) => mocks.mockCheckPreferenceTriggers(...a),
  recordQuery: (...a: any[]) => mocks.mockRecordQuery(...a),
}));

vi.mock('../../gateway-channel', () => ({
  getMessageGateway: (...a: any[]) => mocks.mockGetMessageGateway(...a),
}));

vi.mock('../../../infra/resilience/session-lock', () => ({
  SessionMessageQueue: {
    getInstance: () => ({
      enqueue: mocks.mockSessionMessageQueueEnqueue,
    }),
  },
}));

import { initProactiveApi, initFeishuWSIntegration } from '../proactive';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function makeMessageData(overrides: any = {}) {
  const now = Date.now() + 10000; // future timestamp to pass botStartTime check
  return {
    sender: {
      sender_type: 'user',
      sender_id: { user_id: 'user-1', open_id: 'open-1' },
      ...overrides.sender,
    },
    message: {
      message_id: 'msg-123',
      chat_id: 'chat-456',
      message_type: 'text',
      content: JSON.stringify({ text: 'Hello bot' }),
      create_time: String(now),
      ...overrides.message,
    },
    ...overrides,
  };
}

async function setupAndGetHandler() {
  await initFeishuWSIntegration({
    appId: 'test-app-id',
    appSecret: 'test-app-secret',
  } as any);

  const handler = mocks.wsClient.onMessage.mock.calls[0][0];
  return handler;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */
describe('routes/proactive', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Re-apply defaults that clearAllMocks removed
    mocks.mockSendProactiveMessage.mockResolvedValue({ success: true, response: 'AI reply', sessionId: 'sess-1' });
    mocks.mockGatewayReply.mockResolvedValue({ success: true });
    mocks.mockIsMessageProcessed.mockReturnValue(false);
    mocks.mockGetCachedAgentResponse.mockReturnValue(null);
    mocks.mockSessionMessageQueueEnqueue.mockImplementation((_key: string, fn: () => Promise<void>) => fn());
    mocks.wsClient.addReaction.mockResolvedValue('reaction-1');
    mocks.wsClient.deleteReaction.mockResolvedValue(undefined);
    mocks.wsClient.replyText.mockResolvedValue(undefined);
    mocks.wsClient.start.mockResolvedValue(undefined);

    mocks.wsClient.extractUserId.mockImplementation((data: any) => data.sender?.sender_id?.user_id || 'user-1');
    mocks.wsClient.extractChatId.mockImplementation((data: any) => data.message?.chat_id || 'chat-456');
    mocks.wsClient.extractMessageId.mockImplementation((data: any) => data.message?.message_id || 'msg-123');
    mocks.wsClient.parseMessageContent.mockImplementation((data: any) => {
      try {
        const c = JSON.parse(data.message?.content || '{}');
        return c.text || '';
      } catch { return data.message?.content || ''; }
    });
  });

  /* ================================================================ */
  /*  initProactiveApi                                                 */
  /* ================================================================ */
  describe('initProactiveApi', () => {
    it('should call initSessionManager with config', () => {
      const config = {
        provider: 'openai' as any,
        model: 'gpt-4',
        systemPrompt: 'Test prompt',
        useTools: true,
      };
      initProactiveApi(config);
      expect(mocks.mockInitSessionManager).toHaveBeenCalledWith(config);
    });

    it('should accept config with optional params', () => {
      initProactiveApi({
        provider: 'openai' as any,
        model: 'gpt-4',
        params: { temperature: 0.7 },
        visionConfig: { visionModel: 'gpt-4-vision' },
        tokenStatsConfig: { showTokenStats: true },
      });
      expect(mocks.mockInitSessionManager).toHaveBeenCalledTimes(1);
    });
  });

  /* ================================================================ */
  /*  initFeishuWSIntegration - setup                                  */
  /* ================================================================ */
  describe('initFeishuWSIntegration', () => {
    it('should warn and return if missing appId', async () => {
      await initFeishuWSIntegration({ appId: '', appSecret: 'secret' } as any);
      expect(mocks.mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Missing appId'));
      expect(mocks.mockInitFeishuWSClient).not.toHaveBeenCalled();
    });

    it('should warn and return if missing appSecret', async () => {
      await initFeishuWSIntegration({ appId: 'id', appSecret: '' } as any);
      expect(mocks.mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Missing'));
      expect(mocks.mockInitFeishuWSClient).not.toHaveBeenCalled();
    });

    it('should init client with correct config', async () => {
      await initFeishuWSIntegration({ appId: 'id', appSecret: 'secret', logLevel: 'debug' } as any);
      expect(mocks.mockInitFeishuWSClient).toHaveBeenCalledWith({
        appId: 'id', appSecret: 'secret', enabled: true, loggerLevel: 'debug',
      });
    });

    it('should default loggerLevel to error', async () => {
      await initFeishuWSIntegration({ appId: 'id', appSecret: 'secret' } as any);
      expect(mocks.mockInitFeishuWSClient).toHaveBeenCalledWith(
        expect.objectContaining({ loggerLevel: 'error' }),
      );
    });

    it('should register onMessage handler and start', async () => {
      await initFeishuWSIntegration({ appId: 'id', appSecret: 'secret' } as any);
      expect(mocks.wsClient.onMessage).toHaveBeenCalledTimes(1);
      expect(mocks.wsClient.start).toHaveBeenCalledTimes(1);
    });

    it('should throw if start fails', async () => {
      mocks.wsClient.start.mockRejectedValueOnce(new Error('WS failed'));
      await expect(initFeishuWSIntegration({ appId: 'id', appSecret: 'secret' } as any))
        .rejects.toThrow('WS failed');
      expect(mocks.mockLogger.error).toHaveBeenCalled();
    });
  });

  /* ================================================================ */
  /*  onMessage handler                                                */
  /* ================================================================ */
  describe('onMessage handler', () => {
    it('should return early if client is null', async () => {
      mocks.mockGetFeishuWSClient.mockReturnValueOnce(null);
      const handler = await setupAndGetHandler();
      await handler(makeMessageData());
      expect(mocks.mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Client not initialized'));
    });

    it('should ignore messages from bot (sender_type=app)', async () => {
      const handler = await setupAndGetHandler();
      await handler(makeMessageData({ sender: { sender_type: 'app' } }));
      expect(mocks.mockSendProactiveMessage).not.toHaveBeenCalled();
    });

    it('should ignore pre-startup messages', async () => {
      const handler = await setupAndGetHandler();
      const pastTime = String(1000); // very old timestamp
      await handler(makeMessageData({ message: { create_time: pastTime } }));
      expect(mocks.mockSendProactiveMessage).not.toHaveBeenCalled();
    });

    it('should skip duplicate messages (already processed)', async () => {
      mocks.mockIsMessageProcessed.mockReturnValue(true);
      const handler = await setupAndGetHandler();
      await handler(makeMessageData());
      expect(mocks.mockSendProactiveMessage).not.toHaveBeenCalled();
    });

    it('should handle cached agent response - text reply', async () => {
      mocks.mockGetCachedAgentResponse.mockReturnValue({ response: 'cached reply', usedCardV2: false });
      const handler = await setupAndGetHandler();
      await handler(makeMessageData());

      expect(mocks.mockMarkMessageProcessing).toHaveBeenCalled();
      expect(mocks.mockGatewayReply).toHaveBeenCalled();
      expect(mocks.mockMarkMessageCompleted).toHaveBeenCalled();
      // Should NOT call sendProactiveMessage since we used cached response
      expect(mocks.mockSendProactiveMessage).not.toHaveBeenCalled();
    });

    it('should handle cached agent response - card v2', async () => {
      mocks.mockGetCachedAgentResponse.mockReturnValue({ response: 'cached card', usedCardV2: true });
      const handler = await setupAndGetHandler();
      await handler(makeMessageData());

      expect(mocks.mockMarkMessageCompleted).toHaveBeenCalledWith(
        expect.any(String), expect.any(String), 'cached card', true,
      );
      expect(mocks.mockGatewayReply).not.toHaveBeenCalled();
    });

    it('should handle cached delivery failure', async () => {
      mocks.mockGetCachedAgentResponse.mockReturnValue({ response: 'cached', usedCardV2: false });
      mocks.mockGatewayReply.mockRejectedValueOnce(new Error('delivery failed'));
      const handler = await setupAndGetHandler();
      await handler(makeMessageData());

      expect(mocks.mockMarkMessageFailed).toHaveBeenCalled();
    });

    it('should ignore empty text messages', async () => {
      const handler = await setupAndGetHandler();
      mocks.wsClient.parseMessageContent.mockReturnValue('');
      await handler(makeMessageData({ message: { message_type: 'text', content: '{}' } }));
      expect(mocks.mockSendProactiveMessage).not.toHaveBeenCalled();
    });

    it('should process normal text message successfully', async () => {
      const handler = await setupAndGetHandler();
      await handler(makeMessageData());

      expect(mocks.mockMarkMessageProcessing).toHaveBeenCalled();
      expect(mocks.mockSendProactiveMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'feishu',
          userId: 'user-1',
        }),
      );
      expect(mocks.mockGatewayReply).toHaveBeenCalled();
      expect(mocks.mockMarkMessageCompleted).toHaveBeenCalled();
      expect(mocks.mockConfirmDelivery).toHaveBeenCalledWith('sess-1');
    });

    it('should handle Card V2 response (skip gateway reply)', async () => {
      mocks.mockSendProactiveMessage.mockResolvedValue({
        success: true, response: 'card reply', sessionId: 'sess-1', usedCardV2: true,
      });
      const handler = await setupAndGetHandler();
      await handler(makeMessageData());

      expect(mocks.mockGatewayReply).not.toHaveBeenCalled();
      expect(mocks.mockMarkMessageCompleted).toHaveBeenCalledWith(
        expect.any(String), expect.any(String), 'card reply', true,
      );
      expect(mocks.mockConfirmDelivery).toHaveBeenCalledWith('sess-1');
    });

    it('should delete reaction after successful Card V2 reply', async () => {
      mocks.mockSendProactiveMessage.mockResolvedValue({
        success: true, response: 'card', sessionId: 's', usedCardV2: true,
      });
      const handler = await setupAndGetHandler();
      await handler(makeMessageData());
      expect(mocks.wsClient.deleteReaction).toHaveBeenCalled();
    });

    it('should handle sendProactiveMessage failure', async () => {
      mocks.mockSendProactiveMessage.mockResolvedValue({ success: false, error: 'AI error' });
      const handler = await setupAndGetHandler();
      await handler(makeMessageData());

      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to process message'),
      );
      // Should try to send error message to user
      expect(mocks.mockGatewayReply).toHaveBeenCalled();
    });

    it('should handle empty response from agent', async () => {
      mocks.mockSendProactiveMessage.mockResolvedValue({ success: true, response: '' });
      const handler = await setupAndGetHandler();
      await handler(makeMessageData());

      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Empty response'),
      );
    });

    it('should handle null response from agent', async () => {
      mocks.mockSendProactiveMessage.mockResolvedValue({ success: true, response: null });
      const handler = await setupAndGetHandler();
      await handler(makeMessageData());

      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Empty response'),
      );
    });

    it('should handle gateway reply failure with fallback', async () => {
      mocks.mockGatewayReply.mockRejectedValueOnce(new Error('reply failed'));
      const handler = await setupAndGetHandler();
      await handler(makeMessageData());

      // Should mark failed and try fallback
      expect(mocks.mockMarkMessageFailed).toHaveBeenCalled();
      expect(mocks.wsClient.replyText).toHaveBeenCalled();
    });

    it('should handle withdrawn message error gracefully (230011)', async () => {
      mocks.mockGatewayReply.mockRejectedValueOnce(new Error('code: 230011 message withdrawn'));
      const handler = await setupAndGetHandler();
      await handler(makeMessageData());

      expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('withdrawn'),
      );
      // Should NOT attempt fallback for withdrawn messages
      expect(mocks.wsClient.replyText).not.toHaveBeenCalled();
    });

    it('should handle withdrawn message error gracefully (231003)', async () => {
      mocks.mockGatewayReply.mockRejectedValueOnce(new Error('code: 231003 withdrawn'));
      const handler = await setupAndGetHandler();
      await handler(makeMessageData());

      expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('withdrawn'),
      );
    });

    it('should handle fallback replyText failure', async () => {
      mocks.mockGatewayReply.mockRejectedValueOnce(new Error('reply failed'));
      mocks.wsClient.replyText.mockRejectedValueOnce(new Error('fallback failed'));
      const handler = await setupAndGetHandler();
      await handler(makeMessageData());

      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Fallback reply also failed'),
        expect.any(Error),
      );
    });

    it('should handle addReaction failure gracefully', async () => {
      mocks.wsClient.addReaction.mockRejectedValueOnce(new Error('reaction error'));
      const handler = await setupAndGetHandler();
      await handler(makeMessageData());

      // Should still process the message
      expect(mocks.mockSendProactiveMessage).toHaveBeenCalled();
    });

    it('should handle deleteReaction failure gracefully after text reply', async () => {
      mocks.wsClient.deleteReaction.mockRejectedValueOnce(new Error('delete error'));
      const handler = await setupAndGetHandler();
      await handler(makeMessageData());

      // Should still complete successfully
      expect(mocks.mockMarkMessageCompleted).toHaveBeenCalled();
    });

    it('should record query for self-evolution', async () => {
      const handler = await setupAndGetHandler();
      await handler(makeMessageData());

      expect(mocks.mockRecordQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ channel: 'feishu' }),
      );
    });

    it('should check preference triggers', async () => {
      mocks.mockCheckPreferenceTriggers.mockReturnValue({ hasPreference: true, expressions: ['likes cats'] });
      const handler = await setupAndGetHandler();
      await handler(makeMessageData());

      expect(mocks.mockCheckPreferenceTriggers).toHaveBeenCalled();
    });

    it('should handle evolution analysis failure gracefully', async () => {
      mocks.mockCheckPreferenceTriggers.mockImplementation(() => { throw new Error('evolution err'); });
      const handler = await setupAndGetHandler();
      await handler(makeMessageData());

      // Should not affect message processing
      expect(mocks.mockMarkMessageCompleted).toHaveBeenCalled();
    });

    it('should handle error reply failure for withdrawn messages (error path)', async () => {
      mocks.mockSendProactiveMessage.mockResolvedValue({ success: false, error: 'fail' });
      mocks.mockGatewayReply.mockRejectedValueOnce(new Error('230011 withdrawn'));
      const handler = await setupAndGetHandler();
      await handler(makeMessageData());

      expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('withdrawn'),
      );
    });

    it('should handle error reply failure for non-withdrawn errors', async () => {
      mocks.mockSendProactiveMessage.mockResolvedValue({ success: false, error: 'fail' });
      mocks.mockGatewayReply.mockRejectedValueOnce(new Error('network error'));
      const handler = await setupAndGetHandler();
      await handler(makeMessageData());

      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send error reply'),
        expect.any(Error),
      );
    });

    it('should handle empty response reply failure for withdrawn messages', async () => {
      mocks.mockSendProactiveMessage.mockResolvedValue({ success: true, response: null });
      mocks.mockGatewayReply.mockRejectedValueOnce(new Error('231003 withdrawn'));
      const handler = await setupAndGetHandler();
      await handler(makeMessageData());

      expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('withdrawn'),
      );
    });

    it('should handle empty response reply failure for non-withdrawn errors', async () => {
      mocks.mockSendProactiveMessage.mockResolvedValue({ success: true, response: null });
      mocks.mockGatewayReply.mockRejectedValueOnce(new Error('some other error'));
      const handler = await setupAndGetHandler();
      await handler(makeMessageData());

      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send empty response reply'),
        expect.any(Error),
      );
    });

    it('should use openId from sender_id if available', async () => {
      const handler = await setupAndGetHandler();
      await handler(makeMessageData({
        sender: { sender_type: 'user', sender_id: { user_id: 'uid', open_id: 'oid' } },
      }));
      expect(mocks.mockSendProactiveMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({ openId: 'oid' }),
        }),
      );
    });

    it('should enqueue messages per chatId for sequential processing', async () => {
      const handler = await setupAndGetHandler();
      await handler(makeMessageData());
      expect(mocks.mockSessionMessageQueueEnqueue).toHaveBeenCalledWith(
        expect.stringContaining('chat-'),
        expect.any(Function),
      );
    });
  });

  /* ================================================================ */
  /*  Re-exports                                                       */
  /* ================================================================ */
  describe('re-exported utilities', () => {
    it('should export sendProactiveMessage', async () => {
      const mod = await import('../proactive');
      expect(typeof mod.sendProactiveMessage).toBe('function');
    });

    it('should export pushNotification', async () => {
      const mod = await import('../proactive');
      expect(typeof mod.pushNotification).toBe('function');
    });

    it('should export evaluatePatterns', async () => {
      const mod = await import('../proactive');
      expect(typeof mod.evaluatePatterns).toBe('function');
    });

    it('should export getGoalStore', async () => {
      const mod = await import('../proactive');
      expect(typeof mod.getGoalStore).toBe('function');
    });
  });
});
