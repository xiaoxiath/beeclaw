import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mock all dependencies
const mockLogger = { info: mock(), error: mock(), warn: mock(), debug: mock() };
mock.module('../../../infra/observability/logger', () => ({ logger: mockLogger }));

const mockGetConfig = mock(() => ({
  defaultPushTarget: { channel: 'feishu', chatId: 'chat-1', userId: 'user-1' },
}));
mock.module('../../../infra/config', () => ({ getConfig: mockGetConfig }));

const mockSendProactiveMessage = mock(() => Promise.resolve({ success: true, response: 'Mock response' }));
const mockInjectProactiveResult = mock();
const mockGetRecentSessionHistory = mock(() => []);
mock.module('../../session', () => ({
  sendProactiveMessage: mockSendProactiveMessage,
  injectProactiveResult: mockInjectProactiveResult,
  getRecentSessionHistory: mockGetRecentSessionHistory,
}));

const mockGetSkillStore = mock(() => ({
  get: mock((name: string) => name === 'test-skill' ? {
    description: 'Test skill',
    content: 'Do something',
  } : null),
}));
mock.module('../../skills/store', () => ({ getSkillStore: mockGetSkillStore }));

const mockCompress = mock(() => Promise.resolve({ processed: 5, summarized: 2, archived: 1 }));
mock.module('../../memory/compression', () => ({
  getCompressionEngine: () => ({ compress: mockCompress }),
}));

mock.module('../../memory', () => ({
  getMemoryStore: () => ({
    getCoreContext: () => ({ user: 'Test user', facts: 'Some facts' }),
    getRecentConversations: mock(() => Promise.resolve([])),
    record: mock(() => Promise.resolve()),
    getBasePath: () => '/tmp/test-memory',
  }),
}));

mock.module('../../agent/reflection-engine', () => ({
  getReflectionEngine: () => ({
    reflect: mock(() => Promise.resolve({ patterns: [], strategyUpdates: [] })),
  }),
}));

mock.module('../pusher', () => ({
  pushNotification: mock(() => Promise.resolve()),
}));

mock.module('../../agent/types', () => ({
  PROACTIVE_DEFAULT_BLOCKED_TOOLS: ['dangerous_tool'],
}));

import {
  handleRunSkillJob,
  handleLlmProactiveChatJob,
  handleSelfEvolutionJob,
  handleMemoryCompressJob,
  handleGoalProgressCheckJob,
  handleCustomJob,
  handleSendReminderJob,
} from '../job-handlers';

describe('job-handlers', () => {
  beforeEach(() => {
    mockSendProactiveMessage.mockClear();
    mockInjectProactiveResult.mockClear();
    mockGetRecentSessionHistory.mockClear();
    mockCompress.mockClear();
    for (const fn of Object.values(mockLogger)) (fn as any).mockClear();
  });

  describe('handleRunSkillJob', () => {
    it('logs error when skillName is missing', async () => {
      await handleRunSkillJob({ taskType: 'run_skill', params: {} } as any);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('logs error when skill is not found', async () => {
      await handleRunSkillJob({
        taskType: 'run_skill',
        params: { skillName: 'nonexistent-skill' },
      } as any);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('executes skill and sends proactive message', async () => {
      mockSendProactiveMessage.mockResolvedValueOnce({ success: true, response: 'Skill result' });

      await handleRunSkillJob({
        taskType: 'run_skill',
        params: { skillName: 'test-skill', skillParams: { key: 'value' } },
      } as any);

      expect(mockSendProactiveMessage).toHaveBeenCalled();
    });

    it('injects result back when associatedSessionId is set', async () => {
      mockSendProactiveMessage.mockResolvedValueOnce({ success: true, response: 'Result' });

      await handleRunSkillJob({
        taskType: 'run_skill',
        params: { skillName: 'test-skill' },
        associatedSessionId: 'session-123',
      } as any);

      expect(mockInjectProactiveResult).toHaveBeenCalled();
    });

    it('handles snake_case skill_name param', async () => {
      mockSendProactiveMessage.mockResolvedValueOnce({ success: true, response: 'OK' });

      await handleRunSkillJob({
        taskType: 'run_skill',
        params: { skill_name: 'test-skill' },
      } as any);

      expect(mockSendProactiveMessage).toHaveBeenCalled();
    });
  });

  describe('handleLlmProactiveChatJob', () => {
    it('sends proactive message with prompt', async () => {
      mockSendProactiveMessage.mockResolvedValueOnce({ success: true, response: 'Hello!' });

      await handleLlmProactiveChatJob({
        taskType: 'llm_proactive_chat',
        params: { prompt: 'Say hello' },
      } as any);

      expect(mockSendProactiveMessage).toHaveBeenCalled();
    });

    it('uses default prompt when none provided', async () => {
      mockSendProactiveMessage.mockResolvedValueOnce({ success: true, response: 'Hi!' });

      await handleLlmProactiveChatJob({
        taskType: 'llm_proactive_chat',
        params: {},
      } as any);

      expect(mockSendProactiveMessage).toHaveBeenCalled();
    });

    it('handles LLM generation failure', async () => {
      mockSendProactiveMessage.mockResolvedValueOnce({ success: false, error: 'LLM error' });

      await handleLlmProactiveChatJob({
        taskType: 'llm_proactive_chat',
        params: {},
      } as any);

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('handleSelfEvolutionJob', () => {
    it('sends evolution prompt', async () => {
      mockSendProactiveMessage.mockResolvedValueOnce({ success: true, response: 'Evolved' });

      await handleSelfEvolutionJob({ taskType: 'self_evolution', params: {} } as any);

      expect(mockSendProactiveMessage).toHaveBeenCalled();
    });
  });

  describe('handleMemoryCompressJob', () => {
    it('runs compression engine', async () => {
      await handleMemoryCompressJob();
      expect(mockCompress).toHaveBeenCalled();
    });
  });

  describe('handleGoalProgressCheckJob', () => {
    it('is a function that does not throw', async () => {
      await expect(handleGoalProgressCheckJob()).resolves.toBeUndefined();
    });
  });

  describe('handleCustomJob', () => {
    it('logs warning for unknown action', async () => {
      await handleCustomJob({ taskType: 'custom', params: { action: 'unknown-action' } } as any);
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('handles daily-reflection action', async () => {
      await handleCustomJob({
        taskType: 'custom',
        params: { action: 'daily-reflection' },
      } as any);
      // Should not throw
    });
  });

  describe('handleSendReminderJob', () => {
    it('sends reminder via notification when no client and no chatId', async () => {
      // Override config to return no chatId so the else (pushNotification) branch is taken
      mockGetConfig.mockReturnValueOnce({ defaultPushTarget: { channel: 'feishu', chatId: undefined, userId: 'user-1' } });

      await handleSendReminderJob({
        taskType: 'send_reminder',
        params: { message: 'Remember this!' },
      } as any);

      // pushNotification fallback path is taken when chatId is falsy
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it('sends reminder via Feishu client when available', async () => {
      const mockClient = {
        sendMarkdownMessage: mock(() => Promise.resolve()),
        lastActiveChatId: 'chat-1',
        lastActiveUserId: 'user-1',
      };

      await handleSendReminderJob(
        {
          taskType: 'send_reminder',
          params: { message: 'Remember!', chatId: 'chat-1' },
        } as any,
        { getFeishuClient: () => mockClient },
      );

      expect(mockClient.sendMarkdownMessage).toHaveBeenCalled();
    });
  });
});
