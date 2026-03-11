/**
 * TaskDispatcher - Unified task scheduling and execution
 * RFC-02: TaskDispatcher architecture
 */

/**
 * Task types supported by the dispatcher
 */
export type TaskType = 'message' | 'cron' | 'reminder' | 'custom';

/**
 * Task status lifecycle
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * Task definition
 */
export interface Task {
  id: string;
  sessionId: string;
  type: TaskType;
  payload: Record<string, any>;
  scheduledAt: Date;
  cron?: string; // Cron expression for recurring tasks
  status: TaskStatus;
  attempts: number;
  maxAttempts: number;
  error?: string;
  lockedBy?: string; // Dispatcher instance ID
  lockedAt?: Date;
  result?: Record<string, any>;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * Task handler function type
 */
export type TaskHandler = (task: Task) => Promise<void>;

/**
 * Task dispatcher configuration
 */
export interface TaskDispatcherConfig {
  maxConcurrency?: number; // Max concurrent tasks (default: 10)
  lockTimeoutMs?: number; // Lock timeout in milliseconds (default: 300000 = 5min)
  retryAttempts?: number; // Max retry attempts (default: 3)
  pollIntervalMs?: number; // Polling interval in milliseconds (default: 1000)
  dispatcherId?: string; // Unique dispatcher instance ID
}

/**
 * Task dispatcher statistics
 */
export interface TaskDispatcherStats {
  totalTasks: number;
  pendingTasks: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  activeLocks: number;
}
