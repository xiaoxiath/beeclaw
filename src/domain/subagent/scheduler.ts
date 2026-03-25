/**
 * DAG Scheduler - Directed Acyclic Graph Task Scheduler
 *
 * Executes tasks in dependency order with maximum parallelism
 */

import type { SubTask, SubTaskState, ExecutionProgress } from './orchestration-types';
import type { SubagentResult } from './types';

/**
 * DAG Scheduler for task execution
 */
export class DAGScheduler {
  private taskStates: Map<number, SubTaskState> = new Map();
  private startTime: number = 0;
  private maxParallelism: number;

  constructor(maxParallelism: number = 3) {
    this.maxParallelism = maxParallelism;
  }

  /**
   * Initialize scheduler with subtasks
   */
  initialize(subtasks: SubTask[]): void {
    this.taskStates.clear();

    for (const subtask of subtasks) {
      this.taskStates.set(subtask.id, {
        subtask,
        status: 'pending',
        retryCount: 0,
      });
    }

    // Validate the dependency graph has no cycles before scheduling
    this.detectCycles();
  }

  /**
   * Get tasks that are ready to execute (all dependencies completed)
   */
  getReadyTasks(): SubTask[] {
    const ready: SubTask[] = [];

    for (const [_id, state] of this.taskStates) {
      if (state.status !== 'pending') {
        continue;
      }

      // Check if all dependencies are completed
      const depsCompleted = state.subtask.dependsOn.every(depId => {
        const depState = this.taskStates.get(depId);
        return depState && depState.status === 'completed';
      });

      if (depsCompleted) {
        ready.push(state.subtask);
      }
    }

    // Sort by priority (if set) and complexity
    ready.sort((a, b) => {
      const priorityA = a.priority || 5;
      const priorityB = b.priority || 5;
      if (priorityA !== priorityB) {
        return priorityB - priorityA; // Higher priority first
      }

      const complexityA = a.estimatedComplexity || 5;
      const complexityB = b.estimatedComplexity || 5;
      return complexityA - complexityB; // Lower complexity first
    });

    return ready;
  }

  /**
   * Get currently running tasks
   */
  getRunningTasks(): SubTask[] {
    const running: SubTask[] = [];

    for (const state of this.taskStates.values()) {
      if (state.status === 'running') {
        running.push(state.subtask);
      }
    }

    return running;
  }

  /**
   * Start a task
   */
  startTask(taskId: number): void {
    const state = this.taskStates.get(taskId);
    if (state && state.status === 'pending') {
      state.status = 'running';
      state.startedAt = new Date();
    }
  }

  /**
   * Complete a task
   */
  completeTask(taskId: number, result: SubagentResult): void {
    const state = this.taskStates.get(taskId);
    if (state) {
      state.status = result.success ? 'completed' : 'failed';
      state.result = result;
      state.completedAt = new Date();
    }
  }

  /**
   * Fail a task
   */
  failTask(taskId: number, error: string): void {
    const state = this.taskStates.get(taskId);
    if (state) {
      state.status = 'failed';
      state.result = {
        success: false,
        output: '',
        tokensUsed: 0,
        duration: 0,
        error,
        id: `task-${taskId}`,
      };
      state.completedAt = new Date();
    }
  }

  /**
   * Retry a failed task
   */
  retryTask(taskId: number): boolean {
    const state = this.taskStates.get(taskId);
    if (state && state.status === 'failed') {
      state.status = 'pending';
      state.result = undefined;
      state.startedAt = undefined;
      state.completedAt = undefined;
      state.retryCount++;
      return true;
    }
    return false;
  }

  /**
   * Skip a task
   */
  skipTask(taskId: number): void {
    const state = this.taskStates.get(taskId);
    if (state) {
      state.status = 'skipped';
      state.completedAt = new Date();
    }
  }

