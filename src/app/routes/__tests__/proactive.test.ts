/**
 * Tests for routes/proactive.ts
 *
 * Tests the exported functions: initProactiveApi and initFeishuWSIntegration.
 * All external dependencies are mocked to test initialization logic only.
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';

// ---- Mocks ----

const mockInitSessionManager = mock(() => {});
const mockSendProactiveMessage = mock(() => Promise.resolve({ success: true }));
const mockConfirmDelivery = mock(() => {});
const mockIsMessageProcessed = mock(() => false);
const mockMarkMessageProcessing = mock(() => {});
const mockMarkMessageCompleted = mock(() => {});
const mockMarkMessageFailed = mock(() => {});
const mockGetCachedAgentResponse = mock(() => null);

const mockPushNotification = mock(() =>
  Promise.resolve({ success: true })
);

const mockEvaluatePatterns = mock(() => []);

const mockGoalStore = {
  list: mock(() => []),
};

const mockWsClient = {
  onMessage: mock((_handler: any) => {}),
  start: mock(() => Promise.resolve()),
  connected: true,
  isEnabled: true,
};

const mockInitFeishuWSClient = mock(() => mockWsClient);
const mockGetFeishuWSClient = mock(() => mockWsClient);

const mockLogger = {
  debug: mock(() => {}),
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
};

const mockCheckPreferenceTriggers = mock(() => null);
const mockRecordQuery = mock(() => {});

const mockGetMessageGateway = mock(() => ({
  replyMessage: mock(() => Promise.resolve({ success: true })),
}));

const mockSessionMessageQueue = {
  getInstance: mock(() => ({
    enqueue: mock((_key: string, fn: () => Promise<void>) => fn()),
  })),
};

const mockRenderMessageCard = mock(() => ({ card: 'mock-card' }));

mock.module('../../../domain/session', () => ({
  initSessionManager: mockInitSessionManager,
  sendProactiveMessage: mockSendProactiveMessage,
  confirmDelivery: mockConfirmDelivery,
  isMessageProcessed: mockIsMessageProcessed,
  markMessageProcessing: mockMarkMessageProcessing,
  markMessageCompleted: mockMarkMessageCompleted,
  markMessageFailed: mockMarkMessageFailed,
  getCachedAgentResponse: mockGetCachedAgentResponse,
}));

mock.module('../../../domain/proactive/pusher', () => ({
  pushNotification: mockPushNotification,
}));

mock.module('../../../domain/proactive/triggers', () => ({
  evaluatePatterns: mockEvaluatePatterns,
}));

mock.module('../../../domain/agent/goal/store', () => ({
  getGoalStore: () => mockGoalStore,
}));

mock.module('../../../adapter/feishu', () => ({
  initFeishuWSClient: mockInitFeishuWSClient,
  getFeishuWSClient: mockGetFeishuWSClient,
}));

mock.module('../../../infra/observability/logger', () => ({
  logger: mockLogger,
}));

mock.module('../../../domain/agent/evolution', () => ({
  checkPreferenceTriggers: mockCheckPreferenceTriggers,
  recordQuery: mockRecordQuery,
}));

mock.module('../../gateway-channel', () => ({
  getMessageGateway: mockGetMessageGateway,
}));

mock.module('../../../infra/resilience/session-lock', () => ({
  SessionMessageQueue: mockSessionMessageQueue,
}));

mock.module('../../../adapter/feishu/card-v2/message-renderer', () => ({
  renderMessageCard: mockRenderMessageCard,
}));

// Import after mocks
import { initProactiveApi, initFeishuWSIntegration } from '../proactive';

describe('routes/proactive', () => {
  beforeEach(() => {
    mockInitSessionManager.mockClear();
    mockInitFeishuWSClient.mockClear();
    mockWsClient.onMessage.mockClear();
    mockWsClient.start.mockClear();
    mockLogger.debug.mockClear();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
  });

  describe('initProactiveApi', () => {
    it('should call initSessionManager with config', () => {
      const config = {
        provider: 'openai' as const,
        model: 'gpt-4',
        systemPrompt: 'Test prompt',
        useTools: true,
      };
      initProactiveApi(config);

      expect(mockInitSessionManager).toHaveBeenCalledTimes(1);
      expect(mockInitSessionManager).toHaveBeenCalledWith(config);
    });

    it('should accept minimal config', () => {
      initProactiveApi({
        provider: 'anthropic' as any,
        model: 'claude-3',
      });

      expect(mockInitSessionManager).toHaveBeenCalledTimes(1);
    });

    it('should accept config with optional params', () => {
      initProactiveApi({
        provider: 'openai' as any,
        model: 'gpt-4',
        params: { temperature: 0.7, max_tokens: 1000 },
        visionConfig: { visionModel: 'gpt-4-vision' },
      });

      expect(mockInitSessionManager).toHaveBeenCalledTimes(1);
    });
  });

  describe('initFeishuWSIntegration', () => {
    it('should warn and return if missing appId', async () => {
      await initFeishuWSIntegration({
        appId: '',
        appSecret: 'secret',
      } as any);

      expect(mockLogger.warn).toHaveBeenCalled();
      expect(mockInitFeishuWSClient).not.toHaveBeenCalled();
    });

    it('should warn and return if missing appSecret', async () => {
      await initFeishuWSIntegration({
        appId: 'app-id',
        appSecret: '',
      } as any);

      expect(mockLogger.warn).toHaveBeenCalled();
      expect(mockInitFeishuWSClient).not.toHaveBeenCalled();
    });

    it('should initialize Feishu WS client with correct config', async () => {
      await initFeishuWSIntegration({
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
        logLevel: 'debug',
      } as any);

      expect(mockInitFeishuWSClient).toHaveBeenCalledWith({
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
        enabled: true,
        loggerLevel: 'debug',
      });
    });

    it('should register onMessage handler', async () => {
      await initFeishuWSIntegration({
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
      } as any);

      expect(mockWsClient.onMessage).toHaveBeenCalledTimes(1);
      expect(typeof mockWsClient.onMessage.mock.calls[0][0]).toBe('function');
    });

    it('should call wsClient.start()', async () => {
      await initFeishuWSIntegration({
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
      } as any);

      expect(mockWsClient.start).toHaveBeenCalledTimes(1);
    });

    it('should default loggerLevel to error when logLevel is not set', async () => {
      await initFeishuWSIntegration({
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
      } as any);

      expect(mockInitFeishuWSClient).toHaveBeenCalledWith(
        expect.objectContaining({ loggerLevel: 'error' })
      );
    });

    it('should throw if wsClient.start() fails', async () => {
      mockWsClient.start.mockRejectedValueOnce(new Error('Connection failed'));

      await expect(
        initFeishuWSIntegration({
          appId: 'test-app-id',
          appSecret: 'test-app-secret',
        } as any)
      ).rejects.toThrow('Connection failed');

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

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
