/**
 * bee — Tool Dispatcher.
 *
 * Dispatches tool calls from AI responses to executors.
 * Handles blocked tools, error recovery, and per-call overrides.
 * No singletons — instantiate with configuration.
 */

import type { ToolCall, ToolResult } from '../core/types';
import { getLogger } from '../core/logger';

export type ToolExecutorFn = (name: string, params: Record<string, unknown>) => Promise<unknown>;

export interface ToolDispatcherConfig {
  executor: ToolExecutorFn;
  /** Tool names that should be blocked */
  blockedTools?: string[];
}

export interface DispatchOptions {
  /** Override executor for this dispatch */
  executor?: ToolExecutorFn;
}

export class ToolDispatcher {
  private executor: ToolExecutorFn;
  private blockedTools: Set<string>;

  constructor(config: ToolDispatcherConfig) {
    this.executor = config.executor;
    this.blockedTools = new Set(config.blockedTools ?? []);
  }

  /**
   * Dispatch an array of tool calls.
   */
  async dispatch(toolCalls: ToolCall[], options?: DispatchOptions): Promise<ToolResult[]> {
    const executor = options?.executor ?? this.executor;
    const results: ToolResult[] = [];

    for (const call of toolCalls) {
      const result = await this.dispatchSingle(call, executor);
      results.push(result);
    }

    return results;
  }

  isToolBlocked(toolName: string): boolean {
    return this.blockedTools.has(toolName);
  }

  private async dispatchSingle(
    call: ToolCall,
    executor: ToolExecutorFn,
  ): Promise<ToolResult> {
    const logger = getLogger();

    // Check blocked
    if (this.isToolBlocked(call.function.name)) {
      return {
        tool_call_id: call.id,
        content: JSON.stringify({
          success: false,
          error: `Tool "${call.function.name}" is blocked`,
        }),
      };
    }

    // Parse arguments
    let params: Record<string, unknown>;
    try {
      params = JSON.parse(call.function.arguments);
    } catch {
      return {
        tool_call_id: call.id,
        content: JSON.stringify({
          success: false,
          error: `Failed to parse arguments for "${call.function.name}": ${call.function.arguments}`,
        }),
      };
    }

    // Execute
    try {
      const result = await executor(call.function.name, params);
      return {
        tool_call_id: call.id,
        content: JSON.stringify(result),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        tool_call_id: call.id,
        content: JSON.stringify({
          success: false,
          error: errorMsg,
        }),
      };
    }
  }
}
