/**
 * Queue Workers
 *
 * Initializes and manages workers for each queue
 */

import type { Job } from 'bunqueue/client';
import { getTaskManager } from '../manager';
import type { QueueConfig } from '../types';
import {
  handleSearchJob,
  handleSkillJob,
  handleReminderJob,
  handleAnalysisJob,
  handleProactiveJob,
} from '../handlers';

/**
 * Initialize all workers
 */
export async function initWorkers(config?: QueueConfig): Promise<void> {
  const manager = getTaskManager(config);

  // Ensure manager is initialized
  await manager.initialize();

  // Register workers
  manager.registerWorker('search-jobs', handleSearchJob as (job: Job) => Promise<unknown>, {
    concurrency: config?.workers?.search?.concurrency ?? 5,
  });

  manager.registerWorker('skill-jobs', handleSkillJob as (job: Job) => Promise<unknown>, {
    concurrency: config?.workers?.skill?.concurrency ?? 3,
  });

  manager.registerWorker('scheduled', handleReminderJob as (job: Job) => Promise<unknown>, {
    concurrency: config?.workers?.cron?.concurrency ?? 1,
  });

  manager.registerWorker('analysis-jobs', handleAnalysisJob as (job: Job) => Promise<unknown>, {
    concurrency: config?.workers?.analysis?.concurrency ?? 2,
  });

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
