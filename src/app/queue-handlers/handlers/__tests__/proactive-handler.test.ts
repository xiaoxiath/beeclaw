/**
 * Tests for proactive-handler.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Use vi.hoisted for all mock variables referenced inside vi.mock factories
const {
  mockLogger,
  mockGoalStore,
  mockNotificationManager,
  mockPushNotification,
  mockHandleSelfEvolutionJob,
  mockGetFeishuWSClient,
  mockSendProactiveMessage,
  mockInjectProactiveResult,
  mockGetSessionSummary,
  mockGetMemoryStore,
  mockRenderMessageCard,
} = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(() => {}),
    info: vi.fn(() => {}),
    warn: vi.fn(() => {}),
    error: vi.fn(() => {}),
  },
  mockGoalStore: { list: vi.fn(() => []) },
  mockNotificationManager: { create: vi.fn(() => ({ id: 'notif-1' })) },
  mockPushNotification: vi.fn(() =>
    Promise.resolve({ success: true, notificationId: 'notif-push-1', delivered: ['cli'] })
  ),
  mockHandleSelfEvolutionJob: vi.fn(() => Promise.resolve({ success: true, response: 'evolved' })),
  mockGetFeishuWSClient: vi.fn(() => null),
  mockSendProactiveMessage: vi.fn(() =>
    Promise.resolve({ success: true, response: 'Hello!', sessionId: 'sess-1' })
  ),
  mockInjectProactiveResult: vi.fn(() => true),
  mockGetSessionSummary: vi.fn(() => 'recent conversation summary'),
  mockGetMemoryStore: vi.fn(() => ({
    getCoreContext: vi.fn(() => ({ user: 'Test User', facts: 'Some facts' })),
  })),
  mockRenderMessageCard: vi.fn(() => ({ card: 'mock-card' })),
}));

vi.mock('../../../../infra/observability/logger', () => ({
  logger: mockLogger,
}));

vi.mock('../../../../domain/agent/goal/store', () => ({
  getGoalStore: () => mockGoalStore,
}));

vi.mock('../../../../domain/proactive/notifications', () => ({
  getNotificationManager: () => mockNotificationManager,
}));

vi.mock('../../../../domain/proactive/pusher', () => ({
  pushNotification: mockPushNotification,
}));

vi.mock('../../../../domain/proactive/job-handlers', () => ({
  handleSelfEvolutionJob: mockHandleSelfEvolutionJob,
}));

vi.mock('../../../../adapter/feishu', () => ({
  getFeishuWSClient: mockGetFeishuWSClient,
}));

vi.mock('../../../../domain/session', () => ({
  sendProactiveMessage: mockSendProactiveMessage,
  injectProactiveResult: mockInjectProactiveResult,
  getSessionSummary: mockGetSessionSummary,
}));

vi.mock('../../../../domain/memory', () => ({
  getMemoryStore: mockGetMemoryStore,
}));

vi.mock('../../../../adapter/feishu/card-v2/message-renderer', () => ({
  renderMessageCard: mockRenderMessageCard,
}));

import { handleProactiveJob } from '../proactive-handler';

function fakeJob(data: Record<string, unknown>) {
  return {
    data: {
      scheduleId: 'sched-1',
      triggeredAt: new Date().toISOString(),
      triggeredBy: 'scheduler',
      ...data,
    },
    updateProgress: vi.fn(() => Promise.resolve()),
  } as any;
}

describe('handleProactiveJob', () => {
  beforeEach(() => {
    mockLogger.debug.mockClear();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockGoalStore.list.mockClear();
    mockNotificationManager.create.mockClear();
    mockPushNotification.mockClear();
    mockHandleSelfEvolutionJob.mockClear();
    mockHandleSelfEvolutionJob.mockResolvedValue({ success: true, response: 'evolved' });
    mockGetFeishuWSClient.mockClear();
    mockSendProactiveMessage.mockClear();
    mockInjectProactiveResult.mockClear();
    mockGetSessionSummary.mockClear();
    mockGetMemoryStore.mockClear();
    mockRenderMessageCard.mockClear();
  });

  it('should handle check_goal_progress task with no goals', async () => {
    mockGoalStore.list.mockReturnValue([]);
    const job = fakeJob({ taskType: 'check_goal_progress', params: {} });
    const result = await handleProactiveJob(job) as any;

    expect(result.success).toBe(true);
    expect(result.taskType).toBe('check_goal_progress');
    expect(result.result.checkedGoals).toBe(0);
    expect(result.result.notificationsCreated).toBe(0);
    expect(job.updateProgress).toHaveBeenCalledTimes(2);
  });

  it('should handle check_goal_progress with stale goals', async () => {
    const staleDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    mockGoalStore.list.mockReturnValue([
      { id: 'g1', title: 'Test Goal', progress: 30, updatedAt: staleDate },
    ]);

    const job = fakeJob({ taskType: 'check_goal_progress', params: {} });
    const result = await handleProactiveJob(job) as any;

    expect(result.success).toBe(true);
    expect(result.result.checkedGoals).toBe(1);
    expect(result.result.notificationsCreated).toBe(1);
    expect(mockNotificationManager.create).toHaveBeenCalledTimes(1);
  });

  it('should handle run_skill task', async () => {
    const job = fakeJob({
      taskType: 'run_skill',
      params: { skillName: 'test-skill', skillParams: { key: 'val' } },
    });
    const result = await handleProactiveJob(job) as any;

    expect(result.success).toBe(true);
    expect(result.result.skillName).toBe('test-skill');
    expect(result.result.executed).toBe(false);
  });

  it('should fail run_skill without skillName', async () => {
    const job = fakeJob({ taskType: 'run_skill', params: {} });
    const result = await handleProactiveJob(job) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain('skillName');
  });

  it('should handle send_reminder task successfully', async () => {
    mockPushNotification.mockResolvedValue({
      success: true,
      notificationId: 'n1',
      delivered: ['cli'],
    });

    const job = fakeJob({
      taskType: 'send_reminder',
      params: { message: 'Remember this!', priority: 'high' },
    });
    const result = await handleProactiveJob(job) as any;

    expect(result.success).toBe(true);
    expect(result.result.message).toBe('Remember this!');
    expect(mockPushNotification).toHaveBeenCalled();
  });

  it('should fail send_reminder without message', async () => {
    const job = fakeJob({ taskType: 'send_reminder', params: {} });
    const result = await handleProactiveJob(job) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain('message');
  });

  it('should handle memory_compress task (stub)', async () => {
    const job = fakeJob({ taskType: 'memory_compress', params: {} });
    const result = await handleProactiveJob(job) as any;

    expect(result.success).toBe(true);
    expect(result.result.executed).toBe(false);
    expect(result.result.note).toContain('Phase 3');
  });

  it('should handle custom task with action param', async () => {
    const job = fakeJob({
      taskType: 'custom',
      params: { action: 'my-action', extra: 'data' },
    });
    const result = await handleProactiveJob(job) as any;

    expect(result.success).toBe(true);
    expect(result.result.action).toBe('my-action');
    expect(result.result.executed).toBe(true);
  });

  it('should fail custom task without action', async () => {
    const job = fakeJob({ taskType: 'custom', params: {} });
    const result = await handleProactiveJob(job) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain('action');
  });

  it('should handle llm_proactive_chat task', async () => {
    mockSendProactiveMessage.mockResolvedValue({
      success: true,
      response: 'Generated greeting',
      sessionId: 's1',
    });

    const job = fakeJob({
      taskType: 'llm_proactive_chat',
      params: { prompt: 'Say hello', userId: 'u1' },
    });
    const result = await handleProactiveJob(job) as any;

    expect(result.success).toBe(true);
    expect(result.result.generated).toBe(true);
    expect(mockSendProactiveMessage).toHaveBeenCalled();
  });

  it('should handle llm_proactive_chat with Feishu push', async () => {
    const mockClient = {
      lastActiveChatId: 'chat-123',
      sendCard: vi.fn(() => Promise.resolve('msg-1')),
    };
    mockGetFeishuWSClient.mockReturnValue(mockClient);
    mockSendProactiveMessage.mockResolvedValue({
      success: true,
      response: 'Pushed message',
      sessionId: 's2',
    });

    const job = fakeJob({
      taskType: 'llm_proactive_chat',
      params: { prompt: 'Push test', chatId: 'chat-123' },
    });
    const result = await handleProactiveJob(job) as any;

    expect(result.success).toBe(true);
    expect(result.result.generated).toBe(true);
    expect(result.result.pushed).toBe(true);
  });

  it('should handle llm_proactive_chat with LLM failure', async () => {
    mockSendProactiveMessage.mockResolvedValue({
      success: false,
      error: 'LLM timeout',
    });

    const job = fakeJob({
      taskType: 'llm_proactive_chat',
      params: { prompt: 'Fail test' },
    });
    const result = await handleProactiveJob(job) as any;

    expect(result.success).toBe(true);
    expect(result.result.generated).toBe(false);
    expect(result.result.error).toContain('LLM');
  });

  it('should handle unknown task type', async () => {
    const job = fakeJob({ taskType: 'nonexistent_task', params: {} });
    const result = await handleProactiveJob(job) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown task type');
  });

  it('should include completedAt on success', async () => {
    const job = fakeJob({ taskType: 'memory_compress', params: {} });
    const result = await handleProactiveJob(job) as any;

    expect(result.success).toBe(true);
    expect(result.completedAt).toBeDefined();
    expect(result.scheduleId).toBe('sched-1');
  });

  it('should include failedAt on failure', async () => {
    const job = fakeJob({ taskType: 'nonexistent_task', params: {} });
    const result = await handleProactiveJob(job) as any;

    expect(result.success).toBe(false);
    expect(result.failedAt).toBeDefined();
  });

  it('should handle send_reminder with Feishu channel', async () => {
    const mockClient = { lastActiveChatId: 'feishu-chat-1' };
    mockGetFeishuWSClient.mockReturnValue(mockClient);
    mockPushNotification.mockResolvedValue({
      success: true,
      notificationId: 'n2',
      delivered: ['feishu'],
    });

    const job = fakeJob({
      taskType: 'send_reminder',
      params: { message: 'Feishu reminder', priority: 'normal' },
    });
    const result = await handleProactiveJob(job) as any;

    expect(result.success).toBe(true);
    expect(result.result.channels).toContain('feishu');
  });

  it('should handle llm_proactive_chat with session context', async () => {
    mockSendProactiveMessage.mockResolvedValue({
      success: true,
      response: 'Context-aware reply',
      sessionId: 's3',
    });

    const job = fakeJob({
      taskType: 'llm_proactive_chat',
      params: { prompt: 'Test with context', associatedSessionId: 'session-abc' },
    });
    const result = await handleProactiveJob(job) as any;

    expect(result.success).toBe(true);
    expect(result.result.generated).toBe(true);
    expect(mockGetSessionSummary).toHaveBeenCalled();
  });

  it('should use top-level associatedSessionId for proactive chat context and write-back', async () => {
    mockSendProactiveMessage.mockResolvedValue({
      success: true,
      response: 'Context-aware reply',
      sessionId: 'session-top',
    });

    const job = fakeJob({
      taskType: 'llm_proactive_chat',
      params: { prompt: 'Test with context' },
      associatedSessionId: 'session-top',
    });
    const result = await handleProactiveJob(job) as any;

    expect(result.success).toBe(true);
    expect(mockGetSessionSummary).toHaveBeenCalledWith('session-top', 5, 'proactive-user');
    expect(mockSendProactiveMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-top',
      context: expect.objectContaining({ source: 'proactive' }),
    }));
    expect(mockInjectProactiveResult).toHaveBeenCalledWith('session-top', expect.objectContaining({
      source: '定时主动沟通',
      content: 'Context-aware reply',
    }));
  });

  it('should handle queued self_evolution jobs', async () => {
    const job = fakeJob({ taskType: 'self_evolution', params: {} });
    const result = await handleProactiveJob(job) as any;

    expect(result.success).toBe(true);
    expect(result.result.success).toBe(true);
    expect(mockHandleSelfEvolutionJob).toHaveBeenCalledWith(expect.objectContaining({
      taskType: 'self_evolution',
    }));
  });

  it('should fail queued self_evolution jobs when the domain handler fails', async () => {
    mockHandleSelfEvolutionJob.mockResolvedValueOnce({ success: false, error: 'evolution failed' });

    const job = fakeJob({ taskType: 'self_evolution', params: {} });
    const result = await handleProactiveJob(job) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain('evolution failed');
  });
});
