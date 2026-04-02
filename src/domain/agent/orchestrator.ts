/**
 * Orchestrator — Agent class and conversation loop.
 *
 * This is the core of the agent system. Responsibilities:
 * - Agent construction (provider resolution, hook init, module wiring)
 * - The synchronous `chat()` conversation loop (tool dispatch, skill
 *   enforcement, evolution triggers, token budget guards)
 * - Thin delegation to extracted modules:
 *     context-manager  — trimming / compression
 *     stream-handler   — chatStream() async generator
 *     prompt-builder   — system-prompt assembly (used via agent-factory)
 *
 * Extracted from the Agent god-object (index.ts) for single-responsibility.
 */

import { LoopDetector, createLoopDetector } from '../../infra/resilience/loop-detector';
import { TimeoutEnforcer } from '../../infra/resilience/timeout-enforcer';

import type { AgentOptions, ChatMessage, OpenAITool, ToolExecutor, MultimodalContent, UserContext } from './types';
import { stripMessageMetadata } from './types';
import { callAI, hasToolCalls, extractToolCalls, extractContent } from './api';
import { getAllToolsForAI, buildVolatileContext } from './tools';
import { logger } from '../../infra/observability/logger';
import { getDynamicMemoryInjector } from '../memory';
import { getSkillStore } from '../skills/store';
// Task 3: Use port interfaces instead of direct adapter imports
import { getHookRunnerPort, getHealthMonitorPort } from '../ports';
import type { IHookRunner, IHealthMonitor } from '../ports';
import { recordSkillFailure, getReflectionStats } from './evolution';
import { checkPreferenceTriggers } from './evolution/preference-learning';
import { triggerSelfEvolution } from './evolution/self-evolution';
import {
  estimateMessageTokens,
  estimateTokens,
  compressToolResult,
  formatTokenStats,
  cleanTokenStats,
  DEFAULT_TOKEN_STATS_CONFIG,
  calculateContextConfig,
  type AgentContextConfig,
  type TokenStatsConfig,
  type TokenStats,
} from './context';
import { type LegacyCompressionResult as CompressionResult } from './compression';
import { SkillEnforcementEngine, type SkillMatchResult } from '../skills/enforcement';
import { getHybridToolSelector } from './hybrid-tool-selector';

// Phase 4: Extracted modules from Agent god-object
import { ToolDispatcher } from './tool-dispatcher';
import { createDefaultToolExecutor } from './tool-executor';
import { MemoryManager } from './memory-manager';

// Extracted sub-modules (this refactor)
import {
  trimContextIfNeeded,
  compressContextWithLLM as compressContextWithLLMImpl,
  manageContextCompression,
  type ContextManagerState,
} from './context-manager';
import { chatStream as chatStreamImpl, type StreamHandlerDeps } from './stream-handler';

/**
 * Safely parse JSON with fallback
 */
function safeJsonParse<T>(jsonString: string, fallback: T): T {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    logger.error('[Agent] Failed to parse JSON:', error, 'Input:', jsonString.substring(0, 100));
    return fallback;
  }
}

// Helper to safely extract a string property from parsed JSON
function jsonStringProp(obj: unknown, key: string): string | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    return typeof val === 'string' ? val : undefined;
  }
  return undefined;
}

// Helper to safely extract a boolean property from parsed JSON
function jsonBoolProp(obj: unknown, key: string): boolean | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    return typeof val === 'boolean' ? val : undefined;
  }
  return undefined;
}

