import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { GoalStore, getGoalStore, resetGoalStore } from '../store';
import { executeGoalTool } from '../tools';
import type { CreateGoalOptions } from '../types';

const TEST_GOAL_PATH = './test-goal-data';

describe('GoalStore', () => {
  let store: GoalStore;

  beforeEach(() => {
    if (existsSync(TEST_GOAL_PATH)) {
      rmSync(TEST_GOAL_PATH, { recursive: true });
    }
    resetGoalStore();
    store = getGoalStore(TEST_GOAL_PATH);
  });

  afterEach(() => {
    if (existsSync(TEST_GOAL_PATH)) {
      rmSync(TEST_GOAL_PATH, { recursive: true });
    }
  });

  describe('init', () => {
    test('creates directory structure', () => {
      expect(existsSync(join(TEST_GOAL_PATH, 'active'))).toBe(true);
      expect(existsSync(join(TEST_GOAL_PATH, 'completed'))).toBe(true);
      expect(existsSync(join(TEST_GOAL_PATH, 'paused'))).toBe(true);
      expect(existsSync(join(TEST_GOAL_PATH, 'cancelled'))).toBe(true);
    });

    test('creates index file', () => {
      expect(existsSync(join(TEST_GOAL_PATH, 'index.json'))).toBe(true);
    });
  });

  describe('create', () => {
    test('creates a goal with required fields', () => {
      const options: CreateGoalOptions = {
        title: 'Test Goal',
      };

      const result = store.create(options);

      expect(result.success).toBe(true);
      expect(result.data?.title).toBe('Test Goal');
      expect(result.data?.state).toBe('active');
      expect(result.data?.priority).toBe('medium');
      expect(result.data?.progress).toBe(0);
      expect(result.data?.id).toBeDefined();
      expect(result.data?.createdAt).toBeDefined();
      expect(result.data?.updatedAt).toBeDefined();
    });

    test('creates a goal with all options', () => {
      const options: CreateGoalOptions = {
        title: 'Complete Goal',
        description: 'A detailed description',
        priority: 'high',
        targetDate: '2026-03-15',
        tags: ['work', 'urgent'],
        context: {
          why: 'Important for project',
          relatedFacts: [],
          constraints: [],
        },
      };

      const result = store.create(options);

      expect(result.success).toBe(true);
      expect(result.data?.title).toBe('Complete Goal');
      expect(result.data?.description).toBe('A detailed description');
      expect(result.data?.priority).toBe('high');
      expect(result.data?.targetDate).toBe('2026-03-15');
      expect(result.data?.tags).toEqual(['work', 'urgent']);
      expect(result.data?.context?.why).toBe('Important for project');
    });

    test('creates goal in active directory', () => {
      const result = store.create({ title: 'Test' });
      expect(result.success).toBe(true);
      expect(result.data?.id).toBeDefined();

      const goalPath = join(TEST_GOAL_PATH, 'active', `${result.data!.id}.json`);
      expect(existsSync(goalPath)).toBe(true);
    });

    test('generates unique IDs', () => {
      const result1 = store.create({ title: 'Goal 1' });
      const result2 = store.create({ title: 'Goal 2' });

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.data?.id).not.toBe(result2.data?.id);
    });
  });

  describe('get', () => {
    test('returns goal by ID', () => {
      const createResult = store.create({ title: 'Find Me' });
      expect(createResult.success).toBe(true);
      expect(createResult.data?.id).toBeDefined();

      const goal = store.get(createResult.data!.id);
      expect(goal).not.toBeNull();
      expect(goal?.title).toBe('Find Me');
    });

    test('returns null for non-existent goal', () => {
      const goal = store.get('non-existent-id');
      expect(goal).toBeNull();
    });

    test('finds goal in any state directory', () => {
      const createResult = store.create({ title: 'Move Me' });
      expect(createResult.success).toBe(true);
      expect(createResult.data?.id).toBeDefined();

      const goalId = createResult.data!.id;
      store.update(goalId, { state: 'completed' });

      const goal = store.get(goalId);
      expect(goal).not.toBeNull();
      expect(goal?.state).toBe('completed');
    });
  });

  describe('list', () => {
    test('lists all goals', () => {
      store.create({ title: 'Goal 1' });
      store.create({ title: 'Goal 2' });
      store.create({ title: 'Goal 3' });

      const goals = store.list();
      expect(goals.length).toBe(3);
    });

    test('filters by state', () => {
      const result1 = store.create({ title: 'Active 1' });
      const result2 = store.create({ title: 'Active 2' });
      store.create({ title: 'To Complete' });

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      if (result1.data && result2.data) {
        store.update(result1.data.id, { state: 'paused' });
        store.update(result2.data.id, { state: 'completed' });
      }

      const activeGoals = store.list({ state: 'active' });
      expect(activeGoals.length).toBe(1);
      expect(activeGoals[0].title).toBe('To Complete');

      const pausedGoals = store.list({ state: 'paused' });
      expect(pausedGoals.length).toBe(1);
    });

    test('filters by priority', () => {
      store.create({ title: 'Low', priority: 'low' });
      store.create({ title: 'High', priority: 'high' });
      store.create({ title: 'Critical', priority: 'critical' });

      const criticalGoals = store.list({ priority: 'critical' });
      expect(criticalGoals.length).toBe(1);
      expect(criticalGoals[0].title).toBe('Critical');
    });

    test('filters by tags', () => {
      store.create({ title: 'Work Goal', tags: ['work'] });
      store.create({ title: 'Personal Goal', tags: ['personal'] });
      store.create({ title: 'Both', tags: ['work', 'personal'] });

      const workGoals = store.list({ tags: ['work'] });
      expect(workGoals.length).toBe(2);
    });

    test('searches in title and description', () => {
      store.create({ title: 'Build API', description: 'Create REST endpoints' });
      store.create({ title: 'Write Tests', description: 'Unit and integration tests' });
      store.create({ title: 'Deploy', description: 'Deploy to production' });

      const results = store.list({ search: 'API' });
      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Build API');

      const testResults = store.list({ search: 'tests' });
      expect(testResults.length).toBe(1);
    });

    test('sorts by priority then updatedAt', () => {
      store.create({ title: 'Low Goal', priority: 'low' });
      store.create({ title: 'Critical Goal', priority: 'critical' });
      store.create({ title: 'Medium Goal', priority: 'medium' });
      store.create({ title: 'High Goal', priority: 'high' });

      const goals = store.list();

      expect(goals[0].priority).toBe('critical');
      expect(goals[1].priority).toBe('high');
      expect(goals[2].priority).toBe('medium');
      expect(goals[3].priority).toBe('low');
    });
  });

  describe('update', () => {
    test('updates goal fields', () => {
      const createResult = store.create({ title: 'Original' });
      expect(createResult.success).toBe(true);
      expect(createResult.data?.id).toBeDefined();

      const updateResult = store.update(createResult.data!.id, {
        title: 'Updated',
        description: 'New description',
        priority: 'high',
        progress: 50,
      });

      expect(updateResult.success).toBe(true);
      expect(updateResult.data?.title).toBe('Updated');
      expect(updateResult.data?.description).toBe('New description');
      expect(updateResult.data?.priority).toBe('high');
      expect(updateResult.data?.progress).toBe(50);
    });

    test('moves goal to new state directory', () => {
      const createResult = store.create({ title: 'To Complete' });
      expect(createResult.success).toBe(true);
      expect(createResult.data?.id).toBeDefined();

      const goalId = createResult.data!.id;
      expect(existsSync(join(TEST_GOAL_PATH, 'active', `${goalId}.json`))).toBe(true);

      store.update(goalId, { state: 'completed' });

      expect(existsSync(join(TEST_GOAL_PATH, 'active', `${goalId}.json`))).toBe(false);
      expect(existsSync(join(TEST_GOAL_PATH, 'completed', `${goalId}.json`))).toBe(true);
    });

    test('sets completedAt when state is completed', () => {
      const createResult = store.create({ title: 'To Complete' });
      expect(createResult.success).toBe(true);
      expect(createResult.data?.id).toBeDefined();

      const updateResult = store.update(createResult.data!.id, { state: 'completed' });

      expect(updateResult.success).toBe(true);
      expect(updateResult.data?.completedAt).toBeDefined();
      expect(updateResult.data?.progress).toBe(100);
    });

    test('returns error for non-existent goal', () => {
      const result = store.update('non-existent', { title: 'New Title' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('preserves unspecified fields', () => {
      const createResult = store.create({
        title: 'Original',
        description: 'Original desc',
        priority: 'high',
      });
      expect(createResult.success).toBe(true);
      expect(createResult.data?.id).toBeDefined();

      const updateResult = store.update(createResult.data!.id, { title: 'New Title' });

      expect(updateResult.success).toBe(true);
      expect(updateResult.data?.title).toBe('New Title');
      expect(updateResult.data?.description).toBe('Original desc');
      expect(updateResult.data?.priority).toBe('high');
    });
  });

  describe('delete', () => {
    test('deletes an existing goal', () => {
      const createResult = store.create({ title: 'To Delete' });
      expect(createResult.success).toBe(true);
      expect(createResult.data?.id).toBeDefined();

      const goalId = createResult.data!.id;
      const deleteResult = store.delete(goalId);
      expect(deleteResult.success).toBe(true);

      expect(store.get(goalId)).toBeNull();
    });

    test('returns error for non-existent goal', () => {
      const result = store.delete('non-existent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('removes from index', () => {
      const createResult = store.create({ title: 'To Delete' });
      expect(createResult.success).toBe(true);
      expect(createResult.data?.id).toBeDefined();

      const goalId = createResult.data!.id;
      store.delete(goalId);

      const summary = store.getSummary();
      expect(summary.total).toBe(0);
    });
  });

  describe('addCheckpoint', () => {
    test('adds a checkpoint to goal', () => {
      const createResult = store.create({ title: 'Goal with Checkpoint' });
      expect(createResult.success).toBe(true);
      expect(createResult.data?.id).toBeDefined();

      const result = store.addCheckpoint(createResult.data!.id, 'First milestone', 'Details');

      expect(result.success).toBe(true);
      expect(result.data?.checkpoints?.length).toBe(1);
      expect(result.data?.checkpoints?.[0].title).toBe('First milestone');
      expect(result.data?.checkpoints?.[0].description).toBe('Details');
      expect(result.data?.checkpoints?.[0].completed).toBe(false);
    });

    test('returns error for non-existent goal', () => {
      const result = store.addCheckpoint('non-existent', 'Checkpoint');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('generates checkpoint ID', () => {
      const createResult = store.create({ title: 'Goal' });
      expect(createResult.success).toBe(true);
      expect(createResult.data?.id).toBeDefined();

      const result = store.addCheckpoint(createResult.data!.id, 'Checkpoint');

      expect(result.success).toBe(true);
      expect(result.data?.checkpoints?.[0].id).toBeDefined();
    });
  });

  describe('completeCheckpoint', () => {
    test('marks checkpoint as completed', () => {
      const createResult = store.create({ title: 'Goal' });
      expect(createResult.success).toBe(true);
      expect(createResult.data?.id).toBeDefined();

      const goalId = createResult.data!.id;
      store.addCheckpoint(goalId, 'Checkpoint');
      const goal = store.get(goalId);
      const checkpointId = goal?.checkpoints?.[0]?.id;

      const result = store.completeCheckpoint(goalId, checkpointId!);

      expect(result.success).toBe(true);
      expect(result.data?.checkpoints?.[0]?.completed).toBe(true);
      expect(result.data?.checkpoints?.[0]?.completedAt).toBeDefined();
    });

    test('updates progress', () => {
      const createResult = store.create({ title: 'Goal' });
      expect(createResult.success).toBe(true);
      expect(createResult.data?.id).toBeDefined();

      const goalId = createResult.data!.id;
      store.addCheckpoint(goalId, 'C1');
      store.addCheckpoint(goalId, 'C2');

      const goal = store.get(goalId);
      const checkpointId = goal?.checkpoints?.[0]?.id;

      store.completeCheckpoint(goalId, checkpointId!);

      const updatedGoal = store.get(goalId);
      expect(updatedGoal?.progress).toBe(50);
    });

    test('returns error for non-existent checkpoint', () => {
      const createResult = store.create({ title: 'Goal' });
      expect(createResult.success).toBe(true);
      expect(createResult.data?.id).toBeDefined();

      const result = store.completeCheckpoint(createResult.data!.id, 'non-existent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('decompose', () => {
    test('creates sub-goals from parent', () => {
      const createResult = store.create({ title: 'Parent Goal', priority: 'high' });
      expect(createResult.success).toBe(true);
      expect(createResult.data?.id).toBeDefined();

      const result = store.decompose(createResult.data!.id, ['Sub 1', 'Sub 2', 'Sub 3']);

      expect(result.success).toBe(true);
      const data = result.data as { parentGoal: typeof createResult.data; subGoalIds: string[] };
      expect(data.subGoalIds.length).toBe(3);
      expect(data.parentGoal?.subGoals?.length).toBe(3);
    });

    test('sub-goals inherit parent priority', () => {
      const createResult = store.create({ title: 'Parent', priority: 'critical' });
      expect(createResult.success).toBe(true);
      expect(createResult.data?.id).toBeDefined();

      const result = store.decompose(createResult.data!.id, ['Sub Goal']);

      expect(result.success).toBe(true);
      const data = result.data as { subGoalIds: string[] };
      const subGoal = store.get(data.subGoalIds[0]);
      expect(subGoal?.priority).toBe('critical');
    });

    test('sub-goals reference parent', () => {
      const createResult = store.create({ title: 'Parent' });
      expect(createResult.success).toBe(true);
      expect(createResult.data?.id).toBeDefined();

      const result = store.decompose(createResult.data!.id, ['Sub Goal']);

      expect(result.success).toBe(true);
      const data = result.data as { subGoalIds: string[] };
      const subGoal = store.get(data.subGoalIds[0]);
      expect(subGoal?.parentGoal).toBe(createResult.data!.id);
    });

    test('returns error for non-existent parent', () => {
      const result = store.decompose('non-existent', ['Sub']);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('getSummary', () => {
    test('returns counts by state', () => {
      const r1 = store.create({ title: 'A1' });
      const r2 = store.create({ title: 'A2' });
      store.create({ title: 'P1' });
      store.create({ title: 'C1' });

      if (r1.success && r1.data) store.update(r1.data.id, { state: 'completed' });
      if (r2.success && r2.data) store.update(r2.data.id, { state: 'paused' });

      const summary = store.getSummary();

      expect(summary.active).toBe(2);
      expect(summary.paused).toBe(1);
      expect(summary.completed).toBe(1);
      expect(summary.cancelled).toBe(0);
      expect(summary.total).toBe(4);
    });

    test('returns zeros for empty store', () => {
      const summary = store.getSummary();

      expect(summary.active).toBe(0);
      expect(summary.total).toBe(0);
    });
  });
});

describe('Goal Tools', () => {
  beforeEach(() => {
    if (existsSync(TEST_GOAL_PATH)) {
      rmSync(TEST_GOAL_PATH, { recursive: true });
    }
    resetGoalStore();
    getGoalStore(TEST_GOAL_PATH);
  });

  afterEach(() => {
    if (existsSync(TEST_GOAL_PATH)) {
      rmSync(TEST_GOAL_PATH, { recursive: true });
    }
  });

  describe('goal_list', () => {
    test('lists all goals', () => {
      executeGoalTool('goal_create', { title: 'Goal 1' });
      executeGoalTool('goal_create', { title: 'Goal 2' });

      const result = executeGoalTool('goal_list', {});

      expect(result.success).toBe(true);
      const goals = result.data as Array<{ title: string }>;
      expect(goals.length).toBe(2);
    });

    test('filters by state', () => {
      executeGoalTool('goal_create', { title: 'Active' });
      const r = executeGoalTool('goal_create', { title: 'To Pause' });
      if (r.success && r.data) {
        executeGoalTool('goal_update', { id: (r.data as { id: string }).id, state: 'paused' });
      }

      const result = executeGoalTool('goal_list', { state: 'paused' });

      expect(result.success).toBe(true);
      const goals = result.data as Array<{ state: string }>;
      expect(goals.length).toBe(1);
      expect(goals[0].state).toBe('paused');
    });
  });

  describe('goal_get', () => {
    test('returns goal by ID', () => {
      const createResult = executeGoalTool('goal_create', { title: 'Get Me' });
      expect(createResult.success).toBe(true);

      const result = executeGoalTool('goal_get', { id: (createResult.data as { id: string }).id });

      expect(result.success).toBe(true);
      expect((result.data as { title: string }).title).toBe('Get Me');
    });

    test('returns error for non-existent goal', () => {
      const result = executeGoalTool('goal_get', { id: 'non-existent' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('goal_create', () => {
    test('creates goal with required fields', () => {
      const result = executeGoalTool('goal_create', { title: 'New Goal' });

      expect(result.success).toBe(true);
      const goal = result.data as { title: string; state: string };
      expect(goal.title).toBe('New Goal');
      expect(goal.state).toBe('active');
    });

    test('creates goal with all options', () => {
      const result = executeGoalTool('goal_create', {
        title: 'Full Goal',
        description: 'Description',
        priority: 'critical',
        targetDate: '2026-04-01',
        tags: ['important'],
        why: 'This is important',
      });

      expect(result.success).toBe(true);
      const goal = result.data as Record<string, unknown>;
      expect(goal.title).toBe('Full Goal');
      expect(goal.priority).toBe('critical');
      expect(goal.context).toBeDefined();
    });

    test('validates required title', () => {
      const result = executeGoalTool('goal_create', {});
      expect(result.success).toBe(false);
    });
  });

  describe('goal_update', () => {
    test('updates goal fields', () => {
      const createResult = executeGoalTool('goal_create', { title: 'Original' });
      expect(createResult.success).toBe(true);

      const goalId = (createResult.data as { id: string }).id;
      const result = executeGoalTool('goal_update', {
        id: goalId,
        title: 'Updated',
        progress: 75,
      });

      expect(result.success).toBe(true);
      const goal = result.data as { title: string; progress: number };
      expect(goal.title).toBe('Updated');
      expect(goal.progress).toBe(75);
    });

    test('validates progress range', () => {
      const createResult = executeGoalTool('goal_create', { title: 'Goal' });
      expect(createResult.success).toBe(true);

      const goalId = (createResult.data as { id: string }).id;
      const result = executeGoalTool('goal_update', {
        id: goalId,
        progress: 150,
      });

      expect(result.success).toBe(false);
    });
  });

  describe('goal_checkpoint', () => {
    test('adds checkpoint', () => {
      const createResult = executeGoalTool('goal_create', { title: 'Goal' });
      expect(createResult.success).toBe(true);

      const goalId = (createResult.data as { id: string }).id;
      const result = executeGoalTool('goal_checkpoint', {
        goalId,
        action: 'add',
        title: 'First Milestone',
        description: 'Details',
      });

      expect(result.success).toBe(true);
      const goal = result.data as { checkpoints: Array<{ title: string }> };
      expect(goal.checkpoints.length).toBe(1);
      expect(goal.checkpoints[0].title).toBe('First Milestone');
    });

    test('completes checkpoint', () => {
      const createResult = executeGoalTool('goal_create', { title: 'Goal' });
      expect(createResult.success).toBe(true);

      const goalId = (createResult.data as { id: string }).id;
      executeGoalTool('goal_checkpoint', { goalId, action: 'add', title: 'C1' });

      const goal = executeGoalTool('goal_get', { id: goalId });
      const checkpointId = ((goal.data as { checkpoints: Array<{ id: string }> })).checkpoints[0].id;

      const result = executeGoalTool('goal_checkpoint', {
        goalId,
        action: 'complete',
        checkpointId,
      });

      expect(result.success).toBe(true);
    });

    test('requires title for add action', () => {
      const createResult = executeGoalTool('goal_create', { title: 'Goal' });
      expect(createResult.success).toBe(true);

      const goalId = (createResult.data as { id: string }).id;
      const result = executeGoalTool('goal_checkpoint', {
        goalId,
        action: 'add',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('title');
    });

    test('requires checkpointId for complete action', () => {
      const createResult = executeGoalTool('goal_create', { title: 'Goal' });
      expect(createResult.success).toBe(true);

      const goalId = (createResult.data as { id: string }).id;
      const result = executeGoalTool('goal_checkpoint', {
        goalId,
        action: 'complete',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('checkpointId');
    });
  });

  describe('goal_decompose', () => {
    test('creates sub-goals', () => {
      const createResult = executeGoalTool('goal_create', { title: 'Parent' });
      expect(createResult.success).toBe(true);

      const goalId = (createResult.data as { id: string }).id;
      const result = executeGoalTool('goal_decompose', {
        id: goalId,
        subGoals: ['Sub 1', 'Sub 2'],
      });

      expect(result.success).toBe(true);
      const data = result.data as { subGoalIds: string[] };
      expect(data.subGoalIds.length).toBe(2);
    });

    test('requires subGoals array', () => {
      const createResult = executeGoalTool('goal_create', { title: 'Parent' });
      expect(createResult.success).toBe(true);

      const goalId = (createResult.data as { id: string }).id;
      const result = executeGoalTool('goal_decompose', {
        id: goalId,
      });

      expect(result.success).toBe(false);
    });
  });

  describe('goal_delete', () => {
    test('deletes goal', () => {
      const createResult = executeGoalTool('goal_create', { title: 'To Delete' });
      expect(createResult.success).toBe(true);

      const goalId = (createResult.data as { id: string }).id;
      const result = executeGoalTool('goal_delete', { id: goalId });

      expect(result.success).toBe(true);

      const getResult = executeGoalTool('goal_get', { id: goalId });
      expect(getResult.success).toBe(false);
    });

    test('returns error for non-existent goal', () => {
      const result = executeGoalTool('goal_delete', { id: 'non-existent' });
      expect(result.success).toBe(false);
    });
  });

  describe('goal_summary', () => {
    test('returns summary counts', () => {
      executeGoalTool('goal_create', { title: 'A1' });
      executeGoalTool('goal_create', { title: 'A2' });
      const r = executeGoalTool('goal_create', { title: 'C1' });
      if (r.success && r.data) {
        executeGoalTool('goal_update', { id: (r.data as { id: string }).id, state: 'completed' });
      }

      const result = executeGoalTool('goal_summary', {});

      expect(result.success).toBe(true);
      const summary = result.data as { active: number; completed: number; total: number };
      expect(summary.active).toBe(2);
      expect(summary.completed).toBe(1);
      expect(summary.total).toBe(3);
    });
  });

  describe('unknown tool', () => {
    test('returns error for unknown tool name', () => {
      const result = executeGoalTool('unknown_tool', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown tool');
    });
  });
});
