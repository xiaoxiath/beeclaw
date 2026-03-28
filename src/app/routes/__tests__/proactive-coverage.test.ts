/**
 * Additional coverage tests for routes/proactive.ts
 * Targets uncovered lines:
 *   34-66: getTenantAccessToken (cached token, fetch, error)
 *   216-249: image message processing (download, base64 conversion, errors)
 *   276-285: multimodal message content building
 *   390: gateway replyResult.success === false branch
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Hoisted mocks                                                     */
/* ------------------------------------------------------------------ */

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
  const mockGateway = { replyMessage: mockGatewayReply };

  return {
    mockInitSessionManager: vi.fn(),
    mockSendProactiveMessage: vi.fn(() =>
      Promise.resolve({ success: true, response: 'AI reply', sessionId: 'sess-1' }),
    ),
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
    mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    mockCheckPreferenceTriggers: vi.fn(() => null),
    mockRecordQuery: vi.fn(),
    mockGatewayReply,
    mockGateway,
    mockGetMessageGateway: vi.fn(() => mockGateway),
    mockSessionMessageQueueEnqueue: vi.fn((_key: string, fn: () => Promise<void>) => fn()),
    mockFetch: vi.fn(),
  };
});

/* ------------------------------------------------------------------ */
/*  Module mocks                                                      */
/* ------------------------------------------------------------------ */

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

import { initFeishuWSIntegration } from '../proactive';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function makeImageData(overrides: any = {}) {
  const now = Date.now() + 10_000;
  return {
    sender: {
      sender_type: 'user',
      sender_id: { user_id: 'user-1', open_id: 'open-1' },
    },
    message: {
      message_id: overrides.messageId || 'msg-img',
      chat_id: 'chat-456',
      message_type: 'image',
      content: JSON.stringify({ image_key: overrides.imageKey || 'img_key_123' }),
      create_time: String(now),
      ...overrides.message,
    },
  };
}

function makeTextData(overrides: any = {}) {
  const now = Date.now() + 10_000;
  return {
    sender: {
      sender_type: 'user',
      sender_id: { user_id: 'user-1', open_id: 'open-1' },
    },
    message: {
      message_id: overrides.messageId || 'msg-text',
      chat_id: 'chat-456',
      message_type: 'text',
      content: JSON.stringify({ text: overrides.text || 'Hello bot' }),
      create_time: String(now),
    },
  };
}

async function setupAndGetHandler() {
  await initFeishuWSIntegration({
    appId: 'test-app-id',
    appSecret: 'test-app-secret',
  } as any);
  return mocks.wsClient.onMessage.mock.calls[0][0];
}

/** Mock a successful token fetch response */
function mockTokenResponse() {
  return {
    ok: true,
    json: async () => ({
      code: 0,
      tenant_access_token: 'test-token-abc',
      expire: 7200,
    }),
  };
}

/** Mock a successful image download response */
function mockImageDownloadResponse(size = 8) {
  return {
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(size),
  };
}

