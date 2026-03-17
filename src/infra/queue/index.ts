/**
 * Queue Module
 *
 * Multi-task processing system using Bunqueue
 */

export * from './types';
export { TaskManager, getTaskManager, initTaskManager } from './manager';

// Import for internal use
import { getTaskManager } from './manager';

// Re-export commonly used types
import type {
  JobResult,
  QueueStats
} from './types';

/**
 * Quick task creation helpers
 */

/**
 * Create a background search task
 */
export async function createSearchTask(
  query: string,
  options?: {
    numResults?: number;
    region?: string;
    timeRange?: string;
    sessionId?: string;
  }
): Promise<{ jobId: string }> {
  const manager = getTaskManager();
  await manager.initialize();

  return manager.addJob('search-jobs', 'web-search', {
    query,
    numResults: options?.numResults,
    region: options?.region,
    timeRange: options?.timeRange,
    sessionId: options?.sessionId,
  });
}

/**
 * Create a background skill execution task
 */
export async function createSkillTask(
  skillName: string,
  action: string,
  params: Record<string, unknown>,
  options?: {
    sessionId?: string;
    userId?: string;
  }
): Promise<{ jobId: string }> {
  const manager = getTaskManager();
  await manager.initialize();

  return manager.addJob('skill-jobs', 'execute-skill', {
    skillName,
    action,
    params,
    sessionId: options?.sessionId,
    userId: options?.userId,
  });
}

/**
 * Create a scheduled reminder
 */
export async function createReminderTask(
  userId: string,
  message: string,
  schedule?: {
    delay?: number;
    cron?: string;
  }
): Promise<{ jobId: string }> {
  const manager = getTaskManager();
  await manager.initialize();

  return manager.addJob(
    'scheduled',
    'reminder',
    {
      userId,
      message,
      type: schedule ? 'recurring' : 'one-time',
    },
    {
      delay: schedule?.delay,
      repeat: schedule?.cron ? { pattern: schedule.cron } : undefined,
    }
  );
}

/**
 * Get task status
 */
export async function getTaskStatus(jobId: string): Promise<JobResult | null> {
  const manager = getTaskManager();
  await manager.initialize();
  return manager.getJob(jobId);
}

/**
 * Cancel a task
 */
export async function cancelTask(jobId: string): Promise<boolean> {
  const manager = getTaskManager();
  await manager.initialize();
  return manager.cancelJob(jobId);
}

/**
 * Get queue statistics
 */
export async function getQueueStatistics(): Promise<Record<string, QueueStats>> {
  const manager = getTaskManager();
  await manager.initialize();
  return manager.getAllStats();
}

/**
 * Create a deep analysis task
 */
export async function createAnalysisTask(options: {
  sessionId: string;
  userId: string;
  chatId: string;
  originalMessage: string;
  analysisTasks: string[];
  context?: string;
}): Promise<{ jobId: string }> {
  const manager = getTaskManager();
  await manager.initialize();

  return manager.addJob('analysis-jobs', 'deep-analysis', {
    sessionId: options.sessionId,
    userId: options.userId,
    chatId: options.chatId,
    originalMessage: options.originalMessage,
    analysisTasks: options.analysisTasks,
    context: options.context,
    createdAt: new Date().toISOString(),
  });
}
