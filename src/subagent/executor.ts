/**
 * Subagent Tool Executor
 *
 * Execute subagent tools from the builtin tools system
 */

import { spawnSubagent, spawnParallelSubagents } from './runtime';
import { formatSubagentResult, formatParallelResults } from './tools';
import type { SpawnSubagentParams, SpawnParallelParams } from './tools';
import type { ToolResult } from '../tools/builtin';

/**
 * Execute spawn_subagent tool
 */
export async function executeSpawnSubagent(
  params: SpawnSubagentParams
): Promise<ToolResult> {
  try {
    console.log(`[SubagentTool] Spawning ${params.type} subagent`);
    console.log(`[SubagentTool] Task: ${params.task.substring(0, 100)}...`);

    const result = await spawnSubagent({
      type: params.type,
      task: params.task,
      context: params.context,
      timeout: params.timeout || 60000,
      maxTokens: params.maxTokens,
    });

    if (result.success) {
      console.log(`[SubagentTool] Success in ${result.duration}ms`);

      return {
        success: true,
        output: formatSubagentResult(result, params.task),
        data: result,
      };
    } else {
      console.error(`[SubagentTool] Failed: ${result.error}`);

      return {
        success: false,
        output: `Subagent failed: ${result.error}`,
        error: result.error,
      };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[SubagentTool] Error:', errorMsg);

    return {
      success: false,
      output: `Failed to spawn subagent: ${errorMsg}`,
      error: errorMsg,
    };
  }
}

/**
 * Execute spawn_parallel tool
 */
export async function executeSpawnParallel(
  params: SpawnParallelParams
): Promise<ToolResult> {
  try {
    console.log(`[SubagentTool] Spawning ${params.tasks.length} subagents in parallel`);

    const configs = params.tasks.map(task => ({
      type: task.type,
      task: task.task,
      context: task.context,
      timeout: task.timeout || 60000,
    }));

    const results = await spawnParallelSubagents(configs);

    const successful = results.filter(r => r.success).length;
    const total = results.length;

    console.log(`[SubagentTool] Completed: ${successful}/${total} successful`);

    const taskDescriptions = params.tasks.map(t => t.task);

    return {
      success: successful > 0,
      output: formatParallelResults(results, taskDescriptions),
      data: {
        results,
        successful,
        total,
        parallelism: params.maxParallelism || 3,
      },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[SubagentTool] Error:', errorMsg);

    return {
      success: false,
      output: `Failed to spawn parallel subagents: ${errorMsg}`,
      error: errorMsg,
    };
  }
}
