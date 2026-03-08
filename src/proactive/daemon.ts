/**
 * Proactive Daemon
 *
 * Background process for autonomous task execution
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { DaemonState, Schedule, ProactiveJobData } from './types';
import { getScheduler } from './scheduler';
import { getNotificationManager } from './notifications';
import { getGoalStore } from '../goal/store';

export class Daemon {
  private basePath: string;
  private statePath: string;
  private heartbeatPath: string;
  private pidPath: string;
  private state: DaemonState;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private checkInterval: NodeJS.Timeout | null = null;
  private running: boolean = false;
  // Memory-level execution lock to prevent duplicate execution
  private executingSchedules: Set<string> = new Set();

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
      console.log('[Daemon] Already running');
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

    console.log(`[Daemon] Started with PID ${process.pid}`);

    // Load schedules
    try {
      const scheduler = getScheduler(this.basePath + '/../proactive');
      this.state.schedulesLoaded = scheduler.listSchedules().length;
      this.saveState();

      // Start all enabled schedules
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
      console.log('[Daemon] Not running');
      return;
    }

    console.log('[Daemon] Stopping...');

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
    console.log('[Daemon] Stopped');
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

  private async executeSchedule(
    schedule: Schedule,
    onJob?: (job: ProactiveJobData) => Promise<void>
  ): Promise<void> {
    // Memory-level lock check (first line of defense)
    if (this.executingSchedules.has(schedule.id)) {
      console.log(`[Daemon] Schedule "${schedule.name}" is already executing (memory lock), skipping`);
      return;
    }

    // Check storage-level execution lock (second line of defense)
    const scheduler = getScheduler(this.basePath + '/../proactive');
    const currentSchedule = scheduler.getSchedule(schedule.id);
    
    if (currentSchedule?.isExecuting) {
      console.log(`[Daemon] Schedule "${schedule.name}" is already executing (storage lock), skipping`);
      return;
    }

    // Acquire both locks
    this.executingSchedules.add(schedule.id);
    scheduler.setExecuting(schedule.id, true);

    console.log(`[Daemon] Executing schedule: ${schedule.name}`);

    const job: ProactiveJobData = {
      scheduleId: schedule.id,
      taskType: schedule.task.type,
      params: schedule.task.params,
      triggeredAt: new Date().toISOString(),
      triggeredBy: 'cron',
    };

    try {
      if (onJob) {
        await onJob(job);
      } else {
        await this.executeDefaultJobHandler(job);
      }

      // Record success (also releases storage lock)
      scheduler.recordExecution(schedule.id, { success: true });

      this.state.jobsExecuted++;
      this.saveState();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.recordError(`Schedule ${schedule.name} failed: ${errorMessage}`);

      // Record failure (also releases storage lock)
      scheduler.recordExecution(schedule.id, { success: false, error: errorMessage });
    } finally {
      // Always release memory lock
      this.executingSchedules.delete(schedule.id);
    }
  }

  private async executeDefaultJobHandler(job: ProactiveJobData): Promise<void> {
    // Import unified handlers
    const {
      handleRunSkillJob,
      handleLlmProactiveChatJob,
      handleSelfEvolutionJob,
      handleMemoryCompressJob,
      handleGoalProgressCheckJob,
      handleCustomJob,
      handleSendReminderJob,
    } = await import('./job-handlers');

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
        await handleSelfEvolutionJob();
        break;

      case 'custom':
        await handleCustomJob(job);
        break;

      default:
        console.log(`[Daemon] Unknown task type: ${job.taskType}`);
    }
  }

  private async periodicCheck(onJob?: (job: ProactiveJobData) => Promise<void>): Promise<void> {
    try {
      // Check for due schedules (excludes already executing schedules)
      const scheduler = getScheduler(this.basePath + '/../proactive');
      const dueSchedules = scheduler.getDueSchedules();

      for (const schedule of dueSchedules) {
        // Triple check: memory lock, storage lock, and due status
        if (this.executingSchedules.has(schedule.id)) {
          console.log(`[Daemon] [PeriodicCheck] Schedule "${schedule.name}" is executing (memory lock), skipping`);
          continue;
        }
        
        if (schedule.isExecuting) {
          console.log(`[Daemon] [PeriodicCheck] Schedule "${schedule.name}" is executing (storage lock), skipping`);
          continue;
        }
        
        await this.executeSchedule(schedule, onJob);
      }

      // Push pending notifications
      try {
        const { pushPendingNotifications } = await import('./pusher');
        const { pushed, failed } = await pushPendingNotifications();
        if (pushed > 0 || failed > 0) {
          console.log(`[Daemon] Pushed ${pushed} notifications, failed ${failed}`);
        }
      } catch (error) {
        console.error('[Daemon] Failed to push pending notifications:', error);
      }

      // Clean up expired notifications
      try {
        const notificationManager = getNotificationManager(this.basePath + '/../proactive');
        const expired = notificationManager.clearExpired();
        if (expired > 0) {
          console.log(`[Daemon] Cleared ${expired} expired notifications`);
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
    console.error(`[Daemon] Error: ${message}`);
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
