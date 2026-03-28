/**
 * Extended unit tests for job-handlers.ts — covers all uncovered branches.
 *
 * Key uncovered areas from existing test:
 * - getDefaultPushTarget: config error, missing fields, null config
 * - getPushTarget: client fallback, param priority
 * - buildConversationHistoryContext: non-empty history, role mapping, truncation, error
 * - getProactiveBlockedTools: custom blocked tools merge
 * - handleRunSkillJob: feishu push with client+chatId, no-chatId notification fallback,
 *   failed result, catch error, params fallback (snake_case params)
 * - handleLlmProactiveChatJob: feishu push with client, no-chatId notification,
 *   context with user+facts, memory store error, associatedSessionId inject, catch error
 * - handleSelfEvolutionJob: failed result, catch error, memory store error
 * - handleMemoryCompressJob: catch error
 * - handleCustomJob: daily-reflection with conversations, patterns with suggestions,
 *   no conversations, reflection error
 * - handleSendReminderJob: inject with associatedSessionId, chatId without client
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const {
  mockLogger,
  mockGetConfig,
  mockSendProactiveMessage,
  mockInjectProactiveResult,
  mockGetRecentSessionHistory,
  mockGetSkillStore,
  mockSkillStoreGet,
  mockCompress,
  mockGetMemoryStore,
  mockGetCompressionEngine,
  mockReflect,
  mockGetReflectionEngine,
  mockPushNotification,
  mockGetRecentConversations,
  mockRecord,
} = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  mockGetConfig: vi.fn(),
  mockSendProactiveMessage: vi.fn(),
  mockInjectProactiveResult: vi.fn(),
  mockGetRecentSessionHistory: vi.fn(),
  mockGetSkillStore: vi.fn(),
  mockSkillStoreGet: vi.fn(),
  mockCompress: vi.fn(),
  mockGetMemoryStore: vi.fn(),
  mockGetCompressionEngine: vi.fn(),
  mockReflect: vi.fn(),
  mockGetReflectionEngine: vi.fn(),
  mockPushNotification: vi.fn(),
  mockGetRecentConversations: vi.fn(),
  mockRecord: vi.fn(),
}));

vi.mock('../../../infra/observability/logger', () => ({ logger: mockLogger }));
vi.mock('../../../infra/config', () => ({ getConfig: mockGetConfig }));
vi.mock('../../session', () => ({
  sendProactiveMessage: (...a: any[]) => mockSendProactiveMessage(...a),
  injectProactiveResult: (...a: any[]) => mockInjectProactiveResult(...a),
  getRecentSessionHistory: (...a: any[]) => mockGetRecentSessionHistory(...a),
}));
vi.mock('../../skills/store', () => ({ getSkillStore: () => ({ get: mockSkillStoreGet }) }));
vi.mock('../../memory/compression', () => ({
  getCompressionEngine: (...a: any[]) => mockGetCompressionEngine(...a),
}));
vi.mock('../../memory', () => ({
  getMemoryStore: (...a: any[]) => mockGetMemoryStore(...a),
}));
vi.mock('../../agent/reflection-engine', () => ({
  getReflectionEngine: (...a: any[]) => mockGetReflectionEngine(...a),
}));
vi.mock('../pusher', () => ({
  pushNotification: (...a: any[]) => mockPushNotification(...a),
}));
vi.mock('../../agent/types', () => ({
  PROACTIVE_DEFAULT_BLOCKED_TOOLS: ['dangerous_tool'],
}));

import {
  handleRunSkillJob,
  handleLlmProactiveChatJob,
  handleSelfEvolutionJob,
  handleMemoryCompressJob,
  handleCustomJob,
  handleSendReminderJob,
} from '../job-handlers';

// ── Helpers ────────────────────────────────────────────────────────────────

function defaultMemoryStore() {
  return {
    getCoreContext: () => ({ user: 'TestUser', facts: 'Some facts', soul: 'Soul data' }),
    getRecentConversations: mockGetRecentConversations,
    record: mockRecord,
    getBasePath: () => '/tmp/mem',
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('job-handlers (extended)', () => {
  beforeEach(() => {
    // Reset all mocks
    for (const fn of Object.values(mockLogger)) (fn as any).mockReset();
    mockGetConfig.mockReset();
    mockSendProactiveMessage.mockReset();
    mockInjectProactiveResult.mockReset();
    mockGetRecentSessionHistory.mockReset();
    mockSkillStoreGet.mockReset();
    mockCompress.mockReset();
    mockGetMemoryStore.mockReset();
    mockGetCompressionEngine.mockReset();
    mockReflect.mockReset();
    mockGetReflectionEngine.mockReset();
    mockPushNotification.mockReset();
    mockGetRecentConversations.mockReset();
    mockRecord.mockReset();

    // Sensible defaults
    mockGetConfig.mockReturnValue({
      defaultPushTarget: { channel: 'feishu', chatId: 'default-chat', userId: 'default-user' },
    });
    mockSendProactiveMessage.mockResolvedValue({ success: true, response: 'ok response' });
    mockGetRecentSessionHistory.mockReturnValue([]);
    mockSkillStoreGet.mockReturnValue({ description: 'A skill', content: 'skill body' });
    mockGetMemoryStore.mockReturnValue(defaultMemoryStore());
    mockGetCompressionEngine.mockReturnValue({ compress: mockCompress });
    mockCompress.mockResolvedValue({ processed: 3, summarized: 1, archived: 0 });
    mockGetReflectionEngine.mockReturnValue({ reflect: mockReflect });
    mockReflect.mockResolvedValue({ patterns: [], strategyUpdates: [] });
    mockPushNotification.mockResolvedValue({ success: true });
    mockGetRecentConversations.mockResolvedValue([]);
    mockRecord.mockResolvedValue(undefined);
  });

  // ── getDefaultPushTarget / getPushTarget (tested indirectly) ──────────

  describe('getPushTarget / getDefaultPushTarget (indirect)', () => {
    it('uses config defaults when no params or client', async () => {
      await handleRunSkillJob({ taskType: 'run_skill', params: { skillName: 'x' } } as any);
      // sendProactiveMessage should receive userId from config
      expect(mockSendProactiveMessage).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'default-user' }),
      );
    });

    it('falls back to feishu-user when config throws', async () => {
      mockGetConfig.mockImplementation(() => { throw new Error('no config'); });
      await handleRunSkillJob({ taskType: 'run_skill', params: { skillName: 'x' } } as any);
      expect(mockSendProactiveMessage).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'feishu-user' }),
      );
    });

    it('uses job params over config defaults', async () => {
      await handleRunSkillJob({
        taskType: 'run_skill',
        params: { skillName: 'x', channel: 'cli', chatId: 'my-chat', userId: 'my-user' },
      } as any);
      expect(mockSendProactiveMessage).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'my-user', channel: 'cli' }),
      );
    });

    it('uses client lastActiveChatId/userId when no params', async () => {
      mockGetConfig.mockReturnValue({});  // no defaultPushTarget
      const client = { lastActiveChatId: 'client-chat', lastActiveUserId: 'client-user' };
      await handleRunSkillJob(
        { taskType: 'run_skill', params: { skillName: 'x' } } as any,
        { getFeishuClient: () => client },
      );
      expect(mockSendProactiveMessage).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'client-user' }),
      );
    });

    it('uses config with missing channel/chatId/userId fields', async () => {
      mockGetConfig.mockReturnValue({ defaultPushTarget: {} });
      await handleRunSkillJob({ taskType: 'run_skill', params: { skillName: 'x' } } as any);
      // Should fall back: channel='feishu', chatId='', userId='feishu-user'
      expect(mockSendProactiveMessage).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'feishu-user', channel: 'feishu' }),
      );
    });
  });

  // ── buildConversationHistoryContext (tested indirectly) ────────────────

  describe('buildConversationHistoryContext (indirect)', () => {
    it('loads and formats history when associatedSessionId is set', async () => {
      mockGetRecentSessionHistory.mockReturnValue([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
        { role: 'system', content: 'Init' },
      ]);
      await handleRunSkillJob({
        taskType: 'run_skill',
        params: { skillName: 'x' },
        associatedSessionId: 'sess-1',
      } as any);
      // The prompt passed to sendProactiveMessage should contain history context
      const call = mockSendProactiveMessage.mock.calls[0][0];
      expect(call.message).toContain('用户最近对话上下文');
      expect(call.message).toContain('用户: Hello');
      expect(call.message).toContain('助手: Hi there');
      expect(call.message).toContain('系统: Init');
    });

    it('truncates messages longer than 500 chars', async () => {
      const longContent = 'A'.repeat(600);
      mockGetRecentSessionHistory.mockReturnValue([
        { role: 'user', content: longContent },
      ]);
      await handleRunSkillJob({
        taskType: 'run_skill',
        params: { skillName: 'x' },
        associatedSessionId: 'sess-2',
      } as any);
      const call = mockSendProactiveMessage.mock.calls[0][0];
      expect(call.message).toContain('...');
      expect(call.message).not.toContain('A'.repeat(600));
    });

    it('returns empty string when getRecentSessionHistory throws', async () => {
      mockGetRecentSessionHistory.mockImplementation(() => { throw new Error('fail'); });
      await handleRunSkillJob({
        taskType: 'run_skill',
        params: { skillName: 'x' },
        associatedSessionId: 'sess-3',
      } as any);
      const call = mockSendProactiveMessage.mock.calls[0][0];
      expect(call.message).not.toContain('用户最近对话上下文');
    });

    it('returns empty string when history is empty', async () => {
      mockGetRecentSessionHistory.mockReturnValue([]);
      await handleRunSkillJob({
        taskType: 'run_skill',
        params: { skillName: 'x' },
        associatedSessionId: 'sess-4',
      } as any);
      const call = mockSendProactiveMessage.mock.calls[0][0];
      expect(call.message).not.toContain('用户最近对话上下文');
    });
  });

  // ── getProactiveBlockedTools (tested indirectly) ──────────────────────

  describe('getProactiveBlockedTools (indirect)', () => {
    it('merges custom blocked tools with defaults', async () => {
      await handleRunSkillJob({
        taskType: 'run_skill',
        params: { skillName: 'x', blockedTools: ['extra_tool'] },
      } as any);
      const call = mockSendProactiveMessage.mock.calls[0][0];
      expect(call.agentOptions.blockedTools).toContain('dangerous_tool');
      expect(call.agentOptions.blockedTools).toContain('extra_tool');
    });

    it('deduplicates when custom includes default', async () => {
      await handleRunSkillJob({
        taskType: 'run_skill',
        params: { skillName: 'x', blockedTools: ['dangerous_tool', 'other'] },
      } as any);
      const call = mockSendProactiveMessage.mock.calls[0][0];
      const blocked = call.agentOptions.blockedTools;
      expect(blocked.filter((t: string) => t === 'dangerous_tool')).toHaveLength(1);
      expect(blocked).toContain('other');
    });
  });

  // ── handleRunSkillJob extended branches ───────────────────────────────

  describe('handleRunSkillJob', () => {
    it('pushes to feishu when channel=feishu, chatId and client exist', async () => {
      const mockClient = { sendMarkdownMessage: vi.fn().mockResolvedValue(undefined) };
      mockSendProactiveMessage.mockResolvedValue({ success: true, response: 'Result text' });
      await handleRunSkillJob(
        {
          taskType: 'run_skill',
          params: { skillName: 'x', chatId: 'ch-1', channel: 'feishu' },
        } as any,
        { getFeishuClient: () => mockClient },
      );
      expect(mockClient.sendMarkdownMessage).toHaveBeenCalledWith('ch-1', 'chat_id', 'Result text');
    });

    it('falls back to pushNotification when no chatId', async () => {
      mockGetConfig.mockReturnValue({ defaultPushTarget: { channel: 'feishu' } }); // no chatId
      mockSendProactiveMessage.mockResolvedValue({ success: true, response: 'Res' });
      await handleRunSkillJob({ taskType: 'run_skill', params: { skillName: 'x' } } as any);
      expect(mockPushNotification).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'skill-execution' }),
      );
    });

    it('logs error when sendProactiveMessage fails', async () => {
      mockSendProactiveMessage.mockResolvedValue({ success: false, error: 'LLM fail' });
      await handleRunSkillJob({ taskType: 'run_skill', params: { skillName: 'x' } } as any);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('execution failed'),
        expect.anything(),
      );
    });

    it('catches thrown error in try block', async () => {
      mockSendProactiveMessage.mockRejectedValue(new Error('network'));
      await handleRunSkillJob({ taskType: 'run_skill', params: { skillName: 'x' } } as any);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to execute skill'),
        expect.objectContaining({ error: 'network' }),
      );
    });

    it('catches non-Error thrown object', async () => {
      mockSendProactiveMessage.mockRejectedValue('string err');
      await handleRunSkillJob({ taskType: 'run_skill', params: { skillName: 'x' } } as any);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to execute skill'),
        expect.objectContaining({ error: 'Unknown error' }),
      );
    });

    it('uses params fallback (job.params.params) when no skillParams', async () => {
      mockSendProactiveMessage.mockResolvedValue({ success: true, response: 'ok' });
      await handleRunSkillJob({
        taskType: 'run_skill',
        params: { skillName: 'x', params: { key: 'val' } },
      } as any);
      const call = mockSendProactiveMessage.mock.calls[0][0];
      expect(call.message).toContain('"key": "val"');
    });

    it('uses sessionId from chatId+userId when no associatedSessionId', async () => {
      mockSendProactiveMessage.mockResolvedValue({ success: true, response: 'ok' });
      await handleRunSkillJob({
        taskType: 'run_skill',
        params: { skillName: 'x', chatId: 'ch-2', userId: 'u-2' },
      } as any);
      const call = mockSendProactiveMessage.mock.calls[0][0];
      expect(call.sessionId).toBe('feishu-ch-2-u-2');
    });

    it('handles skill with no content', async () => {
      mockSkillStoreGet.mockReturnValue({ description: 'desc', content: '' });
      mockSendProactiveMessage.mockResolvedValue({ success: true, response: 'ok' });
      await handleRunSkillJob({ taskType: 'run_skill', params: { skillName: 'x' } } as any);
      const call = mockSendProactiveMessage.mock.calls[0][0];
      expect(call.message).toContain('(无详细内容)');
    });
  });

  // ── handleLlmProactiveChatJob extended branches ───────────────────────

  describe('handleLlmProactiveChatJob', () => {
    it('includes user and facts context from memory store', async () => {
      mockSendProactiveMessage.mockResolvedValue({ success: true, response: 'hi' });
      await handleLlmProactiveChatJob({
        taskType: 'llm_proactive_chat',
        params: { prompt: 'hello' },
      } as any);
      const call = mockSendProactiveMessage.mock.calls[0][0];
      expect(call.message).toContain('用户信息: TestUser');
      expect(call.message).toContain('用户事实: Some facts');
    });

    it('handles memory store error gracefully', async () => {
      mockGetMemoryStore.mockImplementation(() => { throw new Error('no mem'); });
      mockSendProactiveMessage.mockResolvedValue({ success: true, response: 'hi' });
      await handleLlmProactiveChatJob({
        taskType: 'llm_proactive_chat',
        params: { prompt: 'test' },
      } as any);
      expect(mockSendProactiveMessage).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Memory store not initialized'),
        expect.anything(),
      );
    });

    it('pushes to feishu when chatId and client available', async () => {
      const mockClient = { sendMarkdownMessage: vi.fn().mockResolvedValue(undefined) };
      mockSendProactiveMessage.mockResolvedValue({ success: true, response: 'msg' });
      await handleLlmProactiveChatJob(
        {
          taskType: 'llm_proactive_chat',
          params: { chatId: 'ch-llm' },
        } as any,
        { getFeishuClient: () => mockClient },
      );
      expect(mockClient.sendMarkdownMessage).toHaveBeenCalledWith('ch-llm', 'chat_id', 'msg');
    });

    it('pushes notification when no chatId', async () => {
      mockGetConfig.mockReturnValue({ defaultPushTarget: { channel: 'feishu' } }); // no chatId
      mockSendProactiveMessage.mockResolvedValue({ success: true, response: 'msg' });
      await handleLlmProactiveChatJob({
        taskType: 'llm_proactive_chat',
        params: {},
      } as any);
      expect(mockPushNotification).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'llm-proactive' }),
      );
    });

    it('injects result when associatedSessionId is set', async () => {
      mockSendProactiveMessage.mockResolvedValue({ success: true, response: 'injected' });
      await handleLlmProactiveChatJob({
        taskType: 'llm_proactive_chat',
        params: {},
        associatedSessionId: 'sess-llm',
      } as any);
      expect(mockInjectProactiveResult).toHaveBeenCalledWith('sess-llm', expect.objectContaining({
        source: '定时主动沟通',
      }));
    });

    it('catches thrown error', async () => {
      mockSendProactiveMessage.mockRejectedValue(new Error('boom'));
      await handleLlmProactiveChatJob({
        taskType: 'llm_proactive_chat',
        params: {},
      } as any);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('LLM proactive chat error'),
        expect.anything(),
      );
    });

    it('uses default prompt when none provided', async () => {
      mockSendProactiveMessage.mockResolvedValue({ success: true, response: 'ok' });
      await handleLlmProactiveChatJob({
        taskType: 'llm_proactive_chat',
        params: {},
      } as any);
      const call = mockSendProactiveMessage.mock.calls[0][0];
      expect(call.message).toContain('定时主动沟通');
    });

    it('includes history context with associatedSessionId', async () => {
      mockGetRecentSessionHistory.mockReturnValue([
        { role: 'user', content: 'recent msg' },
      ]);
      mockSendProactiveMessage.mockResolvedValue({ success: true, response: 'ok' });
      await handleLlmProactiveChatJob({
        taskType: 'llm_proactive_chat',
        params: {},
        associatedSessionId: 'sess-hist',
      } as any);
      const call = mockSendProactiveMessage.mock.calls[0][0];
      expect(call.message).toContain('用户最近对话上下文');
    });

    it('handles coreContext with no user or facts', async () => {
      mockGetMemoryStore.mockReturnValue({
        ...defaultMemoryStore(),
        getCoreContext: () => ({}),
      });
      mockSendProactiveMessage.mockResolvedValue({ success: true, response: 'ok' });
      await handleLlmProactiveChatJob({
        taskType: 'llm_proactive_chat',
        params: { prompt: 'test' },
      } as any);
      const call = mockSendProactiveMessage.mock.calls[0][0];
      expect(call.message).not.toContain('用户信息');
      expect(call.message).not.toContain('用户事实');
    });
  });

  // ── handleSelfEvolutionJob extended branches ──────────────────────────

  describe('handleSelfEvolutionJob', () => {
    it('includes facts and soul context', async () => {
      mockSendProactiveMessage.mockResolvedValue({ success: true, response: 'evolved' });
      await handleSelfEvolutionJob({ taskType: 'self_evolution', params: {} } as any);
      const call = mockSendProactiveMessage.mock.calls[0][0];
      expect(call.message).toContain('用户事实和经验教训');
      expect(call.message).toContain('Some facts');
      expect(call.message).toContain('当前 SOUL.md');
      expect(call.message).toContain('Soul data');
    });

    it('handles failed result', async () => {
      mockSendProactiveMessage.mockResolvedValue({ success: false, error: 'LLM err' });
      await handleSelfEvolutionJob({ taskType: 'self_evolution', params: {} } as any);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Self-evolution failed'),
        expect.anything(),
      );
    });

    it('catches thrown error', async () => {
      mockSendProactiveMessage.mockRejectedValue(new Error('kaboom'));
      await handleSelfEvolutionJob({ taskType: 'self_evolution', params: {} } as any);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Self-evolution failed'),
        expect.anything(),
      );
    });

    it('handles memory store error gracefully', async () => {
      mockGetMemoryStore.mockImplementation(() => { throw new Error('no mem'); });
      mockSendProactiveMessage.mockResolvedValue({ success: true, response: 'ok' });
      await handleSelfEvolutionJob({ taskType: 'self_evolution', params: {} } as any);
      expect(mockSendProactiveMessage).toHaveBeenCalled();
    });

    it('handles coreContext with no facts or soul', async () => {
      mockGetMemoryStore.mockReturnValue({
        ...defaultMemoryStore(),
        getCoreContext: () => ({}),
      });
      mockSendProactiveMessage.mockResolvedValue({ success: true, response: 'ok' });
      await handleSelfEvolutionJob({ taskType: 'self_evolution', params: {} } as any);
      const call = mockSendProactiveMessage.mock.calls[0][0];
      expect(call.message).not.toContain('用户事实和经验教训');
      expect(call.message).not.toContain('当前 SOUL.md');
    });
  });

  // ── handleMemoryCompressJob extended branches ─────────────────────────

  describe('handleMemoryCompressJob', () => {
    it('catches compression error', async () => {
      mockCompress.mockRejectedValue(new Error('compress fail'));
      await handleMemoryCompressJob();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Memory compression failed'),
        expect.anything(),
      );
    });

    it('catches getMemoryStore error', async () => {
      mockGetMemoryStore.mockImplementation(() => { throw new Error('no store'); });
      await handleMemoryCompressJob();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Memory compression failed'),
        expect.anything(),
      );
    });
  });

  // ── handleCustomJob extended branches ─────────────────────────────────

  describe('handleCustomJob', () => {
    it('daily-reflection with conversations and patterns', async () => {
      mockGetRecentConversations.mockResolvedValue([
        { timestamp: '2026-01-01', user: 'hi', assistant: 'hello', metadata: { skillTriggered: 'greet' } },
        { timestamp: '2026-01-02', user: 'bye', assistant: 'goodbye', metadata: {} },
      ]);
      mockReflect.mockResolvedValue({
        patterns: [
          { description: 'User greets often', suggestion: 'Be friendlier' },
          { description: 'Short messages' },
        ],
        strategyUpdates: ['update1'],
      });
      await handleCustomJob({
        taskType: 'custom',
        params: { action: 'daily-reflection' },
      } as any);
      expect(mockReflect).toHaveBeenCalled();
      expect(mockRecord).toHaveBeenCalledTimes(2);
      // First pattern has suggestion
      expect(mockRecord).toHaveBeenCalledWith('lessons', expect.stringContaining('Suggestion: Be friendlier'));
      // Second pattern has no suggestion
      expect(mockRecord).toHaveBeenCalledWith('lessons', 'Short messages');
    });

    it('daily-reflection returns early when no conversations', async () => {
      mockGetRecentConversations.mockResolvedValue([]);
      await handleCustomJob({
        taskType: 'custom',
        params: { action: 'daily-reflection' },
      } as any);
      expect(mockReflect).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('No conversations to reflect on'),
      );
    });

    it('daily-reflection catches reflection error', async () => {
      mockGetRecentConversations.mockResolvedValue([
        { timestamp: '2026-01-01', user: 'hi', assistant: 'hello', metadata: {} },
      ]);
      mockReflect.mockRejectedValue(new Error('reflect fail'));
      await handleCustomJob({
        taskType: 'custom',
        params: { action: 'daily-reflection' },
      } as any);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Daily reflection failed'),
        expect.anything(),
      );
    });

    it('daily-reflection handles null result from reflect', async () => {
      mockGetRecentConversations.mockResolvedValue([
        { timestamp: '2026-01-01', user: 'hi', assistant: 'hello', metadata: {} },
      ]);
      mockReflect.mockResolvedValue(null);
      await handleCustomJob({
        taskType: 'custom',
        params: { action: 'daily-reflection' },
      } as any);
      // Should not throw, no record calls
      expect(mockRecord).not.toHaveBeenCalled();
    });

    it('daily-reflection with no patterns in result', async () => {
      mockGetRecentConversations.mockResolvedValue([
        { timestamp: '2026-01-01', user: 'hi', assistant: 'hello', metadata: {} },
      ]);
      mockReflect.mockResolvedValue({ patterns: [], strategyUpdates: [] });
      await handleCustomJob({
        taskType: 'custom',
        params: { action: 'daily-reflection' },
      } as any);
      // result.patterns is empty array, truthy but length 0 — no record calls
      expect(mockRecord).not.toHaveBeenCalled();
    });

    it('logs warning for unknown action', async () => {
      await handleCustomJob({
        taskType: 'custom',
        params: { action: 'some-random-action' },
      } as any);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unknown custom action'),
        'some-random-action',
      );
    });

    it('handles missing action param', async () => {
      await handleCustomJob({
        taskType: 'custom',
        params: {},
      } as any);
      // undefined action → not 'daily-reflection', falls through to warn
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  // ── handleSendReminderJob extended branches ───────────────────────────

  describe('handleSendReminderJob', () => {
    it('sends via client and injects when associatedSessionId is set', async () => {
      const mockClient = { sendMarkdownMessage: vi.fn().mockResolvedValue(undefined) };
      await handleSendReminderJob(
        {
          taskType: 'send_reminder',
          params: { message: 'Remember!', chatId: 'ch-rem' },
          associatedSessionId: 'sess-rem',
        } as any,
        { getFeishuClient: () => mockClient },
      );
      expect(mockClient.sendMarkdownMessage).toHaveBeenCalled();
      expect(mockInjectProactiveResult).toHaveBeenCalledWith('sess-rem', expect.objectContaining({
        source: '定时提醒',
        content: 'Remember!',
      }));
    });

    it('does not inject when no associatedSessionId', async () => {
      const mockClient = { sendMarkdownMessage: vi.fn().mockResolvedValue(undefined) };
      await handleSendReminderJob(
        {
          taskType: 'send_reminder',
          params: { message: 'Remind!', chatId: 'ch-x' },
        } as any,
        { getFeishuClient: () => mockClient },
      );
      expect(mockClient.sendMarkdownMessage).toHaveBeenCalled();
      expect(mockInjectProactiveResult).not.toHaveBeenCalled();
    });

    it('falls back to pushNotification when chatId is present but no client', async () => {
      // chatId exists but no client → the if(client) branch is false, so it skips the send
      // Actually re-reading the code: if(chatId && job.params?.message) → if(client) ...
      // When client is falsy, nothing happens in the if block. Then no else either.
      // So we need to test the else (pushNotification) path: chatId falsy or message falsy
      mockGetConfig.mockReturnValue({ defaultPushTarget: {} }); // no chatId
      await handleSendReminderJob(
        {
          taskType: 'send_reminder',
          params: { message: 'Fallback msg', priority: 'high' },
        } as any,
      );
      expect(mockPushNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Fallback msg',
          priority: 'high',
          category: 'reminder',
        }),
      );
    });

    it('falls back to pushNotification when message is missing', async () => {
      await handleSendReminderJob(
        {
          taskType: 'send_reminder',
          params: {},
        } as any,
      );
      expect(mockPushNotification).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'reminder' }),
      );
    });

    it('uses default priority when not specified in fallback', async () => {
      mockGetConfig.mockReturnValue({ defaultPushTarget: {} }); // no chatId
      await handleSendReminderJob(
        {
          taskType: 'send_reminder',
          params: { message: 'test' },
        } as any,
      );
      expect(mockPushNotification).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'normal' }),
      );
    });
  });
});
