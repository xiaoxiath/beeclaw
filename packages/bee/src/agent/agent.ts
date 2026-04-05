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
  toolExecutor?: (name: string, params: Record<string, unknown>) => Promise<unknown>;
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
  private readonly toolExecutor?: AgentConfig['toolExecutor'];
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
    this.toolExecutor = config.toolExecutor;
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
      if (!this.toolExecutor) {
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
   */
  async *chatStream(userMessage: string): AsyncGenerator<StreamEvent, void, unknown> {
    this.history.push({ role: 'user', content: userMessage });

    const messages = this.buildMessages();
    let fullContent = '';

    const stream = this.aiClient.streamAI({
      provider: this.provider,
      model: this.model,
      messages,
      tools: this.tools,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
    });

    for await (const chunk of stream) {
      fullContent += chunk;
      yield { type: 'content' as const, content: chunk } as StreamEvent;
    }

    this.history.push({ role: 'assistant', content: fullContent });

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
    if (!this.toolExecutor) return [];

    const results: ToolResult[] = [];
    for (const call of toolCalls) {
      try {
        const params = JSON.parse(call.function.arguments);
        const result = await this.toolExecutor(call.function.name, params);
        results.push({
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      } catch (error) {
        results.push({
          tool_call_id: call.id,
          content: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        });
      }
    }
    return results;
  }
}
