/**
 * Task Decomposition Types
 *
 * Type definitions for task decomposition and orchestration
 */

import type { SubagentType, SubagentResult } from './types';

/**
 * A subtask in a decomposed task
 */
export interface SubTask {
  /** Unique identifier for this subtask */
  id: number;

  /** Type of subagent to handle this task */
  type: SubagentType;

  /** Task description */
  description: string;

  /** Whether this task can run in parallel with others */
  parallel: boolean;

  /** IDs of tasks that must complete before this one */
  dependsOn: number[];

  /** Estimated complexity (1-10) */
  estimatedComplexity?: number;

  /** Priority (1-10, higher = more important) */
  priority?: number;

  /** Expected output type */
  expectedOutput?: string;

  /** Additional context for this subtask */
  context?: string;
}

/**
 * Result of task decomposition
 */
export interface TaskDecomposition {
  /** Original complex task */
  originalTask: string;

  /** Decomposed subtasks */
  subtasks: SubTask[];

  /** Decomposition strategy used */
  strategy: 'sequential' | 'parallel' | 'mixed';

  /** Reasoning for decomposition */
  reasoning: string;

  /** Estimated total complexity */
  totalComplexity: number;

  /** Maximum parallelism possible */
  maxParallelism: number;
}

/**
 * Execution status of a subtask
 */
export type SubTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * State of a subtask during execution
 */
export interface SubTaskState {
  subtask: SubTask;
  status: SubTaskStatus;
  result?: SubagentResult;
  startedAt?: Date;
  completedAt?: Date;
  retryCount: number;
}

/**
 * Execution progress
 */
export interface ExecutionProgress {
  /** Total subtasks */
  total: number;

  /** Completed subtasks */
  completed: number;

  /** Failed subtasks */
  failed: number;

  /** Running subtasks */
  running: number;

  /** Pending subtasks */
  pending: number;

  /** Current parallelism level */
  parallelism: number;

  /** Execution time so far */
  elapsedMs: number;

  /** Estimated remaining time */
  estimatedRemainingMs?: number;
}

/**
 * Orchestration result
 */
export interface OrchestrationResult {
  /** Whether all tasks completed successfully */
  success: boolean;

  /** Original task */
  originalTask: string;

  /** Final aggregated output */
  output: string;

  /** All subtask results */
  subtaskResults: Map<number, SubagentResult>;

  /** Execution statistics */
  stats: {
    totalSubtasks: number;
    completedSubtasks: number;
    failedSubtasks: number;
    totalDurationMs: number;
    totalTokensUsed: number;
    maxParallelism: number;
  };

  /** Errors encountered */
  errors: Array<{
    subtaskId: number;
    error: string;
  }>;
}

/**
 * Orchestration options
 */
export interface OrchestrationOptions {
  /** Maximum parallelism (default: 3) */
  maxParallelism?: number;

  /** Maximum retries per subtask (default: 1) */
  maxRetries?: number;

  /** Timeout for entire orchestration in ms (default: 300000 = 5 minutes) */
  timeout?: number;

  /** Timeout per individual subtask in ms. When unset, computed from estimatedComplexity. */
  subtaskTimeout?: number;

  /** Whether to continue on failure (default: true) */
  continueOnFailure?: boolean;

  /** [G-P1-03] Maximum cumulative token budget across all subagents (0 = unlimited) */
  maxTokens?: number;

  /** Callback for progress updates */
  onProgress?: (progress: ExecutionProgress) => void;

  /** Callback for subtask completion */
  onSubtaskComplete?: (subtaskId: number, result: SubagentResult) => void;
}
