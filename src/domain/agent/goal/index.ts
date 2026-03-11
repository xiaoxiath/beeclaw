/**
 * Goal System Module
 *
 * Cross-session goal tracking for long-horizon agent behavior
 */

// Types
export type {
  Goal,
  GoalState,
  GoalPriority,
  GoalIndex,
  GoalToolResult,
  GoalFilter,
  GoalContext,
  Checkpoint,
  CreateGoalOptions,
  UpdateGoalOptions,
} from './types';

// Store
export { GoalStore, getGoalStore, resetGoalStore } from './store';

// Tools
export {
  goalTools,
  executeGoalTool,
  getGoalToolsForAI,
  GOAL_TOOL_NAMES,
} from './tools';
