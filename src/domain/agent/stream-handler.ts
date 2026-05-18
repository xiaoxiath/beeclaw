/**
 * Stream Handler — Streaming chat response generator.
 *
 * Responsible for:
 * - The chatStream() async generator that yields content/tool events
 * - Mirrors chat() capabilities (skill enforcement, health monitoring,
 *   token budget guards, tool batching) in streaming mode
 *
 * Extracted from the Agent god-object (index.ts) for single-responsibility.
 */

import type { ChatMessage, OpenAITool, MultimodalContent, UserContext } from './types';
import { callAIWithFallback, hasToolCalls, extractToolCalls } from './api';

// Inlined for the same reason as orchestrator.ts — keep tests that mock
// './types' from needing to re-list every named export.
const FALLBACK_TOKEN_BUDGET_DEFAULT =
  '处理过程中消耗了过多 Token，已提前终止。请尝试简化问题或拆分为多个步骤。';
import { getAllToolsForAI } from './tools';
import {
  estimateMessageTokens,
  type AgentContextConfig,
} from './context';
import { logger } from '../../infra/observability/logger';
import { getHybridToolSelector } from './hybrid-tool-selector';
import { SkillEnforcementEngine } from '../skills/enforcement';
import type { IHookRunner, IHealthMonitor } from '../ports';
import type { ToolDispatcher } from './tool-dispatcher';
import type { MemoryManager } from './memory-manager';
import type { ContextManagerState } from './context-manager';
import { manageContextCompression, trimContextIfNeeded } from './context-manager';

/**
 * Safely parse JSON with fallback (duplicated locally to avoid circular deps).
 */
function safeJsonParse<T>(jsonString: string, fallback: T): T {
  try {
    return JSON.parse(jsonString);
  } catch {
    return fallback;
  }
}

function jsonStringProp(obj: unknown, key: string): string | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    return typeof val === 'string' ? val : undefined;
  }
  return undefined;
}

/** Internal state required by chatStream, passed from the Agent class. */
export interface StreamHandlerDeps {
  options: {
    provider: any;
    model: string;
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    tools?: OpenAITool[];
    maxToolIterations?: number;
    blockedTools?: string[];
    compressionConfig?: any;
    tokenBudgetPctPerTurn?: number;
    maxTokensPerTurn?: number;
    fallbackMessages?: { tokenBudgetExceeded?: string; maxIterationsReached?: string };
    fallback?: { provider: any; model: string; temperature?: number; topP?: number; maxTokens?: number };
  };
  messages: ChatMessage[];
  estimatedTokens: number;
  contextConfig: AgentContextConfig;
  autoRefreshMemory: boolean;
  hookRunner: IHookRunner | null;
  healthMonitor?: IHealthMonitor;
  skillEnforcement?: SkillEnforcementEngine;
  toolDispatcher: ToolDispatcher;
  memoryManager: MemoryManager;
  usedSkillsInTurn: Set<string>;
  lastToolCalls: Array<any>;
  currentUserContext?: UserContext;
  _compressing: boolean;
  compressedSummary: string;
  /** Bound methods from the Agent instance */
  refreshTime: () => void;
  refreshMemory: () => void;
  getMessagesForAPI: () => ChatMessage[];
  loopDetector: { reset: () => void };
}

/**
 * Chat with streaming support.
 *
 * [P0 FIX] Added full context management (token tracking, compression, time refresh)
 * that was previously missing from the streaming path. Without this fix, long
 * conversations using chatStream() would grow unbounded until exceeding the
 * model's context window.
 */
export async function* chatStream(
  deps: StreamHandlerDeps,
  userMessage: string | MultimodalContent[],
  options?: {
    tools?: OpenAITool[];
    userContext?: UserContext;
  },
): AsyncGenerator<
  | { type: 'content'; content: string }
  | { type: 'tool_call'; name: string; params: Record<string, unknown> }
  | { type: 'tool_result'; name: string; result: unknown }
