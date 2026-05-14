/**
 * Queue Workers
 *
 * Initializes and manages workers for each queue
 */

import { logger } from '../../../infra/observability/logger';
import type { Job } from 'bunqueue/client';
import { getTaskManager } from '../../../infra/queue/manager';
import type { QueueConfig } from '../../../infra/queue/types';
import { handleProactiveJob } from '../handlers';
import { getSQLite } from '../../../infra/db/connection';

/**
 * Initialize all workers
 */
export async function initWorkers(config?: QueueConfig): Promise<void> {
  const manager = getTaskManager(config);

  // Ensure manager is initialized
  await manager.initialize();

  // Attach durable persistence if the SQLite layer is up. Best-effort: the
  // queue still works in-memory if the DB hasn't been initialised (e.g.
  // CLI mode), it just won't survive crashes.
  try {
    const sqlite = getSQLite();
    manager.setPersistence(sqlite as unknown as Parameters<typeof manager.setPersistence>[0]);
    logger.info('[Queue] Durable persistence enabled (write-through to tasks table)');
  } catch {
    logger.debug('[Queue] DataConnection not initialised; queue runs in-memory only');
  }

  // Register proactive worker (only active queue)
  manager.registerWorker('proactive-jobs', handleProactiveJob as (job: Job) => Promise<unknown>, {
    concurrency: config?.workers?.proactive?.concurrency ?? 3,
  });

  // Replay any jobs that were pending when the previous process exited.
  // Done after registerWorker so the worker is ready to consume them.
  if (manager.hasPersistence()) {
    try {
      const replayed = await manager.recoverPersistedJobs('proactive-jobs');
      if (replayed > 0) {
        logger.info(`[Queue] Recovered ${replayed} persisted jobs from prior session`);
      }
    } catch (err) {
      logger.warn('[Queue] Recovery scan failed', { error: String(err) });
    }
  }

  logger.info('[Queue] All workers initialized');
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
