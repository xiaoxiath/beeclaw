/**
 * Queue System Types
 */

export type JobState =
  | 'waiting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'delayed'
  | 'paused';

export type QueueName =
  | 'skill-jobs'
  | 'search-jobs'
  | 'scheduled'
  | 'eval-jobs'
  | 'report-jobs'
  | 'cleanup-jobs'
  | 'proactive-jobs';

export type TaskType = 'skill' | 'search' | 'reminder' | 'report' | 'eval' | 'cleanup' | 'proactive';

export interface JobOptions {
  priority?: number;        // 1-10, default 5
  delay?: number;           // Delay in ms
  attempts?: number;        // Retry attempts
  backoff?: {
    type: 'fixed' | 'exponential';
    delay: number;
  };
  repeat?: {
    pattern?: string;       // Cron pattern
    every?: number;         // Repeat every N ms
    limit?: number;         // Max repetitions
  };
  timeout?: number;         // Timeout in ms
}

export interface JobResult<T = unknown> {
  id: string;
  name: string;
  queue: string;
  state: JobState;
  data: unknown;
  result?: T;
  error?: string;
  progress?: number;
  timestamp: {
    created: Date;
    processed?: Date;
    completed?: Date;
  };
}

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
}

export interface QueueConfig {
  enabled?: boolean;
  mode?: 'embedded' | 'server';
  storage?: {
    path?: string;
  };
  workers?: {
    skill?: WorkerConfig;
    search?: WorkerConfig;
    cron?: WorkerConfig;
    eval?: WorkerConfig;
    report?: WorkerConfig;
    cleanup?: WorkerConfig;
    proactive?: WorkerConfig;
  };
  defaultJobOptions?: JobOptions;
}

export interface WorkerConfig {
  concurrency?: number;
  timeout?: number;
  enabled?: boolean;
}

// Job data types for each queue

export interface SkillJobData {
  skillName: string;
  action: string;
  params: Record<string, unknown>;
  sessionId?: string;
  userId?: string;
}

export interface SearchJobData {
  query: string;
  numResults?: number;
  region?: string;
  timeRange?: string;
  sessionId?: string;
  userId?: string;
}

export interface ReminderJobData {
  userId: string;
  message: string;
  type: 'one-time' | 'recurring';
}

export interface ReportJobData {
  type: 'daily' | 'weekly' | 'monthly' | 'custom';
  userId: string;
  format: 'markdown' | 'docx' | 'pdf';
  params?: Record<string, unknown>;
}

export interface EvalJobData {
  skillName: string;
  evalSet: string;
  iteration?: number;
}

export interface CleanupJobData {
  task: 'conversations' | 'sessions' | 'logs' | 'all';
  retentionDays?: number;
}

export interface ProactiveJobData {
  scheduleId: string;
  taskType: 'check_goal_progress' | 'run_skill' | 'send_reminder' | 'memory_compress' | 'custom';
  params?: Record<string, unknown>;
  triggeredAt: string;
  triggeredBy: 'cron' | 'pattern' | 'manual';
}
