/**
 * Tool Dependency Registry
 *
 * Defines which tools can be executed in parallel and which have dependencies.
 * This enables Phase 1 of the subagent optimization - parallel tool execution.
 */

/**
 * Tool execution mode
 * - parallel: Can execute simultaneously with other tools
 * - sequential: Must execute one after another (in order received)
 */
export type ToolExecutionMode = 'parallel' | 'sequential';

/**
 * Tool dependency configuration
 */
export interface ToolDependencyConfig {
  /** Execution mode for this tool */
  mode: ToolExecutionMode;
  /** Tools that must complete before this tool can run */
  dependsOn?: string[];
  /** Whether this tool modifies state (affects caching and ordering) */
  hasSideEffects?: boolean;
}

/**
 * Default dependency configurations for all tools
 *
 * Most tools are independent and can run in parallel.
 * Only tools that explicitly depend on others or have ordering requirements
 * should be marked as sequential.
 */
const TOOL_DEPENDENCIES: Record<string, ToolDependencyConfig> = {
  // Memory tools - read operations are parallel, write is sequential
  memory_ls: { mode: 'parallel', hasSideEffects: false },
  memory_grep: { mode: 'parallel', hasSideEffects: false },
  memory_read: { mode: 'parallel', hasSideEffects: false },
  memory_write: { mode: 'sequential', hasSideEffects: true },
  memory_record: { mode: 'sequential', hasSideEffects: true },

  // Skill tools - skill_get is sequential so LLM sees skill content before acting
  skill_list: { mode: 'parallel', hasSideEffects: false },
  skill_get: { mode: 'sequential', hasSideEffects: false },
  skill_search: { mode: 'parallel', hasSideEffects: false },
  skill_maturity: { mode: 'parallel', hasSideEffects: false },
  skill_create: { mode: 'sequential', hasSideEffects: true },
  skill_update: { mode: 'sequential', hasSideEffects: true },
  skill_ensure: { mode: 'sequential', hasSideEffects: true },
  skill_delete: { mode: 'sequential', hasSideEffects: true },
  skill_record: { mode: 'sequential', hasSideEffects: true },
  skill_evals_get: { mode: 'parallel', hasSideEffects: false },
  skill_evals_set: { mode: 'sequential', hasSideEffects: true },
  skill_resource_read: { mode: 'parallel', hasSideEffects: false },
  skill_resource_write: { mode: 'sequential', hasSideEffects: true },
  skill_structure: { mode: 'parallel', hasSideEffects: false },
  skill_workspace_create: { mode: 'sequential', hasSideEffects: true },

  // Goal tools - read operations are parallel
  goal_list: { mode: 'parallel', hasSideEffects: false },
  goal_get: { mode: 'parallel', hasSideEffects: false },
  goal_summary: { mode: 'parallel', hasSideEffects: false },
  goal_create: { mode: 'sequential', hasSideEffects: true },
  goal_update: { mode: 'sequential', hasSideEffects: true },
  goal_checkpoint: { mode: 'sequential', hasSideEffects: true },
  goal_decompose: { mode: 'sequential', hasSideEffects: true },
  goal_delete: { mode: 'sequential', hasSideEffects: true },

  // Proactive tools
  proactive_list: { mode: 'parallel', hasSideEffects: false },
  proactive_schedule: { mode: 'sequential', hasSideEffects: true },
  proactive_pattern: { mode: 'sequential', hasSideEffects: true },
  proactive_cancel: { mode: 'sequential', hasSideEffects: true },
  proactive_enable: { mode: 'sequential', hasSideEffects: true },
  proactive_disable: { mode: 'sequential', hasSideEffects: true },
  notification_send: { mode: 'sequential', hasSideEffects: true },
  notification_list: { mode: 'parallel', hasSideEffects: false },

  // Builtin tools - mostly parallel (independent operations)
  web_search: { mode: 'parallel', hasSideEffects: false },
  web_fetch: { mode: 'parallel', hasSideEffects: false },
  time_now: { mode: 'parallel', hasSideEffects: false },
  calc: { mode: 'parallel', hasSideEffects: false },
  code_execute: { mode: 'sequential', hasSideEffects: true }, // May affect state
  weather: { mode: 'parallel', hasSideEffects: false },
  url_shorten: { mode: 'parallel', hasSideEffects: false },
  qrcode: { mode: 'parallel', hasSideEffects: false },
  claude_code: { mode: 'sequential', hasSideEffects: true }, // Complex operations

  // Persona tools
  persona_get: { mode: 'parallel', hasSideEffects: false },
  persona_export: { mode: 'parallel', hasSideEffects: false },
  persona_update_traits: { mode: 'sequential', hasSideEffects: true },
  persona_import: { mode: 'sequential', hasSideEffects: true },
  persona_explain_traits: { mode: 'parallel', hasSideEffects: false },

  // Subagent tools
  spawn_subagent: { mode: 'sequential', hasSideEffects: true }, // Spawns and waits for subagent
  spawn_parallel: { mode: 'sequential', hasSideEffects: true }, // Spawns multiple subagents

  // State management tools
  state_set: { mode: 'sequential', hasSideEffects: true }, // Modifies state
  state_get: { mode: 'parallel', hasSideEffects: false }, // Read-only
  state_delete: { mode: 'sequential', hasSideEffects: true }, // Modifies state
  state_update: { mode: 'sequential', hasSideEffects: true }, // Modifies state
  state_exists: { mode: 'parallel', hasSideEffects: false }, // Read-only
  state_list: { mode: 'parallel', hasSideEffects: false }, // Read-only
  state_stats: { mode: 'parallel', hasSideEffects: false }, // Read-only
  state_lock: { mode: 'sequential', hasSideEffects: true }, // Acquires lock
  state_unlock: { mode: 'sequential', hasSideEffects: true }, // Releases lock
};

