/**
 * Agent Exports — Extracted from agent/index.ts
 *
 * Pure re-export module that aggregates public API from sibling modules.
 * This keeps agent/index.ts focused on the Agent class itself.
 */

// Tools & prompt building
export { getAllToolsForAI, SYSTEM_PROMPTS, buildSystemPrompt, formatSkillsForPrompt, getCurrentTimeContext } from './tools';
export { getMemoryTools, getSkillTools, getToolsByCategory, TOOL_CATEGORIES } from './tools';

// Builtin tools
export { getBuiltinToolsForAI, executeBuiltinTool, isBuiltinTool, builtinToolNames } from '../tools';

// Evolution
export { recordSkillFailure } from './evolution';

// Types
export type { OpenAITool, ChatMessage, ToolCall, ToolResult } from './types';
export { stripMessageMetadata } from './types';

// Context management
export {
  estimateMessageTokens,
  estimateTotalTokens,
  DEFAULT_CONTEXT_CONFIG,
  DEFAULT_TOKEN_STATS_CONFIG,
  calculateContextConfig,
  getModelContextWindow,
  cleanTokenStats,
  type ContextConfig,
  type TokenStatsConfig,
  type TokenStats,
} from './context';

// Tool dependencies
export {
  groupToolCalls,
  getGroupingStats,
  isParallelTool,
  getToolDependency,
  hasSideEffects,
  registerToolDependencyOverride,
  registerToolDependencyPattern,
  clearToolDependencyOverrides,
  getToolDependencyOverrides,
} from './tool-dependencies';

// Phase 4: Extracted modules for backward compatibility
export { ToolDispatcher } from './tool-dispatcher';
export { TokenBudgetManager, type TokenBudget, type TurnBudgetCheck } from './token-budget';
export { SkillRunner } from './skill-runner';

// App-level re-exports
export { getAgent } from '../../app';

// Tool executor
export { createDefaultToolExecutor, _executeToolInner } from './tool-executor';
