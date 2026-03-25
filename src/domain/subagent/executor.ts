/**
 * Subagent Tool Executor
 *
 * Execute subagent tools from the builtin tools system
 */

import { logger } from '../../infra/observability/logger';
import { spawnSubagent, spawnParallelSubagents } from './runtime';
import { formatSubagentResult, formatParallelResults } from './tools';
import type { SpawnSubagentParams, SpawnParallelParams } from './tools';
import type { BuiltinToolResult } from '../tools/builtin';

/**
 * Execute spawn_subagent tool
 */
export async function executeSpawnSubagent(
  params: SpawnSubagentParams
): Promise<BuiltinToolResult> {
  try {
    logger.debug(`[SubagentTool] Spawning ${params.type} subagent`);
    logger.debug(`[SubagentTool] Task: ${params.task.substring(0, 100)}...`);

    const result = await spawnSubagent({
      type: params.type,
      task: params.task,
      context: params.context,
      timeout: params.timeout || 180000,
      maxTokens: params.maxTokens,
    });

    if (result.success) {
      logger.info(`[SubagentTool] Success in ${result.duration}ms`);

      return {
        success: true,
        data: formatSubagentResult(result, params.task),
      };
    } else {
      // Ensure error is a string
      const errorStr = typeof result.error === 'string'
        ? result.error
        : JSON.stringify(result.error);

      logger.error(`[SubagentTool] Failed: ${errorStr}`);

      return {
        success: false,
        error: errorStr,
      };
    }
  } catch (error) {
    // Properly serialize error to string
    let errorMsg: string;
    if (error instanceof Error) {
      errorMsg = error.message;
    } else if (typeof error === 'string') {
      errorMsg = error;
    } else {
      try {
        errorMsg = JSON.stringify(error);
      } catch {
        errorMsg = 'Unknown error';
      }
    }

    logger.error('[SubagentTool] Error:', errorMsg);

    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Execute spawn_parallel tool
 */
export async function executeSpawnParallel(
  params: SpawnParallelParams
): Promise<BuiltinToolResult> {
  try {
    logger.debug(`[SubagentTool] Spawning ${params.tasks.length} subagents in parallel`);

    const configs = params.tasks.map(task => ({
      type: task.type,
      task: task.task,
      context: task.context,
      timeout: task.timeout || 180000,
    }));

    const results = await spawnParallelSubagents(configs);

    const successful = results.filter(r => r.success).length;
    const total = results.length;

    logger.info(`[SubagentTool] Completed: ${successful}/${total} successful`);

    const taskDescriptions = params.tasks.map(t => t.task);

    return {
      success: successful > 0,
      data: formatParallelResults(results, taskDescriptions),
    };
  } catch (error) {
    // Properly serialize error to string
    let errorMsg: string;
    if (error instanceof Error) {
      errorMsg = error.message;
    } else if (typeof error === 'string') {
      errorMsg = error;
    } else {
      try {
        errorMsg = JSON.stringify(error);
      } catch {
        errorMsg = 'Unknown error';
      }
    }

    logger.error('[SubagentTool] Error:', errorMsg);

    return {
      success: false,
      error: errorMsg,
    };
  }
}
