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

export type QueueName = 'proactive-jobs';

export type TaskType = 'proactive';

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
    proactive?: WorkerConfig;
  };
  defaultJobOptions?: JobOptions;
}

export interface WorkerConfig {
  concurrency?: number;
  timeout?: number;
  enabled?: boolean;
}

// Job data types

export interface ProactiveJobData {
  scheduleId: string;
  taskType: 'check_goal_progress' | 'run_skill' | 'send_reminder' | 'memory_compress' | 'llm_proactive_chat' | 'deep_analysis' | 'custom';
  params?: Record<string, unknown>;
  triggeredAt: string;
  triggeredBy: 'cron' | 'pattern' | 'manual';
}
