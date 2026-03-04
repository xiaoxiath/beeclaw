import type { AIProvider } from '../config/schema';
import type { AgentOptions, ChatMessage, OpenAITool, ToolExecutor, ConversationContext, MultimodalContent } from './types';
import { callAI, executeToolCalls, hasToolCalls, extractToolCalls, extractContent } from './api';
import { getAllToolsForAI, SYSTEM_PROMPTS, buildSystemPrompt, formatSkillsForPrompt, getCurrentTimeContext } from './tools';
import { getMemoryStore } from '../memory';
import { getSkillStore } from '../skills/store';
import { executeMemoryTool } from '../memory/tools';
import { executeSkillTool } from '../skills/tools';
import { executeGoalTool } from '../goal/tools';
import { executeProactiveTool } from '../proactive/tools';
import { executePersonaTool } from '../persona/tools';
import { executeBuiltinTool, isBuiltinTool } from '../tools';
import { getMCPManager, MCPClientManager } from '../mcp';
import { recordSkillFailure, type ReflectionTrigger } from '../evolution';
import {
  executeCalendarTool,
  executeDocxTool,
  executeDriveTool,
  executeBitableTool,
  executeWikiTool,
  getFeishuWSClient,
} from '../feishu';
import {
  estimateMessageTokens,
  estimateTotalTokens,
  estimateTokens,
  compressToolResult,
  compressAssistantMessage,
  formatTokenStats,
  cleanTokenStats,
  DEFAULT_CONTEXT_CONFIG,
  DEFAULT_TOKEN_STATS_CONFIG,
  calculateContextConfig,
  getModelContextWindow,
  type ContextConfig,
  type TokenStatsConfig,
  type TokenStats,
} from './context';
import { hybridCompress, type CompressionResult } from './compressor';
import { groupToolCalls, getGroupingStats, isParallelTool } from './tool-dependencies';

/**
 * Safely parse JSON with fallback
 */
function safeJsonParse<T>(jsonString: string, fallback: T): T {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.error('[Agent] Failed to parse JSON:', error, 'Input:', jsonString.substring(0, 100));
    return fallback;
  }
}

// Re-export from tools
export { getAllToolsForAI, SYSTEM_PROMPTS, buildSystemPrompt, formatSkillsForPrompt, getCurrentTimeContext };
export { getMemoryTools, getSkillTools, getToolsByCategory, TOOL_CATEGORIES } from './tools';
export { getBuiltinToolsForAI, executeBuiltinTool, isBuiltinTool, builtinToolNames } from '../tools';
export { recordSkillFailure, type ReflectionTrigger } from '../evolution';
export type { OpenAITool, ChatMessage, ToolCall, ToolResult } from './types';
export { estimateMessageTokens, estimateTotalTokens, DEFAULT_CONTEXT_CONFIG, DEFAULT_TOKEN_STATS_CONFIG, calculateContextConfig, getModelContextWindow, cleanTokenStats, type ContextConfig, type TokenStatsConfig, type TokenStats };
export { groupToolCalls, getGroupingStats, isParallelTool, getToolDependency, hasSideEffects } from './tool-dependencies';

