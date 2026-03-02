/**
 * Goal Tools
 *
 * AI tool definitions for goal management
 */

import { z } from 'zod';
import type { GoalToolResult, GoalFilter, CreateGoalOptions, UpdateGoalOptions } from './types';
import { getGoalStore } from './store';

// Tool definitions for AI function calling
export const goalTools = {
  goal_list: {
    name: 'goal_list',
    description: 'List all goals or filter by state/priority. Use this to see what goals exist and their progress.',
    parameters: {
      type: 'object' as const,
      properties: {
        state: {
          type: 'string',
          enum: ['active', 'paused', 'completed', 'cancelled'],
          description: 'Filter by goal state',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: 'Filter by priority',
        },
        search: {
          type: 'string',
          description: 'Search in goal title and description',
        },
      },
      required: [],
    },
  },

  goal_get: {
    name: 'goal_get',
    description: 'Get detailed information about a specific goal including checkpoints and context.',
    parameters: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'Goal ID',
        },
      },
      required: ['id'],
    },
  },

  goal_create: {
    name: 'goal_create',
    description: 'Create a new goal. Use this to track long-term objectives across sessions.',
    parameters: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Goal title (concise, actionable)',
        },
        description: {
          type: 'string',
          description: 'Detailed description of what the goal involves',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: 'Priority level (default: medium)',
        },
        targetDate: {
          type: 'string',
          description: 'Target completion date (ISO format, e.g., "2026-03-15")',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization',
        },
        why: {
          type: 'string',
          description: 'Why this goal matters',
        },
      },
      required: ['title'],
    },
  },

  goal_update: {
    name: 'goal_update',
    description: 'Update a goal\'s state, progress, or other properties.',
    parameters: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'Goal ID',
        },
        title: {
          type: 'string',
          description: 'Updated title',
        },
        state: {
          type: 'string',
          enum: ['active', 'paused', 'completed', 'cancelled'],
          description: 'New state',
        },
        progress: {
          type: 'number',
          minimum: 0,
          maximum: 100,
          description: 'Progress percentage (0-100)',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: 'New priority',
        },
        description: {
          type: 'string',
          description: 'Updated description',
        },
        targetDate: {
          type: 'string',
          description: 'Updated target date',
        },
      },
      required: ['id'],
    },
  },

  goal_checkpoint: {
    name: 'goal_checkpoint',
    description: 'Add a checkpoint/milestone to a goal, or complete an existing checkpoint.',
    parameters: {
      type: 'object' as const,
      properties: {
        goalId: {
          type: 'string',
          description: 'Goal ID',
        },
        action: {
          type: 'string',
          enum: ['add', 'complete'],
          description: 'Action to perform',
        },
        checkpointId: {
          type: 'string',
          description: 'Checkpoint ID (required for complete action)',
        },
        title: {
          type: 'string',
          description: 'Checkpoint title (required for add action)',
        },
        description: {
          type: 'string',
          description: 'Checkpoint description',
        },
      },
      required: ['goalId', 'action'],
    },
  },

  goal_decompose: {
    name: 'goal_decompose',
    description: 'Break down a goal into smaller sub-goals for easier tracking.',
    parameters: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'Parent goal ID',
        },
        subGoals: {
          type: 'array',
          items: { type: 'string' },
          description: 'Titles for the sub-goals',
        },
      },
      required: ['id', 'subGoals'],
    },
  },

  goal_delete: {
    name: 'goal_delete',
    description: 'Delete a goal permanently. Use with caution.',
    parameters: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'Goal ID to delete',
        },
      },
      required: ['id'],
    },
  },

  goal_summary: {
    name: 'goal_summary',
    description: 'Get a summary of all goals (counts by state).',
    parameters: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
};

// Tool executor
export function executeGoalTool(name: string, params: Record<string, unknown>): GoalToolResult {
  const store = getGoalStore();

  switch (name) {
    case 'goal_list': {
      const filter: GoalFilter = {};
      if (params.state) filter.state = params.state as GoalFilter['state'];
      if (params.priority) filter.priority = params.priority as GoalFilter['priority'];
      if (params.search) filter.search = params.search as string;

      const goals = store.list(filter);
      return {
        success: true,
        data: goals.map(g => ({
          id: g.id,
          title: g.title,
          state: g.state,
          priority: g.priority,
          progress: g.progress,
          checkpoints: g.checkpoints?.length || 0,
          tags: g.tags,
          targetDate: g.targetDate,
          updatedAt: g.updatedAt,
        })),
      };
    }

    case 'goal_get': {
      const parsed = z.object({ id: z.string() }).safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      const goal = store.get(parsed.data.id);
      if (!goal) {
        return { success: false, error: `Goal not found: ${parsed.data.id}` };
      }
      return { success: true, data: goal };
    }

    case 'goal_create': {
      const parsed = z.object({
        title: z.string().min(1),
        description: z.string().optional().default(''),
        priority: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium'),
        targetDate: z.string().optional(),
        tags: z.array(z.string()).optional().default([]),
        why: z.string().optional(),
      }).safeParse(params);

      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }

      const options: CreateGoalOptions = {
        title: parsed.data.title,
        description: parsed.data.description,
        priority: parsed.data.priority,
        targetDate: parsed.data.targetDate,
        tags: parsed.data.tags,
      };

      if (parsed.data.why) {
        options.context = {
          why: parsed.data.why,
          relatedFacts: [],
          constraints: [],
        };
      }

      return store.create(options);
    }

    case 'goal_update': {
      const parsed = z.object({
        id: z.string(),
        title: z.string().optional(),
        state: z.enum(['active', 'paused', 'completed', 'cancelled']).optional(),
        progress: z.number().min(0).max(100).optional(),
        priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
        description: z.string().optional(),
        targetDate: z.string().optional(),
      }).safeParse(params);

      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }

      const options: UpdateGoalOptions = {};
      if (parsed.data.title) options.title = parsed.data.title;
      if (parsed.data.state) options.state = parsed.data.state;
      if (parsed.data.progress !== undefined) options.progress = parsed.data.progress;
      if (parsed.data.priority) options.priority = parsed.data.priority;
      if (parsed.data.description) options.description = parsed.data.description;
      if (parsed.data.targetDate !== undefined) options.targetDate = parsed.data.targetDate;

      return store.update(parsed.data.id, options);
    }

    case 'goal_checkpoint': {
      const parsed = z.object({
        goalId: z.string(),
        action: z.enum(['add', 'complete']),
        checkpointId: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
      }).safeParse(params);

      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }

      if (parsed.data.action === 'add') {
        if (!parsed.data.title) {
          return { success: false, error: 'title is required for add action' };
        }
        return store.addCheckpoint(parsed.data.goalId, parsed.data.title, parsed.data.description);
      } else {
        if (!parsed.data.checkpointId) {
          return { success: false, error: 'checkpointId is required for complete action' };
        }
        return store.completeCheckpoint(parsed.data.goalId, parsed.data.checkpointId);
      }
    }

    case 'goal_decompose': {
      const parsed = z.object({
        id: z.string(),
        subGoals: z.array(z.string()).min(1),
      }).safeParse(params);

      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }

      return store.decompose(parsed.data.id, parsed.data.subGoals);
    }

    case 'goal_delete': {
      const parsed = z.object({ id: z.string() }).safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      return store.delete(parsed.data.id);
    }

    case 'goal_summary': {
      return { success: true, data: store.getSummary() };
    }

    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
}

// Get all goal tools for AI
export function getGoalToolsForAI() {
  return Object.values(goalTools);
}

// Export tool names
export const GOAL_TOOL_NAMES = Object.keys(goalTools);
