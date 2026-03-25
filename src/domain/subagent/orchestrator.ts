/**
 * Task Orchestrator
 *
 * Main orchestrator for task decomposition and execution
 */

import type { AIProvider } from '../../infra/config/schema';
import { decomposeTask } from './decompose';
import { DAGScheduler } from './scheduler';
import { spawnSubagent } from './runtime';
import type {
  TaskDecomposition,
  OrchestrationResult,
  OrchestrationOptions,
  SubTask,
} from './orchestration-types';
import type { SubagentResult } from './types';

/** Default per-subtask timeout in ms */
const DEFAULT_SUBTASK_TIMEOUT = 60000;

/** Minimum per-subtask timeout in ms */
const MIN_SUBTASK_TIMEOUT = 15000;

/** Maximum per-subtask timeout in ms */
const MAX_SUBTASK_TIMEOUT = 180000;

/**
 * Compute a per-subtask timeout based on its estimated complexity (1-10).
 * Falls back to `defaultMs` when the subtask has no complexity annotation.
 */
function computeSubtaskTimeout(
  subtask: SubTask,
  perSubtaskTimeoutMs?: number,
): number {
  // If the caller provided an explicit per-subtask timeout, honour it.
  if (perSubtaskTimeoutMs !== undefined) {
    return perSubtaskTimeoutMs;
  }

  const complexity = subtask.estimatedComplexity;
  if (complexity === undefined) {
    return DEFAULT_SUBTASK_TIMEOUT;
  }

  // Linear scale: complexity 1 -> MIN, complexity 10 -> MAX
  const clamped = Math.max(1, Math.min(10, complexity));
  const ratio = (clamped - 1) / 9; // 0..1
  return Math.round(MIN_SUBTASK_TIMEOUT + ratio * (MAX_SUBTASK_TIMEOUT - MIN_SUBTASK_TIMEOUT));
}

/**
 * Task Orchestrator - manages task decomposition and execution
 */
export class TaskOrchestrator {
  private provider: AIProvider;
  private model: string;
  private defaultOptions: OrchestrationOptions;

  constructor(options: {
    provider: AIProvider;
    model: string;
    defaultMaxParallelism?: number;
    defaultMaxRetries?: number;
    defaultTimeout?: number;
    defaultSubtaskTimeout?: number;
  }) {
    this.provider = options.provider;
    this.model = options.model;

    this.defaultOptions = {
      maxParallelism: options.defaultMaxParallelism || 3,
      maxRetries: options.defaultMaxRetries || 1,
      timeout: options.defaultTimeout || 300000, // 5 minutes
      subtaskTimeout: options.defaultSubtaskTimeout,
      continueOnFailure: true,
    };
  }

  /**
   * Decompose a complex task into subtasks
   */
  async decompose(
    task: string,
    context?: string
  ): Promise<TaskDecomposition> {
    console.log(`[Orchestrator] Decomposing task: ${task.substring(0, 100)}...`);

    try {
      const decomposition = await decomposeTask({
        provider: this.provider,
        model: this.model,
        task,
        context,
      });

      console.log(`[Orchestrator] Decomposed into ${decomposition.subtasks.length} subtasks`);
      console.log(`[Orchestrator] Strategy: ${decomposition.strategy}`);
      console.log(`[Orchestrator] Max parallelism: ${decomposition.maxParallelism}`);

      return decomposition;
    } catch (error) {
      console.error('[Orchestrator] Decomposition failed:', error);

      // Fallback: create a simple single-task decomposition
      console.log('[Orchestrator] Using fallback decomposition');

      return {
        originalTask: task,
        subtasks: [
          {
            id: 0,
            type: 'general',
            description: task,
            parallel: false,
            dependsOn: [],
            estimatedComplexity: 5,
          },
        ],
        strategy: 'sequential',
        reasoning: 'Fallback due to decomposition failure',
        totalComplexity: 5,
        maxParallelism: 1,
      };
    }
  }

