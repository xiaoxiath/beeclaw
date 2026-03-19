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
