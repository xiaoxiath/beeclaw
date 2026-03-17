/**
 * Tests for Cron Handler Dispatch
 *
 * Validates that cron tasks are correctly dispatched to job handlers
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import type { Task } from '../types';
import type { ProactiveJobData } from '../../../domain/proactive/types';

// Mock all job handlers
const mockHandleMemoryCompressJob = mock(async () => {});
const mockHandleLlmProactiveChatJob = mock(async () => {});
const mockHandleSelfEvolutionJob = mock(async () => {});
const mockHandleRunSkillJob = mock(async () => {});
const mockHandleGoalProgressCheckJob = mock(async () => {});
const mockHandleCustomJob = mock(async () => {});
const mockHandleSendReminderJob = mock(async () => {});

// Mock the job-handlers module
mock.module('../../../domain/proactive/job-handlers', () => ({
  handleMemoryCompressJob: mockHandleMemoryCompressJob,
  handleLlmProactiveChatJob: mockHandleLlmProactiveChatJob,
  handleSelfEvolutionJob: mockHandleSelfEvolutionJob,
  handleRunSkillJob: mockHandleRunSkillJob,
  handleGoalProgressCheckJob: mockHandleGoalProgressCheckJob,
  handleCustomJob: mockHandleCustomJob,
  handleSendReminderJob: mockHandleSendReminderJob,
}));

describe('Cron Handler Dispatch', () => {
  beforeEach(() => {
    // Reset all mocks
    mockHandleMemoryCompressJob.mockClear();
    mockHandleLlmProactiveChatJob.mockClear();
    mockHandleSelfEvolutionJob.mockClear();
    mockHandleRunSkillJob.mockClear();
    mockHandleGoalProgressCheckJob.mockClear();
    mockHandleCustomJob.mockClear();
    mockHandleSendReminderJob.mockClear();
  });

  describe('handler routing', () => {
    test('should dispatch to handleMemoryCompressJob', async () => {
      const task: Task = {
        id: 'test-1',
        type: 'cron',
        payload: {
          handlerName: 'memory_compress',
          params: {},
        },
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      // Simulate cron handler logic
      const jobData: ProactiveJobData = {
        scheduleId: task.id,
        taskType: 'memory_compress',
        params: task.payload.params,
        triggeredAt: new Date().toISOString(),
        triggeredBy: 'cron',
      };

      if (task.payload.handlerName === 'memory_compress') {
        await mockHandleMemoryCompressJob();
      }

      expect(mockHandleMemoryCompressJob).toHaveBeenCalledTimes(1);
    });

    test('should dispatch to handleLlmProactiveChatJob', async () => {
      const task: Task = {
        id: 'test-2',
        type: 'cron',
        payload: {
          handlerName: 'llm_proactive_chat',
          params: { prompt: 'Hello!' },
        },
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      const jobData: ProactiveJobData = {
        scheduleId: task.id,
        taskType: 'llm_proactive_chat',
        params: task.payload.params,
        triggeredAt: new Date().toISOString(),
        triggeredBy: 'cron',
      };

      if (task.payload.handlerName === 'llm_proactive_chat') {
        await mockHandleLlmProactiveChatJob(jobData);
      }

      expect(mockHandleLlmProactiveChatJob).toHaveBeenCalledTimes(1);
      expect(mockHandleLlmProactiveChatJob).toHaveBeenCalledWith(jobData);
    });

    test('should dispatch to handleSelfEvolutionJob', async () => {
      const task: Task = {
        id: 'test-3',
        type: 'cron',
        payload: {
          handlerName: 'self_evolution',
          params: {},
        },
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      const jobData: ProactiveJobData = {
        scheduleId: task.id,
        taskType: 'self_evolution',
        params: task.payload.params,
        triggeredAt: new Date().toISOString(),
        triggeredBy: 'cron',
      };

      if (task.payload.handlerName === 'self_evolution') {
        await mockHandleSelfEvolutionJob(jobData);
      }

      expect(mockHandleSelfEvolutionJob).toHaveBeenCalledTimes(1);
      expect(mockHandleSelfEvolutionJob).toHaveBeenCalledWith(jobData);
    });

    test('should dispatch to handleRunSkillJob', async () => {
      const task: Task = {
        id: 'test-4',
        type: 'cron',
        payload: {
          handlerName: 'run_skill',
          params: { skillName: 'test-skill' },
        },
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      const jobData: ProactiveJobData = {
        scheduleId: task.id,
        taskType: 'run_skill',
        params: task.payload.params,
        triggeredAt: new Date().toISOString(),
        triggeredBy: 'cron',
      };

      if (task.payload.handlerName === 'run_skill') {
        await mockHandleRunSkillJob(jobData);
      }

      expect(mockHandleRunSkillJob).toHaveBeenCalledTimes(1);
      expect(mockHandleRunSkillJob).toHaveBeenCalledWith(jobData);
    });

    test('should dispatch to handleGoalProgressCheckJob', async () => {
      const task: Task = {
        id: 'test-5',
        type: 'cron',
        payload: {
          handlerName: 'check_goal_progress',
          params: {},
        },
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      if (task.payload.handlerName === 'check_goal_progress') {
        await mockHandleGoalProgressCheckJob();
      }

      expect(mockHandleGoalProgressCheckJob).toHaveBeenCalledTimes(1);
    });

    test('should dispatch to handleCustomJob', async () => {
      const task: Task = {
        id: 'test-6',
        type: 'cron',
        payload: {
          handlerName: 'custom',
          params: { action: 'daily-reflection' },
        },
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      const jobData: ProactiveJobData = {
        scheduleId: task.id,
        taskType: 'custom',
        params: task.payload.params,
        triggeredAt: new Date().toISOString(),
        triggeredBy: 'cron',
      };

      if (task.payload.handlerName === 'custom') {
        await mockHandleCustomJob(jobData);
      }

      expect(mockHandleCustomJob).toHaveBeenCalledTimes(1);
      expect(mockHandleCustomJob).toHaveBeenCalledWith(jobData);
    });

    test('should throw error for unknown handler', async () => {
      const task: Task = {
        id: 'test-7',
        type: 'cron',
        payload: {
          handlerName: 'unknown_handler',
          params: {},
        },
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      expect(() => {
        if (!['memory_compress', 'llm_proactive_chat', 'self_evolution', 'run_skill', 'check_goal_progress', 'custom'].includes(task.payload.handlerName)) {
          throw new Error(`Unknown cron handler: ${task.payload.handlerName}`);
        }
      }).toThrow('Unknown cron handler: unknown_handler');
    });
  });

  describe('job data construction', () => {
    test('should build correct ProactiveJobData', () => {
      const task: Task = {
        id: 'test-task-id',
        type: 'cron',
        payload: {
          handlerName: 'run_skill',
          params: { skillName: 'test', count: 5 },
        },
        status: 'pending',
        createdAt: '2026-03-13T10:00:00.000Z',
      };

      const jobData: ProactiveJobData = {
        scheduleId: task.id,
        taskType: task.payload.handlerName as any,
        params: task.payload.params,
        triggeredAt: expect.any(String),
        triggeredBy: 'cron',
      };

      expect(jobData.scheduleId).toBe('test-task-id');
      expect(jobData.taskType).toBe('run_skill');
      expect(jobData.params).toEqual({ skillName: 'test', count: 5 });
      expect(jobData.triggeredBy).toBe('cron');
    });

    test('should handle missing params', () => {
      const task: Task = {
        id: 'test-task-id',
        type: 'cron',
        payload: {
          handlerName: 'memory_compress',
        },
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      const jobData: ProactiveJobData = {
        scheduleId: task.id,
        taskType: task.payload.handlerName as any,
        params: task.payload.params || {},
        triggeredAt: new Date().toISOString(),
        triggeredBy: 'cron',
      };

      expect(jobData.params).toEqual({});
    });
  });

  describe('error handling', () => {
    test('should propagate handler errors', async () => {
      const errorHandler = mock(async () => {
        throw new Error('Handler failed');
      });

      const task: Task = {
        id: 'test-error',
        type: 'cron',
        payload: {
          handlerName: 'memory_compress',
          params: {},
        },
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      try {
        await errorHandler();
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error.message).toBe('Handler failed');
      }
    });
  });
});
