/**
 * ToolDispatcher — Extracted from Agent god-object (Phase 4)
 *
 * Handles tool execution orchestration: batching, loop detection,
 * blocked-tool checks, and hook-runner integration.
 */

import { logger } from '../../infra/observability/logger';
import type { ToolExecutor, ToolCall, UserContext, ChatMessage } from './types';
import type { LoopDetector } from '../../infra/resilience/loop-detector';
import type { IHookRunner } from '../ports';
import { groupToolCalls, getGroupingStats } from './tool-dependencies';
import { TimeoutEnforcer, ToolTimeoutError } from '../../infra/resilience/timeout-enforcer';

function safeJsonParse<T>(jsonString: string, fallback: T): T {
  try { return JSON.parse(jsonString); }
  catch { return fallback; }
}

export interface ToolDispatchOptions {
  onToolCall?: (name: string, params: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: unknown) => void;
  onContentBlock?: (block: any) => void;
  userContext?: UserContext;
}

export interface ToolBatchResult {
  call: ToolCall;
  result: any;
  error: string | null;
}

export class ToolDispatcher {
  constructor(
    private toolExecutor: ToolExecutor,
    private hookRunner: IHookRunner | null,
    private loopDetector: LoopDetector,
    private blockedTools?: string[],
    private timeoutEnforcer?: TimeoutEnforcer,
  ) {}

  isToolBlocked(toolName: string): boolean {
    return this.blockedTools?.includes(toolName) ?? false;
  }

  async executeSingle(
    call: ToolCall, iteration: number,
    messages: Array<{ role: string; content: string }>,
    opts?: ToolDispatchOptions,
  ): Promise<ToolBatchResult> {
    const params = safeJsonParse(call.function.arguments, {});
    const toolName = call.function.name;
    opts?.onToolCall?.(toolName, params);
    opts?.onContentBlock?.({ type: 'tool_use', id: call.id, name: toolName, input: params });

    if (this.hookRunner) {
      await this.hookRunner.runBeforeToolCall({ toolName, params, timestamp: new Date().toISOString() });
    }

    const loopCheck = this.loopDetector.check(toolName, params);
    if (loopCheck.action === 'warn') {
      messages.push({ role: 'system', content: loopCheck.warningMessage || '检测到可能的循环行为' });
      this.loopDetector.acknowledgeWarning();
    } else if (loopCheck.action === 'break') {
      const errorMsg = `检测到循环行为: ${loopCheck.details}。请尝试不同的方法。`;
      opts?.onToolResult?.(toolName, { success: false, error: errorMsg });
      return { call, result: { success: false, error: errorMsg }, error: errorMsg };
    }
    this.loopDetector.recordToolCall(toolName, params, iteration);

    if (this.isToolBlocked(toolName)) {
      const blockedMsg = `Tool "${toolName}" is blocked in this context.`;
      const blockedResult = { success: false, error: blockedMsg, blocked: true };
      opts?.onToolResult?.(toolName, blockedResult);
      return { call, result: blockedResult, error: blockedMsg };
    }

    try {
      let result;
      if (this.timeoutEnforcer) {
        result = await this.timeoutEnforcer.executeWithToolTimeout(
          toolName,
          async (_signal) => this.toolExecutor(toolName, params, opts?.userContext),
        );
      } else {
        result = await this.toolExecutor(toolName, params, opts?.userContext);
      }
      this.loopDetector.recordToolResult(result);
      if (result._contentBlock && result.success && result.data) opts?.onContentBlock?.(result.data);
      if (this.hookRunner) {
        await this.hookRunner.runAfterToolCall({ toolName, result, timestamp: new Date().toISOString() });
      }
      opts?.onToolResult?.(toolName, result);
      return { call, result, error: null };
    } catch (error) {
      if (error instanceof ToolTimeoutError) {
        const timeoutMs = this.timeoutEnforcer?.getToolTimeout(toolName) ?? 'unknown';
        const errorMsg = `Tool "${toolName}" timed out after ${timeoutMs}ms`;
        logger.warn(`[ToolDispatcher] ${errorMsg}`);
        const errorResult = { success: false, error: errorMsg, timeout: true };
        opts?.onToolResult?.(toolName, errorResult);
        return { call, result: errorResult, error: errorMsg };
      }
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      const errorResult = { success: false, error: errorMsg };
      opts?.onToolResult?.(toolName, errorResult);
      return { call, result: errorResult, error: errorMsg };
    }
  }

  async executeToolBatches(
    toolCalls: ToolCall[], iteration: number,
    messages: ChatMessage[],
    opts?: ToolDispatchOptions,
  ): Promise<ToolBatchResult[]> {
    const batches = groupToolCalls(toolCalls.map(tc => ({ name: tc.function.name, call: tc })));
    const stats = getGroupingStats(toolCalls.map(tc => ({ name: tc.function.name })));
    logger.debug(`\n[ToolDispatcher] Plan: ${stats.totalCalls} calls, ${stats.parallelBatches} parallel batches`);
    const allResults: ToolBatchResult[] = [];
    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map(({ call }) => this.executeSingle(call, iteration, messages as unknown as Array<{ role: string; content: string }>, opts)),
      );
      allResults.push(...batchResults);
    }
    return allResults;
  }

  persistResult(toolName: string, result: unknown, toolCallId: string): Promise<Record<string, unknown>> | unknown {
    if (!this.hookRunner) return result;
    return this.hookRunner.runToolResultPersist({ toolName, result, toolCallId, timestamp: new Date().toISOString() });
  }
}
