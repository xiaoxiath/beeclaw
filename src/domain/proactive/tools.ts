/**
 * Proactive Tools
 *
 * AI tool definitions for proactive scheduling
 */

import { z } from 'zod';
import type { ProactiveToolResult, CreateScheduleOptions } from './types';
import { getSchedulerLazy } from '../../infra/db/store';
import { getNotificationsLazy } from '../../infra/db/store';
import { getTaskManager } from '../../infra/queue/manager';
import { pushNotification } from './pusher';

// Tool definitions for AI function calling
export const proactiveTools = {
  proactive_schedule: {
    name: 'proactive_schedule',
    description: 'Create a scheduled task that runs automatically. Use this for recurring reminders, goal progress checks. IMPORTANT: (1) Cron expressions use the configured timezone (check user.timezone in config). (2) Reserved names that should NOT be used: "Daily Memory Compression", "Daily Self-Evolution" - these are auto-created by the system.',
    parameters: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Name for this schedule. DO NOT use reserved names: "Daily Memory Compression", "Daily Self-Evolution"',
        },
        description: {
          type: 'string',
          description: 'What this schedule does',
        },
        cron: {
          type: 'string',
          description: 'Cron expression in the configured timezone (default: Asia/Shanghai). Example: "0 9 * * *" for daily at 9:00 AM, "*/30 * * * *" for every 30 minutes. Check user.timezone config for current timezone.',
        },
        taskType: {
          type: 'string',
          enum: ['check_goal_progress', 'run_skill', 'send_reminder', 'memory_compress', 'llm_proactive_chat', 'self_evolution', 'custom'],
          description: 'Type of task to execute. Use llm_proactive_chat for LLM-generated proactive messages. Use self_evolution for self-reflection and SOUL.md updates.',
        },
        taskParams: {
          type: 'object',
          description: 'Parameters for the task. For run_skill: { skillName: string, skillParams?: object }. For llm_proactive_chat: { prompt?: string, channel?: "cli"|"feishu", userId?: string }. For send_reminder: { message: string, priority?: "low"|"normal"|"high"|"urgent" }',
        },
        enabled: {
          type: 'boolean',
          description: 'Whether to enable immediately (default: true)',
        },
      },
      required: ['name', 'cron', 'taskType'],
    },
  },

  proactive_pattern: {
    name: 'proactive_pattern',
    description: 'Create an event-based trigger pattern. Use this for reactive behavior.',
    parameters: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Pattern name',
        },
        description: {
          type: 'string',
          description: 'What this pattern does',
        },
        triggerType: {
          type: 'string',
          enum: ['time_based', 'event_based', 'condition_based'],
          description: 'Type of trigger',
        },
        condition: {
          type: 'string',
          description: 'Condition expression (e.g., "goal.progress < 50", "time.hour == 9")',
        },
        actionType: {
          type: 'string',
          enum: ['check_goal_progress', 'run_skill', 'send_reminder', 'memory_compress', 'llm_proactive_chat', 'custom'],
          description: 'Action to take when triggered. Use llm_proactive_chat for LLM-generated messages.',
        },
        actionParams: {
          type: 'object',
          description: 'Parameters for the action',
        },
      },
      required: ['name', 'triggerType', 'condition', 'actionType'],
    },
  },

  proactive_list: {
    name: 'proactive_list',
    description: 'List all schedules and patterns. Returns nextRun in both ISO format (UTC) and local time format for clarity.',
    parameters: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string',
          enum: ['schedules', 'patterns', 'all'],
          description: 'What to list (default: all)',
        },
        enabled: {
          type: 'boolean',
          description: 'Filter by enabled status',
        },
      },
      required: [],
    },
  },

  proactive_cancel: {
    name: 'proactive_cancel',
    description: 'Cancel/delete a schedule or pattern.',
    parameters: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'ID of the schedule or pattern to cancel',
        },
        type: {
          type: 'string',
          enum: ['schedule', 'pattern'],
          description: 'Type of item to cancel',
        },
      },
      required: ['id', 'type'],
    },
  },

  proactive_enable: {
    name: 'proactive_enable',
    description: 'Enable a disabled schedule.',
    parameters: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'Schedule ID',
        },
      },
      required: ['id'],
    },
  },

  proactive_disable: {
    name: 'proactive_disable',
    description: 'Disable an enabled schedule.',
    parameters: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'Schedule ID',
        },
      },
      required: ['id'],
    },
  },

  schedule_once: {
    name: 'schedule_once',
    description: 'Create a one-time task that runs after a delay. Use this for reminders or actions that should happen once in the future. Unlike proactive_schedule, this creates a queue job that auto-deletes after execution.',
    parameters: {
      type: 'object' as const,
      properties: {
        delay_seconds: {
          type: 'number',
          description: 'Delay in seconds before executing the task. E.g., 300 for 5 minutes, 3600 for 1 hour.',
        },
        taskType: {
          type: 'string',
          enum: ['send_reminder', 'llm_proactive_chat', 'run_skill', 'custom'],
          description: 'Type of task. Use llm_proactive_chat for LLM-generated messages, send_reminder for simple reminders.',
        },
        taskParams: {
          type: 'object',
          description: 'Parameters for the task. For run_skill: { skillName: string, skillParams?: object }. For llm_proactive_chat: { prompt, chatId?, userId? }. For send_reminder: { message, priority? }',
        },
        name: {
          type: 'string',
          description: 'Optional name for tracking the task',
        },
      },
      required: ['delay_seconds', 'taskType'],
    },
  },

  notification_send: {
    name: 'notification_send',
    description: 'Send a persistent notification to the user. Use for reminders that should survive across sessions.',
    parameters: {
      type: 'object' as const,
      properties: {
        message: {
          type: 'string',
          description: 'Notification message',
        },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high', 'urgent'],
          description: 'Priority level (default: normal)',
        },
        category: {
          type: 'string',
          description: 'Category for grouping (e.g., "goal-progress", "reminder")',
        },
        scheduledFor: {
          type: 'string',
          description: 'ISO timestamp for when to deliver (optional)',
        },
        expiresAt: {
          type: 'string',
          description: 'ISO timestamp for when notification expires (optional)',
        },
      },
      required: ['message'],
    },
  },

  notification_list: {
    name: 'notification_list',
    description: 'List pending notifications.',
    parameters: {
      type: 'object' as const,
      properties: {
        userId: {
          type: 'string',
          description: 'User ID to filter by (default: current user)',
        },
      },
      required: [],
    },
  },

  notification_mark_read: {
    name: 'notification_mark_read',
    description: 'Mark a notification as read/delivered. Use this after showing or handling a notification to prevent it from appearing again.',
    parameters: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'Notification ID to mark as read',
        },
      },
      required: ['id'],
    },
  },

  notification_delete: {
    name: 'notification_delete',
    description: 'Delete a pending notification before it is delivered. Use this to cancel unnecessary or outdated notifications.',
    parameters: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'Notification ID to delete',
        },
      },
      required: ['id'],
    },
  },

  notification_history: {
    name: 'notification_history',
    description: 'Get notification delivery history. Shows past notifications that were delivered or expired.',
    parameters: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of history entries to return (default: 20, max: 100)',
        },
      },
      required: [],
    },
  },

  notification_stats: {
    name: 'notification_stats',
    description: 'Get notification statistics (pending count, history count, by priority). Use this to understand the current notification queue status.',
    parameters: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
};

