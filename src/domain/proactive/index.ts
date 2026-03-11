/**
 * Proactive Scheduling Module
 *
 * Autonomous task scheduling and persistent notifications
 */

// Types
export type {
  Schedule,
  Pattern,
  ScheduleState,
  ProactiveTaskType,
  PendingNotification,
  NotificationHistory,
  NotificationPriority,
  DaemonState,
  ScheduleStorage,
  NotificationStorage,
  ProactiveToolResult,
  CreateScheduleOptions,
  ProactiveJobData,
} from './types';

// Scheduler
export { Scheduler, getScheduler, resetScheduler } from './scheduler';

// Notifications
export { NotificationManager, getNotificationManager, resetNotificationManager } from './notifications';

// Daemon
export { Daemon, getDaemon, resetDaemon } from './daemon';

// Pusher
export {
  pushNotification,
  pushPendingNotifications,
  pushUrgent,
  pushReminder,
  pushGoalProgress,
  formatNotification,
  formatNotifications,
  setCliDeliveryHandler,
  registerDeliveryHandler,
  pushToFeishu,
  registerFeishuHandler,
  proactiveMessageToFeishu,
} from './pusher';
export type { PushOptions, PushResult } from './pusher';

// Triggers
export {
  evaluateCondition,
  evaluatePatterns,
  executePatternAction,
} from './triggers';
export type { TriggerContext, TriggerResult } from './triggers';

// Tools
export {
  proactiveTools,
  executeProactiveTool,
  getProactiveToolsForAI,
  PROACTIVE_TOOL_NAMES,
} from './tools';
