/**
 * Proactive Scheduling Types
 *
 * Types for autonomous task scheduling and persistent notifications
 */

import { z } from 'zod';
import type { ToolResult } from '../../types';

// Re-export for convenience
export type { ToolResult } from '../../types';

// Task types for proactive scheduling
export type ProactiveTaskType =
  | 'check_goal_progress'
  | 'run_skill'
  | 'send_reminder'
  | 'memory_compress'
  | 'llm_proactive_chat'  // LLM 主动沟通
  | 'self_evolution'
  | 'custom';

// Schedule state
export type ScheduleState = 'enabled' | 'disabled' | 'paused';

// Schedule schema
export const ScheduleSchema = z.object({
  id: z.string().describe('Unique schedule ID'),
  name: z.string().describe('Human-readable name'),
  description: z.string().optional().describe('What this schedule does'),
  cron: z.string().describe('Cron expression for timing'),
  enabled: z.boolean().default(true).describe('Whether schedule is active'),
  state: z.enum(['enabled', 'disabled', 'paused']).default('enabled'),
  task: z.object({
    type: z.enum(['check_goal_progress', 'run_skill', 'send_reminder', 'memory_compress', 'llm_proactive_chat', 'self_evolution', 'custom']),
    params: z.record(z.unknown()).optional().default({}),
  }).describe('Task to execute'),
  lastRun: z.string().optional().describe('Last execution time'),
  nextRun: z.string().optional().describe('Next scheduled run'),
  runCount: z.number().default(0).describe('Number of times executed'),
  lastResult: z.unknown().optional().describe('Result of last execution'),
  createdAt: z.string().describe('Creation timestamp'),
  updatedAt: z.string().describe('Last update timestamp'),
  // Execution lock to prevent duplicate execution
  isExecuting: z.boolean().default(false).describe('Whether task is currently executing'),
});

export type Schedule = z.infer<typeof ScheduleSchema>;

// Pattern trigger schema (event-based)
export const PatternSchema = z.object({
  id: z.string().describe('Pattern ID'),
  name: z.string().describe('Pattern name'),
  description: z.string().optional(),
  trigger: z.object({
    type: z.enum(['time_based', 'event_based', 'condition_based']),
    condition: z.string().describe('Condition expression'),
  }).describe('Trigger definition'),
  action: z.object({
    type: z.enum(['check_goal_progress', 'run_skill', 'send_reminder', 'memory_compress', 'llm_proactive_chat', 'self_evolution', 'custom']),
    params: z.record(z.unknown()).optional().default({}),
  }).describe('Action to take'),
  enabled: z.boolean().default(true),
  lastTriggered: z.string().optional(),
  triggerCount: z.number().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Pattern = z.infer<typeof PatternSchema>;

// Notification priority (independent type)
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

// Notification schema
export const PendingNotificationSchema = z.object({
  id: z.string().describe('Notification ID'),
  userId: z.string().describe('Target user ID'),
  message: z.string().describe('Notification content'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  category: z.string().optional().describe('Notification category'),
  createdAt: z.string().describe('Creation timestamp'),
  scheduledFor: z.string().optional().describe('When to deliver'),
  expiresAt: z.string().optional().describe('When notification expires'),
  delivery: z.object({
    channels: z.array(z.enum(['cli', 'websocket', 'email'])).default(['cli']),
    attempts: z.number().default(0),
    maxAttempts: z.number().default(3),
    delivered: z.boolean().default(false),
    deliveredAt: z.string().optional(),
  }).describe('Delivery tracking'),
  metadata: z.record(z.unknown()).optional().describe('Additional metadata'),
});

export type PendingNotification = z.infer<typeof PendingNotificationSchema>;

// Notification history schema
export const NotificationHistorySchema = z.object({
  id: z.string(),
  userId: z.string(),
  message: z.string(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  category: z.string().optional(),
  createdAt: z.string(),
  deliveredAt: z.string(),
  channel: z.enum(['cli', 'websocket', 'email']),
  success: z.boolean(),
  metadata: z.record(z.unknown()).optional(),
});

export type NotificationHistory = z.infer<typeof NotificationHistorySchema>;

// Daemon state schema
export const DaemonStateSchema = z.object({
  running: z.boolean().default(false),
  pid: z.number().optional(),
  startedAt: z.string().optional(),
  lastHeartbeat: z.string().optional(),
  schedulesLoaded: z.number().default(0),
  jobsExecuted: z.number().default(0),
  errors: z.array(z.object({
    time: z.string(),
    message: z.string(),
  })).default([]),
});

export type DaemonState = z.infer<typeof DaemonStateSchema>;

// Schedule storage schema
export const ScheduleStorageSchema = z.object({
  schedules: z.record(ScheduleSchema).default({}),
  patterns: z.record(PatternSchema).default({}),
  lastUpdated: z.string(),
});

export type ScheduleStorage = z.infer<typeof ScheduleStorageSchema>;

// Notification storage schema
export const NotificationStorageSchema = z.object({
  pending: z.array(PendingNotificationSchema).default([]),
  history: z.array(NotificationHistorySchema).default([]),
  lastUpdated: z.string(),
});

export type NotificationStorage = z.infer<typeof NotificationStorageSchema>;

// Tool result type - uses unified type
export type ProactiveToolResult = ToolResult<Schedule | Pattern | PendingNotification | PendingNotification[] | NotificationHistory[] | NotificationHistory | { [key: string]: unknown }>;

// Create schedule options
export const CreateScheduleOptionsSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  cron: z.string(),
  taskType: z.enum(['check_goal_progress', 'run_skill', 'send_reminder', 'memory_compress', 'llm_proactive_chat', 'self_evolution', 'custom']),
  taskParams: z.record(z.unknown()).optional().default({}),
  enabled: z.boolean().optional().default(true),
});

export type CreateScheduleOptions = z.infer<typeof CreateScheduleOptionsSchema>;

// Proactive job data for queue
// [AUDIT FIX M-02, M-11] associatedSessionId is now actively used for:
//   1. Loading user conversation history into proactive task context
//   2. Injecting task results back into user sessions
//   3. Enabling bidirectional context flow between tasks and conversations
export const ProactiveJobDataSchema = z.object({
  scheduleId: z.string(),
  taskType: z.enum(['check_goal_progress', 'run_skill', 'send_reminder', 'memory_compress', 'llm_proactive_chat', 'self_evolution', 'custom']),
  params: z.record(z.unknown()).optional().default({}),
  triggeredAt: z.string(),
  triggeredBy: z.enum(['cron', 'pattern', 'manual']),
  /**
   * [AUDIT FIX M-02/M-11] Associated user session ID for bidirectional context flow.
   * When set, the job handler will:
   *   - Load recent conversation history from this session as context
   *   - Inject the task execution result back into this session
   */
  associatedSessionId: z.string().optional(),
  /** Source tag for message tracking */
  source: z.literal('proactive').optional().default('proactive'),
});

export type ProactiveJobData = z.infer<typeof ProactiveJobDataSchema>;