// Tool executor
export async function executeProactiveTool(name: string, params: Record<string, unknown>): Promise<ProactiveToolResult> {
  try {
    const scheduler = getSchedulerLazy();
    const notificationManager = getNotificationsLazy();

    switch (name) {
      case 'proactive_schedule': {
        const parsed = z.object({
          name: z.string().min(1),
          description: z.string().optional(),
          cron: z.string(),
          taskType: z.enum(['check_goal_progress', 'run_skill', 'send_reminder', 'memory_compress', 'llm_proactive_chat', 'self_evolution', 'custom']),
          taskParams: z.record(z.unknown()).optional().default({}),
          enabled: z.boolean().optional().default(true),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const options: CreateScheduleOptions = {
          name: parsed.data.name,
          description: parsed.data.description,
          cron: parsed.data.cron,
          taskType: parsed.data.taskType,
          taskParams: parsed.data.taskParams,
          enabled: parsed.data.enabled,
        };

        return scheduler.createSchedule(options);
      }

      case 'proactive_pattern': {
        const parsed = z.object({
          name: z.string().min(1),
          description: z.string().optional(),
          triggerType: z.enum(['time_based', 'event_based', 'condition_based']),
          condition: z.string(),
          actionType: z.string(),
          actionParams: z.record(z.unknown()).optional().default({}),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        return scheduler.createPattern({
          name: parsed.data.name,
          description: parsed.data.description,
          triggerType: parsed.data.triggerType,
          condition: parsed.data.condition,
          actionType: parsed.data.actionType,
          actionParams: parsed.data.actionParams,
        });
      }

      case 'proactive_list': {
        const parsed = z.object({
          type: z.enum(['schedules', 'patterns', 'all']).optional().default('all'),
          enabled: z.boolean().optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const result: { schedules?: unknown[]; patterns?: unknown[] } = {};

        if (parsed.data.type === 'schedules' || parsed.data.type === 'all') {
          result.schedules = scheduler.listSchedules({ enabled: parsed.data.enabled }).map(s => {
            const nextRunDate = s.nextRun ? new Date(s.nextRun) : null;
            return {
              id: s.id,
              name: s.name,
              cron: s.cron,
              enabled: s.enabled,
              taskType: s.task.type,
              lastRun: s.lastRun,
              nextRun: s.nextRun,
              nextRunLocal: nextRunDate ? nextRunDate.toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                weekday: 'short'
              }) : undefined,
              runCount: s.runCount,
            };
          });
        }

        if (parsed.data.type === 'patterns' || parsed.data.type === 'all') {
          result.patterns = scheduler.listPatterns({ enabled: parsed.data.enabled }).map(p => ({
            id: p.id,
            name: p.name,
            triggerType: p.trigger.type,
            condition: p.trigger.condition,
            enabled: p.enabled,
            triggerCount: p.triggerCount,
          }));
        }

        return { success: true, data: result };
      }

      case 'proactive_cancel': {
        const parsed = z.object({
          id: z.string(),
          type: z.enum(['schedule', 'pattern']),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        if (parsed.data.type === 'schedule') {
          return scheduler.deleteSchedule(parsed.data.id);
        } else {
          return scheduler.deletePattern(parsed.data.id);
        }
      }

      case 'proactive_enable': {
        const parsed = z.object({ id: z.string() }).safeParse(params);
        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }
        return scheduler.enableSchedule(parsed.data.id);
      }

      case 'proactive_disable': {
        const parsed = z.object({ id: z.string() }).safeParse(params);
        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }
        return scheduler.disableSchedule(parsed.data.id);
      }

      case 'schedule_once': {
        const parsed = z.object({
          delay_seconds: z.number().min(1),
          taskType: z.enum(['send_reminder', 'llm_proactive_chat', 'run_skill', 'custom']),
          taskParams: z.record(z.unknown()).optional().default({}),
          name: z.string().optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        try {
          // Use the queue system for one-time tasks
          const manager = getTaskManager();
          await manager.initialize();

          const jobName = parsed.data.name || `once-${parsed.data.taskType}-${Date.now()}`;
          const delayMs = parsed.data.delay_seconds * 1000;

          const { jobId } = await manager.addJob(
            'proactive-jobs',
            jobName,
            {
              scheduleId: `once-${jobName}`,
              taskType: parsed.data.taskType,
              params: parsed.data.taskParams,
              triggeredAt: new Date(Date.now() + delayMs).toISOString(),
              triggeredBy: 'delay',
            },
            { delay: delayMs }
          );

          const delayDesc = formatDelay(parsed.data.delay_seconds);
          console.log(`[schedule_once] Created one-time task "${jobName}" (${parsed.data.taskType}) to run in ${delayDesc}`);

          return {
            success: true,
            data: {
              jobId,
              taskType: parsed.data.taskType,
              delaySeconds: parsed.data.delay_seconds,
              executeAt: new Date(Date.now() + delayMs).toISOString(),
              message: `One-time task scheduled to run in ${delayDesc}`,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: `Failed to create one-time task: ${error instanceof Error ? error.message : 'Unknown error'}`,
          };
        }
      }

      case 'notification_send': {
        const parsed = z.object({
          message: z.string().min(1),
          priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().default('normal'),
          category: z.string().optional(),
          scheduledFor: z.string().optional(),
          expiresAt: z.string().optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        // Use pushNotification for immediate delivery
        return await pushNotification({
          message: parsed.data.message,
          priority: parsed.data.priority,
          category: parsed.data.category,
          scheduledFor: parsed.data.scheduledFor,
          expiresAt: parsed.data.expiresAt,
        });
      }

      case 'notification_list': {
        const parsed = z.object({
          userId: z.string().optional().default('cli-user'),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const notifications = notificationManager.getPending(parsed.data.userId);
        return { success: true, data: notifications };
      }

      case 'notification_mark_read': {
        const parsed = z.object({
          id: z.string(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        return notificationManager.markDelivered(parsed.data.id, 'cli');
      }

      case 'notification_delete': {
        const parsed = z.object({
          id: z.string(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        return notificationManager.delete(parsed.data.id);
      }

      case 'notification_history': {
        const parsed = z.object({
          limit: z.number().min(1).max(100).optional().default(20),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const history = notificationManager.getHistory(parsed.data.limit);
        return { success: true, data: history };
      }

      case 'notification_stats': {
        const stats = notificationManager.getStats();
        return { success: true, data: stats };
      }

      default:
        return { success: false, error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    // Stores might not be initialized
    return {
      success: false,
      error: `Proactive system not initialized: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// Helper to format delay in human-readable form
function formatDelay(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}秒`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}分钟`;
  } else if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    return `${hours}小时`;
  } else {
    const days = Math.floor(seconds / 86400);
    return `${days}天`;
  }
}

// Get all proactive tools for AI
export function getProactiveToolsForAI() {
  return Object.values(proactiveTools);
}

// Export tool names
export const PROACTIVE_TOOL_NAMES = Object.keys(proactiveTools);
