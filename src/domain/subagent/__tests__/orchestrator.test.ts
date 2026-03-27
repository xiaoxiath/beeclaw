/**
 * Task Orchestrator Tests
 *
 * Unit tests for task decomposition and orchestration
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { DAGScheduler } from '../scheduler';
import { validateDependencies, createSequentialDecomposition, createParallelDecomposition } from '../decompose';
import type { SubTask, TaskDecomposition } from '../orchestration-types';

describe('DAGScheduler', () => {
  let scheduler: DAGScheduler;

  beforeEach(() => {
    scheduler = new DAGScheduler(3); // maxParallelism = 3
  });

  describe('Initialization', () => {
    test('should initialize with subtasks', () => {
      const subtasks: SubTask[] = [
        { id: 0, type: 'research', description: 'Task 1', parallel: true, dependsOn: [] },
        { id: 1, type: 'memory', description: 'Task 2', parallel: false, dependsOn: [0] },
      ];

      scheduler.initialize(subtasks);

      const progress = scheduler.getProgress();
      expect(progress.total).toBe(2);
      expect(progress.pending).toBe(2);
    });

    test('should track task states', () => {
      const subtasks: SubTask[] = [
        { id: 0, type: 'research', description: 'Task 1', parallel: true, dependsOn: [] },
      ];

      scheduler.initialize(subtasks);

      const ready = scheduler.getReadyTasks();
      expect(ready.length).toBe(1);
      expect(ready[0].id).toBe(0);
    });
  });

  describe('Dependency Resolution', () => {
    test('should identify ready tasks (no dependencies)', () => {
      const subtasks: SubTask[] = [
        { id: 0, type: 'research', description: 'Task 1', parallel: true, dependsOn: [] },
        { id: 1, type: 'research', description: 'Task 2', parallel: true, dependsOn: [] },
        { id: 2, type: 'memory', description: 'Task 3', parallel: false, dependsOn: [0, 1] },
      ];

      scheduler.initialize(subtasks);

      const ready = scheduler.getReadyTasks();
      expect(ready.length).toBe(2);
    });

    test('should not return dependent tasks as ready', () => {
      const subtasks: SubTask[] = [
        { id: 0, type: 'research', description: 'Task 1', parallel: true, dependsOn: [] },
        { id: 1, type: 'memory', description: 'Task 2', parallel: false, dependsOn: [0] },
      ];

      scheduler.initialize(subtasks);

      const ready = scheduler.getReadyTasks();
      expect(ready.length).toBe(1);
      expect(ready[0].id).toBe(0);
    });

    test('should make task ready after dependencies complete', () => {
      const subtasks: SubTask[] = [
        { id: 0, type: 'research', description: 'Task 1', parallel: true, dependsOn: [] },
        { id: 1, type: 'memory', description: 'Task 2', parallel: false, dependsOn: [0] },
      ];

      scheduler.initialize(subtasks);

      // Initially only task 0 is ready
      expect(scheduler.getReadyTasks().length).toBe(1);

      // Complete task 0
      scheduler.startTask(0);
      scheduler.completeTask(0, {
        success: true,
        output: 'Result',
        tokensUsed: 0,
        duration: 100,
        id: 'test',
      });

      // Now task 1 should be ready
      const ready = scheduler.getReadyTasks();
      expect(ready.length).toBe(1);
      expect(ready[0].id).toBe(1);
    });
  });

  describe('Parallel Execution', () => {
    test('should limit parallelism', () => {
      const limitedScheduler = new DAGScheduler(2); // maxParallelism = 2

      const subtasks: SubTask[] = [
        { id: 0, type: 'research', description: 'Task 1', parallel: true, dependsOn: [] },
        { id: 1, type: 'research', description: 'Task 2', parallel: true, dependsOn: [] },
        { id: 2, type: 'research', description: 'Task 3', parallel: true, dependsOn: [] },
      ];

      limitedScheduler.initialize(subtasks);

      const parallelizable = limitedScheduler.getParallelizableTasks();
      expect(parallelizable.length).toBe(2); // Limited to 2
    });

    test('should return all ready tasks if under limit', () => {
      const subtasks: SubTask[] = [
        { id: 0, type: 'research', description: 'Task 1', parallel: true, dependsOn: [] },
        { id: 1, type: 'research', description: 'Task 2', parallel: true, dependsOn: [] },
      ];

      scheduler.initialize(subtasks);

      const parallelizable = scheduler.getParallelizableTasks();
      expect(parallelizable.length).toBe(2);
    });

    test('should account for running tasks', () => {
      const subtasks: SubTask[] = [
        { id: 0, type: 'research', description: 'Task 1', parallel: true, dependsOn: [] },
        { id: 1, type: 'research', description: 'Task 2', parallel: true, dependsOn: [] },
        { id: 2, type: 'research', description: 'Task 3', parallel: true, dependsOn: [] },
      ];

      scheduler.initialize(subtasks);

      // Start task 0
      scheduler.startTask(0);

      // Now only 2 more can run (maxParallelism = 3, 1 running)
      const parallelizable = scheduler.getParallelizableTasks();
      expect(parallelizable.length).toBe(2);
    });
  });

  describe('Task Lifecycle', () => {
    test('should track task status', () => {
      const subtasks: SubTask[] = [
        { id: 0, type: 'research', description: 'Task 1', parallel: true, dependsOn: [] },
      ];

      scheduler.initialize(subtasks);

      // Initially pending
      let progress = scheduler.getProgress();
      expect(progress.pending).toBe(1);

      // Start task
      scheduler.startTask(0);
      progress = scheduler.getProgress();
      expect(progress.running).toBe(1);
      expect(progress.pending).toBe(0);

      // Complete task
      scheduler.completeTask(0, {
        success: true,
        output: 'Result',
        tokensUsed: 0,
        duration: 100,
        id: 'test',
      });
      progress = scheduler.getProgress();
      expect(progress.completed).toBe(1);
      expect(progress.running).toBe(0);
    });

    test('should handle task failure', () => {
      const subtasks: SubTask[] = [
        { id: 0, type: 'research', description: 'Task 1', parallel: true, dependsOn: [] },
      ];

      scheduler.initialize(subtasks);

      scheduler.startTask(0);
      scheduler.failTask(0, 'Test error');

      const progress = scheduler.getProgress();
      expect(progress.failed).toBe(1);
    });

    test('should support retry', () => {
      const subtasks: SubTask[] = [
        { id: 0, type: 'research', description: 'Task 1', parallel: true, dependsOn: [] },
      ];

      scheduler.initialize(subtasks);

      scheduler.startTask(0);
      scheduler.failTask(0, 'Error');

      let progress = scheduler.getProgress();
      expect(progress.failed).toBe(1);

      // Retry
      const retried = scheduler.retryTask(0);
      expect(retried).toBe(true);

      progress = scheduler.getProgress();
      expect(progress.pending).toBe(1);
      expect(progress.failed).toBe(0);
    });

    test('should not retry non-failed tasks', () => {
      const subtasks: SubTask[] = [
        { id: 0, type: 'research', description: 'Task 1', parallel: true, dependsOn: [] },
      ];

      scheduler.initialize(subtasks);

      const retried = scheduler.retryTask(0);
      expect(retried).toBe(false);
    });
  });

  describe('Completion Tracking', () => {
    test('should detect when all tasks complete', () => {
      const subtasks: SubTask[] = [
        { id: 0, type: 'research', description: 'Task 1', parallel: true, dependsOn: [] },
      ];

      scheduler.initialize(subtasks);

      expect(scheduler.isComplete()).toBe(false);

      scheduler.startTask(0);
      scheduler.completeTask(0, {
        success: true,
        output: 'Result',
        tokensUsed: 0,
        duration: 100,
        id: 'test',
      });

      expect(scheduler.isComplete()).toBe(true);
    });

    test('should detect when some tasks failed', () => {
      const subtasks: SubTask[] = [
        { id: 0, type: 'research', description: 'Task 1', parallel: true, dependsOn: [] },
      ];

      scheduler.initialize(subtasks);

      scheduler.startTask(0);
      scheduler.failTask(0, 'Error');

      expect(scheduler.isComplete()).toBe(true);
    });

    test('should not complete while tasks running', () => {
      const subtasks: SubTask[] = [
        { id: 0, type: 'research', description: 'Task 1', parallel: true, dependsOn: [] },
      ];

      scheduler.initialize(subtasks);
      scheduler.startTask(0);

      expect(scheduler.isComplete()).toBe(false);
    });
  });

  describe('Topological Sort', () => {
    test('should return valid execution order', () => {
      const subtasks: SubTask[] = [
        { id: 0, type: 'research', description: 'Task 1', parallel: true, dependsOn: [] },
        { id: 1, type: 'research', description: 'Task 2', parallel: true, dependsOn: [] },
        { id: 2, type: 'memory', description: 'Task 3', parallel: false, dependsOn: [0, 1] },
      ];

      scheduler.initialize(subtasks);

      const order = scheduler.getExecutionOrder();

      // Task 2 should come after tasks 0 and 1
      const idx0 = order.indexOf(0);
      const idx1 = order.indexOf(1);
      const idx2 = order.indexOf(2);

      expect(idx0).toBeLessThan(idx2);
      expect(idx1).toBeLessThan(idx2);
    });

    test('should handle sequential dependencies', () => {
      const subtasks: SubTask[] = [
        { id: 0, type: 'research', description: 'Task 1', parallel: true, dependsOn: [] },
        { id: 1, type: 'memory', description: 'Task 2', parallel: false, dependsOn: [0] },
        { id: 2, type: 'skill', description: 'Task 3', parallel: false, dependsOn: [1] },
      ];

      scheduler.initialize(subtasks);

      const order = scheduler.getExecutionOrder();

      expect(order).toEqual([0, 1, 2]);
    });
  });

  describe('Progress Tracking', () => {
    test('should calculate progress correctly', () => {
      const subtasks: SubTask[] = [
        { id: 0, type: 'research', description: 'Task 1', parallel: true, dependsOn: [] },
        { id: 1, type: 'research', description: 'Task 2', parallel: true, dependsOn: [] },
        { id: 2, type: 'memory', description: 'Task 3', parallel: false, dependsOn: [0, 1] },
      ];

      scheduler.initialize(subtasks);

      let progress = scheduler.getProgress();
      expect(progress.total).toBe(3);
      expect(progress.pending).toBe(3);

      scheduler.startTask(0);
      progress = scheduler.getProgress();
      expect(progress.running).toBe(1);
      expect(progress.pending).toBe(2);

      scheduler.completeTask(0, {
        success: true,
        output: 'R1',
        tokensUsed: 0,
        duration: 100,
        id: 'test',
      });
      progress = scheduler.getProgress();
      expect(progress.completed).toBe(1);
    });

    test('should track elapsed time', () => {
      const subtasks: SubTask[] = [
        { id: 0, type: 'research', description: 'Task 1', parallel: true, dependsOn: [] },
      ];

      scheduler.initialize(subtasks);

      const progress = scheduler.getProgress();
      expect(progress.elapsedMs).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('Dependency Validation', () => {
  test('should accept valid dependencies', () => {
    const subtasks: SubTask[] = [
      { id: 0, type: 'research', description: 'Task 1', parallel: true, dependsOn: [] },
      { id: 1, type: 'memory', description: 'Task 2', parallel: false, dependsOn: [0] },
    ];

    expect(() => validateDependencies(subtasks)).not.toThrow();
  });

  test('should detect circular dependencies', () => {
    const subtasks: SubTask[] = [
      { id: 0, type: 'research', description: 'Task 1', parallel: true, dependsOn: [1] },
      { id: 1, type: 'memory', description: 'Task 2', parallel: false, dependsOn: [0] },
    ];

    expect(() => validateDependencies(subtasks)).toThrow('Circular');
  });

  test('should detect self-dependencies', () => {
    const subtasks: SubTask[] = [
      { id: 0, type: 'research', description: 'Task 1', parallel: true, dependsOn: [0] },
    ];

    expect(() => validateDependencies(subtasks)).toThrow();
  });

  test('should detect complex circular dependencies', () => {
    const subtasks: SubTask[] = [
      { id: 0, type: 'research', description: 'Task 1', parallel: true, dependsOn: [2] },
      { id: 1, type: 'memory', description: 'Task 2', parallel: false, dependsOn: [0] },
      { id: 2, type: 'skill', description: 'Task 3', parallel: false, dependsOn: [1] },
    ];

    expect(() => validateDependencies(subtasks)).toThrow('Circular');
  });

  test('should accept independent tasks', () => {
    const subtasks: SubTask[] = [
      { id: 0, type: 'research', description: 'Task 1', parallel: true, dependsOn: [] },
      { id: 1, type: 'research', description: 'Task 2', parallel: true, dependsOn: [] },
      { id: 2, type: 'research', description: 'Task 3', parallel: true, dependsOn: [] },
    ];

    expect(() => validateDependencies(subtasks)).not.toThrow();
  });
});

describe('Decomposition Helpers', () => {
  test('should create sequential decomposition', () => {
    const task = 'Complex task';
    const steps = ['Step 1', 'Step 2', 'Step 3'];

    const decomposition = createSequentialDecomposition(task, steps);

    expect(decomposition.originalTask).toBe(task);
    expect(decomposition.subtasks.length).toBe(3);
    expect(decomposition.strategy).toBe('sequential');

    // Check dependencies
    expect(decomposition.subtasks[0].dependsOn).toEqual([]);
    expect(decomposition.subtasks[1].dependsOn).toEqual([0]);
    expect(decomposition.subtasks[2].dependsOn).toEqual([1]);
  });

  test('should create parallel decomposition', () => {
    const task = 'Parallel task';
    const subtaskDescriptions = [
      { type: 'research' as const, description: 'Task 1' },
      { type: 'memory' as const, description: 'Task 2' },
      { type: 'skill' as const, description: 'Task 3' },
    ];

    const decomposition = createParallelDecomposition(task, subtaskDescriptions);

    expect(decomposition.originalTask).toBe(task);
    expect(decomposition.subtasks.length).toBe(3);
    expect(decomposition.strategy).toBe('parallel');

    // All should be independent
    for (const subtask of decomposition.subtasks) {
      expect(subtask.dependsOn).toEqual([]);
      expect(subtask.parallel).toBe(true);
    }
  });

  test('should calculate total complexity', () => {
    const task = 'Task';
    const steps = ['S1', 'S2'];

    const decomposition = createSequentialDecomposition(task, steps);

    expect(decomposition.totalComplexity).toBeGreaterThan(0);
  });

  test('should estimate max parallelism', () => {
    const task = 'Task';
    const subtaskDescriptions = [
      { type: 'research' as const, description: 'T1' },
      { type: 'memory' as const, description: 'T2' },
    ];

    const decomposition = createParallelDecomposition(task, subtaskDescriptions);

    expect(decomposition.maxParallelism).toBeGreaterThan(0);
  });
});

describe('TaskDecomposition', () => {
  test('should have required properties', () => {
    const decomposition: TaskDecomposition = {
      originalTask: 'Test task',
      subtasks: [
        { id: 0, type: 'research', description: 'Subtask', parallel: true, dependsOn: [] },
      ],
      strategy: 'parallel',
      reasoning: 'Test reasoning',
      totalComplexity: 1,
      maxParallelism: 1,
    };

    expect(decomposition.originalTask).toBeDefined();
    expect(decomposition.subtasks).toBeDefined();
    expect(decomposition.strategy).toBeDefined();
    expect(decomposition.reasoning).toBeDefined();
  });

  test('should support different strategies', () => {
    const strategies: Array<'sequential' | 'parallel' | 'mixed'> = [
      'sequential',
      'parallel',
      'mixed',
    ];

    for (const strategy of strategies) {
      const decomposition: TaskDecomposition = {
        originalTask: 'Task',
        subtasks: [],
        strategy,
        reasoning: 'Test',
        totalComplexity: 1,
        maxParallelism: 1,
      };

      expect(decomposition.strategy).toBe(strategy);
    }
  });
});
