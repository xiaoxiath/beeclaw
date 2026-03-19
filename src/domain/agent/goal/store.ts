/**
 * Goal Store
 *
 * File-based storage for cross-session goal tracking
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import type {
  Goal,
  GoalIndex,
  GoalToolResult,
  CreateGoalOptions,
  UpdateGoalOptions,
  GoalFilter,
  Checkpoint,
} from './types';

// SECURITY: [CR-Sec] Methods that accept user-provided IDs (get, update, delete, addCheckpoint, etc.)
// use them in path.join() without validation. Add path traversal checks before any fs operation.
// e.g., verify id matches /^goal-[a-z0-9]+-[a-z0-9]+$/ pattern.
export class GoalStore {
  private basePath: string;
  private initialized: boolean = false;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  // Initialize goal directory structure
  init(): void {
    if (this.initialized) return;

    // Create directories
    const directories = ['', 'active', 'completed', 'paused', 'cancelled'];
    for (const dir of directories) {
      const path = join(this.basePath, dir);
      if (!existsSync(path)) {
        mkdirSync(path, { recursive: true });
      }
    }

    // Create index if not exists
    this.ensureIndexFile();

    this.initialized = true;
  }

  // Get base path
  getBasePath(): string {
    return this.basePath;
  }

  // List goals with optional filter
  list(filter?: GoalFilter): Goal[] {
    this.init();

    const goals: Goal[] = [];
    const stateDirs = filter?.state ? [filter.state] : ['active', 'paused', 'completed', 'cancelled'];

    for (const state of stateDirs) {
      const dirPath = join(this.basePath, state);
      if (!existsSync(dirPath)) continue;

      const entries = readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.name.endsWith('.json')) continue;

        const goalPath = join(dirPath, entry.name);
        const goal = this.loadGoal(goalPath);
        if (goal) {
          // Apply filters
          if (filter?.priority && goal.priority !== filter.priority) continue;
          if (filter?.tags && filter.tags.length > 0) {
            const hasTag = filter.tags.some(t => goal.tags?.includes(t));
            if (!hasTag) continue;
          }
          if (filter?.search) {
            const searchText = `${goal.title} ${goal.description}`.toLowerCase();
            if (!searchText.includes(filter.search.toLowerCase())) continue;
          }
          goals.push(goal);
        }
      }
    }

    // Sort by priority (critical first) then by updatedAt
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    goals.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    return goals;
  }

  // Get a specific goal
  get(id: string): Goal | null {
    // SECURITY: [CR-Sec] Validate id to prevent directory traversal (e.g., id="../../etc/passwd")
    this.init();

    // Search in all state directories
    const states = ['active', 'paused', 'completed', 'cancelled'];
    for (const state of states) {
      const goalPath = join(this.basePath, state, `${id}.json`);
      if (existsSync(goalPath)) {
        return this.loadGoal(goalPath);
      }
    }

    return null;
  }

  // Create a new goal
  create(options: CreateGoalOptions): GoalToolResult {
    this.init();

    const id = this.generateId();
    const now = new Date().toISOString();

    const goal: Goal = {
      id,
      title: options.title,
      description: options.description || '',
      state: 'active',
      priority: options.priority || 'medium',
      progress: 0,
      checkpoints: [],
      subGoals: [],
      context: options.context || { why: '', relatedFacts: [], constraints: [] },
      tags: options.tags || [],
      createdAt: now,
      updatedAt: now,
      targetDate: options.targetDate,
    };

    // Save goal file
    const goalPath = join(this.basePath, 'active', `${id}.json`);
    try {
      writeFileSync(goalPath, JSON.stringify(goal, null, 2), 'utf-8');

      // Update index
      this.updateIndex(goal);

      return { success: true, data: goal };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Update a goal
  update(id: string, options: UpdateGoalOptions): GoalToolResult {
    this.init();

    const existingGoal = this.get(id);
    if (!existingGoal) {
      return { success: false, error: `Goal not found: ${id}` };
    }

    const now = new Date().toISOString();
    const updatedGoal: Goal = {
      ...existingGoal,
      title: options.title ?? existingGoal.title,
      description: options.description ?? existingGoal.description,
      state: options.state ?? existingGoal.state,
      priority: options.priority ?? existingGoal.priority,
      progress: options.progress ?? existingGoal.progress,
      targetDate: options.targetDate ?? existingGoal.targetDate,
      tags: options.tags ?? existingGoal.tags,
      updatedAt: now,
    };

    // Handle state change
    if (options.state && options.state !== existingGoal.state) {
      // Handle completion
      if (options.state === 'completed') {
        updatedGoal.completedAt = now;
        updatedGoal.progress = 100;
      }

      // Move file to new state directory
      const oldPath = join(this.basePath, existingGoal.state, `${id}.json`);
      const newPath = join(this.basePath, options.state, `${id}.json`);

      try {
        // Write to new location
        writeFileSync(newPath, JSON.stringify(updatedGoal, null, 2), 'utf-8');
        // Remove from old location
        if (existsSync(oldPath)) {
          rmSync(oldPath);
        }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to move goal' };
      }
    } else {
      // Just update in place
      const goalPath = join(this.basePath, updatedGoal.state, `${id}.json`);
      try {
        writeFileSync(goalPath, JSON.stringify(updatedGoal, null, 2), 'utf-8');
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to update goal' };
      }
    }

    // Update index
    this.updateIndex(updatedGoal);

    return { success: true, data: updatedGoal };
  }

  // Delete a goal
  delete(id: string): GoalToolResult {
    this.init();

    const goal = this.get(id);
    if (!goal) {
      return { success: false, error: `Goal not found: ${id}` };
    }

    const goalPath = join(this.basePath, goal.state, `${id}.json`);
    try {
      if (existsSync(goalPath)) {
        rmSync(goalPath);
      }

      // Remove from index
      this.removeFromIndex(id);

      return { success: true, data: { deleted: id } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to delete goal' };
    }
  }

  // Add checkpoint to a goal
  addCheckpoint(goalId: string, title: string, description?: string): GoalToolResult {
    this.init();

    const goal = this.get(goalId);
    if (!goal) {
      return { success: false, error: `Goal not found: ${goalId}` };
    }

    const checkpoint: Checkpoint = {
      id: this.generateId(),
      title,
      description,
      completed: false,
      createdAt: new Date().toISOString(),
    };

    const checkpoints = goal.checkpoints || [];
    checkpoints.push(checkpoint);

    // Update goal directly with new checkpoints
    const now = new Date().toISOString();
    const updatedGoal: Goal = {
      ...goal,
      checkpoints,
      progress: this.calculateProgress(checkpoints),
      updatedAt: now,
    };

    const goalPath = join(this.basePath, goal.state, `${goalId}.json`);
    try {
      writeFileSync(goalPath, JSON.stringify(updatedGoal, null, 2), 'utf-8');
      this.updateIndex(updatedGoal);
      return { success: true, data: updatedGoal };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to add checkpoint' };
    }
  }

  // Complete a checkpoint
  completeCheckpoint(goalId: string, checkpointId: string): GoalToolResult {
    this.init();

    const goal = this.get(goalId);
    if (!goal) {
      return { success: false, error: `Goal not found: ${goalId}` };
    }

    const checkpoints = goal.checkpoints || [];
    const checkpoint = checkpoints.find(c => c.id === checkpointId);
    if (!checkpoint) {
      return { success: false, error: `Checkpoint not found: ${checkpointId}` };
    }

    checkpoint.completed = true;
    checkpoint.completedAt = new Date().toISOString();

    // Calculate new progress
    const progress = this.calculateProgress(checkpoints);

    // Update goal
    const goalPath = join(this.basePath, goal.state, `${goalId}.json`);
    const updatedGoal = {
      ...goal,
      checkpoints,
      progress,
      updatedAt: new Date().toISOString(),
    };

    try {
      writeFileSync(goalPath, JSON.stringify(updatedGoal, null, 2), 'utf-8');
      this.updateIndex(updatedGoal);
      return { success: true, data: updatedGoal };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to complete checkpoint' };
    }
  }

  // Decompose goal into sub-goals
  decompose(parentId: string, subGoalTitles: string[]): GoalToolResult {
    this.init();

    const parentGoal = this.get(parentId);
    if (!parentGoal) {
      return { success: false, error: `Goal not found: ${parentId}` };
    }

    const subGoalIds: string[] = [];
    const now = new Date().toISOString();

    for (const title of subGoalTitles) {
      const id = this.generateId();
      const subGoal: Goal = {
        id,
        title,
        description: `Sub-goal of: ${parentGoal.title}`,
        state: 'active',
        priority: parentGoal.priority,
        progress: 0,
        checkpoints: [],
        subGoals: [],
        parentGoal: parentId,
        tags: parentGoal.tags,
        createdAt: now,
        updatedAt: now,
      };

      const goalPath = join(this.basePath, 'active', `${id}.json`);
      try {
        writeFileSync(goalPath, JSON.stringify(subGoal, null, 2), 'utf-8');
        this.updateIndex(subGoal);
        subGoalIds.push(id);
      } catch (_error) {
        return { success: false, error: `Failed to create sub-goal: ${title}` };
      }
    }

    // Update parent goal with sub-goal references
    const updatedParent = {
      ...parentGoal,
      subGoals: [...(parentGoal.subGoals || []), ...subGoalIds],
      updatedAt: now,
    };

    const parentPath = join(this.basePath, parentGoal.state, `${parentId}.json`);
    try {
      writeFileSync(parentPath, JSON.stringify(updatedParent, null, 2), 'utf-8');
      this.updateIndex(updatedParent);
    } catch (_error) {
      return { success: false, error: 'Failed to update parent goal' };
    }

    return { success: true, data: { parentGoal: updatedParent, subGoalIds } };
  }

  // Get goal summary
  getSummary(): { active: number; paused: number; completed: number; cancelled: number; total: number } {
    const index = this.readIndex();
    const goals = Object.values(index.goals);

    return {
      active: goals.filter(g => g.state === 'active').length,
      paused: goals.filter(g => g.state === 'paused').length,
      completed: goals.filter(g => g.state === 'completed').length,
      cancelled: goals.filter(g => g.state === 'cancelled').length,
      total: goals.length,
    };
  }

  // Private helper methods

  private loadGoal(path: string): Goal | null {
    try {
      const content = readFileSync(path, 'utf-8');
      return JSON.parse(content) as Goal;
    } catch {
      return null;
    }
  }

  private generateId(): string {
    return `goal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  private calculateProgress(checkpoints: Checkpoint[]): number {
    if (checkpoints.length === 0) return 0;
    const completed = checkpoints.filter(c => c.completed).length;
    return Math.round((completed / checkpoints.length) * 100);
  }

  private ensureIndexFile(): void {
    const indexPath = join(this.basePath, 'index.json');
    if (!existsSync(indexPath)) {
      writeFileSync(indexPath, JSON.stringify({
        goals: {},
        lastUpdated: new Date().toISOString(),
      }, null, 2), 'utf-8');
    }
  }

  private readIndex(): GoalIndex {
    const indexPath = join(this.basePath, 'index.json');
    try {
      const content = readFileSync(indexPath, 'utf-8');
      return JSON.parse(content) as GoalIndex;
    } catch {
      return { goals: {}, lastUpdated: new Date().toISOString() };
    }
  }

  private updateIndex(goal: Goal): void {
    const index = this.readIndex();
    index.goals[goal.id] = {
      id: goal.id,
      title: goal.title,
      state: goal.state,
      priority: goal.priority,
      progress: goal.progress,
      updatedAt: goal.updatedAt,
    };
    index.lastUpdated = new Date().toISOString();

    const indexPath = join(this.basePath, 'index.json');
    writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  }

  private removeFromIndex(id: string): void {
    const index = this.readIndex();
    delete index.goals[id];
    index.lastUpdated = new Date().toISOString();

    const indexPath = join(this.basePath, 'index.json');
    writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  }
}

// Singleton instance
let goalStore: GoalStore | null = null;

export function getGoalStore(basePath?: string): GoalStore {
  if (!goalStore && basePath) {
    goalStore = new GoalStore(basePath);
    goalStore.init();
  }
  if (!goalStore) {
    throw new Error('GoalStore not initialized. Call getGoalStore with basePath first.');
  }
  return goalStore;
}

export function resetGoalStore(): void {
  goalStore = null;
}
