/**
 * Task Queue Manager
 *
 * Manages job queues using Bunqueue in embedded mode
 */

import { Queue, Worker, type Job } from 'bunqueue/client';
import type {
  QueueName,
  JobOptions,
  JobResult,
  QueueStats,
  QueueConfig,
} from './types';

// Queue name to config mapping
const QUEUE_CONFIGS: Record<QueueName, { priority: number }> = {
  'search-jobs': { priority: 8 },
  'skill-jobs': { priority: 5 },
  'scheduled': { priority: 3 },
  'report-jobs': { priority: 4 },
  'eval-jobs': { priority: 2 },
  'cleanup-jobs': { priority: 1 },
  'proactive-jobs': { priority: 3 },
  'analysis-jobs': { priority: 6 },  // Higher priority for deep analysis
};

class TaskManager {
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();
  private config: QueueConfig;
  private initialized = false;
  private dbPath: string;

  constructor(config?: QueueConfig) {
    this.config = config || {
      enabled: true,
      mode: 'embedded',
      storage: { path: './data/queue/beeclaw.db' },
    };
    this.dbPath = this.config.storage?.path || './data/queue/beeclaw.db';
  }

  /**
   * Initialize queues
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create queues in embedded mode
    for (const [name] of Object.entries(QUEUE_CONFIGS)) {
      const queue = new Queue(name, {
        embedded: true,
        path: this.dbPath,
      });
      this.queues.set(name, queue);
    }

    this.initialized = true;
    console.log('[Queue] Task manager initialized');
  }

  /**
   * Add a job to a queue
   */
  async addJob<T = unknown>(
    queue: QueueName,
    name: string,
    data: T,
    options?: JobOptions
  ): Promise<{ jobId: string }> {
    await this.ensureInitialized();

    const q = this.queues.get(queue);
    if (!q) {
      throw new Error(`Queue not found: ${queue}`);
    }

    const jobOptions: Record<string, unknown> = {
      priority: options?.priority ?? QUEUE_CONFIGS[queue].priority,
    };

    if (options?.delay) {
      jobOptions.delay = options.delay;
    }

    if (options?.attempts) {
      jobOptions.attempts = options.attempts;
    }

    if (options?.repeat?.pattern) {
      jobOptions.repeat = { pattern: options.repeat.pattern };
    }

    const job = await q.add(name, data, jobOptions);

    return { jobId: job.id };
  }

  /**
   * Get job status
   */
  async getJob(jobId: string): Promise<JobResult | null> {
    await this.ensureInitialized();

    // Search all queues for the job
    for (const [queueName, queue] of this.queues) {
      try {
        const job = await queue.getJob(jobId);
        if (job) {
          return this.formatJobResult(job, queueName);
        }
      } catch {
        // Job not found in this queue, continue
      }
    }

    return null;
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(queue: QueueName): Promise<QueueStats> {
    await this.ensureInitialized();

    const q = this.queues.get(queue);
    if (!q) {
      throw new Error(`Queue not found: ${queue}`);
    }

    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        q.getWaitingCount(),
        q.getActiveCount(),
        q.getCompletedCount(),
        q.getFailedCount(),
        q.getDelayedCount(),
      ]);

      return {
        waiting,
        active,
        completed,
        failed,
        delayed,
        paused: false,
      };
    } catch {
      return {
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: false,
      };
    }
  }

  /**
   * Get all queues statistics
   */
  async getAllStats(): Promise<Record<string, QueueStats>> {
    await this.ensureInitialized();

    const stats: Record<string, QueueStats> = {};
    for (const [name] of this.queues) {
      stats[name] = await this.getQueueStats(name as QueueName);
    }
    return stats;
  }

  /**
   * List jobs in a queue
   */
  async listJobs(
    queue: QueueName,
    state?: 'waiting' | 'active' | 'completed' | 'failed',
    limit = 20
  ): Promise<JobResult[]> {
    await this.ensureInitialized();

    const q = this.queues.get(queue);
    if (!q) {
      throw new Error(`Queue not found: ${queue}`);
    }

    let jobs: Job[] = [];

    try {
      switch (state) {
        case 'waiting':
          jobs = await q.getWaiting(0, limit);
          break;
        case 'active':
          jobs = await q.getActive(0, limit);
          break;
        case 'completed':
          jobs = await q.getCompleted(0, limit);
          break;
        case 'failed':
          jobs = await q.getFailed(0, limit);
          break;
        default:
          const [waiting, active, completed, failed] = await Promise.all([
            q.getWaiting(0, limit),
            q.getActive(0, limit),
            q.getCompleted(0, limit),
            q.getFailed(0, limit),
          ]);
          jobs = [...waiting, ...active, ...completed, ...failed].slice(0, limit);
      }
    } catch {
      // Return empty array on error
    }

    return jobs.map(job => this.formatJobResult(job, queue));
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    await this.ensureInitialized();

    for (const [, queue] of this.queues) {
      try {
        const job = await queue.getJob(jobId);
        if (job) {
          await job.remove();
          return true;
        }
      } catch {
        // Continue to next queue
      }
    }

    return false;
  }

  /**
   * Register a worker for a queue
   */
  registerWorker(
    queue: QueueName,
    handler: (job: Job) => Promise<unknown>,
    options?: { concurrency?: number }
  ): void {
    const worker = new Worker(queue, handler, {
      embedded: true,
      path: this.dbPath,
      concurrency: options?.concurrency ?? 3,
    });

    this.workers.set(queue, worker);
    console.log(`[Queue] Worker registered for ${queue}`);
  }

  /**
   * Shutdown all queues and workers
   */
  async shutdown(): Promise<void> {
    // Close all workers
    for (const [, worker] of this.workers) {
      try {
        await worker.close();
      } catch {
        // Ignore errors on close
      }
    }

    // Close all queues
    for (const [, queue] of this.queues) {
      try {
        await queue.close();
      } catch {
        // Ignore errors on close
      }
    }

    this.queues.clear();
    this.workers.clear();
    this.initialized = false;
    console.log('[Queue] Task manager shut down');
  }

  /**
   * Format job result
   */
  private formatJobResult(job: Job, queue: string): JobResult {
    return {
      id: job.id,
      name: job.name,
      queue,
      state: this.mapState(job.state),
      data: job.data,
      result: job.returnvalue,
      error: job.failedReason,
      progress: job.progress,
      timestamp: {
        created: new Date(job.timestamp),
        processed: job.processedOn ? new Date(job.processedOn) : undefined,
        completed: job.finishedOn ? new Date(job.finishedOn) : undefined,
      },
    };
  }

  /**
   * Map Bunqueue state to our state
   */
  private mapState(state: string): JobResult['state'] {
    const stateMap: Record<string, JobResult['state']> = {
      waiting: 'waiting',
      active: 'active',
      completed: 'completed',
      failed: 'failed',
      delayed: 'delayed',
      paused: 'paused',
    };
    return stateMap[state] || 'waiting';
  }

  /**
   * Ensure manager is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}

// Singleton instance
let taskManagerInstance: TaskManager | null = null;

/**
 * Get or create task manager singleton
 */
export function getTaskManager(config?: QueueConfig): TaskManager {
  if (!taskManagerInstance || config) {
    taskManagerInstance = new TaskManager(config);
  }
  return taskManagerInstance;
}

/**
 * Initialize task manager from config
 */
export async function initTaskManager(config?: QueueConfig): Promise<TaskManager> {
  const manager = getTaskManager(config);
  await manager.initialize();
  return manager;
}

export { TaskManager };
