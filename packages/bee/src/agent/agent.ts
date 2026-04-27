/**
 * bee — Agent class.
 *
 * The main orchestrator for AI conversations with tool calling.
 * Constructor-injected dependencies — no singletons.
 */

import type {
  ChatMessage,
  OpenAITool,
  ToolResult,
  StreamEvent,
  ProviderConfig,
  AIResponse,
  ToolCall as TCTool,
} from '../core/types';
import { ToolDispatcher, type ToolExecutorFn } from '../tool/dispatcher';

// ============================================================================
// Agent Config
// ============================================================================

export interface AgentConfig {
  /** AI client with callAI / streamAI methods */
  aiClient: {
    callAI(options: {
      provider: ProviderConfig;
      model: string;
      messages: ChatMessage[];
      tools?: OpenAITool[];
      temperature?: number;
      maxTokens?: number;
    }): Promise<AIResponse>;
    streamAI(options: {
      provider: ProviderConfig;
      model: string;
      messages: ChatMessage[];
      tools?: OpenAITool[];
      temperature?: number;
      maxTokens?: number;
    }): AsyncGenerator<string, void, unknown>;
  };
  /** Provider configuration */
  provider: ProviderConfig;
  /** Model to use */
  model: string;
  /** System prompt */
  systemPrompt?: string;
  /** Available tools (OpenAI format) */
  tools?: OpenAITool[];
  /** Tool executor: (toolName, params) => result */
  toolExecutor?: ToolExecutorFn;
  /** Tool names that should be blocked from execution */
  blockedTools?: string[];
  /** Temperature (0-1) */
  temperature?: number;
  /** Max iterations for tool call loops (default 10) */
  maxIterations?: number;
  /** Max tokens for responses */
  maxTokens?: number;
}

export interface AgentResponse {
  content: string;
  toolCalls?: TCTool[];
  messages: ChatMessage[];
  iterations: number;
}

// ============================================================================
// Agent
// ============================================================================

export class Agent {
  private readonly aiClient: AgentConfig['aiClient'];
  private readonly provider: ProviderConfig;
  private readonly model: string;
  private readonly systemPrompt?: string;
  private readonly tools?: OpenAITool[];
  private readonly toolDispatcher?: ToolDispatcher;
  private readonly temperature?: number;
  private readonly maxIterations: number;
  private readonly maxTokens?: number;

  private history: ChatMessage[] = [];

  constructor(config: AgentConfig) {
    this.aiClient = config.aiClient;
    this.provider = config.provider;
    this.model = config.model;
    this.systemPrompt = config.systemPrompt;
    this.tools = config.tools;
    this.toolDispatcher = config.toolExecutor
      ? new ToolDispatcher({
          executor: config.toolExecutor,
          blockedTools: config.blockedTools,
        })
      : undefined;
    this.temperature = config.temperature;
    this.maxIterations = config.maxIterations ?? 10;
    this.maxTokens = config.maxTokens;
  }

  /**
   * Send a message and get a response. Handles tool call loops automatically.
   */
  async chat(userMessage: string): Promise<AgentResponse> {
    this.history.push({ role: 'user', content: userMessage });

    let iterations = 0;

    for (let i = 0; i < this.maxIterations; i++) {
      iterations++;

      const messages = this.buildMessages();

      const response = await this.aiClient.callAI({
        provider: this.provider,
        model: this.model,
        messages,
        tools: this.tools,
        temperature: this.temperature,
        maxTokens: this.maxTokens,
      });

      const assistantMessage = response.choices[0].message;

      // Add assistant response to history
      this.history.push({
        role: 'assistant',
        content: assistantMessage.content ?? '',
        ...(assistantMessage.tool_calls ? { tool_calls: assistantMessage.tool_calls } : {}),
      });

      // Check for tool calls
      const toolCalls = assistantMessage.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        return {
          content: assistantMessage.content || '',
          messages: [...this.history],
          iterations,
        };
      }

      // Execute tool calls if executor available
      if (!this.toolDispatcher) {
        return {
          content: assistantMessage.content || '',
          toolCalls,
          messages: [...this.history],
          iterations,
        };
      }

      const toolResults = await this.executeToolCalls(toolCalls);

      // Add tool results to history
      for (const result of toolResults) {
        this.history.push({
          role: 'tool' as const,
          content: result.content,
          tool_call_id: result.tool_call_id,
        } as ChatMessage);
      }
    }

