/**
 * Agent module — public barrel (re-export index).
 *
 * This file re-exports every public symbol that was previously defined
 * directly in index.ts. All implementation has been moved to focused
 * sub-modules:
 *
 *   orchestrator.ts   — Agent class, chat() loop, evolution triggers
 *   stream-handler.ts — chatStream() async generator
 *   context-manager.ts — context trimming and multi-tier compression
 *   prompt-builder.ts  — system prompt assembly (memory + skills)
 *   agent-factory.ts   — createAgent() factory function
 *
 * Downstream code that imports from 'domain/agent' continues to work
 * without changes — backward compatibility is fully preserved.
 */

// ============================================================================
// Orchestrator (Agent class)
// ============================================================================
export { Agent } from './orchestrator';

// ============================================================================
// Agent factory
// ============================================================================
export { createAgent } from './agent-factory';

// ============================================================================
// Prompt builder
// ============================================================================
export { assembleSystemPrompt } from './prompt-builder';

// ============================================================================
// Context manager
// ============================================================================
export {
  trimContextIfNeeded,
  compressContextWithLLM,
  manageContextCompression,
  type ContextManagerState,
} from './context-manager';

// ============================================================================
// Stream handler
// ============================================================================
export { chatStream, type StreamHandlerDeps } from './stream-handler';

// ============================================================================
// Tools & prompt building
// ============================================================================
export { getAllToolsForAI, SYSTEM_PROMPTS, buildSystemPrompt, formatSkillsForPrompt, getCurrentTimeContext } from './tools';
export { getMemoryTools, getSkillTools, getToolsByCategory, TOOL_CATEGORIES } from './tools';

// ============================================================================
// Builtin tools
// ============================================================================
export { getBuiltinToolsForAI, executeBuiltinTool, isBuiltinTool, builtinToolNames } from '../tools';

// ============================================================================
// Evolution
// ============================================================================
export { recordSkillFailure } from './evolution';

// ============================================================================
// Types
// ============================================================================
export type { OpenAITool, ChatMessage, ToolCall, ToolResult } from './types';
export { stripMessageMetadata } from './types';

// ============================================================================
// Context management (from ./context)
// ============================================================================
export {
  estimateMessageTokens,
  estimateTotalTokens,
  DEFAULT_CONTEXT_CONFIG,
  DEFAULT_TOKEN_STATS_CONFIG,
  calculateContextConfig,
  getModelContextWindow,
  cleanTokenStats,
  type AgentContextConfig,
  type ContextConfig,
  type TokenStatsConfig,
  type TokenStats,
} from './context';

// ============================================================================
// Tool dependencies
// ============================================================================
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

// ============================================================================
// Phase 4: Extracted modules
// ============================================================================
export { ToolDispatcher } from './tool-dispatcher';
export { TokenBudgetManager, type TokenBudget, type TurnBudgetCheck } from './token-budget';
export { SkillRunner } from './skill-runner';

// ============================================================================
// App-level re-exports
// ============================================================================
export { getAgent } from '../../app';

// ============================================================================
// Tool executor
// ============================================================================
export { createDefaultToolExecutor, _executeToolInner } from './tool-executor';
