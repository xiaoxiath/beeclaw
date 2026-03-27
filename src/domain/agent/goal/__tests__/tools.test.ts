/**
 * Tests for goal/tools.ts
 *
 * Uses a real GoalStore with tmp directory to test all tool definitions and execution.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { getGoalStore, resetGoalStore } from '../store';
import {
  goalTools,
  executeGoalTool,
  getGoalToolsForAI,
  GOAL_TOOL_NAMES,
} from '../tools';

const TEST_DIR = join('/tmp', `goal-tools-test-${Date.now()}`);

describe('goal/tools', () => {
  beforeEach(() => {
    resetGoalStore();
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    getGoalStore(TEST_DIR);
  });

  afterEach(() => {
    resetGoalStore();
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  describe('tool definitions', () => {
    it('should define 8 tools', () => {
      expect(GOAL_TOOL_NAMES).toHaveLength(8);
    });

    it('should include expected tool names', () => {
      expect(GOAL_TOOL_NAMES).toContain('goal_list');
      expect(GOAL_TOOL_NAMES).toContain('goal_get');
      expect(GOAL_TOOL_NAMES).toContain('goal_create');
      expect(GOAL_TOOL_NAMES).toContain('goal_update');
      expect(GOAL_TOOL_NAMES).toContain('goal_checkpoint');
      expect(GOAL_TOOL_NAMES).toContain('goal_decompose');
      expect(GOAL_TOOL_NAMES).toContain('goal_delete');
      expect(GOAL_TOOL_NAMES).toContain('goal_summary');
    });

    it('getGoalToolsForAI should return all tool objects', () => {
      const tools = getGoalToolsForAI();
      expect(tools).toHaveLength(8);
      expect(tools[0]).toHaveProperty('name');
      expect(tools[0]).toHaveProperty('parameters');
    });
  });

  describe('executeGoalTool', () => {
    it('goal_create should create a goal', () => {
      const result = executeGoalTool('goal_create', { title: 'Test' });
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('goal_create should fail without title', () => {
      const result = executeGoalTool('goal_create', {});
      expect(result.success).toBe(false);
    });

    it('goal_list should return empty initially', () => {
      const result = executeGoalTool('goal_list', {});
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('goal_list should return created goals', () => {
      executeGoalTool('goal_create', { title: 'A' });
      executeGoalTool('goal_create', { title: 'B' });
      const result = executeGoalTool('goal_list', {});
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('goal_get should retrieve a goal', () => {
      const created = executeGoalTool('goal_create', { title: 'Find Me' });
      const result = executeGoalTool('goal_get', { id: created.data.id });
      expect(result.success).toBe(true);
      expect(result.data.title).toBe('Find Me');
    });

    it('goal_get should fail for nonexistent goal', () => {
      const result = executeGoalTool('goal_get', { id: 'nope' });
      expect(result.success).toBe(false);
    });

    it('goal_update should update a goal', () => {
      const created = executeGoalTool('goal_create', { title: 'Old' });
      const result = executeGoalTool('goal_update', { id: created.data.id, title: 'New', progress: 50 });
      expect(result.success).toBe(true);
      expect(result.data.title).toBe('New');
      expect(result.data.progress).toBe(50);
    });

    it('goal_checkpoint add should add a checkpoint', () => {
      const created = executeGoalTool('goal_create', { title: 'Goal' });
      const result = executeGoalTool('goal_checkpoint', {
        goalId: created.data.id,
        action: 'add',
        title: 'Step 1',
      });
      expect(result.success).toBe(true);
      expect(result.data.checkpoints).toHaveLength(1);
    });

    it('goal_checkpoint complete should complete a checkpoint', () => {
      const created = executeGoalTool('goal_create', { title: 'Goal' });
      const cpResult = executeGoalTool('goal_checkpoint', {
        goalId: created.data.id,
        action: 'add',
        title: 'Step 1',
      });
      const cpId = cpResult.data.checkpoints[0].id;
      const result = executeGoalTool('goal_checkpoint', {
        goalId: created.data.id,
        action: 'complete',
        checkpointId: cpId,
      });
      expect(result.success).toBe(true);
      expect(result.data.progress).toBe(100);
    });

    it('goal_decompose should create sub-goals', () => {
      const created = executeGoalTool('goal_create', { title: 'Parent' });
      const result = executeGoalTool('goal_decompose', {
        id: created.data.id,
        subGoals: ['Sub 1', 'Sub 2'],
      });
      expect(result.success).toBe(true);
      expect(result.data.subGoalIds).toHaveLength(2);
    });

    it('goal_delete should delete a goal', () => {
      const created = executeGoalTool('goal_create', { title: 'Deletable' });
      const result = executeGoalTool('goal_delete', { id: created.data.id });
      expect(result.success).toBe(true);
    });

    it('goal_summary should return counts', () => {
      executeGoalTool('goal_create', { title: 'A' });
      const result = executeGoalTool('goal_summary', {});
      expect(result.success).toBe(true);
      expect(result.data.active).toBe(1);
      expect(result.data.total).toBe(1);
    });

    it('should return error for unknown tool', () => {
      const result = executeGoalTool('goal_nonexistent', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown tool');
    });
  });
});
