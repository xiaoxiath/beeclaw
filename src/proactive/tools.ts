/**
 * Proactive Tools
 *
 * AI tool definitions for proactive scheduling
 */

import { z } from 'zod';
import type { ProactiveToolResult, CreateScheduleOptions } from './types';
import { getSchedulerLazy } from '../store';
import { getNotificationsLazy } from '../store';

// Tool definitions for AI function calling
export const proactiveTools = {
  proactive_schedule: {
    name: 'proactive_schedule',
    description: 'Create a scheduled task that runs automatically. Use this for recurring reminders, goal progress checks, etc.',
    parameters: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Name for this schedule',
        },
        description: {
          type: 'string',
          description: 'What this schedule does',
        },
        cron: {
          type: 'string',
          description: 'Cron expression (e.g., "0 9 * * *" for daily at 9am, "*/30 * * * *" for every 30 minutes)',
        },
        taskType: {
          type: 'string',
          enum: ['check_goal_progress', 'run_skill', 'send_reminder', 'memory_compress', 'custom'],
          description: 'Type of task to execute',
        },
        taskParams: {
          type: 'object',
          description: 'Parameters for the task',
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
          enum: ['check_goal_progress', 'run_skill', 'send_reminder', 'memory_compress', 'custom'],
          description: 'Action to take when triggered',
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
    description: 'List all schedules and patterns.',
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
};

// Tool executor
export function executeProactiveTool(name: string, params: Record<string, unknown>): ProactiveToolResult {
  try {
    const scheduler = getSchedulerLazy();
    const notificationManager = getNotificationsLazy();

    switch (name) {
      case 'proactive_schedule': {
        const parsed = z.object({
          name: z.string().min(1),
          description: z.string().optional(),
          cron: z.string(),
          taskType: z.enum(['check_goal_progress', 'run_skill', 'send_reminder', 'memory_compress', 'custom']),
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
          result.schedules = scheduler.listSchedules({ enabled: parsed.data.enabled }).map(s => ({
            id: s.id,
            name: s.name,
            cron: s.cron,
            enabled: s.enabled,
            taskType: s.task.type,
            lastRun: s.lastRun,
            nextRun: s.nextRun,
            runCount: s.runCount,
          }));
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

        return notificationManager.create({
          userId: 'cli-user',
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

// Get all proactive tools for AI
export function getProactiveToolsForAI() {
  return Object.values(proactiveTools);
}

// Export tool names
export const PROACTIVE_TOOL_NAMES = Object.keys(proactiveTools);
