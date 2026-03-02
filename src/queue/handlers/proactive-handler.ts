/**
 * Proactive Worker Handler
 *
 * Handles proactive scheduled jobs
 */

import type { Job } from 'bunqueue/client';
import type { ProactiveJobData } from '../types';
import { getGoalStore } from '../../goal/store';
import { getNotificationManager } from '../../proactive/notifications';

export async function handleProactiveJob(job: Job<ProactiveJobData>): Promise<unknown> {
  const { scheduleId, taskType, params, triggeredAt, triggeredBy } = job.data;

  console.log(`[Worker:proactive] Processing job for schedule ${scheduleId}`);
  console.log(`  Task: ${taskType}, Triggered: ${triggeredBy} at ${triggeredAt}`);

  await job.updateProgress(25);

  try {
    let result: unknown;

    switch (taskType) {
      case 'check_goal_progress': {
        result = await handleGoalProgressCheck(params);
        break;
      }

      case 'run_skill': {
        result = await handleRunSkill(params);
        break;
      }

      case 'send_reminder': {
        result = await handleSendReminder(params);
        break;
      }

      case 'memory_compress': {
        result = await handleMemoryCompress(params);
        break;
      }

      case 'custom': {
        result = await handleCustomTask(params);
        break;
      }

      default:
        throw new Error(`Unknown task type: ${taskType}`);
    }

    await job.updateProgress(100);

    console.log(`[Worker:proactive] Job completed for schedule ${scheduleId}`);

    return {
      success: true,
      scheduleId,
      taskType,
      result,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`[Worker:proactive] Job failed for schedule ${scheduleId}:`, error);

    return {
      success: false,
      scheduleId,
      taskType,
      error: error instanceof Error ? error.message : 'Unknown error',
      failedAt: new Date().toISOString(),
    };
  }
}

// Task handlers

async function handleGoalProgressCheck(params?: Record<string, unknown>): Promise<unknown> {
  try {
    const goalStore = getGoalStore();
    const goals = goalStore.list({ state: 'active' });

    const notifications: string[] = [];

    for (const goal of goals) {
      // Check for goals with low progress that haven't been updated recently
      const daysSinceUpdate = (Date.now() - new Date(goal.updatedAt).getTime()) / (1000 * 60 * 60 * 24);

      if (goal.progress < 50 && daysSinceUpdate > 3) {
        const notificationManager = getNotificationManager();
        notificationManager.create({
          userId: 'cli-user',
          message: `Goal "${goal.title}" is at ${goal.progress}% progress. Consider updating it.`,
          priority: 'normal',
          category: 'goal-progress',
        });
        notifications.push(goal.id);
      }
    }

    return {
      checkedGoals: goals.length,
      notificationsCreated: notifications.length,
      goalIds: notifications,
    };
  } catch (error) {
    return { error: 'Goal store not initialized' };
  }
}

async function handleRunSkill(params?: Record<string, unknown>): Promise<unknown> {
  const skillName = params?.skillName as string;
  const skillParams = params?.skillParams as Record<string, unknown> | undefined;

  if (!skillName) {
    throw new Error('skillName parameter required for run_skill task');
  }

  // This would integrate with the skill execution system
  // For now, just log the intent
  console.log(`[Worker:proactive] Would run skill: ${skillName}`, skillParams);

  return {
    skillName,
    executed: false,
    note: 'Skill execution not implemented in proactive handler',
  };
}

async function handleSendReminder(params?: Record<string, unknown>): Promise<unknown> {
  const message = params?.message as string;
  const userId = (params?.userId as string) || 'cli-user';
  const priority = (params?.priority as 'low' | 'normal' | 'high' | 'urgent') || 'normal';

  if (!message) {
    throw new Error('message parameter required for send_reminder task');
  }

  try {
    const notificationManager = getNotificationManager();
    const notification = notificationManager.create({
      userId,
      message,
      priority,
      category: 'reminder',
    });

    return {
      notificationId: (notification.data as any)?.id,
      message,
      userId,
    };
  } catch (error) {
    return { error: 'Notification manager not initialized' };
  }
}

async function handleMemoryCompress(params?: Record<string, unknown>): Promise<unknown> {
  // This will be implemented in Phase 3
  console.log('[Worker:proactive] Memory compression not yet implemented');

  return {
    executed: false,
    note: 'Memory compression not implemented yet (Phase 3)',
  };
}

async function handleCustomTask(params?: Record<string, unknown>): Promise<unknown> {
  const action = params?.action as string;

  if (!action) {
    throw new Error('action parameter required for custom task');
  }

  console.log(`[Worker:proactive] Custom task: ${action}`, params);

  return {
    action,
    params,
    executed: true,
  };
}
