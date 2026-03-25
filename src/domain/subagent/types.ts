/**
 * Subagent Types
 *
 * Core type definitions for the subagent system
 */

import type { SubagentResult as _SR } from './types';

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

  /** AI provider (overrides runtime default) */
  provider?: any;

  /** AI model (overrides runtime default) */
  model?: string;

  /** Unique identifier for this subagent */
  id?: string;

  /** AbortSignal for cooperative cancellation */
  signal?: AbortSignal;
}

/**
 * Result from a subagent execution
 */
export interface SubagentResult {
  /** Whether the subagent succeeded */
  success: boolean;

  /** Output text */
  output: string;

  /** Tokens used */
  tokensUsed: number;

  /** Duration in milliseconds */
  duration: number;

  /** Error message if failed */
  error?: string;

  /** Subagent identifier */
  id?: string;
}

/**
 * Subagent statistics
 */
export interface SubagentStats {
  totalSpawned: number;
  successful: number;
  failed: number;
  totalTokens: number;
  totalDuration: number;
  avgDuration: number;
}

/**
 * Tool set configuration for each subagent type.
 *
 * Tool names MUST match the actual registered names from:
 * - builtin.ts: web_search, web_fetch, file_read, file_write, file_list, file_delete,
 *               shell, code_execute, spawn_subagent, spawn_parallel, etc.
 * - memory/tools.ts: memory_ls, memory_grep, memory_read, memory_write, memory_record
 * - skills/tools.ts: skill_list, skill_get, skill_ensure, skill_delete, skill_record,
 *                     skill_maturity, skill_evals
 */
export const SUBAGENT_TOOL_SETS: Record<SubagentType, string[]> = {
  research: [
    'web_search',
    'web_fetch',
    'file_read',
    'file_write',
    'memory_read',
    'memory_grep',
    'memory_ls',
    'memory_write',
  ],

  memory: [
    'memory_read',
    'memory_write',
    'memory_grep',
    'memory_ls',
    'memory_record',
    'file_read',
  ],

  skill: [
    'skill_list',
    'skill_get',
    'skill_ensure',
    'skill_evals',
    'skill_record',
    'skill_maturity',
    'file_read',
    'file_write',
  ],

  code: [
    'code_execute',
    'shell',
    'file_read',
    'file_write',
    'file_list',
    'file_delete',
    'memory_read',
    'memory_write',
  ],

  general: [
    // All tools available — empty array signals "no filtering"
  ],
};