// Default tool executor that handles memory, skill, goal, proactive, persona, builtin, and feishu tools
export function createDefaultToolExecutor(): ToolExecutor {
  return async (name: string, params: Record<string, unknown>) => {
    // Memory tools
    if (name.startsWith('memory_')) {
      return executeMemoryTool(name, params);
    }

    // Skill tools
    if (name.startsWith('skill_')) {
      const result = executeSkillTool(name, params);

      // Handle skill_ensure requiring skill-creator workflow
      if (name === 'skill_ensure' && result.success === false && result.error === 'NEW_SKILL_REQUIRES_CREATOR') {
        // Return a clear instruction to use skill-creator instead
        return {
          success: false,
          error: `Creating new skill "${result.data?.skillName}" requires skill-creator workflow.

Please use skill_get to read the skill-creator skill first, then follow its workflow:
  skill_get({ name: "skill-creator" })

The skill-creator provides:
- Proper skill structure (SKILL.md, scripts/, references/, evals/)
- Test cases and evaluation
- Iterative refinement
- Quality benchmarking

This ensures high-quality, well-tested skills.`,
        };
      }

      return result;
    }

    // Goal tools
    if (name.startsWith('goal_')) {
      return executeGoalTool(name, params);
    }

    // Proactive tools
    if (name.startsWith('proactive_') || name.startsWith('notification_') || name === 'schedule_once') {
      return executeProactiveTool(name, params);
    }

    // Persona tools
    if (name.startsWith('persona_')) {
      return executePersonaTool(name, params);
    }

    // Builtin tools
    if (isBuiltinTool(name)) {
      return executeBuiltinTool(name, params);
    }

    // Feishu tools
    if (name.startsWith('feishu_')) {
      const wsClient = getFeishuWSClient();
      if (!wsClient) {
        return {
          success: false,
          error: 'Feishu client not initialized. Make sure the bot is connected to Feishu.',
        };
      }

      const client = wsClient.getApiClient();
      if (!client) {
        return {
          success: false,
          error: 'Feishu API client not available.',
        };
      }

      try {
        let result: Record<string, unknown>;
        if (name.startsWith('feishu_calendar_')) {
          result = await executeCalendarTool(client, name, params);
        } else if (name.startsWith('feishu_docx_')) {
          result = await executeDocxTool(client, name, params);
        } else if (name.startsWith('feishu_drive_')) {
          result = await executeDriveTool(client, name, params);
        } else if (name.startsWith('feishu_bitable_')) {
          result = await executeBitableTool(client, name, params);
        } else if (name.startsWith('feishu_wiki_')) {
          result = await executeWikiTool(client, name, params);
        } else {
          return {
            success: false,
            error: `Unknown Feishu tool: ${name}`,
          };
        }

        // Ensure the result has the expected format
        if (typeof result.success === 'boolean') {
          return result as { success: boolean; data?: unknown; error?: string };
        }

        // Wrap the result if it doesn't have success field
        return {
          success: true,
          data: result,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        return {
          success: false,
          error: `Feishu tool execution failed: ${errorMsg}`,
        };
      }
    }

    // MCP tools (format: mcp_{serverId}_{toolName})
    if (MCPClientManager.isMCPToolName(name)) {
      try {
        const manager = getMCPManager();
        const parsed = MCPClientManager.parseMCPToolName(name);
        if (!parsed) {
          return {
            success: false,
            error: `Invalid MCP tool name format: ${name}`,
          };
        }
        const result = await manager.executeTool(parsed.serverId, parsed.toolName, params);
        return {
          success: result.success,
          data: result.data,
          error: result.error,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        return {
          success: false,
          error: `MCP tool execution failed: ${errorMsg}`,
        };
      }
    }

    return {
      success: false,
      error: `Unknown tool: ${name}`,
    };
  };
}

// Agent class
export class Agent {
  private options: AgentOptions;
  private messages: ChatMessage[] = [];
  private toolExecutor: ToolExecutor;
  private lastSkillFailed: string | undefined;
  private baseSystemPrompt: string;
  private autoRefreshMemory: boolean;
  private contextConfig: ContextConfig;
  private tokenStatsConfig: TokenStatsConfig;
  private estimatedTokens: number = 0;
  private usedSkillsInTurn: Set<string> = new Set(); // Track skills used in current turn

  constructor(options: AgentOptions & {
    contextConfig?: Partial<ContextConfig>;
    tokenStatsConfig?: Partial<TokenStatsConfig>;
  }) {
    this.options = {
      maxToolIterations: 30,  // Increased from 10 to support complex workflows like news aggregation
      ...options,
    };
    this.toolExecutor = options.toolExecutor || createDefaultToolExecutor();
    this.baseSystemPrompt = options.systemPrompt || '';
    this.autoRefreshMemory = (options as any).autoRefreshMemory ?? false;

    // Calculate optimal context config based on model and response tokens
    this.contextConfig = calculateContextConfig(
      options.model,
      options.maxTokens,
      options.contextConfig
    );

    this.tokenStatsConfig = { ...DEFAULT_TOKEN_STATS_CONFIG, ...options.tokenStatsConfig };

    // Initialize with system prompt
    if (options.systemPrompt) {
      this.messages.push({
        role: 'system',
        content: options.systemPrompt,
      });
      this.estimatedTokens = estimateMessageTokens({ role: 'system', content: options.systemPrompt });
    }
  }

  // Get current token estimate
  getTokenEstimate(): number {
    return this.estimatedTokens;
  }

  // Get token stats config
  getTokenStatsConfig(): TokenStatsConfig {
    return { ...this.tokenStatsConfig };
  }

  // Get context config
  getContextConfig(): ContextConfig {
    return { ...this.contextConfig };
  }

  // Refresh memory context (reload facts/*.md and skills)
  refreshMemory(): void {
    try {
      const memoryStore = getMemoryStore();
      const coreContext = memoryStore.getCoreContext();

      // Add available skills to context (OpenClaw-style)
      let skillsPrompt = '';
      try {
        const skillStore = getSkillStore();
        const skills = skillStore.list();
        if (skills.length > 0) {
          skillsPrompt = formatSkillsForPrompt(
            skills.map(s => ({
              name: s.name,
              description: s.description,
              triggers: s.triggers,
            }))
          );
        }
      } catch {
        // SkillStore not initialized
      }

      const freshPrompt = buildSystemPrompt(this.baseSystemPrompt, {
        ...coreContext,
        skills: skillsPrompt,
      });

      // Find and update the system message
      const systemIndex = this.messages.findIndex(m => m.role === 'system');
      if (systemIndex >= 0) {
        const oldTokens = estimateMessageTokens(this.messages[systemIndex]);
        this.messages[systemIndex].content = freshPrompt;
        const newTokens = estimateMessageTokens(this.messages[systemIndex]);
        this.estimatedTokens = this.estimatedTokens - oldTokens + newTokens;
      } else {
        this.messages.unshift({
          role: 'system',
          content: freshPrompt,
        });
        this.estimatedTokens += estimateMessageTokens({ role: 'system', content: freshPrompt });
      }

      console.log('[Agent] Memory refreshed - facts/*.md changes applied');
    } catch (error) {
      console.warn('[Agent] Failed to refresh memory:', error);
    }
  }

  // Refresh time context in system message (called before each chat)
  refreshTime(): void {
    const systemIndex = this.messages.findIndex(m => m.role === 'system');
    if (systemIndex < 0) return;

    const systemContent = this.messages[systemIndex].content;
    if (typeof systemContent !== 'string') return;

    // Generate fresh time context
    const newTimeContext = getCurrentTimeContext();

    // Replace the existing time context block
    // Pattern matches "# Current Context" through the "---" separator
    const timeContextPattern = /# Current Context\n\n\*\*Date\*\*:.*?\n\*\*Time\*\*:.*?\n\*\*Timezone\*\*:.*?\n\n---/s;

    if (timeContextPattern.test(systemContent)) {
      const oldTokens = estimateMessageTokens(this.messages[systemIndex]);
      this.messages[systemIndex].content = systemContent.replace(timeContextPattern, newTimeContext);
      const newTokens = estimateMessageTokens(this.messages[systemIndex]);
      this.estimatedTokens = this.estimatedTokens - oldTokens + newTokens;
    }
  }

  // Get conversation history
  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  // Clear conversation history (keep system prompt)
  clearHistory(): void {
    const systemPrompt = this.messages.find(m => m.role === 'system');
    if (systemPrompt) {
      this.messages = [systemPrompt];
      this.estimatedTokens = estimateMessageTokens(systemPrompt);
    } else {
      this.messages = [];
      this.estimatedTokens = 0;
    }
  }

  // Add message to history with token tracking
  addMessage(message: ChatMessage): void {
    this.messages.push(message);
    this.estimatedTokens += estimateMessageTokens(message);
    this.trimContextIfNeeded();
  }

  // Trim context if exceeding token limit
  private trimContextIfNeeded(): void {
    const threshold = this.contextConfig.maxTokens * this.contextConfig.compressionThreshold;

    if (this.estimatedTokens <= threshold) {
      return;
    }

    console.log(`[Agent] Context compression triggered: ${this.estimatedTokens} tokens > ${threshold} threshold`);

    // Find system message index
    const systemIndex = this.messages.findIndex(m => m.role === 'system');

    // Messages to potentially compress (exclude system and recent)
    const startIndex = systemIndex >= 0 ? systemIndex + 1 : 0;
    const keepRecent = this.contextConfig.keepRecent;
    const endIndex = this.messages.length - keepRecent;

    if (endIndex <= startIndex) {
      // Not enough messages to compress, just trim oldest
      if (startIndex < this.messages.length - 2) {
        const removed = this.messages.splice(startIndex, 1);
        this.estimatedTokens -= estimateMessageTokens(removed[0]);
        console.log(`[Agent] Removed oldest message to free space`);
      }
      return;
    }

    // Compress middle messages
    let tokensFreed = 0;
    for (let i = startIndex; i < endIndex && this.estimatedTokens > threshold; i++) {
      const msg = this.messages[i];

      // Skip if already compressed or is critical
      if ((msg as any)._compressed) continue;

      const originalTokens = estimateMessageTokens(msg);
      let compressed = false;

      // Compress tool results (only if content is string)
      if (msg.role === 'tool' && msg.content && typeof msg.content === 'string') {
        const compressedContent = compressToolResult(msg.content);
        if (compressedContent !== msg.content) {
          msg.content = compressedContent;
          (msg as any)._compressed = true;
          compressed = true;
        }
      }

      // Compress assistant messages with tool calls (only if content is string)
      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0 && typeof msg.content === 'string') {
        const compressedContent = compressAssistantMessage(msg.content || '', msg.tool_calls);
        if (compressedContent !== msg.content) {
          msg.content = compressedContent;
          (msg as any)._compressed = true;
          compressed = true;
        }
      }

      if (compressed) {
        const newTokens = estimateMessageTokens(msg);
        tokensFreed += originalTokens - newTokens;
        this.estimatedTokens -= originalTokens - newTokens;
      }
    }

    // If still over threshold, remove oldest non-system messages
    while (this.estimatedTokens > this.contextConfig.maxTokens * 0.9 && this.messages.length > keepRecent + 1) {
      const removeIndex = systemIndex >= 0 ? 1 : 0;
      if (removeIndex < this.messages.length - keepRecent) {
        const removed = this.messages.splice(removeIndex, 1);
        this.estimatedTokens -= estimateMessageTokens(removed[0]);
        console.log(`[Agent] Removed message at index ${removeIndex} to free space`);
      } else {
        break;
      }
    }

    console.log(`[Agent] Context compressed: freed ${tokensFreed} tokens, now at ${this.estimatedTokens}`);
  }

  // Compressed context summary (from LLM compression)
  private compressedSummary: string = '';

  /**
   * Compress old messages using LLM for intelligent summarization
   * This is called proactively when context grows large
   */
  async compressContextWithLLM(): Promise<CompressionResult> {
    if (!this.options.provider) {
      return { summary: '', originalTokens: 0, compressedTokens: 0, compressionRatio: 1 };
    }

    const systemIndex = this.messages.findIndex(m => m.role === 'system');
    const keepRecent = 8; // Keep more recent messages for LLM compression
    const startIndex = systemIndex >= 0 ? systemIndex + 1 : 0;
    const endIndex = this.messages.length - keepRecent;

    if (endIndex <= startIndex) {
      return { summary: '', originalTokens: 0, compressedTokens: 0, compressionRatio: 1 };
    }

    const oldMessages = this.messages.slice(startIndex, endIndex);
    const recentMessages = this.messages.slice(-keepRecent);
    const systemMessage = systemIndex >= 0 ? this.messages[systemIndex] : null;

    console.log(`[Agent] LLM compressing ${oldMessages.length} old messages...`);

    try {
      const result = await hybridCompress(
        oldMessages,
        this.options.provider,
        {
          maxTokens: this.contextConfig.maxTokens,
          currentTokens: this.estimatedTokens,
          config: this.options.compressionConfig,  // Use configured model
        }
      );

      if (result.summary) {
        // Update compressed summary
        this.compressedSummary = this.compressedSummary
          ? `${this.compressedSummary}\n\n---\n${result.summary}`
          : result.summary;

        // Rebuild messages: system + summary + recent
        const newMessages: ChatMessage[] = [];
        if (systemMessage) {
          // Update system message to include summary
          newMessages.push({
            ...systemMessage,
            content: systemMessage.content + `\n\n## 历史对话摘要\n${this.compressedSummary}`,
          });
        }
        newMessages.push(...recentMessages);

        // Calculate new token count
        const oldTokens = this.estimatedTokens;
        this.messages = newMessages;
        this.estimatedTokens = estimateTotalTokens(newMessages);

        console.log(
          `[Agent] LLM compression complete: ${oldTokens} → ${this.estimatedTokens} tokens ` +
          `(${Math.round((1 - this.estimatedTokens / oldTokens) * 100)}% reduction)`
        );
      }

      return {
        summary: result.summary,
        originalTokens: this.estimatedTokens,
        compressedTokens: estimateTokens(result.summary),
        compressionRatio: result.compressionRatio,
      };
    } catch (error) {
      console.error('[Agent] LLM compression failed:', error);
      // Fall back to rule-based compression
      this.trimContextIfNeeded();
      return { summary: '', originalTokens: 0, compressedTokens: 0, compressionRatio: 1 };
    }
  }

  // Get compressed summary
  getCompressedSummary(): string {
    return this.compressedSummary;
  }

  // Chat with the agent
  async chat(userMessage: string | MultimodalContent[], options?: {
    tools?: OpenAITool[];
    onToolCall?: (name: string, params: Record<string, unknown>) => void;
    onToolResult?: (name: string, result: unknown) => void;
    onStream?: (chunk: string) => void;
    onReflectionTrigger?: (trigger: ReflectionTrigger) => void;
  }): Promise<string> {
    // Always refresh time context before each chat (ensures real-time accuracy)
    this.refreshTime();

    // Auto-refresh memory if enabled (get latest facts/*.md)
    if (this.autoRefreshMemory) {
      this.refreshMemory();
    }

    // Track tokens before this turn
    const tokensBefore = this.estimatedTokens;

    // Reset failure tracking for this turn
    this.lastSkillFailed = undefined;
    this.usedSkillsInTurn.clear(); // Reset skill tracking for this turn

    // Add user message
    this.messages.push({
      role: 'user',
      content: userMessage,
    });
    this.estimatedTokens += estimateMessageTokens({ role: 'user', content: userMessage });

    // Proactive LLM compression when context is getting full
    // Use LLM compression when > 80% of max tokens (smarter than rule-based)
    const compressionThreshold = this.contextConfig.maxTokens * 0.8;
    if (this.estimatedTokens > compressionThreshold && this.messages.length > 10) {
      console.log(`[Agent] Context at ${Math.round(this.estimatedTokens / 1000)}k tokens, triggering LLM compression...`);
      try {
        await this.compressContextWithLLM();
      } catch (error) {
        console.warn('[Agent] LLM compression failed, using rule-based fallback');
        this.trimContextIfNeeded();
      }
    }

    // Get tools
    const tools = options?.tools || this.options.tools || getAllToolsForAI();

    // Iteratively call AI and execute tools
    let iterations = 0;
    let finalContent = '';
    let totalCompletionTokens = 0;

    while (iterations < (this.options.maxToolIterations || 5)) {
      iterations++;

      // Call AI
      const response = await callAI({
        provider: this.options.provider,
        model: this.options.model,
        messages: this.messages,
        tools,
        temperature: this.options.temperature,
        topP: this.options.topP,
        maxTokens: this.options.maxTokens,
      });

      const assistantMessage = response.choices[0].message;

      // Track completion tokens from API if available
      if (response.usage?.completion_tokens) {
        totalCompletionTokens += response.usage.completion_tokens;
      }

      // Clean token stats from assistant message before adding to history
      const cleanedContent = cleanTokenStats(assistantMessage.content || '');

      // Add assistant message to history
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

      // Check if there are tool calls
      if (hasToolCalls(response)) {
        const toolCalls = extractToolCalls(response);

        // Log LLM's tool call decisions
        console.log(`\n${'='.repeat(80)}`);
        console.log(`[Agent] LLM decided to call ${toolCalls.length} tool(s):`);
        toolCalls.forEach((tc, idx) => {
          const params = safeJsonParse(tc.function.arguments, {});
          const paramsStr = JSON.stringify(params);
          const paramsPreview = paramsStr.length > 100 ? paramsStr.substring(0, 100) + '...' : paramsStr;
          console.log(`  ${idx + 1}. ${tc.function.name}(${paramsPreview})`);
        });
        console.log('='.repeat(80));

        // Special handling: if skill_get is among the calls, execute it first
        // and let LLM decide next steps after seeing the skill content
        const skillGetCall = toolCalls.find(tc => tc.function.name === 'skill_get');
        const otherCalls = toolCalls.filter(tc => tc.function.name !== 'skill_get');

        if (skillGetCall && otherCalls.length > 0) {
          // Execute skill_get first, then let LLM decide
          const params = safeJsonParse(skillGetCall.function.arguments, {});
          console.log(`\n[Skill] 🎯 Getting skill: ${params.name}`);
          options?.onToolCall?.(skillGetCall.function.name, params);

          const result = await this.toolExecutor(skillGetCall.function.name, params);
          options?.onToolResult?.(skillGetCall.function.name, result);

          // Track skill usage
          const skillName = params.name as string;
          if (skillName) {
            this.usedSkillsInTurn.add(skillName);
            console.log(`[Skill] ✅ Skill "${skillName}" loaded and will be used`);
          }

          // Replace the assistant message with one that only has skill_get
          // This way LLM will naturally re-decide what tools to call after seeing skill content
          // First, adjust the token estimate (remove the old, add the new)
          this.estimatedTokens -= estimateMessageTokens({
            role: 'assistant',
            content: assistantMessage.content || '',
            tool_calls: assistantMessage.tool_calls,
          });

          this.messages.pop(); // Remove the original assistant message

          // Add assistant message with only skill_get
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

          // Add skill_get result
          this.messages.push({
            role: 'tool',
            content: JSON.stringify(result),
            tool_call_id: skillGetCall.id,
          });
          this.estimatedTokens += estimateMessageTokens({
            role: 'tool',
            content: JSON.stringify(result),
            tool_call_id: skillGetCall.id,
          });

          // Continue to let LLM see the skill content before executing other tools
          continue;
        }

        // Group tool calls into parallel and sequential batches
        const batches = groupToolCalls(toolCalls.map(tc => ({
          name: tc.function.name,
          call: tc,
        })));

        const stats = getGroupingStats(toolCalls.map(tc => ({ name: tc.function.name })));
        console.log(`\n[Tool Execution Plan]`);
        console.log(`  Total calls: ${stats.totalCalls}`);
        console.log(`  Parallel batches: ${stats.parallelBatches}`);
        console.log(`  Sequential batches: ${stats.sequentialBatches}`);
        console.log(`  Max parallelism: ${stats.maxParallelism}`);
        if (batches.length > 0) {
          batches.forEach((batch, idx) => {
            const toolNames = batch.map(b => b.call.function.name).join(', ');
            console.log(`  Batch ${idx + 1}: ${toolNames}`);
          });
        }

        // Execute each batch
        for (const batch of batches) {
          const batchStartTime = Date.now();

          console.log(`\n[Batch Execution] Starting batch with ${batch.length} tool(s)...`);

          // Execute batch in parallel
          const batchResults = await Promise.all(
            batch.map(async ({ call }) => {
              const params = safeJsonParse(call.function.arguments, {});

              // Log individual tool execution
              const paramsStr = JSON.stringify(params);
              const paramsPreview = paramsStr.length > 100 ? paramsStr.substring(0, 100) + '...' : paramsStr;
              console.log(`  [Executing] ${call.function.name}(${paramsPreview})`);

              // Notify callback
              options?.onToolCall?.(call.function.name, params);

              try {
                // Execute tool
                const toolStartTime = Date.now();
                const result = await this.toolExecutor(call.function.name, params);
                const toolElapsed = Date.now() - toolStartTime;

                // Log result summary
                const resultStr = JSON.stringify(result);
                const resultPreview = resultStr.length > 150 ? resultStr.substring(0, 150) + '...' : resultStr;
                console.log(`  [Completed] ${call.function.name} (${toolElapsed}ms): ${resultPreview}`);

                // Notify callback of result
                options?.onToolResult?.(call.function.name, result);

                return { call, result, error: null };
              } catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                console.error(`  [Failed] ${call.function.name}: ${errorMsg}`);
                const errorResult = { success: false, error: errorMsg };
                options?.onToolResult?.(call.function.name, errorResult);
                return { call, result: errorResult, error: errorMsg };
              }
            })
          );

          // Process results
          for (const { call, result } of batchResults) {
            const params = safeJsonParse(call.function.arguments, {});

            // Track skill failures for reflection
            if (call.function.name === 'skill_record') {
              const skillName = params.name as string;
              const success = params.success as boolean;
              if (!success && skillName) {
                const contextStr = typeof userMessage === 'string'
                  ? userMessage
                  : '[Multimodal message]';
                recordSkillFailure(skillName, contextStr);
                this.lastSkillFailed = skillName;
              }
            }

            // Track skill usage for attribution
            if (call.function.name === 'skill_get') {
              const skillName = params.name as string;
              if (skillName) {
                this.usedSkillsInTurn.add(skillName);
                console.log(`[Skill] ✅ Using skill: ${skillName}`);
              }
            }

            // Track skill record calls
            if (call.function.name === 'skill_record') {
              const skillName = params.name as string;
              const success = params.success as boolean;
              console.log(`[Skill] 📝 Recording skill usage: ${skillName} (${success ? 'success' : 'failure'})`);
            }

            // Add tool result to messages
            this.messages.push({
              role: 'tool',
              content: JSON.stringify(result),
              tool_call_id: call.id,
            });
            this.estimatedTokens += estimateMessageTokens({
              role: 'tool',
              content: JSON.stringify(result),
              tool_call_id: call.id,
            });
          }

          // Log batch completion
          const elapsed = Date.now() - batchStartTime;
          if (batch.length > 1) {
            const toolNames = batch.map(b => b.call.function.name).join(', ');
            console.log(`\n[Batch Complete] ${batch.length} tools executed in ${elapsed}ms (parallel)`);
            console.log(`  Tools: ${toolNames}`);
          } else {
            console.log(`[Tool Complete] ${batch[0].call.function.name} in ${elapsed}ms`);
          }
        }

        // Continue loop to get next response
        continue;
      }

      // No tool calls, we're done
      finalContent = extractContent(response);
      break;
    }

    // If we exited the loop due to iteration limit, use the last assistant message
    if (!finalContent) {
      const lastAssistantMsg = [...this.messages].reverse().find(m => m.role === 'assistant');
      if (lastAssistantMsg?.content && typeof lastAssistantMsg.content === 'string') {
        finalContent = lastAssistantMsg.content;
        console.warn(`[Agent] Reached max iterations (${this.options.maxToolIterations || 5}), using last assistant message`);
      } else {
        finalContent = '抱歉，处理您的请求时达到了工具调用次数限制。请尝试简化您的问题。';
        console.warn(`[Agent] Reached max iterations with no assistant message to fall back to`);
      }
    }

    // Log conversation summary
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[Conversation Summary]`);
    console.log(`  Iterations: ${iterations}`);
    if (this.usedSkillsInTurn.size > 0) {
      console.log(`  Skills used: ${Array.from(this.usedSkillsInTurn).join(', ')}`);
    }
    console.log(`  Context: ${this.estimatedTokens} / ${this.contextConfig.maxTokens} tokens (${Math.round(this.estimatedTokens / this.contextConfig.maxTokens * 100)}%)`);
    console.log('='.repeat(80) + '\n');

    // Estimate completion tokens if API didn't provide them
    if (totalCompletionTokens === 0) {
      totalCompletionTokens = estimateTokens(finalContent);
    }

    // Record conversation to memory
    try {
      const memoryStore = getMemoryStore();
      const userMessageStr = typeof userMessage === 'string'
        ? userMessage
        : '[Multimodal message]';
      memoryStore.recordConversation({
        timestamp: new Date().toISOString(),
        source: 'agent',
        user: userMessageStr,
        assistant: finalContent,
      });
    } catch {
      // Memory might not be initialized
    }

    // Append metadata (skill attribution and token stats)
    const metadata: string[] = [];

    // Append skill attribution if any skills were used
    // But only if it's not already in the content (avoid duplication)
    if (this.usedSkillsInTurn.size > 0 && !finalContent.includes('📋 Used skill:')) {
      const skillNames = Array.from(this.usedSkillsInTurn).join(', ');
      metadata.push(`_📋 Used skill: ${skillNames}_`);
    }

    // Append token stats if enabled
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

    // Add metadata to final content
    if (metadata.length > 0) {
      finalContent += '\n\n---\n' + metadata.join('\n\n');
    }

    return finalContent;
  }

  // Chat with streaming
  async *chatStream(userMessage: string, options?: {
    tools?: OpenAITool[];
  }): AsyncGenerator<
    | { type: 'content'; content: string }
    | { type: 'tool_call'; name: string; params: Record<string, unknown> }
    | { type: 'tool_result'; name: string; result: unknown }
  > {
    // Reset skill tracking for this turn
    this.usedSkillsInTurn.clear();

    // Add user message
    this.messages.push({
      role: 'user',
      content: userMessage,
    });

    const tools = options?.tools || this.options.tools || getAllToolsForAI();

    let iterations = 0;
    let finalContent = '';

    while (iterations < (this.options.maxToolIterations || 5)) {
      iterations++;

      const response = await callAI({
        provider: this.options.provider,
        model: this.options.model,
        messages: this.messages,
        tools,
        temperature: this.options.temperature,
        topP: this.options.topP,
        maxTokens: this.options.maxTokens,
      });

      const assistantMessage = response.choices[0].message;

      // Yield content
      if (assistantMessage.content) {
        yield { type: 'content', content: assistantMessage.content };
        finalContent = assistantMessage.content;
      }

      // Add to history
      this.messages.push({
        role: 'assistant',
        content: assistantMessage.content || '',
        tool_calls: assistantMessage.tool_calls,
      });

      // Handle tool calls
      if (hasToolCalls(response)) {
        const toolCalls = extractToolCalls(response);

        for (const call of toolCalls) {
          const params = safeJsonParse(call.function.arguments, {});

          yield { type: 'tool_call', name: call.function.name, params };

          // Track skill usage for attribution
          if (call.function.name === 'skill_get') {
            const skillName = params.name as string;
            if (skillName) {
              this.usedSkillsInTurn.add(skillName);
            }
          }

          const result = await this.toolExecutor(call.function.name, params);

          yield { type: 'tool_result', name: call.function.name, result };

          this.messages.push({
            role: 'tool',
            content: JSON.stringify(result),
            tool_call_id: call.id,
          });
        }

        continue;
      }

      break;
    }

    // Record to memory
    try {
      const memoryStore = getMemoryStore();
      memoryStore.recordConversation({
        timestamp: new Date().toISOString(),
        source: 'agent',
        user: userMessage,
        assistant: finalContent,
      });
    } catch {
      // Memory might not be initialized
    }

    // Yield skill attribution if any skills were used
    if (this.usedSkillsInTurn.size > 0) {
      const skillNames = Array.from(this.usedSkillsInTurn).join(', ');
      yield { type: 'content', content: `\n\n---\n_📋 Used skill: ${skillNames}_` };
    }
  }
}

// Create agent with default configuration
export function createAgent(options: {
  provider: AIProvider;
  model: string;
  systemPrompt?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  tools?: OpenAITool[];
  toolExecutor?: ToolExecutor;
  loadCoreMemory?: boolean;
  autoRefreshMemory?: boolean; // Auto-refresh facts/*.md before each chat
  contextConfig?: Partial<ContextConfig>; // Context management config
  tokenStatsConfig?: Partial<TokenStatsConfig>; // Token stats display config
}): Agent {
  let systemPrompt = options.systemPrompt || SYSTEM_PROMPTS.default;

  // Load USER.md, SOUL.md and facts/*.md if requested (default: true)
  if (options.loadCoreMemory !== false) {
    try {
      const memoryStore = getMemoryStore();
      const coreContext = memoryStore.getCoreContext();

      // Add available skills to context (OpenClaw-style)
      let skillsPrompt = '';
      try {
        const skillStore = getSkillStore();
        const skills = skillStore.list();
        if (skills.length > 0) {
          skillsPrompt = formatSkillsForPrompt(
            skills.map(s => ({
              name: s.name,
              description: s.description,
              triggers: s.triggers,
            }))
          );
        }
      } catch {
        // SkillStore not initialized
      }

      systemPrompt = buildSystemPrompt(systemPrompt, {
        ...coreContext,
        skills: skillsPrompt,
      });
    } catch {
      // Memory store not initialized, use base prompt
    }
  }

  return new Agent({
    ...options,
    systemPrompt,
    autoRefreshMemory: options.autoRefreshMemory ?? false,
    contextConfig: options.contextConfig,
    tokenStatsConfig: options.tokenStatsConfig,
  } as AgentOptions & { contextConfig?: Partial<ContextConfig>; tokenStatsConfig?: Partial<TokenStatsConfig> });
}

// Quick chat function
export async function quickChat(options: {
  provider: AIProvider;
  model: string;
  message: string;
  systemPrompt?: string;
  tools?: OpenAITool[];
}): Promise<string> {
  const agent = createAgent(options);
  return agent.chat(options.message);
}