export class Agent {
  private options: AgentOptions;
  private messages: ChatMessage[] = [];
  private toolExecutor: ToolExecutor;
  private baseSystemPrompt: string;
  private autoRefreshMemory: boolean;
  private contextConfig: AgentContextConfig;
  private tokenStatsConfig: TokenStatsConfig;
  private estimatedTokens: number = 0;
  private usedSkillsInTurn: Set<string> = new Set();
  private hookRunner: IHookRunner | null = null;
  private lastToolCalls: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }> = [];
  private loopDetector: LoopDetector = createLoopDetector();
  private currentUserContext?: UserContext;  // User context for tool execution
  private skillEnforcement?: SkillEnforcementEngine;
  private healthMonitor?: IHealthMonitor;
  private memoryManager: MemoryManager = new MemoryManager();
  // B-P1-06: Mutex flag to prevent concurrent compression
  private _compressing = false;

  // Phase 4: Extracted focused modules
  private toolDispatcher: ToolDispatcher;

  // [P1] Evolution system: tracks reflection triggers and preference signals
  private evolutionEnabled: boolean = true;
  private turnsSinceLastReflection: number = 0;
  private readonly REFLECTION_TURN_INTERVAL = 5; // Check every N turns

  // Compressed context summary (from LLM compression)
  private compressedSummary: string = '';

  /**
   * Check if a tool is blocked from execution in the current context.
   * Used to prevent recursive tool calls in proactive tasks.
   */
  private isToolBlocked(toolName: string): boolean {
    return this.options.blockedTools?.includes(toolName) ?? false;
  }

  constructor(options: AgentOptions & {
    contextConfig?: Partial<AgentContextConfig>;
    tokenStatsConfig?: Partial<TokenStatsConfig>;
  }) {
    this.options = {
      maxToolIterations: 30,
      ...options,
    };
    this.toolExecutor = options.toolExecutor || createDefaultToolExecutor();
    this.baseSystemPrompt = options.systemPrompt || '';
    this.autoRefreshMemory = (options as any).autoRefreshMemory ?? false;

    // Initialize plugin hook runner via port
    try {
      this.hookRunner = getHookRunnerPort();
    } catch {
      // Plugin system not initialized
    }

    // Trigger before_model_resolve hook
    let resolvedModel = options.model;
    let resolvedProvider = options.provider;
    if (this.hookRunner) {
      const modelResolution = this.hookRunner.runBeforeModelResolve({
        model: options.model,
        provider: options.provider?.type,
        timestamp: new Date().toISOString(),
      }) as any; // Original code accessed sync-style props on what is now a Promise

      if (modelResolution?.model) {
        resolvedModel = modelResolution.model;
      }
      if (modelResolution?.provider) {
        resolvedProvider = modelResolution.provider;
      }
    }

    this.options.model = resolvedModel;
    this.options.provider = resolvedProvider!;

    this.contextConfig = calculateContextConfig(
      resolvedModel,
      options.maxTokens,
      options.contextConfig
    );

    this.tokenStatsConfig = { ...DEFAULT_TOKEN_STATS_CONFIG, ...options.tokenStatsConfig };

    if (options.systemPrompt) {
      // [KV-Cache] messages[0]: stable prompt prefix
      this.messages.push({
        role: 'system',
        content: options.systemPrompt,
      });
      // [KV-Cache] messages[1]: volatile time context (separate message so
      // the stable prefix stays byte-identical across turns for KV Cache reuse)
      const volatileCtx = buildVolatileContext();
      this.messages.push({
        role: 'system',
        content: volatileCtx,
      });
      this.estimatedTokens = estimateMessageTokens({ role: 'system', content: options.systemPrompt })
                           + estimateMessageTokens({ role: 'system', content: volatileCtx });
    }

    // [V2 FIX] Initialize skill enforcement engine
    try {
      const skillStore = getSkillStore();
      if (skillStore) {
        this.skillEnforcement = new SkillEnforcementEngine(
          {
            matchThreshold: 0.3,
            maxRecommendations: 3,
            injectDirectives: true,
            validateOutput: true,
          },
          logger,
        );
      }
    } catch (err) {
      logger.debug('[Agent] SkillEnforcement not available:', err);
    }

    // [V2 FIX] Get periodic health monitor instance (initialized in bootstrap-health.ts)
    // NOTE: Health monitor is now initialized in bootstrap-health.ts during app startup
    // to avoid creating multiple instances. We only get the existing instance here.
    try {
      const monitor = getHealthMonitorPort();
      if (monitor) {
        this.healthMonitor = monitor;
      }
    } catch (err) {
      logger.debug('[Agent] PeriodicHealthMonitor not available:', err);
    }

    // Phase 4: Initialize extracted modules
    this.toolDispatcher = new ToolDispatcher(
      this.toolExecutor,
      this.hookRunner,
      this.loopDetector,
      this.options.blockedTools,
      TimeoutEnforcer.fromConfig(),
    );

    // Trigger before_agent_start hook (async, fire-and-forget)
    // [E-P1-02] Added .catch() to prevent unhandled rejection
    if (this.hookRunner) {
      Promise.resolve().then(() => {
        this.hookRunner?.runBeforeAgentStart({
          timestamp: new Date().toISOString(),
        });
      }).catch((err) => {
        logger.warn('[Agent] before_agent_start hook failed (non-fatal):', err);
      });
    }
  }

  // ====================================================================
  // Public getters
  // ====================================================================

  // Get current token estimate
  getTokenEstimate(): number {
    return this.estimatedTokens;
  }

  // Get token stats config
  getTokenStatsConfig(): TokenStatsConfig {
    return { ...this.tokenStatsConfig };
  }

  // Get context config
  getContextConfig(): AgentContextConfig {
    return { ...this.contextConfig };
  }

  // Get conversation history
  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  // Get last tool calls from the most recent assistant message
  getLastToolCalls(): Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }> {
    return this.lastToolCalls;
  }

  // Get compressed summary
  getCompressedSummary(): string {
    return this.compressedSummary;
  }

  // ====================================================================
  // Memory & time refresh
  // ====================================================================

  // Refresh memory context (delegated to MemoryManager — A-P1-05)
  refreshMemory(): void {
    const tokenDelta = this.memoryManager.refreshMemory(
      this.baseSystemPrompt,
      this.messages,
      this.hookRunner,
    );
    this.estimatedTokens += tokenDelta;
  }

  /**
   * [KV-Cache] Refresh volatile time context in messages[1].
   *
   * Only the volatile message is mutated — the stable prefix (messages[0])
   * stays untouched so the LLM's prefix-cache stays valid. Time is quantized
   * to hourly slots, so within the same clock-hour even messages[1] is
   * byte-identical → ~100% cache hit rate during sustained usage.
   */
  refreshTime(): void {
    const volatileCtx = buildVolatileContext();

    // Find the second system message (volatile context)
    let volatileIndex = -1;
    let systemCount = 0;
    for (let i = 0; i < this.messages.length; i++) {
      if (this.messages[i].role === 'system') {
        systemCount++;
        if (systemCount === 2) { volatileIndex = i; break; }
      }
    }

    if (volatileIndex >= 0) {
      if (this.messages[volatileIndex].content === volatileCtx) return; // same hour — skip
      const oldTokens = estimateMessageTokens(this.messages[volatileIndex]);
      this.messages[volatileIndex].content = volatileCtx;
      const newTokens = estimateMessageTokens({ role: 'system', content: volatileCtx });
      this.estimatedTokens = this.estimatedTokens - oldTokens + newTokens;
    } else if (this.messages.length > 0 && this.messages[0].role === 'system') {
      // Volatile message missing — insert after stable prefix
      const msg = { role: 'system' as const, content: volatileCtx };
      this.messages.splice(1, 0, msg);
      this.estimatedTokens += estimateMessageTokens(msg);
    }
  }

  // ====================================================================
  // Message management
  // ====================================================================

  /**
   * Get messages ready for LLM API call (with metadata stripped).
   * [P0 FIX] Use this instead of raw this.messages when calling AI providers.
   */
  private getMessagesForAPI(): ChatMessage[] {
    return stripMessageMetadata(this.messages);
  }

  // Clear conversation history (keep system prompt)
  clearHistory(): void {
    if (this.hookRunner) {
      this.hookRunner.runBeforeReset({
        messages: this.messages,
        tokensBefore: this.estimatedTokens,
        timestamp: new Date().toISOString(),
      });
    }

    // Preserve all leading system-role messages (system prompt + time context, etc.)
    const systemMessages: ChatMessage[] = [];
    for (const m of this.messages) {
      if (m.role === 'system') {
        systemMessages.push(m);
      } else {
        break;
      }
    }

    if (systemMessages.length > 0) {
      this.messages = systemMessages;
      this.estimatedTokens = systemMessages.reduce(
        (sum, m) => sum + estimateMessageTokens(m), 0
      );
    } else {
      this.messages = [];
      this.estimatedTokens = 0;
    }

    // [V2 FIX] Clear skill enforcement traces
    this.skillEnforcement?.clearTraces();
  }

  // Add message to history with token tracking
  addMessage(message: ChatMessage): void {
    this.messages.push(message);
    this.estimatedTokens += estimateMessageTokens(message);
    this._trimContextIfNeeded();
  }

  // ====================================================================
  // Context management (delegated to context-manager module)
  // ====================================================================

  /** Build the shared mutable state object for context-manager functions. */
  private _ctxState(): ContextManagerState {
    return {
      messages: this.messages,
      estimatedTokens: this.estimatedTokens,
      contextConfig: this.contextConfig,
      hookRunner: this.hookRunner,
      provider: this.options.provider,
      compressionConfig: (this.options as any).compressionConfig,
      compressedSummary: this.compressedSummary,
      _compressing: this._compressing,
    };
  }

  /** Sync mutated scalars back from the context-manager state object. */
  private _syncCtxState(s: ContextManagerState): void {
    this.estimatedTokens = s.estimatedTokens;
    this.compressedSummary = s.compressedSummary;
    this._compressing = s._compressing;
    // messages array is shared by reference — no reassignment needed
    // unless manageContextCompression replaced the array entirely:
    if (s.messages !== this.messages) {
      this.messages = s.messages;
    }
  }

  private _trimContextIfNeeded(): void {
    const s = this._ctxState();
    trimContextIfNeeded(s);
    this._syncCtxState(s);
  }

  /**
   * Compress old messages using LLM for intelligent summarization
   */
  async compressContextWithLLM(): Promise<CompressionResult> {
    const s = this._ctxState();
    const result = await compressContextWithLLMImpl(s);
    this._syncCtxState(s);
    return result;
  }

  private async _manageContextCompression(): Promise<void> {
    const s = this._ctxState();
    await manageContextCompression(s);
    this._syncCtxState(s);
  }

  // ====================================================================
  // Chat — main conversation loop
  // ====================================================================

  /**
   * [AUDIT FIX M-04] Coordinated context compression.
   *
   * Enhanced with P0 Context Engineering features:
   * - Health monitoring (ContextHealthDashboard)
   * - Deduplication (SimHash)
   * - Smart selection (RRI + Lost-in-the-Middle)
   * - Three-tier compression
   */
  async chat(userMessage: string | MultimodalContent[], options?: {
    tools?: OpenAITool[];
    onToolCall?: (name: string, params: Record<string, unknown>) => void;
    onToolResult?: (name: string, result: unknown) => void;
    onStream?: (chunk: string) => void;
    /**
     * Callback for content blocks (for streaming Card V2 messages)
     * Called when tool use or final text is generated
     */
    onContentBlock?: (block: any) => void; // ContentBlock type from types/content-block
    /**
     * User context for tool execution (e.g., Feishu openId, chatId)
     */
    userContext?: UserContext;
    /**
     * Force a specific pattern, bypassing automatic selection
     * Used to avoid recursive pattern selection (e.g., in plan-execute subtasks)
     */
    pattern?: 'direct' | 'react' | 'plan-execute' | 'reflective';
  }): Promise<string> {
    this.refreshTime();

    if (this.autoRefreshMemory) {
      this.refreshMemory();
    }

    // Store user context for tool execution
    this.currentUserContext = options?.userContext;

    const tokensBefore = this.estimatedTokens;
    this.usedSkillsInTurn.clear();
    this.loopDetector.reset(); // Reset loop detector for new turn
    this.lastToolCalls = []; // Clear tool calls from previous turn

    // [P0 优化] 动态注入相关历史记忆
    let enrichedMessage = userMessage;
    if (typeof userMessage === 'string') {
      try {
        const injector = getDynamicMemoryInjector(this.options.provider);
        const userId = options?.userContext?.userId || 'default';
        enrichedMessage = await injector.inject(userMessage, userId);

        // 如果注入成功，记录日志
        if (enrichedMessage !== userMessage) {
          logger.info('[Agent] Dynamic memory injection triggered', {
            originalLength: userMessage.length,
            enrichedLength: (enrichedMessage as string).length,
            userId,
          });
        }
      } catch (error) {
        // 注入失败不影响主流程，使用原始消息
        logger.warn('[Agent] Dynamic memory injection failed, using original message', error);
        enrichedMessage = userMessage;
      }
    }

    // [P1] Collect preference signals from user message
    if (typeof enrichedMessage === 'string') {
      this.collectPreferenceSignals(enrichedMessage);
    }

    if (this.hookRunner) {
      await this.hookRunner.runMessageReceived({
        content: typeof enrichedMessage === 'string' ? enrichedMessage : JSON.stringify(enrichedMessage),
        timestamp: new Date().toISOString(),
      });
    }

    this.messages.push({
      role: 'user',
      content: enrichedMessage,
    });
    this.estimatedTokens += estimateMessageTokens({ role: 'user', content: enrichedMessage });

    // [AUDIT FIX M-04] Coordinated context compression strategy
    // Prevents race between rule-based trimming and LLM summarization
    await this._manageContextCompression();

    // Get all available tools, then optionally filter via HybridToolSelector
    let tools = options?.tools || this.options.tools || getAllToolsForAI();
    try {
      const selector = getHybridToolSelector();
      const messageText = typeof enrichedMessage === 'string'
        ? enrichedMessage
        : Array.isArray(enrichedMessage)
          ? enrichedMessage.filter((c: any) => c.type === 'text').map((c: any) => c.text).join(' ')
          : '';
      if (messageText) {
        tools = await selector.select(tools, messageText);
      }
    } catch (error) {
      logger.debug('[Agent] HybridToolSelector failed, using all tools', error);
    }

    // [P1+P2 优化] 智能选择控制模式
    // Standard agent loop
    let iterations = 0;
    let finalContent = '';
    let totalCompletionTokens = 0;

    // [V2 FIX] Pre-turn: Skill enforcement matching
    let skillMatch: SkillMatchResult | undefined;
    if (this.skillEnforcement) {
      const messageText = typeof userMessage === 'string'
        ? userMessage
        : Array.isArray(userMessage)
          ? userMessage.filter((c: any) => c.type === 'text').map((c: any) => c.text).join(' ')
          : '';

      if (messageText) {
        skillMatch = this.skillEnforcement.matchSkillsForQuery(messageText);
        if (skillMatch.matched) {
          // Inject skill enforcement directive as a system-level hint
          this.messages.push({
            role: 'system',
            content: skillMatch.directive,
          });
          this.estimatedTokens += estimateMessageTokens({
            role: 'system',
            content: skillMatch.directive,
          });
          logger.info(`[SkillEnforcement] Injected directive for ${skillMatch.skills.length} matching skill(s)`);
        }
      }
    }

    // [V2 FIX] Pre-turn: Inject health context if issues detected
    if (this.healthMonitor?.hasIssues()) {
      const healthCtx = this.healthMonitor.buildHealthContext();
      if (healthCtx) {
        this.messages.push({
          role: 'system',
          content: healthCtx,
        });
        this.estimatedTokens += estimateMessageTokens({
          role: 'system',
          content: healthCtx,
        });
        logger.info('[Agent] Injected data source health warning into context');
      }
    }

    // [P2 FIX 4.2] Global token budget guard for tool loop
    const maxTokensPerTurn = (this.options as any).maxTokensPerTurn
      ?? Math.floor(this.contextConfig.maxTokens * 0.6); // Default: 60% of context window
    const turnStartTokens = this.estimatedTokens;

    while (iterations < (this.options.maxToolIterations || 5)) {
      iterations++;

      // [P2 FIX 4.2] Check if we've consumed too many tokens in this turn
      const turnTokensUsed = this.estimatedTokens - turnStartTokens;
      if (turnTokensUsed > maxTokensPerTurn) {
        logger.warn(
          `[Agent] Token budget guard: turn used ${turnTokensUsed} tokens ` +
          `(limit: ${maxTokensPerTurn}). Forcing completion.`
        );
        // Get last assistant content as fallback
        const lastAssistant = [...this.messages].reverse().find(m => m.role === 'assistant');
        if (lastAssistant?.content && typeof lastAssistant.content === 'string') {
          finalContent = lastAssistant.content;
        } else {
          finalContent = '处理过程中消耗了过多 Token，已提前终止。请尝试简化问题或拆分为多个步骤。';
        }
        break;
      }

      // [P2 FIX 4.2] Warn when approaching 80% of turn budget
      if (turnTokensUsed > maxTokensPerTurn * 0.8 && iterations > 1) {
        logger.warn(
          `[Agent] Token budget warning: ${Math.round(turnTokensUsed / maxTokensPerTurn * 100)}% ` +
          `of turn budget used (${turnTokensUsed}/${maxTokensPerTurn})`
        );
      }

      const aiCallParams = {
        provider: this.options.provider,
        model: this.options.model,
        // [P0 FIX] Strip metadata before sending to API
        messages: this.getMessagesForAPI(),
        tools,
        temperature: this.options.temperature,
        topP: this.options.topP,
        maxTokens: this.options.maxTokens,
      };

      if (this.hookRunner) {
        await this.hookRunner.runLlmInput({
          provider: typeof aiCallParams.provider === 'string' ? aiCallParams.provider : aiCallParams.provider?.type,
          model: aiCallParams.model,
          messages: aiCallParams.messages,
          timestamp: new Date().toISOString(),
        });
      }

      const response = await callAI(aiCallParams);

      if (this.hookRunner) {
        await this.hookRunner.runLlmOutput({
          response,
          timestamp: new Date().toISOString(),
        });
      }

      const assistantMessage = response.choices[0].message;

      if (response.usage?.completion_tokens) {
        totalCompletionTokens += response.usage.completion_tokens;
      }

      let cleanedContent = cleanTokenStats(assistantMessage.content || '');

      // Extract and emit thinking content if present
      const thinkingMatch = cleanedContent.match(/<thinking>\n?([\s\S]*?)\n?<\/thinking>/);
      if (thinkingMatch && options?.onContentBlock) {
        const thinkingContent = thinkingMatch[1].trim();
        if (thinkingContent) {
          // Emit thinking block
          options.onContentBlock({
            type: 'thinking',
            thinking: thinkingContent,
          });
          logger.debug(`[Agent] 💭 Thinking process captured (${thinkingContent.length} chars)`);
        }
        // Remove thinking tags from content
        cleanedContent = cleanedContent.replace(/<thinking>\n?[\s\S]*?\n?<\/thinking>\n*/g, '').trim();
      }

      this.messages.push({
        role: 'assistant',
        content: cleanedContent,
        tool_calls: assistantMessage.tool_calls,
      });
      this.estimatedTokens += estimateMessageTokens({
        role: 'assistant',
        content: cleanedContent,
        tool_calls: assistantMessage.tool_calls,
      });

      // Update lastToolCalls for session persistence
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        this.lastToolCalls = assistantMessage.tool_calls;
      }

      if (hasToolCalls(response)) {
        const toolCalls = extractToolCalls(response);

        logger.debug(`\n${'='.repeat(80)}`);
        logger.debug(`[Agent] LLM decided to call ${toolCalls.length} tool(s):`);
        toolCalls.forEach((tc, idx) => {
          const params = safeJsonParse(tc.function.arguments, {});
          const paramsStr = JSON.stringify(params);
          const paramsPreview = paramsStr.length > 100 ? paramsStr.substring(0, 100) + '...' : paramsStr;
          logger.debug(`  ${idx + 1}. ${tc.function.name}(${paramsPreview})`);
        });
        logger.debug('='.repeat(80));

        // Emit thinking block for tool selection decision
        if (options?.onContentBlock) {
          const toolNames = toolCalls.map(tc => tc.function.name).join(', ');
          const thinkingText = `Decided to use ${toolCalls.length} tool(s): ${toolNames}`;
          options.onContentBlock({
            type: 'thinking',
            thinking: thinkingText,
          });
        }

        const skillGetCall = toolCalls.find(tc => tc.function.name === 'skill_get');
        const otherCalls = toolCalls.filter(tc => tc.function.name !== 'skill_get');

        if (skillGetCall && otherCalls.length > 0) {
          // 【修复 Bug 1】先执行 skill_get，但不要 continue，继续执行其他工具
          const params = safeJsonParse(skillGetCall.function.arguments, {});
          logger.debug(`\n[Skill] Getting skill: ${jsonStringProp(params, 'name')}`);
          options?.onToolCall?.(skillGetCall.function.name, params);

          // Generate ContentBlock for skill_get
          options?.onContentBlock?.({
            type: 'tool_use',
            id: skillGetCall.id,
            name: skillGetCall.function.name,
            input: params,
          });

          // [AUDIT FIX P-2] Check if tool is blocked
          if (this.isToolBlocked(skillGetCall.function.name)) {
            const blockedMsg = `Tool "${skillGetCall.function.name}" is blocked in this context.`;
            logger.warn(`[Agent] ${blockedMsg}`);
            const blockedResult = { success: false, error: blockedMsg, blocked: true };
            options?.onToolResult?.(skillGetCall.function.name, blockedResult);
          } else {
            const result = await this.toolExecutor(skillGetCall.function.name, params, this.currentUserContext);
            options?.onToolResult?.(skillGetCall.function.name, result);

            const skillName = jsonStringProp(params, 'name');
            if (skillName) {
              this.usedSkillsInTurn.add(skillName);
              logger.debug(`[Skill] Skill "${skillName}" loaded and will be used`);
            }

            this.estimatedTokens -= estimateMessageTokens({
              role: 'assistant',
              content: assistantMessage.content || '',
              tool_calls: assistantMessage.tool_calls,
            });

            this.messages.pop();

            this.messages.push({
              role: 'assistant',
              content: assistantMessage.content || '',
              tool_calls: [skillGetCall],
            });

            this.estimatedTokens += estimateMessageTokens({
              role: 'assistant',
              content: assistantMessage.content || '',
              tool_calls: [skillGetCall],
            });

            let skillResultToSave: any = result;
            if (this.hookRunner) {
              skillResultToSave = await this.hookRunner.runToolResultPersist({
                toolName: skillGetCall.function.name,
                result,
                toolCallId: skillGetCall.id,
                timestamp: new Date().toISOString(),
              });
            }

            this.messages.push({
              role: 'tool',
              content: JSON.stringify(skillResultToSave),
              tool_call_id: skillGetCall.id,
            });
            this.estimatedTokens += estimateMessageTokens({
              role: 'tool',
              content: JSON.stringify(skillResultToSave),
              tool_call_id: skillGetCall.id,
            });
          }

          // 【修复】不要 continue！继续处理 otherCalls
          // 将 otherCalls 作为下一批工具调用
          logger.debug(`[Skill] ✅ Skill loaded, now executing ${otherCalls.length} other tool(s)`);

          // 重新赋值 toolCalls 为 otherCalls，继续后续处理
          const remainingToolCalls = otherCalls;

          // 使用剩余的工具调用继续执行
          const allBatchResults = await this.toolDispatcher.executeToolBatches(
            remainingToolCalls, iterations, this.messages, {
              onToolCall: options?.onToolCall,
              onToolResult: options?.onToolResult,
              onContentBlock: options?.onContentBlock,
              userContext: this.currentUserContext,
            },
          );

          for (const { call, result } of allBatchResults) {
            let resultToSave = result;
            if (this.hookRunner) {
              resultToSave = this.toolDispatcher.persistResult(call.function.name, result, call.id);
            }

            const resultStr = typeof resultToSave === 'string' ? resultToSave : JSON.stringify(resultToSave);
            const compressedResult = compressToolResult(resultStr, 4000);

            this.messages.push({
              role: 'tool',
              content: compressedResult,
              tool_call_id: call.id,
            });
            this.estimatedTokens += estimateMessageTokens({
              role: 'tool',
              content: compressedResult,
              tool_call_id: call.id,
            });
          }

          // 执行完剩余工具后 continue
          continue;
        }

        const allBatchResults = await this.toolDispatcher.executeToolBatches(
          toolCalls, iterations, this.messages, {
            onToolCall: options?.onToolCall,
            onToolResult: options?.onToolResult,
            onContentBlock: options?.onContentBlock,
            userContext: this.currentUserContext,
          },
        );

        for (const { call, result } of allBatchResults) {
          const params = safeJsonParse(call.function.arguments, {});

          if (call.function.name === 'skill_record') {
            const skillName = jsonStringProp(params, 'name');
            const success = jsonBoolProp(params, 'success');
            if (!success && skillName) {
              const contextStr = typeof userMessage === 'string'
                ? userMessage
                : '[Multimodal message]';
              recordSkillFailure(skillName, contextStr);
            }
          }

          if (call.function.name === 'skill_get') {
            const skillName = jsonStringProp(params, 'name');
            if (skillName) {
              this.usedSkillsInTurn.add(skillName);
              logger.debug(`[Skill] Using skill: ${skillName}`);
            }
          }

          if (call.function.name === 'skill_record') {
            const skillName = jsonStringProp(params, 'name');
            const success = jsonBoolProp(params, 'success');
            logger.debug(`[Skill] Recording skill usage: ${skillName} (${success ? 'success' : 'failure'})`);
          }

          let resultToSave = result;
          if (this.hookRunner) {
            resultToSave = this.toolDispatcher.persistResult(call.function.name, result, call.id);
          }

          const resultStr = typeof resultToSave === 'string' ? resultToSave : JSON.stringify(resultToSave);
          const compressedResult = compressToolResult(resultStr, 4000);

          this.messages.push({
            role: 'tool',
            content: compressedResult,
            tool_call_id: call.id,
          });
          this.estimatedTokens += estimateMessageTokens({
            role: 'tool',
            content: compressedResult,
            tool_call_id: call.id,
          });
        }

        continue;
      }

      finalContent = extractContent(response);

      // Generate ContentBlock for final text
      if (finalContent) {
        options?.onContentBlock?.({
          type: 'text',
          text: finalContent,
        });
      }

      break;
    }

    if (!finalContent) {
      const lastAssistantMsg = [...this.messages].reverse().find(m => m.role === 'assistant');
      if (lastAssistantMsg?.content && typeof lastAssistantMsg.content === 'string') {
        finalContent = lastAssistantMsg.content;
        logger.warn(`[Agent] Reached max iterations (${this.options.maxToolIterations || 5}), using last assistant message`);

        // Generate ContentBlock for final text from fallback
        options?.onContentBlock?.({
          type: 'text',
          text: finalContent,
        });
      } else {
        finalContent = '抱歉，处理您的请求时达到了工具调用次数限制。请尝试简化您的问题。';
        logger.warn(`[Agent] Reached max iterations with no assistant message to fall back to`);

        // Generate ContentBlock for error message
        options?.onContentBlock?.({
          type: 'text',
          text: finalContent,
        });
      }
    }

    // [V2 FIX] Post-turn: Validate output completeness
    if (this.skillEnforcement && skillMatch?.matched && finalContent) {
      const issues = this.skillEnforcement.validateOutputCompleteness(
        finalContent,
        skillMatch.skills.map((s: any) => s.skill ?? s) as any[],
      );

      if (issues.length > 0) {
        logger.warn(`[SkillEnforcement] Output validation found ${issues.length} issue(s):`);
        issues.forEach(i => logger.warn(`  - ${i}`));

        // If we have iterations budget left, attempt one retry
        if (iterations < (this.options.maxToolIterations || 5) - 1) {
          const retryPrompt = this.skillEnforcement.buildRetryPrompt(issues);
          this.messages.push({
            role: 'user',
            content: retryPrompt,
          });
          this.estimatedTokens += estimateMessageTokens({ role: 'user', content: retryPrompt });

          logger.debug('[SkillEnforcement] Requesting more complete output...');

          // One more LLM call for completeness
          try {
            const retryResponse = await callAI({
              provider: this.options.provider,
              model: this.options.model,
              messages: this.getMessagesForAPI(),
              tools,
              temperature: this.options.temperature,
              topP: this.options.topP,
              maxTokens: this.options.maxTokens,
            });

            const retryContent = extractContent(retryResponse);
            if (retryContent && retryContent.length > finalContent.length) {
              const previousLength = finalContent.length;
              finalContent = retryContent;
              this.messages.push({
                role: 'assistant',
                content: retryContent,
              });
              this.estimatedTokens += estimateMessageTokens({
                role: 'assistant',
                content: retryContent,
              });
              logger.debug(`[SkillEnforcement] Retry produced longer output (${retryContent.length} > ${previousLength} chars)`);

              // Update content block for streaming
              options?.onContentBlock?.({
                type: 'text',
                text: retryContent,
              });
            }
          } catch (err) {
            logger.warn('[SkillEnforcement] Retry failed:', err);
          }
        }
      }
    }

    logger.debug(`\n${'='.repeat(80)}`);
    logger.debug(`[Conversation Summary]`);
    logger.debug(`  Iterations: ${iterations}`);
    if (this.usedSkillsInTurn.size > 0) {
      logger.debug(`  Skills used: ${Array.from(this.usedSkillsInTurn).join(', ')}`);
    }
    logger.debug(`  Context: ${this.estimatedTokens} / ${this.contextConfig.maxTokens} tokens (${Math.round(this.estimatedTokens / this.contextConfig.maxTokens * 100)}%)`);
    logger.debug('='.repeat(80) + '\n');

    if (totalCompletionTokens === 0) {
      totalCompletionTokens = estimateTokens(finalContent);
    }

    // Record conversation to memory (delegated to MemoryManager — A-P1-05)
    const userMessageStr = typeof userMessage === 'string'
      ? userMessage
      : '[Multimodal message]';
    await this.memoryManager.recordConversation(userMessageStr, finalContent);

    const metadata: string[] = [];

    if (this.usedSkillsInTurn.size > 0 && !finalContent.includes('📋 Used skill:')) {
      const skillNames = Array.from(this.usedSkillsInTurn).join(', ');
      const skillInfo = `_📋 Used skill: ${skillNames}_`;
      metadata.push(skillInfo);

      // 【修复 Bug 2】同时通过 onContentBlock 发送技能使用信息，让 Card V2 能看到
      options?.onContentBlock?.({
        type: 'text',
        text: `\n\n---\n${skillInfo}`,
      });
      logger.debug(`[Agent] 📋 Skill attribution added: ${skillNames}`);
    }

    if (this.tokenStatsConfig.showTokenStats) {
      const stats: TokenStats = {
        promptTokens: tokensBefore,
        completionTokens: totalCompletionTokens,
        totalTokens: tokensBefore + totalCompletionTokens,
        contextTokensBefore: tokensBefore,
        contextTokensAfter: this.estimatedTokens,
        maxContextTokens: this.contextConfig.maxTokens,
        contextUtilization: (this.estimatedTokens / this.contextConfig.maxTokens) * 100,
      };
      metadata.push(formatTokenStats(stats, this.tokenStatsConfig.tokenStatsFormat).trim());
    }

    if (metadata.length > 0) {
      finalContent += '\n\n---\n' + metadata.join('\n\n');
    }

    if (this.hookRunner) {
      const sendingEvent = {
        content: finalContent,
        role: 'assistant',
        timestamp: new Date().toISOString(),
      };

      const modifiedEvent = await this.hookRunner.runMessageSending(sendingEvent) as any;

      if (modifiedEvent?.content) {
        finalContent = modifiedEvent.content;
      }
    }

    if (this.hookRunner) {
      await this.hookRunner.runMessageSent({
        content: finalContent,
        timestamp: new Date().toISOString(),
      });
    }

    if (this.hookRunner) {
      await this.hookRunner.runAgentEnd({
        timestamp: new Date().toISOString(),
      });
    }

    // [P1] Post-turn evolution check (non-blocking, fire-and-forget)
    this.checkEvolutionTriggers(this.messages).catch(err => {
      logger.debug('[Evolution] Post-turn check failed (non-fatal):', err);
    });

    return finalContent;
  }

  // ====================================================================
  // [P1] Evolution System Integration
  // ====================================================================

  /**
   * Check if evolution triggers should fire after a conversation turn.
   *
   * Called after each successful chat() completion. Evaluates:
   * 1. Skill failure patterns (via reflection-trigger stats)
   * 2. Turn-count threshold for periodic reflection
   * 3. Triggers self-evolution when conditions are met
   *
   * Runs asynchronously and never blocks the main response path.
   */
  private async checkEvolutionTriggers(_messages: ChatMessage[]): Promise<void> {
    if (!this.evolutionEnabled) return;

    this.turnsSinceLastReflection++;

    try {
      // Check skill failure stats from reflection-trigger module
      const reflectionStats = getReflectionStats();
      const hasRecentFailures = reflectionStats.recentFailures >= 3;
      const reachedTurnThreshold = this.turnsSinceLastReflection >= this.REFLECTION_TURN_INTERVAL;

      // Only trigger reflection if there's a reason to
      if (!hasRecentFailures && !reachedTurnThreshold) return;

      logger.info('[Evolution] Reflection trigger activated', {
        reason: hasRecentFailures ? 'skill_failures' : 'turn_threshold',
        recentFailures: reflectionStats.recentFailures,
        turnsSinceLastReflection: this.turnsSinceLastReflection,
        failureDetails: reflectionStats.failureDetails,
      });

      // Reset turn counter
      this.turnsSinceLastReflection = 0;

      // Fire self-evolution (non-blocking)
      const evolutionResult = await triggerSelfEvolution();
      logger.info('[Evolution] Self-evolution result:', evolutionResult);

    } catch (error) {
      // Evolution should never crash the main loop
      logger.warn('[Evolution] checkEvolutionTriggers failed (non-fatal):', error);
    }
  }

  /**
   * Collect preference signals from user messages.
   *
   * Called when processing a user message. Detects preference expressions
   * and feeds them into the preference learning pipeline.
   *
   * Currently the preference-learning module delegates to LLM via system prompt,
   * but this hook ensures we have an explicit code path for future enhancements.
   */
  private collectPreferenceSignals(userMessage: string): void {
    try {
      const result = checkPreferenceTriggers(userMessage, []);
      if (result.hasPreference && result.expressions.length > 0) {
        logger.info('[Evolution] Preference signals detected', {
          count: result.expressions.length,
          types: result.expressions.map(e => e.type),
        });
        // Future: persist signals for batch analysis
        // Currently LLM handles preference saving via system prompt
      }
    } catch (error) {
      // Preference collection should never block the main loop
      logger.debug('[Evolution] collectPreferenceSignals failed (non-fatal):', error);
    }
  }

  // ====================================================================
  // chatStream — delegated to stream-handler module
  // ====================================================================

  /**
   * Chat with streaming support.
   *
   * [P0 FIX] Added full context management (token tracking, compression, time refresh)
   * that was previously missing from the streaming path. Without this fix, long
   * conversations using chatStream() would grow unbounded until exceeding the
   * model's context window.
   */
  async *chatStream(userMessage: string | MultimodalContent[], options?: {
    tools?: OpenAITool[];
    userContext?: UserContext;
  }): AsyncGenerator<
    | { type: 'content'; content: string }
    | { type: 'tool_call'; name: string; params: Record<string, unknown> }
    | { type: 'tool_result'; name: string; result: unknown }
  > {
    const deps: StreamHandlerDeps = {
      options: this.options,
      messages: this.messages,
      estimatedTokens: this.estimatedTokens,
      contextConfig: this.contextConfig,
      autoRefreshMemory: this.autoRefreshMemory,
      hookRunner: this.hookRunner,
      healthMonitor: this.healthMonitor,
      skillEnforcement: this.skillEnforcement,
      toolDispatcher: this.toolDispatcher,
      memoryManager: this.memoryManager,
      usedSkillsInTurn: this.usedSkillsInTurn,
      lastToolCalls: this.lastToolCalls,
      currentUserContext: this.currentUserContext,
      _compressing: this._compressing,
      compressedSummary: this.compressedSummary,
      refreshTime: () => this.refreshTime(),
      refreshMemory: () => this.refreshMemory(),
      getMessagesForAPI: () => this.getMessagesForAPI(),
      loopDetector: this.loopDetector,
    };

    yield* chatStreamImpl(deps, userMessage, options);

    // Sync back any state mutated by the stream handler
    this.estimatedTokens = deps.estimatedTokens;
    this.lastToolCalls = deps.lastToolCalls;
    this.currentUserContext = deps.currentUserContext;
    this._compressing = deps._compressing;
    this.compressedSummary = deps.compressedSummary;
  }
}
