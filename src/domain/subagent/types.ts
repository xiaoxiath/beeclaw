/**
 * Subagent Types
 *
 * Type definitions for the subagent system
 */

import type { AIProvider } from '../../infra/config/schema';

/**
 * Subagent types - each type has a specialized role
 */
export type SubagentType =
  | 'research'   // Information gathering, web search, reading
  | 'memory'     // Memory operations, knowledge management
  | 'skill'      // Skill creation, execution, evaluation
  | 'code'       // Code generation, file operations
  | 'general';   // General-purpose tasks

/**
 * Configuration for spawning a subagent
 */
export interface SubagentConfig {
  /** Type of subagent (determines available tools and system prompt) */
  type: SubagentType;

  /** Task description for the subagent */
  task: string;

  /** Additional context to provide */
  context?: string;

  /** Limit available tools (optional, defaults based on type) */
  tools?: string[];

  /** Maximum tokens for this subagent (optional) */
  maxTokens?: number;

  /** Timeout in milliseconds (optional, default: 60000) */
  timeout?: number;

  /** Provider to use (optional, defaults to main agent's provider) */
  provider?: AIProvider;

  /** Model to use (optional, defaults to main agent's model) */
  model?: string;

  /** Unique identifier for this subagent instance */
  id?: string;
}

/**
 * Result from a subagent execution
 */
export interface SubagentResult {
  /** Whether the task completed successfully */
  success: boolean;

  /** Output from the subagent */
  output: string;

  /** Artifacts produced (e.g., created files, updated memories) */
  artifacts?: Record<string, any>;

  /** Total tokens used by this subagent */
  tokensUsed: number;

  /** Execution time in milliseconds */
  duration: number;

  /** Error message if failed */
  error?: string;

  /** Subagent ID */
  id: string;

  /** Tool calls made by this subagent */
  toolCalls?: Array<{
    name: string;
    params: Record<string, any>;
    result: any;
  }>;
}

/**
 * Statistics for subagent execution
 */
export interface SubagentStats {
  /** Total subagents spawned */
  totalSpawned: number;

  /** Successful executions */
  successful: number;

  /** Failed executions */
  failed: number;

  /** Total tokens used */
  totalTokens: number;

  /** Total execution time */
  totalDuration: number;

  /** Average execution time */
  avgDuration: number;
}

/**
 * Tool set configuration for each subagent type
 */
export const SUBAGENT_TOOL_SETS: Record<SubagentType, string[]> = {
  research: [
    'web_search',
    'web_fetch',
    'memory_read',
    'memory_grep',
    'memory_ls',
  ],

  memory: [
    'memory_read',
    'memory_write',
    'memory_grep',
    'memory_ls',
    'memory_record',
  ],

  skill: [
    'skill_list',
    'skill_get',
    'skill_search',
    'skill_ensure',
    'skill_evals_get',
    'skill_evals_set',
    'skill_resource_read',
    'skill_resource_write',
    'skill_structure',
  ],

  code: [
    'code_execute',
    'memory_read',
    'memory_write',
    'skill_get',
  ],

  general: [
    // All tools available
  ],
};
