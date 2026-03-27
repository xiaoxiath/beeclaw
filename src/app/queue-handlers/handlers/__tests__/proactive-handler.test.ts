/**
 * Tests for proactive-handler.ts
 *
 * Mocks all external dependencies (logger, stores, feishu, session, notifications)
 * and tests each task type handler path.
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';

// ---- Mocks ----

const mockLogger = {
  debug: mock(() => {}),
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
};

const mockGoalStore = {
  list: mock(() => []),
};

const mockNotificationManager = {
  create: mock(() => ({ id: 'notif-1' })),
};

const mockPushNotification = mock(() =>
  Promise.resolve({ success: true, notificationId: 'notif-push-1', delivered: ['cli'] })
);

const mockGetFeishuWSClient = mock(() => null);

const mockSendProactiveMessage = mock(() =>
  Promise.resolve({ success: true, response: 'Hello!', sessionId: 'sess-1' })
);

const mockGetSessionSummary = mock(() => 'recent conversation summary');

const mockGetMemoryStore = mock(() => ({
  getCoreContext: mock(() => ({ user: 'Test User', facts: 'Some facts' })),
}));

const mockRenderMessageCard = mock(() => ({ card: 'mock-card' }));

mock.module('../../../../infra/observability/logger', () => ({
  logger: mockLogger,
}));

mock.module('../../../../domain/agent/goal/store', () => ({
  getGoalStore: () => mockGoalStore,
}));

mock.module('../../../../domain/proactive/notifications', () => ({
  getNotificationManager: () => mockNotificationManager,
}));

mock.module('../../../../domain/proactive/pusher', () => ({
  pushNotification: mockPushNotification,
}));

mock.module('../../../../adapter/feishu', () => ({
  getFeishuWSClient: mockGetFeishuWSClient,
}));

mock.module('../../../../domain/session', () => ({
  sendProactiveMessage: mockSendProactiveMessage,
  getSessionSummary: mockGetSessionSummary,
}));

mock.module('../../../../domain/memory', () => ({
  getMemoryStore: mockGetMemoryStore,
}));

mock.module('../../../../adapter/feishu/card-v2/message-renderer', () => ({
  renderMessageCard: mockRenderMessageCard,
}));

// Import after mocks
import { handleProactiveJob } from '../proactive-handler';

// Helper to create a fake job object
function fakeJob(data: Record<string, unknown>) {
  return {
    data: {
      scheduleId: 'sched-1',
      triggeredAt: new Date().toISOString(),
      triggeredBy: 'scheduler',
      ...data,
    },
    updateProgress: mock(() => Promise.resolve()),
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
    mockGetFeishuWSClient.mockClear();
    mockSendProactiveMessage.mockClear();
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
      sendCard: mock(() => Promise.resolve('msg-1')),
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
});