  /**
   * Check if all tasks are done
   */
  isComplete(): boolean {
    for (const state of this.taskStates.values()) {
      if (state.status === 'pending' || state.status === 'running') {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if all tasks succeeded
   */
  isSuccessful(): boolean {
    for (const state of this.taskStates.values()) {
      if (state.status !== 'completed' && state.status !== 'skipped') {
        return false;
      }
    }
    return true;
  }

  /**
   * Get current execution progress
   */
  getProgress(): ExecutionProgress {
    const total = this.taskStates.size;
    let completed = 0;
    let failed = 0;
    let running = 0;
    let pending = 0;

    for (const state of this.taskStates.values()) {
      switch (state.status) {
        case 'completed':
          completed++;
          break;
        case 'failed':
          failed++;
          break;
        case 'running':
          running++;
          break;
        case 'pending':
          pending++;
          break;
      }
    }

    const elapsedMs = Date.now() - this.startTime;

    // Estimate remaining time based on completed tasks
    let estimatedRemainingMs: number | undefined;
    if (completed > 0 && elapsedMs > 0) {
      const avgTimePerTask = elapsedMs / completed;
      estimatedRemainingMs = avgTimePerTask * (total - completed);
    }

    return {
      total,
      completed,
      failed,
      running,
      pending,
      parallelism: running,
      elapsedMs,
      estimatedRemainingMs,
    };
  }

  /**
   * Get all task states
   */
  getTaskStates(): Map<number, SubTaskState> {
    return new Map(this.taskStates);
  }

  /**
   * Get a specific task state
   */
  getTaskState(taskId: number): SubTaskState | undefined {
    return this.taskStates.get(taskId);
  }

  /**
   * Start timing
   */
  start(): void {
    this.startTime = Date.now();
  }

  /**
   * Get available parallelism slots
   */
  getAvailableSlots(): number {
    const running = this.getRunningTasks().length;
    return Math.max(0, this.maxParallelism - running);
  }

  /**
   * Get tasks that can be run in parallel (respecting max parallelism)
   */
  getParallelizableTasks(): SubTask[] {
    const availableSlots = this.getAvailableSlots();
    if (availableSlots === 0) {
      return [];
    }

    const readyTasks = this.getReadyTasks();
    return readyTasks.slice(0, availableSlots);
  }

  /**
   * Get failed tasks
   */
  getFailedTasks(): SubTaskState[] {
    const failed: SubTaskState[] = [];
    for (const state of this.taskStates.values()) {
      if (state.status === 'failed') {
        failed.push(state);
      }
    }
    return failed;
  }

  /**
   * Detect cycles in the dependency graph using Kahn's algorithm (BFS topological sort).
   * Throws an error with details about the cycle if one is found.
   */
  detectCycles(): void {
    // Build in-degree map and adjacency list
    const inDegree = new Map<number, number>();
    const dependents = new Map<number, number[]>(); // taskId -> tasks that depend on it

    for (const [taskId, state] of this.taskStates) {
      if (!inDegree.has(taskId)) {
        inDegree.set(taskId, 0);
      }
      if (!dependents.has(taskId)) {
        dependents.set(taskId, []);
      }

      for (const depId of state.subtask.dependsOn) {
        inDegree.set(taskId, (inDegree.get(taskId) || 0) + 1);
        if (!dependents.has(depId)) {
          dependents.set(depId, []);
        }
        dependents.get(depId)!.push(taskId);
      }
    }

    // Kahn's algorithm: start with nodes that have 0 in-degree
    const queue: number[] = [];
    for (const [taskId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(taskId);
      }
    }

    let processedCount = 0;
    while (queue.length > 0) {
      const taskId = queue.shift()!;
      processedCount++;

      for (const dependent of dependents.get(taskId) || []) {
        const newDegree = (inDegree.get(dependent) || 1) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) {
          queue.push(dependent);
        }
      }
    }

    // If we couldn't process all nodes, there is a cycle
    if (processedCount !== this.taskStates.size) {
      const cycleTasks: string[] = [];
      for (const [taskId, degree] of inDegree) {
        if (degree > 0) {
          const state = this.taskStates.get(taskId);
          const desc = state ? state.subtask.description.substring(0, 60) : 'unknown';
          cycleTasks.push(`Task ${taskId} ("${desc}")`);
        }
      }
      throw new Error(
        `Cycle detected in task dependency graph. The following tasks are involved in circular dependencies: ${cycleTasks.join(', ')}. ` +
        `Please remove circular dependsOn references to create a valid DAG.`
      );
    }
  }

  /**
   * Get execution order (topological sort)
   */
  getExecutionOrder(): number[] {
    const order: number[] = [];
    const visited = new Set<number>();
    const visiting = new Set<number>(); // Track nodes in current DFS path for cycle detection

    const visit = (taskId: number) => {
      if (visited.has(taskId)) {
        return;
      }

      if (visiting.has(taskId)) {
        throw new Error(`Cycle detected in task dependencies involving Task ${taskId}`);
      }

      visiting.add(taskId);

      const state = this.taskStates.get(taskId);
      if (state) {
        // Visit dependencies first
        for (const depId of state.subtask.dependsOn) {
          visit(depId);
        }
      }

      visiting.delete(taskId);
      visited.add(taskId);
      order.push(taskId);
    };

    for (const taskId of this.taskStates.keys()) {
      visit(taskId);
    }

    return order;
  }

  /**
   * Get task dependency graph (for debugging)
   */
  getDependencyGraph(): string {
    const lines: string[] = ['Task Dependency Graph:', ''];

    for (const state of this.taskStates.values()) {
      const deps = state.subtask.dependsOn;
      const depsStr = deps.length > 0 ? deps.join(', ') : 'none';
      const statusEmoji = {
        pending: '⏳',
        running: '▶️',
        completed: '✅',
        failed: '❌',
        skipped: '⏭️',
      }[state.status];

      lines.push(`${statusEmoji} Task ${state.subtask.id}: ${state.subtask.description.substring(0, 50)}...`);
      lines.push(`   Type: ${state.subtask.type} | Dependencies: ${depsStr} | Status: ${state.status}`);
      lines.push('');
    }

    return lines.join('\n');
  }
}