    // Max iterations reached
    const lastAssistant = this.history
      .filter(m => m.role === 'assistant')
      .pop();
    return {
      content: (lastAssistant?.content as string) || 'Max iterations reached',
      messages: [...this.history],
      iterations,
    };
  }

  /**
   * Stream a response. Yields StreamEvents for content chunks.
   * Detects tool_call markers emitted by the provider stream and filters
   * them out of user-visible output, recording them in history instead.
   */
  async *chatStream(userMessage: string): AsyncGenerator<StreamEvent, void, unknown> {
    this.history.push({ role: 'user', content: userMessage });

    const TOOL_CALL_START = '<!--tool_calls:';
    const TOOL_CALL_END = '-->';

    for (let i = 0; i < this.maxIterations; i++) {
      const messages = this.buildMessages();
      let fullContent = '';
      let toolCallBuffer = '';
      let inToolCallMarker = false;
      let parsedToolCalls: TCTool[] | undefined;

      const stream = this.aiClient.streamAI({
        provider: this.provider,
        model: this.model,
        messages,
        tools: this.tools,
        temperature: this.temperature,
        maxTokens: this.maxTokens,
      });

      for await (const chunk of stream) {
        // When already inside a tool_call marker, keep accumulating
        if (inToolCallMarker) {
          toolCallBuffer += chunk;
          const endIdx = toolCallBuffer.indexOf(TOOL_CALL_END);
          if (endIdx !== -1) {
            // Marker complete — extract the JSON payload
            const markerBody = toolCallBuffer.substring(TOOL_CALL_START.length, endIdx);
            try {
              parsedToolCalls = JSON.parse(markerBody) as TCTool[];
            } catch {
              // malformed — ignore
            }
            inToolCallMarker = false;
            const afterMarker = toolCallBuffer.substring(endIdx + TOOL_CALL_END.length);
            toolCallBuffer = '';
            if (afterMarker) {
              fullContent += afterMarker;
              yield { type: 'content' as const, content: afterMarker } as StreamEvent;
            }
          }
          continue;
        }

        const combined = toolCallBuffer + chunk;

        const startIdx = combined.indexOf(TOOL_CALL_START);
        if (startIdx !== -1) {
          // Found the beginning of a tool_call marker
          const beforeMarker = combined.substring(0, startIdx);
          if (beforeMarker) {
            fullContent += beforeMarker;
            yield { type: 'content' as const, content: beforeMarker } as StreamEvent;
          }
          toolCallBuffer = combined.substring(startIdx);
          inToolCallMarker = true;

          // Check if marker completes within the same chunk
          const endIdx = toolCallBuffer.indexOf(TOOL_CALL_END);
          if (endIdx !== -1) {
            const markerBody = toolCallBuffer.substring(TOOL_CALL_START.length, endIdx);
            try {
              parsedToolCalls = JSON.parse(markerBody) as TCTool[];
            } catch {
              // malformed — ignore
            }
            inToolCallMarker = false;
            const afterMarker = toolCallBuffer.substring(endIdx + TOOL_CALL_END.length);
            toolCallBuffer = '';
            if (afterMarker) {
              fullContent += afterMarker;
              yield { type: 'content' as const, content: afterMarker } as StreamEvent;
            }
          }
        } else {
          // No marker start found.
          // Guard against partial prefix: if combined ends with a '<' that could
          // be the beginning of the marker, buffer it for the next iteration.
          const lastAngle = combined.lastIndexOf('<');
          if (lastAngle !== -1 && combined.length - lastAngle < TOOL_CALL_START.length) {
            const safe = combined.substring(0, lastAngle);
            toolCallBuffer = combined.substring(lastAngle);
            if (safe) {
              fullContent += safe;
              yield { type: 'content' as const, content: safe } as StreamEvent;
            }
          } else {
            toolCallBuffer = '';
            fullContent += combined;
            yield { type: 'content' as const, content: combined } as StreamEvent;
          }
        }
      }

      // Flush any remaining buffer (incomplete marker treated as plain text)
      if (toolCallBuffer) {
        fullContent += toolCallBuffer;
        yield { type: 'content' as const, content: toolCallBuffer } as StreamEvent;
      }

      // Record assistant message in history, including tool_calls when present
      this.history.push({
        role: 'assistant',
        content: fullContent,
        ...(parsedToolCalls && parsedToolCalls.length > 0 ? { tool_calls: parsedToolCalls } : {}),
      });

      if (!parsedToolCalls || parsedToolCalls.length === 0) {
        yield { type: 'done' as const } as StreamEvent;
        return;
      }

      for (const call of parsedToolCalls) {
        yield {
          type: 'tool_call' as const,
          name: call.function.name,
          params: this.parseToolArguments(call),
        } as StreamEvent;
      }

      if (!this.toolDispatcher) {
        yield { type: 'done' as const } as StreamEvent;
        return;
      }

      const toolResults = await this.executeToolCalls(parsedToolCalls);
      for (let idx = 0; idx < toolResults.length; idx++) {
        const result = toolResults[idx];
        const call = parsedToolCalls[idx];
        this.history.push({
          role: 'tool',
          content: result.content,
          tool_call_id: result.tool_call_id,
        } as ChatMessage);
        yield {
          type: 'tool_result' as const,
          name: call.function.name,
          result: this.parseToolResult(result),
        } as StreamEvent;
      }
    }

    yield { type: 'done' as const } as StreamEvent;
  }

  /**
   * Clear conversation history.
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * Get current conversation history.
   */
  getHistory(): ChatMessage[] {
    return [...this.history];
  }

  // --- Internal ---

  private buildMessages(): ChatMessage[] {
    const messages: ChatMessage[] = [];

    if (this.systemPrompt) {
      messages.push({ role: 'system', content: this.systemPrompt });
    }

    messages.push(...this.history);
    return messages;
  }

  private async executeToolCalls(toolCalls: TCTool[]): Promise<ToolResult[]> {
    return this.toolDispatcher?.dispatch(toolCalls) ?? [];
  }

  private parseToolArguments(call: TCTool): Record<string, unknown> {
    try {
      return JSON.parse(call.function.arguments) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private parseToolResult(result: ToolResult): unknown {
    try {
      return JSON.parse(result.content) as unknown;
    } catch {
      return result.content;
    }
  }
}