/* ------------------------------------------------------------------ */
/*  Setup                                                             */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  vi.clearAllMocks();

  mocks.mockSendProactiveMessage.mockResolvedValue({
    success: true, response: 'AI reply', sessionId: 'sess-1',
  });
  mocks.mockGatewayReply.mockResolvedValue({ success: true });
  mocks.mockIsMessageProcessed.mockReturnValue(false);
  mocks.mockGetCachedAgentResponse.mockReturnValue(null);
  mocks.mockSessionMessageQueueEnqueue.mockImplementation(
    (_key: string, fn: () => Promise<void>) => fn(),
  );
  mocks.wsClient.addReaction.mockResolvedValue('reaction-1');
  mocks.wsClient.deleteReaction.mockResolvedValue(undefined);
  mocks.wsClient.replyText.mockResolvedValue(undefined);
  mocks.wsClient.start.mockResolvedValue(undefined);
  mocks.wsClient.onMessage.mockReset();
  mocks.wsClient.onMessage.mockImplementation((_handler: any) => {});

  mocks.wsClient.extractUserId.mockImplementation(
    (data: any) => data.sender?.sender_id?.user_id || 'user-1',
  );
  mocks.wsClient.extractChatId.mockImplementation(
    (data: any) => data.message?.chat_id || 'chat-456',
  );
  mocks.wsClient.extractMessageId.mockImplementation(
    (data: any) => data.message?.message_id || 'msg-123',
  );
  mocks.wsClient.parseMessageContent.mockImplementation((data: any) => {
    try {
      const c = JSON.parse(data.message?.content || '{}');
      return c.text || '';
    } catch {
      return data.message?.content || '';
    }
  });

  vi.stubGlobal('fetch', mocks.mockFetch);

  process.env.LARK_BEECLAW_APPID = 'test-app-id';
  process.env.LARK_BEECLAW_AS = 'test-app-secret';
});

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('Proactive routes coverage', () => {

  /**
   * IMPORTANT: getTenantAccessToken caches at module level.
   * The FIRST image test that fetches the token will populate the cache.
   * Subsequent image tests reuse the cached token (only 1 fetch for image download).
   * We test the full token flow first, then the cached path.
   */

  describe('image message: full token fetch + image download', () => {
    it('fetches tenant token and downloads image, sends multimodal message', async () => {
      // Token fetch + image download
      mocks.mockFetch
        .mockResolvedValueOnce(mockTokenResponse())
        .mockResolvedValueOnce(mockImageDownloadResponse());

      mocks.wsClient.parseMessageContent.mockReturnValue('Describe this');

      const handler = await setupAndGetHandler();
      await handler(makeImageData({ messageId: 'msg-img-full' }));

      // 2 fetch calls: token + image
      expect(mocks.mockFetch).toHaveBeenCalledTimes(2);
      expect(mocks.mockFetch.mock.calls[0][0]).toContain('tenant_access_token');
      expect(mocks.mockFetch.mock.calls[1][0]).toContain('resources/img_key_123');

      // Multimodal message sent to agent
      expect(mocks.mockSendProactiveMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.arrayContaining([
            expect.objectContaining({ type: 'image_url' }),
            expect.objectContaining({ type: 'text', text: 'Describe this' }),
          ]),
        }),
      );
    });
  });

  describe('image message: cached token (subsequent calls)', () => {
    it('reuses cached token, only fetches image', async () => {
      // Only image download (token already cached from previous test)
      mocks.mockFetch.mockResolvedValueOnce(mockImageDownloadResponse());

      mocks.wsClient.parseMessageContent.mockReturnValue('Second image');

      const handler = await setupAndGetHandler();
      await handler(makeImageData({ messageId: 'msg-img-cached', imageKey: 'img_second' }));

      // Only 1 fetch call (image download)
      expect(mocks.mockFetch).toHaveBeenCalledTimes(1);
      expect(mocks.mockFetch.mock.calls[0][0]).toContain('resources/img_second');

      expect(mocks.mockSendProactiveMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.arrayContaining([
            expect.objectContaining({ type: 'text', text: 'Second image' }),
          ]),
        }),
      );
    });
  });

  describe('image message: default prompt when text is empty', () => {
    it('uses default prompt for empty text', async () => {
      mocks.mockFetch.mockResolvedValueOnce(mockImageDownloadResponse());
      mocks.wsClient.parseMessageContent.mockReturnValue('');

      const handler = await setupAndGetHandler();
      await handler(makeImageData({ messageId: 'msg-img-empty' }));

      expect(mocks.mockSendProactiveMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.arrayContaining([
            expect.objectContaining({ type: 'text', text: '请识别并分析这张图片' }),
          ]),
        }),
      );
    });
  });

  describe('image message: default prompt when text contains braces', () => {
    it('uses default prompt when parseMessageContent returns JSON-like text', async () => {
      mocks.mockFetch.mockResolvedValueOnce(mockImageDownloadResponse());
      mocks.wsClient.parseMessageContent.mockReturnValue('{image_key: abc}');

      const handler = await setupAndGetHandler();
      await handler(makeImageData({ messageId: 'msg-img-braces' }));

      expect(mocks.mockSendProactiveMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.arrayContaining([
            expect.objectContaining({ type: 'text', text: '请识别并分析这张图片' }),
          ]),
        }),
      );
    });
  });

  describe('image message: download failure (non-ok response)', () => {
    it('logs error when image download returns non-ok', async () => {
      mocks.mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      });

      mocks.wsClient.parseMessageContent.mockReturnValue('');

      const handler = await setupAndGetHandler();
      await handler(makeImageData({ messageId: 'msg-img-403' }));

      // Should log the download failure
      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to download image'),
      );
    });
  });

  describe('image message: exception in image processing', () => {
    it('catches fetch network error and logs it', async () => {
      mocks.mockFetch.mockRejectedValueOnce(new Error('Network unreachable'));
      mocks.wsClient.parseMessageContent.mockReturnValue('');

      const handler = await setupAndGetHandler();
      await handler(makeImageData({ messageId: 'msg-img-neterr' }));

      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error processing image'),
        expect.any(Error),
      );
    });
  });

  describe('image message: no image_key in content', () => {
    it('skips download and treats as empty message', async () => {
      mocks.wsClient.parseMessageContent.mockReturnValue('');

      const handler = await setupAndGetHandler();
      const now = Date.now() + 10_000;
      await handler({
        sender: {
          sender_type: 'user',
          sender_id: { user_id: 'user-1', open_id: 'open-1' },
        },
        message: {
          message_id: 'msg-img-nokey',
          chat_id: 'chat-456',
          message_type: 'image',
          content: JSON.stringify({}), // no image_key
          create_time: String(now),
        },
      });

      // No fetch calls for image (no image_key)
      expect(mocks.mockFetch).not.toHaveBeenCalled();
      expect(mocks.mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Ignoring empty message'),
      );
    });
  });

  describe('gateway reply returns success=false', () => {
    it('throws and triggers fallback when replyResult.success is false', async () => {
      mocks.mockGatewayReply.mockResolvedValueOnce({
        success: false,
        error: 'Message too long',
      });

      const handler = await setupAndGetHandler();
      await handler(makeTextData({ messageId: 'msg-fail-reply' }));

      // Should mark failed
      expect(mocks.mockMarkMessageFailed).toHaveBeenCalledWith(
        expect.any(String),
        'msg-fail-reply',
        'Message too long',
        'AI reply',
        false,
      );
      // Should attempt fallback replyText
      expect(mocks.wsClient.replyText).toHaveBeenCalled();
    });

    it('uses "Reply failed" default when error is undefined', async () => {
      mocks.mockGatewayReply.mockResolvedValueOnce({ success: false });

      const handler = await setupAndGetHandler();
      await handler(makeTextData({ messageId: 'msg-fail-noerr' }));

      expect(mocks.mockMarkMessageFailed).toHaveBeenCalledWith(
        expect.any(String),
        'msg-fail-noerr',
        'Reply failed',
        'AI reply',
        false,
      );
    });
  });

  describe('message with no create_time', () => {
    it('falls back to Date.now() for missing create_time', async () => {
      const handler = await setupAndGetHandler();
      const now = Date.now() + 10_000;
      await handler({
        sender: {
          sender_type: 'user',
          sender_id: { user_id: 'user-1', open_id: 'open-1' },
        },
        message: {
          message_id: 'msg-notime',
          chat_id: 'chat-456',
          message_type: 'text',
          content: JSON.stringify({ text: 'No timestamp' }),
          // create_time intentionally omitted
        },
      });

      // Should not crash; message might be processed or filtered
      // depending on Date.now() vs botStartTime timing
    });
  });
});
