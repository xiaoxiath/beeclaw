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

// ---------------------------------------------------------------------------
// CommandApprovalPort — local port interface for command safety assessment.
//
// Mirrors the public API of packages/bee/src/safety/command-approval.ts
// WITHOUT creating a static import dependency on the bee layer.
// ---------------------------------------------------------------------------

/** Danger-pattern descriptor (mirrors DangerPattern from bee layer). */
export interface DangerPatternDescriptor {
  pattern: RegExp;
  level: 'safe' | 'warning' | 'dangerous' | 'critical';
  category: string;
  description: string;
}

/** Result of a command safety assessment (mirrors ApprovalAssessment). */
export interface ApprovalAssessmentResult {
  level: 'safe' | 'warning' | 'dangerous' | 'critical';
  matchedPatterns: DangerPatternDescriptor[];
  requiresApproval: boolean;
  directReject: boolean;
}

/**
 * Port interface consumed by ToolDispatcher for command approval.
 *
 * Every method signature matches the concrete CommandApproval class
 * in packages/bee/src/safety/command-approval.ts exactly:
 *  - assess() is async and returns Promise<ApprovalAssessmentResult>
 *  - recordApproval(command, permanent) — records user approval
 *  - fingerprint(command) — stable SHA-256 based fingerprint
 */
export interface CommandApprovalPort {
  assess(command: string, toolName: string): Promise<ApprovalAssessmentResult>;
  recordApproval(command: string, permanent: boolean): void;
  fingerprint(command: string): string;
}

// ---------------------------------------------------------------------------
// ToolDispatcher
// ---------------------------------------------------------------------------

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

/**
 * Tool names that represent command-execution tools.
 * Must match the COMMAND_TOOLS export in command-approval.ts.
 */
const COMMAND_TOOLS = new Set([
  'code_execute',
  'execute_command',
  'bash',
  'shell',
  'terminal',
  'claude_code',
]);

export class ToolDispatcher {
  constructor(
    private toolExecutor: ToolExecutor,
    private hookRunner: IHookRunner | null,
    private loopDetector: LoopDetector,
    private blockedTools?: string[],
    private timeoutEnforcer?: TimeoutEnforcer,
    private commandApproval?: CommandApprovalPort,
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

    // ── Command approval gate ─────────────────────────────────────────
    if (this.commandApproval && COMMAND_TOOLS.has(toolName)) {
      const command = typeof params.command === 'string'
        ? params.command
        : typeof params.code === 'string'
          ? params.code
          : typeof params.input === 'string'
            ? params.input
            : JSON.stringify(params);

      // assess() is async — await it
      const assessment = await this.commandApproval.assess(command, toolName);

      if (assessment.directReject) {
        const patternDescs = assessment.matchedPatterns.map(p => p.description).join('; ');
        const rejectMsg = `Command rejected by safety policy (${assessment.level}): ${patternDescs}`;
        const rejectResult = { success: false, error: rejectMsg, rejected: true };
        opts?.onToolResult?.(toolName, rejectResult);
        return { call, result: rejectResult, error: rejectMsg };
      }

      if (assessment.requiresApproval) {
        const patternDescs = assessment.matchedPatterns.map(p => `[${p.category}] ${p.description}`).join('; ');

        // Notify via hook (extra fields are informational; IHookRunner ignores unknown keys)
        if (this.hookRunner) {
          await this.hookRunner.runBeforeToolCall({
            toolName,
            params,
            timestamp: new Date().toISOString(),
            approvalRequired: true,
            approvalLevel: assessment.level,
          } as any);
        }

        // Block execution: return an error result that tells the LLM to ask the user
        const approvalMsg =
          `[Safety] This command requires user approval before execution.\n` +
          `Level: ${assessment.level}\n` +
          `Matched: ${patternDescs}\n` +
          `Please ask the user for explicit permission before retrying this command.`;

        messages.push({ role: 'system', content: approvalMsg });

        const pendingResult = {
          success: false,
          error: approvalMsg,
          requiresApproval: true,
          level: assessment.level,
        };
        opts?.onToolResult?.(toolName, pendingResult);
        return { call, result: pendingResult, error: approvalMsg };
      }
    }
    // ── End command approval gate ─────────────────────────────────────

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
