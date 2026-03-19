/**
 * Queue Workers
 *
 * Initializes and manages workers for each queue
 */

import type { Job } from 'bunqueue/client';
import { getTaskManager } from '../../../infra/queue/manager';
import type { QueueConfig } from '../../../infra/queue/types';
import { handleProactiveJob } from '../handlers';

/**
 * Initialize all workers
 */
export async function initWorkers(config?: QueueConfig): Promise<void> {
  const manager = getTaskManager(config);

  // Ensure manager is initialized
  await manager.initialize();

  // Register proactive worker (only active queue)
  manager.registerWorker('proactive-jobs', handleProactiveJob as (job: Job) => Promise<unknown>, {
    concurrency: config?.workers?.proactive?.concurrency ?? 3,
  });

  console.log('[Queue] All workers initialized');
}

/**
 * Job processor factory
 */
export function createJobProcessor<T>(
  handler: (data: T) => Promise<unknown>
): (job: Job<T>) => Promise<unknown> {
  return async (job: Job<T>) => {
    await job.updateProgress(10);
    const result = await handler(job.data);
    await job.updateProgress(100);
    return result;
  };
}
