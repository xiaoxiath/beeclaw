/**
 * Tests for Dispatcher Handlers
 *
 * Comprehensive tests for registerDefaultHandlers covering all task types,
 * error paths, and edge cases.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import type { Task } from '../types';

// ── Hoisted mocks ────────────────────────────────────────────────────────

const {
  mockSendProactiveMessage,
  mockConfirmDelivery,
  mockGetMessageGateway,
  mockLogger,
  mockHandleMemoryCompressJob,
  mockHandleLlmProactiveChatJob,
  mockHandleSelfEvolutionJob,
  mockHandleRunSkillJob,
  mockHandleGoalProgressCheckJob,
  mockHandleCustomJob,
  mockHandleSendReminderJob,
  mockRegisterHandler,
  mockGetTaskDispatcher,
} = vi.hoisted(() => ({
  mockSendProactiveMessage: vi.fn(async () => ({ success: true, response: 'Hello!', sessionId: 'sess-1' })),
  mockConfirmDelivery: vi.fn(),
  mockGetMessageGateway: vi.fn(() => ({
    replyMessage: vi.fn(async () => ({ success: true })),
    postMessage: vi.fn(async () => ({ success: true })),
  })),
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  mockHandleMemoryCompressJob: vi.fn(async () => {}),
  mockHandleLlmProactiveChatJob: vi.fn(async () => {}),
  mockHandleSelfEvolutionJob: vi.fn(async () => {}),
  mockHandleRunSkillJob: vi.fn(async () => {}),
  mockHandleGoalProgressCheckJob: vi.fn(async () => {}),
  mockHandleCustomJob: vi.fn(async () => {}),
  mockHandleSendReminderJob: vi.fn(async () => {}),
  mockRegisterHandler: vi.fn(),
  mockGetTaskDispatcher: vi.fn(),
}));

vi.mock('../../../domain/session', () => ({
  sendProactiveMessage: mockSendProactiveMessage,
  confirmDelivery: mockConfirmDelivery,
}));

vi.mock('../../gateway-channel', () => ({
  getMessageGateway: mockGetMessageGateway,
}));

vi.mock('../../../infra/observability/logger', () => ({
  logger: mockLogger,
}));

vi.mock('../../../domain/proactive/job-handlers', () => ({
  handleMemoryCompressJob: mockHandleMemoryCompressJob,
  handleLlmProactiveChatJob: mockHandleLlmProactiveChatJob,
  handleSelfEvolutionJob: mockHandleSelfEvolutionJob,
  handleRunSkillJob: mockHandleRunSkillJob,
  handleGoalProgressCheckJob: mockHandleGoalProgressCheckJob,
  handleCustomJob: mockHandleCustomJob,
  handleSendReminderJob: mockHandleSendReminderJob,
}));

vi.mock('../index', () => ({
  getTaskDispatcher: mockGetTaskDispatcher,
}));

describe('registerDefaultHandlers', () => {
  let handlers: Map<string, (task: Task) => Promise<void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new Map();
    mockRegisterHandler.mockImplementation((type: string, handler: any) => {
      handlers.set(type, handler);
    });
    mockGetTaskDispatcher.mockReturnValue({
      registerHandler: mockRegisterHandler,
    });
  });

  async function importAndRegister() {
    // Re-import to trigger registerDefaultHandlers
    const mod = await import('../handlers');
    mod.registerDefaultHandlers();
    return handlers;
  }

  // ── Message handler ───────────────────────────────────────────────────

  describe('message handler', () => {
    test('should register message handler', async () => {
      await importAndRegister();
      expect(handlers.has('message')).toBe(true);
    });

    test('should process message and send reply via gateway', async () => {
      const gatewayReply = vi.fn(async () => ({ success: true }));
      mockGetMessageGateway.mockReturnValue({
        replyMessage: gatewayReply,
        postMessage: vi.fn(),
      });

      await importAndRegister();
      const handler = handlers.get('message')!;

      const task = {
        id: 't1',
        sessionId: 's1',
        type: 'message' as const,
        payload: {
          message: 'Hello',
          userId: 'user1',
          channel: 'feishu',
          sessionId: 'sess-1',
          context: { chatId: 'chat1', messageId: 'msg1' },
        },
        status: 'pending' as const,
        attempts: 0,
        maxAttempts: 3,
        scheduledAt: new Date(),
        createdAt: new Date(),
      };

      await handler(task);

      expect(mockSendProactiveMessage).toHaveBeenCalledWith({
        message: 'Hello',
        userId: 'user1',
        channel: 'feishu',
        sessionId: 'sess-1',
        context: { chatId: 'chat1', messageId: 'msg1' },
      });
      expect(gatewayReply).toHaveBeenCalled();
      expect(mockConfirmDelivery).toHaveBeenCalledWith('sess-1');
    });

    test('should throw if message processing fails', async () => {
      mockSendProactiveMessage.mockResolvedValueOnce({ success: false, error: 'LLM error' });
      await importAndRegister();
      const handler = handlers.get('message')!;

      const task = {
        id: 't2', sessionId: 's1', type: 'message' as const,
        payload: { message: 'Hi', userId: 'u1', channel: 'cli', sessionId: 's1', context: {} },
        status: 'pending' as const, attempts: 0, maxAttempts: 3,
        scheduledAt: new Date(), createdAt: new Date(),
      };

      await expect(handler(task)).rejects.toThrow('LLM error');
    });

    test('should throw with default message when error is empty', async () => {
      mockSendProactiveMessage.mockResolvedValueOnce({ success: false });
      await importAndRegister();
      const handler = handlers.get('message')!;

      const task = {
        id: 't3', sessionId: 's1', type: 'message' as const,
        payload: { message: 'Hi', userId: 'u1', channel: 'cli', sessionId: 's1', context: {} },
        status: 'pending' as const, attempts: 0, maxAttempts: 3,
        scheduledAt: new Date(), createdAt: new Date(),
      };

      await expect(handler(task)).rejects.toThrow('Message processing failed');
    });

    test('should skip gateway reply when no response', async () => {
      mockSendProactiveMessage.mockResolvedValueOnce({ success: true, response: null });
      const gatewayReply = vi.fn();
      mockGetMessageGateway.mockReturnValue({ replyMessage: gatewayReply, postMessage: vi.fn() });

      await importAndRegister();
      const handler = handlers.get('message')!;

      const task = {
        id: 't4', sessionId: 's1', type: 'message' as const,
        payload: { message: 'Hi', userId: 'u1', channel: 'cli', sessionId: 's1', context: {} },
        status: 'pending' as const, attempts: 0, maxAttempts: 3,
        scheduledAt: new Date(), createdAt: new Date(),
      };

      await handler(task);
      expect(gatewayReply).not.toHaveBeenCalled();
    });

    test('should skip gateway reply when no channel', async () => {
      mockSendProactiveMessage.mockResolvedValueOnce({ success: true, response: 'Response' });
      const gatewayReply = vi.fn();
      mockGetMessageGateway.mockReturnValue({ replyMessage: gatewayReply, postMessage: vi.fn() });

      await importAndRegister();
      const handler = handlers.get('message')!;

      const task = {
        id: 't5', sessionId: 's1', type: 'message' as const,
        payload: { message: 'Hi', userId: 'u1', channel: '', sessionId: 's1', context: {} },
        status: 'pending' as const, attempts: 0, maxAttempts: 3,
        scheduledAt: new Date(), createdAt: new Date(),
      };

      await handler(task);
      expect(gatewayReply).not.toHaveBeenCalled();
    });

    test('should throw when gateway reply fails', async () => {
      mockSendProactiveMessage.mockResolvedValueOnce({ success: true, response: 'OK', sessionId: 's1' });
      mockGetMessageGateway.mockReturnValue({
        replyMessage: vi.fn(async () => ({ success: false, error: 'Gateway error' })),
        postMessage: vi.fn(),
      });

      await importAndRegister();
      const handler = handlers.get('message')!;

      const task = {
        id: 't6', sessionId: 's1', type: 'message' as const,
        payload: { message: 'Hi', userId: 'u1', channel: 'feishu', sessionId: 's1', context: {} },
        status: 'pending' as const, attempts: 0, maxAttempts: 3,
        scheduledAt: new Date(), createdAt: new Date(),
      };

      await expect(handler(task)).rejects.toThrow('Gateway error');
    });

    test('should not confirmDelivery when sessionId is missing', async () => {
      mockSendProactiveMessage.mockResolvedValueOnce({ success: true, response: 'OK' });
      mockGetMessageGateway.mockReturnValue({
        replyMessage: vi.fn(async () => ({ success: true })),
        postMessage: vi.fn(),
      });

      await importAndRegister();
      const handler = handlers.get('message')!;

      const task = {
        id: 't7', sessionId: 's1', type: 'message' as const,
        payload: { message: 'Hi', userId: 'u1', channel: 'feishu', sessionId: null, context: {} },
        status: 'pending' as const, attempts: 0, maxAttempts: 3,
        scheduledAt: new Date(), createdAt: new Date(),
      };

      await handler(task);
      expect(mockConfirmDelivery).not.toHaveBeenCalled();
    });
  });

  // ── Cron handler ──────────────────────────────────────────────────────

  describe('cron handler', () => {
    test('should register cron handler', async () => {
      await importAndRegister();
      expect(handlers.has('cron')).toBe(true);
    });

    test('should dispatch memory_compress', async () => {
      await importAndRegister();
      const handler = handlers.get('cron')!;

      await handler({
        id: 'c1', sessionId: 's1', type: 'cron',
        payload: { handlerName: 'memory_compress', params: {} },
        status: 'pending', attempts: 0, maxAttempts: 3,
        scheduledAt: new Date(), createdAt: new Date(),
      } as Task);

      expect(mockHandleMemoryCompressJob).toHaveBeenCalledTimes(1);
    });

    test('should dispatch llm_proactive_chat with jobData', async () => {
      await importAndRegister();
      const handler = handlers.get('cron')!;

      await handler({
        id: 'c2', sessionId: 's1', type: 'cron',
        payload: { handlerName: 'llm_proactive_chat', params: { prompt: 'test' } },
        status: 'pending', attempts: 0, maxAttempts: 3,
        scheduledAt: new Date(), createdAt: new Date(),
      } as Task);

      expect(mockHandleLlmProactiveChatJob).toHaveBeenCalledWith(
        expect.objectContaining({
          taskType: 'llm_proactive_chat',
          params: { prompt: 'test' },
          triggeredBy: 'cron',
        })
      );
    });

    test('should dispatch self_evolution', async () => {
      await importAndRegister();
      const handler = handlers.get('cron')!;

      await handler({
        id: 'c3', sessionId: 's1', type: 'cron',
        payload: { handlerName: 'self_evolution', params: {} },
        status: 'pending', attempts: 0, maxAttempts: 3,
        scheduledAt: new Date(), createdAt: new Date(),
      } as Task);

      expect(mockHandleSelfEvolutionJob).toHaveBeenCalledWith(
        expect.objectContaining({ taskType: 'self_evolution' })
      );
    });

    test('should dispatch run_skill', async () => {
      await importAndRegister();
      const handler = handlers.get('cron')!;

      await handler({
        id: 'c4', sessionId: 's1', type: 'cron',
        payload: { handlerName: 'run_skill', params: { skill: 'test' } },
        status: 'pending', attempts: 0, maxAttempts: 3,
        scheduledAt: new Date(), createdAt: new Date(),
      } as Task);

      expect(mockHandleRunSkillJob).toHaveBeenCalled();
    });

    test('should dispatch check_goal_progress', async () => {
      await importAndRegister();
      const handler = handlers.get('cron')!;

      await handler({
        id: 'c5', sessionId: 's1', type: 'cron',
        payload: { handlerName: 'check_goal_progress', params: {} },
        status: 'pending', attempts: 0, maxAttempts: 3,
        scheduledAt: new Date(), createdAt: new Date(),
      } as Task);

      expect(mockHandleGoalProgressCheckJob).toHaveBeenCalled();
    });

    test('should dispatch send_reminder', async () => {
      await importAndRegister();
      const handler = handlers.get('cron')!;

      await handler({
        id: 'c6', sessionId: 's1', type: 'cron',
        payload: { handlerName: 'send_reminder', params: { msg: 'hi' } },
        status: 'pending', attempts: 0, maxAttempts: 3,
        scheduledAt: new Date(), createdAt: new Date(),
      } as Task);

      expect(mockHandleSendReminderJob).toHaveBeenCalled();
    });

    test('should dispatch custom', async () => {
      await importAndRegister();
      const handler = handlers.get('cron')!;

      await handler({
        id: 'c7', sessionId: 's1', type: 'cron',
        payload: { handlerName: 'custom', params: { action: 'test' } },
        status: 'pending', attempts: 0, maxAttempts: 3,
        scheduledAt: new Date(), createdAt: new Date(),
      } as Task);

      expect(mockHandleCustomJob).toHaveBeenCalled();
    });

    test('should throw for unknown handler name', async () => {
      await importAndRegister();
      const handler = handlers.get('cron')!;

      await expect(handler({
        id: 'c8', sessionId: 's1', type: 'cron',
        payload: { handlerName: 'nonexistent_handler', params: {} },
        status: 'pending', attempts: 0, maxAttempts: 3,
        scheduledAt: new Date(), createdAt: new Date(),
      } as Task)).rejects.toThrow('Unknown cron handler: nonexistent_handler');
    });

    test('should propagate handler errors', async () => {
      mockHandleMemoryCompressJob.mockRejectedValueOnce(new Error('Compression failed'));
      await importAndRegister();
      const handler = handlers.get('cron')!;

      await expect(handler({
        id: 'c9', sessionId: 's1', type: 'cron',
        payload: { handlerName: 'memory_compress', params: {} },
        status: 'pending', attempts: 0, maxAttempts: 3,
        scheduledAt: new Date(), createdAt: new Date(),
      } as Task)).rejects.toThrow('Compression failed');
    });

    test('should use task.id as scheduleId in jobData when id is present', async () => {
      await importAndRegister();
      const handler = handlers.get('cron')!;

      await handler({
        id: 'my-task-id', sessionId: 's1', type: 'cron',
        payload: { handlerName: 'llm_proactive_chat', params: {} },
        status: 'pending', attempts: 0, maxAttempts: 3,
        scheduledAt: new Date(), createdAt: new Date(),
      } as Task);

      expect(mockHandleLlmProactiveChatJob).toHaveBeenCalledWith(
        expect.objectContaining({ scheduleId: 'my-task-id' })
      );
    });

    test('should handle missing params by defaulting to empty object', async () => {
      await importAndRegister();
      const handler = handlers.get('cron')!;

      await handler({
        id: 'c10', sessionId: 's1', type: 'cron',
        payload: { handlerName: 'custom' },
        status: 'pending', attempts: 0, maxAttempts: 3,
        scheduledAt: new Date(), createdAt: new Date(),
      } as Task);

      expect(mockHandleCustomJob).toHaveBeenCalledWith(
        expect.objectContaining({ params: {} })
      );
    });
  });

  // ── Reminder handler ──────────────────────────────────────────────────

  describe('reminder handler', () => {
    test('should register reminder handler', async () => {
      await importAndRegister();
      expect(handlers.has('reminder')).toBe(true);
    });

    test('should send reminder via gateway postMessage', async () => {
      const mockPost = vi.fn(async () => ({ success: true }));
      mockGetMessageGateway.mockReturnValue({
        replyMessage: vi.fn(),
        postMessage: mockPost,
      });

      await importAndRegister();
      const handler = handlers.get('reminder')!;

      await handler({
        id: 'r1', sessionId: 's1', type: 'reminder',
        payload: { userId: 'user1', channel: 'feishu', message: 'Reminder!', chatId: 'chat1' },
        status: 'pending', attempts: 0, maxAttempts: 3,
        scheduledAt: new Date(), createdAt: new Date(),
      } as Task);

      expect(mockPost).toHaveBeenCalledWith('feishu', 'Reminder!', {
        userId: 'user1',
        metadata: { chatId: 'chat1' },
      });
    });

    test('should throw when reminder sending fails', async () => {
      mockGetMessageGateway.mockReturnValue({
        replyMessage: vi.fn(),
        postMessage: vi.fn(async () => ({ success: false, error: 'Send failed' })),
      });

      await importAndRegister();
      const handler = handlers.get('reminder')!;

      await expect(handler({
        id: 'r2', sessionId: 's1', type: 'reminder',
        payload: { userId: 'u1', channel: 'cli', message: 'Hey' },
        status: 'pending', attempts: 0, maxAttempts: 3,
        scheduledAt: new Date(), createdAt: new Date(),
      } as Task)).rejects.toThrow('Send failed');
    });

    test('should throw default error message when error is empty', async () => {
      mockGetMessageGateway.mockReturnValue({
        replyMessage: vi.fn(),
        postMessage: vi.fn(async () => ({ success: false })),
      });

      await importAndRegister();
      const handler = handlers.get('reminder')!;

      await expect(handler({
        id: 'r3', sessionId: 's1', type: 'reminder',
        payload: { userId: 'u1', channel: 'cli', message: 'Hey' },
        status: 'pending', attempts: 0, maxAttempts: 3,
        scheduledAt: new Date(), createdAt: new Date(),
      } as Task)).rejects.toThrow('Failed to send reminder');
    });
  });

  // ── Registration ──────────────────────────────────────────────────────

  describe('registration', () => {
    test('should register three default handlers', async () => {
      await importAndRegister();
      expect(mockRegisterHandler).toHaveBeenCalledTimes(3);
      expect(mockRegisterHandler).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockRegisterHandler).toHaveBeenCalledWith('cron', expect.any(Function));
      expect(mockRegisterHandler).toHaveBeenCalledWith('reminder', expect.any(Function));
    });
  });
});