/**
 * Get the dependency config for a tool
 */
export function getToolDependency(toolName: string): ToolDependencyConfig {
  return TOOL_DEPENDENCIES[toolName] || { mode: 'parallel', hasSideEffects: false };
}

/**
 * Check if a tool can be executed in parallel
 */
export function isParallelTool(toolName: string): boolean {
  return getToolDependency(toolName).mode === 'parallel';
}

/**
 * Check if a tool has side effects
 */
export function hasSideEffects(toolName: string): boolean {
  return getToolDependency(toolName).hasSideEffects ?? false;
}

/**
 * Group tool calls into parallel and sequential batches
 *
 * @param toolCalls Array of tool calls to group
 * @returns Array of batches - each batch can be executed in parallel,
 *          but batches must be executed sequentially
 */
export function groupToolCalls<T extends { name: string }>(
  toolCalls: T[]
): T[][] {
  if (toolCalls.length === 0) return [];
  if (toolCalls.length === 1) return [toolCalls];

  const batches: T[][] = [];
  let currentBatch: T[] = [];

  for (const call of toolCalls) {
    const config = getToolDependency(call.name);

    if (config.mode === 'sequential' && currentBatch.length > 0) {
      // Flush current batch and start a new one for sequential tool
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
      }
      batches.push([call]);
      currentBatch = [];
    } else if (config.mode === 'sequential') {
      // First tool is sequential - execute alone
      batches.push([call]);
    } else {
      // Parallel tool - add to current batch
      currentBatch.push(call);
    }
  }

  // Don't forget the last batch
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

/**
 * Get statistics about tool grouping
 */
export function getGroupingStats<T extends { name: string }>(
  toolCalls: T[]
): {
  totalCalls: number;
  parallelBatches: number;
  sequentialBatches: number;
  maxParallelism: number;
} {
  const batches = groupToolCalls(toolCalls);
  let parallelBatches = 0;
  let sequentialBatches = 0;
  let maxParallelism = 1;

  for (const batch of batches) {
    if (batch.length === 1 && !isParallelTool(batch[0].name)) {
      sequentialBatches++;
    } else {
      parallelBatches++;
      maxParallelism = Math.max(maxParallelism, batch.length);
    }
  }

  return {
    totalCalls: toolCalls.length,
    parallelBatches,
    sequentialBatches,
    maxParallelism,
  };
}
