import { describe, it, expect, beforeEach, vi } from 'vitest';

import { DAGScheduler } from '../scheduler';
import type { SubTask } from '../orchestration-types';

function makeTask(id: number, dependsOn: number[] = [], opts?: Partial<SubTask>): SubTask {
  return {
    id,
    description: `Task ${id}`,
    type: 'research',
    dependsOn,
    estimatedComplexity: 5,
    priority: 5,
    ...opts,
  } as SubTask;
}

describe('DAGScheduler', () => {
  let scheduler: DAGScheduler;

  beforeEach(() => {
    scheduler = new DAGScheduler(3);
  });

  describe('initialize', () => {
    it('should accept tasks without cycles', () => {
      const tasks = [makeTask(1), makeTask(2, [1]), makeTask(3, [1])];
      expect(() => scheduler.initialize(tasks)).not.toThrow();
    });

    it('should detect and throw on cycles', () => {
      const tasks = [makeTask(1, [2]), makeTask(2, [1])];
      expect(() => scheduler.initialize(tasks)).toThrow(/[Cc]ycle/);
    });

    it('should detect complex cycles', () => {
      const tasks = [makeTask(1, [3]), makeTask(2, [1]), makeTask(3, [2])];
      expect(() => scheduler.initialize(tasks)).toThrow(/[Cc]ycle/);
    });
  });

  describe('getReadyTasks', () => {
    it('should return tasks with no dependencies', () => {
      scheduler.initialize([makeTask(1), makeTask(2), makeTask(3, [1])]);
      const ready = scheduler.getReadyTasks();
      const ids = ready.map(t => t.id);
      expect(ids).toContain(1);
      expect(ids).toContain(2);
      expect(ids).not.toContain(3);
    });

    it('should return task after its dependency is completed', () => {
      scheduler.initialize([makeTask(1), makeTask(2, [1])]);
      scheduler.startTask(1);
      scheduler.completeTask(1, { success: true, output: '', tokensUsed: 0, duration: 0, id: 't1' });

      const ready = scheduler.getReadyTasks();
      expect(ready.map(t => t.id)).toContain(2);
    });

    it('should sort by priority (higher first)', () => {
      scheduler.initialize([
        makeTask(1, [], { priority: 3 }),
        makeTask(2, [], { priority: 8 }),
        makeTask(3, [], { priority: 5 }),
      ]);
      const ready = scheduler.getReadyTasks();
      expect(ready[0].id).toBe(2);
    });
  });

  describe('startTask', () => {
    it('should set task status to running', () => {
      scheduler.initialize([makeTask(1)]);
      scheduler.startTask(1);
      const state = scheduler.getTaskState(1);
      expect(state?.status).toBe('running');
    });
  });

  describe('completeTask', () => {
    it('should mark task as completed on success', () => {
      scheduler.initialize([makeTask(1)]);
      scheduler.startTask(1);
      scheduler.completeTask(1, { success: true, output: 'done', tokensUsed: 100, duration: 50, id: 't1' });
      expect(scheduler.getTaskState(1)?.status).toBe('completed');
    });

    it('should mark task as failed on failure', () => {
      scheduler.initialize([makeTask(1)]);
      scheduler.startTask(1);
      scheduler.completeTask(1, { success: false, output: '', tokensUsed: 0, duration: 0, error: 'oops', id: 't1' });
      expect(scheduler.getTaskState(1)?.status).toBe('failed');
    });
  });

  describe('failTask', () => {
    it('should set status to failed with error', () => {
      scheduler.initialize([makeTask(1)]);
      scheduler.startTask(1);
      scheduler.failTask(1, 'timeout');
      const state = scheduler.getTaskState(1);
      expect(state?.status).toBe('failed');
      expect(state?.result?.error).toBe('timeout');
    });
  });

  describe('retryTask', () => {
    it('should reset failed task to pending', () => {
      scheduler.initialize([makeTask(1)]);
      scheduler.startTask(1);
      scheduler.failTask(1, 'error');
      const retried = scheduler.retryTask(1);
      expect(retried).toBe(true);
      expect(scheduler.getTaskState(1)?.status).toBe('pending');
      expect(scheduler.getTaskState(1)?.retryCount).toBe(1);
    });

    it('should return false for non-failed task', () => {
      scheduler.initialize([makeTask(1)]);
      expect(scheduler.retryTask(1)).toBe(false);
    });
  });

  describe('skipTask', () => {
    it('should mark task as skipped', () => {
      scheduler.initialize([makeTask(1)]);
      scheduler.skipTask(1);
      expect(scheduler.getTaskState(1)?.status).toBe('skipped');
    });
  });

  describe('isComplete', () => {
    it('should return false with pending tasks', () => {
      scheduler.initialize([makeTask(1)]);
      expect(scheduler.isComplete()).toBe(false);
    });

    it('should return true when all completed', () => {
      scheduler.initialize([makeTask(1)]);
      scheduler.startTask(1);
      scheduler.completeTask(1, { success: true, output: '', tokensUsed: 0, duration: 0, id: 't1' });
      expect(scheduler.isComplete()).toBe(true);
    });

    it('should return true when all failed', () => {
      scheduler.initialize([makeTask(1)]);
      scheduler.startTask(1);
      scheduler.failTask(1, 'err');
      expect(scheduler.isComplete()).toBe(true);
    });
  });

  describe('isSuccessful', () => {
    it('should be true when all completed or skipped', () => {
      scheduler.initialize([makeTask(1), makeTask(2)]);
      scheduler.startTask(1);
      scheduler.completeTask(1, { success: true, output: '', tokensUsed: 0, duration: 0, id: 't1' });
      scheduler.skipTask(2);
      expect(scheduler.isSuccessful()).toBe(true);
    });

    it('should be false when any task failed', () => {
      scheduler.initialize([makeTask(1)]);
      scheduler.startTask(1);
      scheduler.failTask(1, 'err');
      expect(scheduler.isSuccessful()).toBe(false);
    });
  });

  describe('getProgress', () => {
    it('should return correct counts', () => {
      scheduler.initialize([makeTask(1), makeTask(2), makeTask(3, [1])]);
      scheduler.start();
      scheduler.startTask(1);
      scheduler.completeTask(1, { success: true, output: '', tokensUsed: 0, duration: 0, id: 't1' });
      scheduler.startTask(2);

      const progress = scheduler.getProgress();
      expect(progress.total).toBe(3);
      expect(progress.completed).toBe(1);
      expect(progress.running).toBe(1);
      expect(progress.pending).toBe(1);
      expect(progress.failed).toBe(0);
    });
  });

  describe('getAvailableSlots', () => {
    it('should respect max parallelism', () => {
      scheduler = new DAGScheduler(2);
      scheduler.initialize([makeTask(1), makeTask(2), makeTask(3)]);
      expect(scheduler.getAvailableSlots()).toBe(2);

      scheduler.startTask(1);
      expect(scheduler.getAvailableSlots()).toBe(1);

      scheduler.startTask(2);
      expect(scheduler.getAvailableSlots()).toBe(0);
    });
  });

  describe('getParallelizableTasks', () => {
    it('should return up to available slots', () => {
      scheduler = new DAGScheduler(2);
      scheduler.initialize([makeTask(1), makeTask(2), makeTask(3)]);
      const tasks = scheduler.getParallelizableTasks();
      expect(tasks.length).toBeLessThanOrEqual(2);
    });

    it('should return empty when no slots available', () => {
      scheduler = new DAGScheduler(1);
      scheduler.initialize([makeTask(1), makeTask(2)]);
      scheduler.startTask(1);
      expect(scheduler.getParallelizableTasks()).toEqual([]);
    });
  });

  describe('getExecutionOrder', () => {
    it('should return valid topological order', () => {
      scheduler.initialize([makeTask(1), makeTask(2, [1]), makeTask(3, [2])]);
      const order = scheduler.getExecutionOrder();
      expect(order.indexOf(1)).toBeLessThan(order.indexOf(2));
      expect(order.indexOf(2)).toBeLessThan(order.indexOf(3));
    });
  });

  describe('detectCycles', () => {
    it('should pass for acyclic graph', () => {
      scheduler.initialize([makeTask(1), makeTask(2, [1])]);
      expect(() => scheduler.detectCycles()).not.toThrow();
    });
  });
});
