/**
 * Tests for goal/store.ts
 *
 * Uses real filesystem with tmp directory for integration-style tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { GoalStore, getGoalStore, resetGoalStore } from '../store';

const TEST_DIR = join('/tmp', `goal-store-test-${Date.now()}`);

describe('GoalStore', () => {
  let store: GoalStore;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
    store = new GoalStore(TEST_DIR);
    store.init();
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  describe('init', () => {
    it('should create directory structure', () => {
      expect(existsSync(join(TEST_DIR, 'active'))).toBe(true);
      expect(existsSync(join(TEST_DIR, 'completed'))).toBe(true);
      expect(existsSync(join(TEST_DIR, 'paused'))).toBe(true);
      expect(existsSync(join(TEST_DIR, 'cancelled'))).toBe(true);
      expect(existsSync(join(TEST_DIR, 'index.json'))).toBe(true);
    });

    it('should be idempotent', () => {
      store.init(); // call again
      expect(existsSync(join(TEST_DIR, 'active'))).toBe(true);
    });
  });

  describe('getBasePath', () => {
    it('should return the base path', () => {
      expect(store.getBasePath()).toBe(TEST_DIR);
    });
  });

  describe('create', () => {
    it('should create a goal with defaults', () => {
      const result = store.create({ title: 'Test Goal' });
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.title).toBe('Test Goal');
      expect(result.data.state).toBe('active');
      expect(result.data.priority).toBe('medium');
      expect(result.data.progress).toBe(0);
      expect(result.data.id).toMatch(/^goal-/);
    });

    it('should create a goal with custom options', () => {
      const result = store.create({
        title: 'Important Goal',
        description: 'Detailed description',
        priority: 'high',
        tags: ['work', 'urgent'],
        targetDate: '2026-06-01',
      });
      expect(result.success).toBe(true);
      expect(result.data.priority).toBe('high');
      expect(result.data.tags).toEqual(['work', 'urgent']);
      expect(result.data.targetDate).toBe('2026-06-01');
    });
  });

  describe('get', () => {
    it('should return null for nonexistent goal', () => {
      expect(store.get('nonexistent')).toBeNull();
    });

    it('should retrieve a created goal', () => {
      const created = store.create({ title: 'Findable' });
      const found = store.get(created.data.id);
      expect(found).not.toBeNull();
      expect(found!.title).toBe('Findable');
    });
  });

  describe('list', () => {
    it('should return empty array when no goals', () => {
      expect(store.list()).toEqual([]);
    });

    it('should return all goals', () => {
      store.create({ title: 'A' });
      store.create({ title: 'B' });
      expect(store.list()).toHaveLength(2);
    });

    it('should filter by state', () => {
      store.create({ title: 'Active' });
      const goals = store.list({ state: 'completed' });
      expect(goals).toHaveLength(0);
    });

    it('should filter by priority', () => {
      store.create({ title: 'High', priority: 'high' });
      store.create({ title: 'Low', priority: 'low' });
      const goals = store.list({ priority: 'high' });
      expect(goals).toHaveLength(1);
      expect(goals[0].title).toBe('High');
    });

    it('should filter by search text', () => {
      store.create({ title: 'Learn TypeScript' });
      store.create({ title: 'Buy groceries' });
      const goals = store.list({ search: 'typescript' });
      expect(goals).toHaveLength(1);
    });

    it('should filter by tags', () => {
      store.create({ title: 'Tagged', tags: ['work'] });
      store.create({ title: 'Untagged' });
      const goals = store.list({ tags: ['work'] });
      expect(goals).toHaveLength(1);
      expect(goals[0].title).toBe('Tagged');
    });
  });

  describe('update', () => {
    it('should update goal properties', () => {
      const created = store.create({ title: 'Original' });
      const result = store.update(created.data.id, { title: 'Updated', progress: 50 });
      expect(result.success).toBe(true);
      expect(result.data.title).toBe('Updated');
      expect(result.data.progress).toBe(50);
    });

    it('should handle state change (active -> completed)', () => {
      const created = store.create({ title: 'To Complete' });
      const result = store.update(created.data.id, { state: 'completed' });
      expect(result.success).toBe(true);
      expect(result.data.state).toBe('completed');
      expect(result.data.progress).toBe(100);
      expect(result.data.completedAt).toBeDefined();
    });

    it('should return error for nonexistent goal', () => {
      const result = store.update('nonexistent', { title: 'Nope' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('delete', () => {
    it('should delete an existing goal', () => {
      const created = store.create({ title: 'To Delete' });
      const result = store.delete(created.data.id);
      expect(result.success).toBe(true);
      expect(store.get(created.data.id)).toBeNull();
    });

    it('should return error for nonexistent goal', () => {
      const result = store.delete('nonexistent');
      expect(result.success).toBe(false);
    });
  });

  describe('addCheckpoint', () => {
    it('should add a checkpoint to a goal', () => {
      const created = store.create({ title: 'Goal with CP' });
      const result = store.addCheckpoint(created.data.id, 'Step 1', 'First step');
      expect(result.success).toBe(true);
      expect(result.data.checkpoints).toHaveLength(1);
      expect(result.data.checkpoints[0].title).toBe('Step 1');
      expect(result.data.checkpoints[0].completed).toBe(false);
    });

    it('should return error for nonexistent goal', () => {
      const result = store.addCheckpoint('nonexistent', 'Step');
      expect(result.success).toBe(false);
    });
  });

  describe('completeCheckpoint', () => {
    it('should complete a checkpoint and update progress', () => {
      const created = store.create({ title: 'Goal' });
      const cpResult = store.addCheckpoint(created.data.id, 'Step 1');
      const cpId = cpResult.data.checkpoints[0].id;

      const result = store.completeCheckpoint(created.data.id, cpId);
      expect(result.success).toBe(true);
      expect(result.data.checkpoints[0].completed).toBe(true);
      expect(result.data.checkpoints[0].completedAt).toBeDefined();
      expect(result.data.progress).toBe(100);
    });

    it('should return error for nonexistent checkpoint', () => {
      const created = store.create({ title: 'Goal' });
      const result = store.completeCheckpoint(created.data.id, 'fake-cp-id');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Checkpoint not found');
    });
  });

  describe('decompose', () => {
    it('should create sub-goals and link to parent', () => {
      const created = store.create({ title: 'Parent Goal' });
      const result = store.decompose(created.data.id, ['Sub A', 'Sub B']);
      expect(result.success).toBe(true);
      expect(result.data.subGoalIds).toHaveLength(2);

      const parent = store.get(created.data.id);
      expect(parent!.subGoals).toHaveLength(2);
    });

    it('should return error for nonexistent parent', () => {
      const result = store.decompose('nonexistent', ['Sub']);
      expect(result.success).toBe(false);
    });
  });

  describe('getSummary', () => {
    it('should return summary counts', () => {
      store.create({ title: 'Active 1' });
      store.create({ title: 'Active 2' });
      const created3 = store.create({ title: 'To Complete' });
      store.update(created3.data.id, { state: 'completed' });

      const summary = store.getSummary();
      expect(summary.active).toBe(2);
      expect(summary.completed).toBe(1);
      expect(summary.total).toBe(3);
    });
  });
});

describe('GoalStore singleton', () => {
  afterEach(() => {
    resetGoalStore();
    const dir = join('/tmp', 'goal-singleton-test');
    if (existsSync(dir)) rmSync(dir, { recursive: true });
  });

  it('getGoalStore should create and return singleton', () => {
    const dir = join('/tmp', 'goal-singleton-test');
    const store1 = getGoalStore(dir);
    const store2 = getGoalStore();
    expect(store1).toBe(store2);
  });

  it('getGoalStore should throw without basePath if not initialized', () => {
    expect(() => getGoalStore()).toThrow('GoalStore not initialized');
  });

  it('resetGoalStore should clear singleton', () => {
    const dir = join('/tmp', 'goal-singleton-test');
    getGoalStore(dir);
    resetGoalStore();
    expect(() => getGoalStore()).toThrow('GoalStore not initialized');
  });
});
