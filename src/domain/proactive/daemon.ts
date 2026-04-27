/**
 * Proactive Daemon
 *
 * Background process for autonomous task execution
 */

import { logger } from '../../infra/observability/logger';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { DaemonState, Schedule, ProactiveJobData } from './types';
import { getScheduler } from './scheduler';
import { getNotificationManager } from './notifications';
import {
  handleLlmProactiveChatJob,
  handleSelfEvolutionJob,
  handleMemoryCompressJob,
  handleGoalProgressCheckJob,
  handleCustomJob,
  handleSendReminderJob,
  handleRunSkillJob,
} from './job-handlers';
import { pushPendingNotifications } from './pusher';

export class Daemon {
  private basePath: string;
  private statePath: string;
  private heartbeatPath: string;
  private pidPath: string;
  private state: DaemonState;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private checkInterval: NodeJS.Timeout | null = null;
  private running: boolean = false;

  constructor(basePath: string) {
    this.basePath = basePath;
    this.statePath = join(basePath, 'state.json');
    this.heartbeatPath = join(basePath, 'heartbeat.json');
    this.pidPath = join(basePath, 'pid');
    this.state = {
      running: false,
      schedulesLoaded: 0,
      jobsExecuted: 0,
      errors: [],
    };
  }

  // Initialize daemon directories
  init(): void {
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }
  }

  // Start the daemon
  async start(options?: {
    checkIntervalMs?: number;
    heartbeatIntervalMs?: number;
    onJob?: (job: ProactiveJobData) => Promise<void>;
  }): Promise<void> {
    if (this.running) {
      logger.debug('[Daemon] Already running');
      return;
    }

    this.init();
    this.running = true;

    const checkIntervalMs = options?.checkIntervalMs || 60000; // 1 minute default
    const heartbeatIntervalMs = options?.heartbeatIntervalMs || 30000; // 30 seconds default

    // Update state
    this.state = {
      running: true,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      schedulesLoaded: 0,
      jobsExecuted: 0,
      errors: [],
    };

    // Write PID file
    writeFileSync(this.pidPath, process.pid.toString(), 'utf-8');
    this.saveState();

    logger.info(`[Daemon] Started with PID ${process.pid}`);

    // Load schedules
    try {
      const scheduler = getScheduler(this.basePath + '/../proactive');
      this.state.schedulesLoaded = scheduler.listSchedules().length;
      this.saveState();

      // Start all enabled schedules
      // NOTE: scheduler.executeWithLock already handles lock acquisition
      // So callback should directly call executeSchedule (not executeScheduleWithLock)
      scheduler.startAll(async (schedule) => {
        await this.executeSchedule(schedule, options?.onJob);
      });
    } catch (error) {
      this.recordError('Failed to load schedules: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }

    // Start heartbeat
    this.heartbeatInterval = setInterval(() => {
      this.updateHeartbeat();
    }, heartbeatIntervalMs);

    // Start periodic check (backup for missed schedules)
    this.checkInterval = setInterval(async () => {
      await this.periodicCheck(options?.onJob);
    }, checkIntervalMs);

    // Run initial check
    await this.periodicCheck(options?.onJob);
  }

  // Stop the daemon
  async stop(): Promise<void> {
    if (!this.running) {
      logger.debug('[Daemon] Not running');
      return;
    }

    logger.debug('[Daemon] Stopping...');

    // Stop intervals
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    // Stop all schedules
    try {
      const scheduler = getScheduler(this.basePath + '/../proactive');
      scheduler.stopAll();
    } catch {
      // Scheduler might not be initialized
    }

    // Update state
    this.state.running = false;
    this.saveState();

    // Remove PID file
    try {
      if (existsSync(this.pidPath)) {
        unlinkSync(this.pidPath);
      }
    } catch {
      // Ignore errors
    }

    this.running = false;
    logger.debug('[Daemon] Stopped');
  }

  // Get daemon state
  getState(): DaemonState {
    this.loadState();
    return { ...this.state };
  }

  // Check if daemon is running
  isRunning(): boolean {
    this.loadState();

    // Check if PID file exists and process is running
    if (existsSync(this.pidPath)) {
      try {
        const pid = parseInt(readFileSync(this.pidPath, 'utf-8'), 10);

        // Check if process is running
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          // Process not running, clean up
          this.state.running = false;
          this.saveState();
          try {
            unlinkSync(this.pidPath);
          } catch {
            // Ignore errors
          }
          return false;
        }
      } catch {
        return false;
      }
    }

    return this.state.running;
  }

  // Private helper methods

  // Execute with lock acquisition (for periodicCheck path)
  // [BUG 3 FIX] TOCTOU Race Condition Note:
  // Both the setTimeout path (scheduler.executeWithLock) and the periodicCheck path
  // (daemon.executeScheduleWithLock) can discover the same due schedule concurrently.
  // This is safe because both paths converge on scheduler.acquireExecutionLock(), which
  // uses a synchronous Set.has() + Set.add() check. Since JS is single-threaded, only
  // one path can win the lock; the other will see the Set entry and skip execution.
  private async executeScheduleWithLock(
    schedule: Schedule,
    onJob?: (job: ProactiveJobData) => Promise<void>
  ): Promise<void> {
    const scheduler = getScheduler(this.basePath + '/../proactive');
    
    // Try to acquire memory lock atomically
    if (!scheduler.acquireExecutionLock(schedule.id)) {
      logger.debug(`[Daemon] Schedule "${schedule.name}" is already executing (memory lock), skipping`);
      return;
    }

    // Check storage lock
    if (schedule.isExecuting) {
      logger.debug(`[Daemon] Schedule "${schedule.name}" is already executing (storage lock), skipping`);
      scheduler.releaseExecutionLock(schedule.id);
      return;
    }

    // Set storage lock
    scheduler.setExecuting(schedule.id, true);

    try {
      await this.executeSchedule(schedule, onJob);
    } finally {
      // Release memory lock (storage lock is released in recordExecution)
      scheduler.releaseExecutionLock(schedule.id);
    }
  }

  private async executeSchedule(
    schedule: Schedule,
    onJob?: (job: ProactiveJobData) => Promise<void>
  ): Promise<void> {
    // NOTE: This method should only be called after lock is acquired
    // Either via scheduler.executeWithLock (setTimeout path) or executeScheduleWithLock (periodicCheck path)

    logger.debug(`[Daemon] Executing schedule: ${schedule.name}`);

    // [AUDIT FIX M-02/M-11] Derive associatedSessionId from params or from chatId+userId pattern
    const explicitSessionId = schedule.task.params?.associatedSessionId as string;
    const derivedSessionId = (() => {
      if (explicitSessionId) return explicitSessionId;
      // Try to derive from chatId + userId (matches the pattern used in session/index.ts)
      const chatId = schedule.task.params?.chatId as string;
      const userId = schedule.task.params?.userId as string;
      if (chatId && userId) return `feishu-${chatId}-${userId}`;
      return undefined;
    })();

    const job: ProactiveJobData = {
      scheduleId: schedule.id,
      taskType: schedule.task.type,
      params: schedule.task.params,
      triggeredAt: new Date().toISOString(),
      triggeredBy: 'cron',
      associatedSessionId: derivedSessionId,
      source: 'proactive' as const,
    };

    try {
      if (onJob) {
        await onJob(job);
      } else {
        await this.executeDefaultJobHandler(job);
      }

      // Record success
      const scheduler = getScheduler(this.basePath + '/../proactive');
      scheduler.recordExecution(schedule.id, { success: true });

      this.state.jobsExecuted++;
      this.saveState();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.recordError(`Schedule ${schedule.name} failed: ${errorMessage}`);

      // Record failure
      const scheduler = getScheduler(this.basePath + '/../proactive');
      scheduler.recordExecution(schedule.id, { success: false, error: errorMessage });
    }
  }

  private async executeDefaultJobHandler(job: ProactiveJobData): Promise<void> {
    switch (job.taskType) {
      case 'llm_proactive_chat':
        await handleLlmProactiveChatJob(job);
        break;

      case 'check_goal_progress':
        await handleGoalProgressCheckJob();
        break;

      case 'run_skill':
        await handleRunSkillJob(job);
        break;

      case 'send_reminder':
        await handleSendReminderJob(job);
        break;

      case 'memory_compress':
        await handleMemoryCompressJob();
        break;

      case 'self_evolution':
        {
          const result = await handleSelfEvolutionJob(job);
          if (!result.success) {
            throw new Error(result.error || 'self_evolution failed');
          }
        }
        break;

      case 'custom':
        await handleCustomJob(job);
        break;

      default:
        logger.debug(`[Daemon] Unknown task type: ${job.taskType}`);
    }
  }

  private async periodicCheck(onJob?: (job: ProactiveJobData) => Promise<void>): Promise<void> {
    try {
      // Check for due schedules (scheduler.getDueSchedules already excludes executing schedules)
      const scheduler = getScheduler(this.basePath + '/../proactive');
      const dueSchedules = scheduler.getDueSchedules();

      // [BUG 4 FIX] Concurrent execution with random jitter to prevent thundering herd.
      // When multiple schedules are due simultaneously (e.g., several daily 3am tasks),
      // stagger their execution with small random delays and run them concurrently
      // instead of blocking each other serially.
      if (dueSchedules.length > 1) {
        await Promise.allSettled(
          dueSchedules.map(async (schedule) => {
            // Stagger execution with small random jitter (0-5 seconds)
            const jitter = Math.random() * 5000;
            await new Promise<void>(r => setTimeout(r, jitter));
            await this.executeScheduleWithLock(schedule, onJob);
          })
        );
      } else if (dueSchedules.length === 1) {
        await this.executeScheduleWithLock(dueSchedules[0], onJob);
      }

      // Push pending notifications
      try {
        const { pushed, failed } = await pushPendingNotifications();
        if (pushed > 0 || failed > 0) {
          logger.debug(`[Daemon] Pushed ${pushed} notifications, failed ${failed}`);
        }
      } catch (error) {
        logger.error('[Daemon] Failed to push pending notifications:', error);
      }

      // Clean up expired notifications
      try {
        const notificationManager = getNotificationManager(this.basePath + '/../proactive');
        const expired = notificationManager.clearExpired();
        if (expired > 0) {
          logger.debug(`[Daemon] Cleared ${expired} expired notifications`);
        }
      } catch {
        // Ignore
      }

      this.updateHeartbeat();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.recordError(`Periodic check failed: ${errorMessage}`);
    }
  }

  private updateHeartbeat(): void {
    this.state.lastHeartbeat = new Date().toISOString();

    try {
      writeFileSync(this.heartbeatPath, JSON.stringify({
        pid: process.pid,
        timestamp: this.state.lastHeartbeat,
        jobsExecuted: this.state.jobsExecuted,
      }, null, 2), 'utf-8');
    } catch {
      // Ignore errors
    }
  }

  private recordError(message: string): void {
    this.state.errors.push({
      time: new Date().toISOString(),
      message,
    });

    // Keep only last 10 errors
    if (this.state.errors.length > 10) {
      this.state.errors = this.state.errors.slice(-10);
    }

    this.saveState();
    logger.error(`[Daemon] Error: ${message}`);
  }

  private loadState(): void {
    if (existsSync(this.statePath)) {
      try {
        const content = readFileSync(this.statePath, 'utf-8');
        this.state = JSON.parse(content);
      } catch {
        // Use defaults
      }
    }
  }

  private saveState(): void {
    try {
      writeFileSync(this.statePath, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch {
      // Ignore errors
    }
  }
}

// Singleton instance
let daemon: Daemon | null = null;

export function getDaemon(basePath?: string): Daemon {
  if (!daemon && basePath) {
    daemon = new Daemon(basePath);
  }
  if (!daemon) {
    throw new Error('Daemon not initialized. Call getDaemon with basePath first.');
  }
  return daemon;
}

export function resetDaemon(): void {
  daemon = null;
}