> {
  // [AUDIT FIX M-01] chatStream now mirrors chat() capabilities
  deps.refreshTime();

  if (deps.autoRefreshMemory) {
    deps.refreshMemory();
  }

  // Store user context for tool execution
  deps.currentUserContext = options?.userContext;

  // [AUDIT FIX M-01] Use shared turn preparation (same as chat())
  deps.usedSkillsInTurn.clear();
  deps.loopDetector.reset();
  deps.lastToolCalls = [];

  // [AUDIT FIX M-01] Run hook for message received
  if (deps.hookRunner) {
    await deps.hookRunner.runMessageReceived({
      content: typeof userMessage === 'string' ? userMessage : JSON.stringify(userMessage),
      timestamp: new Date().toISOString(),
    });
  }

  // Add user message with token tracking
  deps.messages.push({
    role: 'user',
    content: userMessage,
  });
  deps.estimatedTokens += estimateMessageTokens({ role: 'user', content: userMessage });

  // [AUDIT FIX M-04] Coordinated context compression strategy
  const ctxState: ContextManagerState = {
    messages: deps.messages,
    estimatedTokens: deps.estimatedTokens,
    contextConfig: deps.contextConfig,
    hookRunner: deps.hookRunner,
    provider: deps.options.provider,
    compressionConfig: deps.options.compressionConfig,
    compressedSummary: deps.compressedSummary,
    _compressing: deps._compressing,
  };
  await manageContextCompression(ctxState);
  // Sync back mutated state
  deps.estimatedTokens = ctxState.estimatedTokens;
  deps.compressedSummary = ctxState.compressedSummary;
  deps._compressing = ctxState._compressing;
  // messages array is mutated in-place so no reassignment needed

  // Get all available tools, then optionally filter via HybridToolSelector
  let tools = options?.tools || deps.options.tools || getAllToolsForAI();
  const selector = getHybridToolSelector();
  try {
    const messageText = typeof userMessage === 'string'
      ? userMessage
      : Array.isArray(userMessage)
        ? userMessage.filter((c: any) => c.type === 'text').map((c: any) => c.text).join(' ')
        : '';
    if (messageText) {
      tools = await selector.select(tools, messageText);
    }
  } catch (error) {
    // Same treatment as chat() path — see orchestrator.ts for rationale.
    selector.recordFailure(error);
    logger.warn('[Agent.chatStream] HybridToolSelector failed, falling back to all tools', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // [AUDIT FIX M-01] Skill enforcement matching (same as chat())
  if (deps.skillEnforcement) {
    const messageText = typeof userMessage === 'string'
      ? userMessage
      : Array.isArray(userMessage)
        ? userMessage.filter((c: any) => c.type === 'text').map((c: any) => c.text).join(' ')
        : '';

    if (messageText) {
      const skillMatch = deps.skillEnforcement.matchSkillsForQuery(messageText);
      if (skillMatch.matched) {
        deps.messages.push({
          role: 'system',
          content: skillMatch.directive,
        });
        deps.estimatedTokens += estimateMessageTokens({
          role: 'system',
          content: skillMatch.directive,
        });
        logger.info(`[SkillEnforcement.chatStream] Injected directive for ${skillMatch.skills.length} matching skill(s)`);
      }
    }
  }

  // [AUDIT FIX M-01] Health monitor integration (same as chat())
  if (deps.healthMonitor?.hasIssues()) {
    const healthCtx = deps.healthMonitor.buildHealthContext();
    if (healthCtx) {
      deps.messages.push({
        role: 'system',
        content: healthCtx,
      });
      deps.estimatedTokens += estimateMessageTokens({
        role: 'system',
        content: healthCtx,
      });
      logger.info('[Agent.chatStream] Injected data source health warning into context');
    }
  }

  let iterations = 0;
  let finalContent = '';

  // [P2 FIX 4.2] Global token budget guard for streaming tool loop
  const tokenBudgetPctStream = deps.options.tokenBudgetPctPerTurn ?? 0.6;
  const maxTokensPerTurnStream = deps.options.maxTokensPerTurn
    ?? Math.floor(deps.contextConfig.maxTokens * tokenBudgetPctStream);
  const turnStartTokensStream = deps.estimatedTokens;

  while (iterations < (deps.options.maxToolIterations || 5)) {
    iterations++;

    // [P2 FIX 4.2] Token budget check
    const streamTurnUsed = deps.estimatedTokens - turnStartTokensStream;
    if (streamTurnUsed > maxTokensPerTurnStream) {
      logger.warn(
        `[Agent.chatStream] Token budget guard triggered: ${streamTurnUsed}/${maxTokensPerTurnStream}`
      );
      const msg = deps.options.fallbackMessages?.tokenBudgetExceeded
        ?? FALLBACK_TOKEN_BUDGET_DEFAULT;
      yield { type: 'content' as const, content: `\n\n⚠️ ${msg}` };
      break;
    }

    const response = await callAIWithFallback({
      provider: deps.options.provider,
      model: deps.options.model,
      // [P0 FIX] Strip metadata before sending to API
      messages: deps.getMessagesForAPI(),
      tools,
      temperature: deps.options.temperature,
      topP: deps.options.topP,
      maxTokens: deps.options.maxTokens,
    }, deps.options.fallback);

    const assistantMessage = response.choices[0].message;
    const finishReason = response.choices[0].finish_reason;
    // Cache the tool-calls predicate — the empty-content branch and the
    // tool-execution branch both consult it. Calling hasToolCalls twice
    // would silently double-consume mockReturnValueOnce setups in tests
    // (real impl is idempotent, but the cached form is cleaner anyway).
    const responseHasToolCalls = hasToolCalls(response);

    // Yield content. If the provider returned no visible text AND no
    // tool calls (Codex reasoning-only responses do this with
    // finish_reason: 'incomplete'), surface a one-line placeholder so
    // the UI shows something instead of silently flushing the turn.
    if (assistantMessage.content) {
      logger.debug(`[Agent.chatStream] yield content (${assistantMessage.content.length} chars, finish=${finishReason})`);
      yield { type: 'content', content: assistantMessage.content };
      finalContent = assistantMessage.content;
    } else if (!responseHasToolCalls) {
      const note = finishReason === 'incomplete'
        ? '(no visible text — model returned only internal reasoning. Try rephrasing or asking a more concrete question.)'
        : '(empty response)';
      logger.warn(`[Agent.chatStream] empty content (finish=${finishReason}) — yielding placeholder`);
      yield { type: 'content', content: note };
      finalContent = note;
    }

    // Add to history with token tracking
    deps.messages.push({
      role: 'assistant',
      content: assistantMessage.content || '',
      tool_calls: assistantMessage.tool_calls,
    });
    // [P0 FIX] Track assistant message tokens — was missing from chatStream
    deps.estimatedTokens += estimateMessageTokens({
      role: 'assistant',
      content: assistantMessage.content || '',
      tool_calls: assistantMessage.tool_calls,
    });

    // Handle tool calls
    // [P0 FIX] chatStream now mirrors chat() with parallel tool execution,
    // loop detection, hookRunner integration, and content block callbacks.
    if (responseHasToolCalls) {
      const toolCalls = extractToolCalls(response);

      // [P0 FIX] Use batched parallel execution (same as chat())
      const allBatchResults = await deps.toolDispatcher.executeToolBatches(
        toolCalls, iterations, deps.messages, {
          userContext: deps.currentUserContext,
        },
      );

      for (const { call, result } of allBatchResults) {
        const params = safeJsonParse(call.function.arguments, {});

        // Track skill usage
        if (call.function.name === 'skill_get') {
          const skillName = jsonStringProp(params, 'name');
          if (skillName) {
            deps.usedSkillsInTurn.add(skillName);
          }
        }

        yield { type: 'tool_call' as const, name: call.function.name, params };
        yield { type: 'tool_result' as const, name: call.function.name, result };

        let resultToSave = result;
        if (deps.hookRunner) {
          resultToSave = deps.toolDispatcher.persistResult(call.function.name, result, call.id);
        }

        const toolMsg: ChatMessage = {
          role: 'tool',
          content: JSON.stringify(resultToSave),
          tool_call_id: call.id,
        };
        deps.messages.push(toolMsg);
        deps.estimatedTokens += estimateMessageTokens(toolMsg);
      }

      continue;
    }

    break;
  }

  // [P0 FIX] Post-response context check — was missing from chatStream
  const trimState: ContextManagerState = {
    messages: deps.messages,
    estimatedTokens: deps.estimatedTokens,
    contextConfig: deps.contextConfig,
    hookRunner: deps.hookRunner,
    provider: deps.options.provider,
    compressedSummary: deps.compressedSummary,
    _compressing: deps._compressing,
  };
  trimContextIfNeeded(trimState);
  deps.estimatedTokens = trimState.estimatedTokens;
  deps._compressing = trimState._compressing;

  // Record conversation to memory (delegated to MemoryManager — A-P1-05)
  const userMessageStr = typeof userMessage === 'string' ? userMessage : '[Multimodal message]';
  await deps.memoryManager.recordConversation(userMessageStr, finalContent);

  // Yield skill attribution if any skills were used
  if (deps.usedSkillsInTurn.size > 0) {
    const skillNames = Array.from(deps.usedSkillsInTurn).join(', ');
    yield { type: 'content', content: `\n\n---\n_📋 Used skill: ${skillNames}_` };
  }

  // [P0 FIX] Log context usage for monitoring — was missing from chatStream
  logger.debug(`[Agent.chatStream] Complete - Context: ${deps.estimatedTokens} / ${deps.contextConfig.maxTokens} tokens (${Math.round(deps.estimatedTokens / deps.contextConfig.maxTokens * 100)}%)`);
}