  /**
   * Execute a decomposed task
   */
  async execute(
    decomposition: TaskDecomposition,
    options?: Partial<OrchestrationOptions>
  ): Promise<OrchestrationResult> {
    const opts = { ...this.defaultOptions, ...options };
    const startTime = Date.now();
    const globalTimeout = opts.timeout || 300000; // 5 minutes default

    console.log(`[Orchestrator] Starting execution of ${decomposition.subtasks.length} subtasks`);
    console.log(`[Orchestrator] Max parallelism: ${opts.maxParallelism}`);

    // Initialize scheduler
    const scheduler = new DAGScheduler(opts.maxParallelism);
    scheduler.initialize(decomposition.subtasks);
    scheduler.start();

    const results = new Map<number, SubagentResult>();
    const errors: Array<{ subtaskId: number; error: string }> = [];

    // ---------------------------------------------------------------
    // Fix 2: Event-driven signal instead of busy-wait polling.
    // A shared promise that resolves whenever any running task finishes.
    // ---------------------------------------------------------------
    let resolveSignal: () => void;
    let taskCompletionSignal = new Promise<void>(r => { resolveSignal = r; });
    const resetSignal = () => {
      taskCompletionSignal = new Promise<void>(r => { resolveSignal = r; });
    };

    // ---------------------------------------------------------------
    // Fix 3: Pipeline scheduling – maintain a running-promise set so we
    // can dispatch new tasks as soon as *any* task finishes, rather than
    // waiting for the entire batch.
    // ---------------------------------------------------------------
    const runningPromises = new Map<number, Promise<void>>();

    /**
     * Launch a single subtask and manage its lifecycle.
     * Returns a promise that settles when the task completes / fails.
     */
    const launchTask = (task: SubTask): Promise<void> => {
      scheduler.startTask(task.id);
      console.log(`[Orchestrator] Starting subtask ${task.id}: ${task.description.substring(0, 50)}...`);

      const subtaskTimeout = computeSubtaskTimeout(task, opts.subtaskTimeout);

      const promise = (async () => {
        try {
          const result = await spawnSubagent({
            type: task.type,
            task: task.description,
            context: task.context,
            timeout: subtaskTimeout,
          });

          if (result.success) {
            scheduler.completeTask(task.id, result);
            results.set(task.id, result);

            console.log(`[Orchestrator] Subtask ${task.id} completed successfully`);

            // Callback
            opts.onSubtaskComplete?.(task.id, result);
          } else {
            // Task failed
            const errorMsg = result.error || 'Unknown error';
            console.error(`[Orchestrator] Subtask ${task.id} failed:`, errorMsg);

            // Check if we should retry
            const state = scheduler.getTaskState(task.id);
            if (state && state.retryCount < opts.maxRetries!) {
              console.log(`[Orchestrator] Retrying subtask ${task.id} (attempt ${state.retryCount + 1}/${opts.maxRetries})`);
              scheduler.retryTask(task.id);
            } else {
              scheduler.failTask(task.id, errorMsg);
              errors.push({ subtaskId: task.id, error: errorMsg });

              if (!opts.continueOnFailure) {
                throw new Error(`Subtask ${task.id} failed: ${errorMsg}`);
              }
            }
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error(`[Orchestrator] Subtask ${task.id} error:`, errorMsg);

          // Only fail if not already handled (retry path sets status to pending)
          const state = scheduler.getTaskState(task.id);
          if (state && state.status === 'running') {
            scheduler.failTask(task.id, errorMsg);
            errors.push({ subtaskId: task.id, error: errorMsg });
          }

          if (!opts.continueOnFailure) {
            throw error;
          }
        } finally {
          // Remove from running set and signal the main loop
          runningPromises.delete(task.id);
          resolveSignal();
          resetSignal();

          // Progress callback
          opts.onProgress?.(scheduler.getProgress());
        }
      })();

      runningPromises.set(task.id, promise);
      return promise;
    };

    // ---------------------------------------------------------------
    // Main scheduling loop
    // ---------------------------------------------------------------
    while (!scheduler.isComplete()) {
      // -----------------------------------------------------------
      // Fix 1: Global timeout check
      // -----------------------------------------------------------
      if (Date.now() - startTime > globalTimeout) {
        console.error('[Orchestrator] Global timeout reached');
        // Fail all pending / running tasks
        for (const state of scheduler.getTaskStates().values()) {
          if (state.status === 'pending' || state.status === 'running') {
            scheduler.failTask(state.subtask.id, 'Global orchestration timeout');
            errors.push({ subtaskId: state.subtask.id, error: 'Global orchestration timeout' });
          }
        }
        break;
      }

      // Get tasks that can run right now (respects maxParallelism)
      const readyTasks = scheduler.getParallelizableTasks();

      if (readyTasks.length === 0) {
        // Check if we are stuck (all pending tasks have failed dependencies)
        const failedTasks = scheduler.getFailedTasks();
        if (failedTasks.length > 0 && scheduler.getRunningTasks().length === 0) {
          console.error('[Orchestrator] Execution stuck due to failed tasks');

          // Skip all remaining pending tasks
          for (const state of scheduler.getTaskStates().values()) {
            if (state.status === 'pending') {
              scheduler.skipTask(state.subtask.id);
            }
          }
          break;
        }

        if (runningPromises.size > 0) {
          // Wait for any running task to complete (event-driven, not busy-wait)
          await taskCompletionSignal;
        }
        continue;
      }

      // Launch all ready tasks (fire-and-forget into the running set)
      for (const task of readyTasks) {
        launchTask(task);
      }

      // Wait for at least one running task to complete before re-evaluating
      if (runningPromises.size > 0) {
        await taskCompletionSignal;
      }
    }

    // Ensure all running promises are settled before returning
    if (runningPromises.size > 0) {
      await Promise.allSettled([...runningPromises.values()]);
    }

    const duration = Date.now() - startTime;
    const success = scheduler.isSuccessful();

    console.log(`[Orchestrator] Execution ${success ? 'completed' : 'finished with errors'} in ${duration}ms`);

    // Aggregate output
    const output = this.aggregateOutput(decomposition, results);

    // Calculate stats
    const stats = this.calculateStats(results, duration, scheduler);

    return {
      success,
      originalTask: decomposition.originalTask,
      output,
      subtaskResults: results,
      stats,
      errors,
    };
  }

  /**
   * Decompose and execute in one step
   */
  async orchestrate(
    task: string,
    context?: string,
    options?: Partial<OrchestrationOptions>
  ): Promise<OrchestrationResult> {
    // Decompose
    const decomposition = await this.decompose(task, context);

    // Execute
    return this.execute(decomposition, options);
  }

  /**
   * Aggregate outputs from all subtasks
   */
  private aggregateOutput(
    decomposition: TaskDecomposition,
    results: Map<number, SubagentResult>
  ): string {
    const sections: string[] = [];

    // Group by task type
    const byType: Record<string, Array<{ task: SubTask; result: SubagentResult }>> = {};

    for (const subtask of decomposition.subtasks) {
      const result = results.get(subtask.id);
      if (result && result.success) {
        if (!byType[subtask.type]) {
          byType[subtask.type] = [];
        }
        byType[subtask.type].push({ task: subtask, result });
      }
    }

    // Build output
    for (const [type, items] of Object.entries(byType)) {
      if (items.length === 1) {
        sections.push(`## ${this.capitalizeType(type)}\n\n${items[0].result.output}`);
      } else {
        sections.push(`## ${this.capitalizeType(type)} (${items.length} tasks)`);
        for (const { task, result } of items) {
          sections.push(`\n### ${task.description.substring(0, 60)}...\n\n${result.output}`);
        }
      }
    }

    // -----------------------------------------------------------
    // Fix 4: Include failed task information in aggregated output
    // -----------------------------------------------------------
    const failedTasks = decomposition.subtasks.filter(
      s => !results.has(s.id) || !results.get(s.id)!.success
    );
    if (failedTasks.length > 0) {
      sections.push('## Failed Tasks\n');
      for (const task of failedTasks) {
        const result = results.get(task.id);
        const reason = result?.error || 'Task was skipped or not executed';
        sections.push(`- **${task.description.substring(0, 60)}**: ${reason}`);
      }
    }

    if (sections.length === 0) {
      return 'No results to aggregate';
    }

    return sections.join('\n\n---\n\n');
  }

  /**
   * Calculate execution statistics
   */
  private calculateStats(
    results: Map<number, SubagentResult>,
    duration: number,
    scheduler: DAGScheduler
  ): OrchestrationResult['stats'] {
    let totalTokens = 0;
    let completed = 0;
    let failed = 0;

    for (const result of results.values()) {
      totalTokens += result.tokensUsed;
      if (result.success) {
        completed++;
      } else {
        failed++;
      }
    }

    return {
      totalSubtasks: scheduler.getTaskStates().size,
      completedSubtasks: completed,
      failedSubtasks: failed,
      totalDurationMs: duration,
      totalTokensUsed: totalTokens,
      maxParallelism: this.defaultOptions.maxParallelism || 3,
    };
  }

  /**
   * Capitalize task type for display
   */
  private capitalizeType(type: string): string {
    const map: Record<string, string> = {
      research: 'Research',
      memory: 'Memory Operations',
      skill: 'Skill Management',
      code: 'Code Tasks',
      general: 'General Tasks',
    };
    return map[type] || this.capitalize(type);
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

// Singleton instance
let orchestratorInstance: TaskOrchestrator | null = null;

/**
 * Initialize the task orchestrator
 */
export function initTaskOrchestrator(options: {
  provider: AIProvider;
  model: string;
}): TaskOrchestrator {
  orchestratorInstance = new TaskOrchestrator(options);
  return orchestratorInstance;
}

/**
 * Get the task orchestrator instance
 */
export function getTaskOrchestrator(): TaskOrchestrator {
  if (!orchestratorInstance) {
    throw new Error('TaskOrchestrator not initialized. Call initTaskOrchestrator() first.');
  }
  return orchestratorInstance;
}

/**
 * Orchestrate a complex task (convenience function)
 */
export async function orchestrateTask(
  task: string,
  context?: string,
  options?: Partial<OrchestrationOptions>
): Promise<OrchestrationResult> {
  const orchestrator = getTaskOrchestrator();
  return orchestrator.orchestrate(task, context, options);
}
