/**
 * bee — AI API calling (callAI / streamAI) and utilities.
 *
 * Provider-agnostic AI calling with retry and concurrency support.
 * Extracted from beeclaw's src/domain/agent/api.ts.
 *
 * Changes from beeclaw:
 * - ProviderConfig replaces AIProvider (no config schema dependency)
 * - UnifiedRetryEngine injected via constructor (no singleton)
 * - ConcurrencyLimiter injected via constructor (no singleton)
 * - fetch injectable for testing (fetchFn option)
 * - getLogger() replaces direct logger import
 */

import type { ChatMessage, OpenAITool, AIResponse, ToolCall, ToolResult, ToolExecutor, ProviderConfig } from '../core/types';
import { convertToAnthropicFormat, convertFromAnthropicFormat } from './format/anthropic';
import type { UnifiedRetryEngine } from '../resilience/retry';
import { RETRY_STRATEGIES } from '../resilience/retry';
import type { ConcurrencyLimiter } from './concurrency';
import type { AcquireOptions } from './concurrency';

// ============================================================================
// Provider-specific configurations
// ============================================================================

const PROVIDER_CONFIGS: Record<string, { baseUrl: string; path: string; extraBody?: Record<string, unknown> }> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    path: '/chat/completions',
  },
  zhipu: {
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    path: '/chat/completions',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    path: '/messages',
  },
  minimax: {
    baseUrl: 'https://api.minimaxi.com/v1',
    path: '/chat/completions',
    extraBody: { reasoning_split: true },
  },
};

function getProviderConfig(provider: ProviderConfig): { baseUrl: string; path: string; extraBody?: Record<string, unknown> } {
  if (provider.baseUrl) {
    const url = new URL(provider.baseUrl);
    const hasPathSegment = url.pathname !== '/' && url.pathname !== '';
    return {
      baseUrl: provider.baseUrl,
      path: hasPathSegment ? '' : '/chat/completions',
      extraBody: provider.options?.extraBody as Record<string, unknown> | undefined,
    };
  }

  const config = PROVIDER_CONFIGS[provider.type];
  if (!config) {
    throw new Error(`Unknown provider type: ${provider.type}`);
  }

  return config;
}

function isAnthropicProvider(provider: ProviderConfig): boolean {
  return provider.type === 'anthropic';
}

// ============================================================================
// AIClient — holds injected dependencies
// ============================================================================

export interface AIClientOptions {
  retryEngine: UnifiedRetryEngine;
  concurrencyLimiter: ConcurrencyLimiter;
  /** Override fetch for testing */
  fetchFn?: typeof fetch;
}

export interface CallAIOptions {
  provider: ProviderConfig;
  model: string;
  messages: ChatMessage[];
  tools?: OpenAITool[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  /** Concurrency control options */
  concurrency?: AcquireOptions;
}

export interface StreamAIOptions {
  provider: ProviderConfig;
  model: string;
  messages: ChatMessage[];
  tools?: OpenAITool[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  /** Concurrency control options */
  concurrency?: AcquireOptions;
}

export class AIClient {
  private readonly retryEngine: UnifiedRetryEngine;
  private readonly limiter: ConcurrencyLimiter;
  private readonly fetchFn: typeof fetch;

  constructor(options: AIClientOptions) {
    this.retryEngine = options.retryEngine;
    this.limiter = options.concurrencyLimiter;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  /**
   * Call AI API with concurrency control and retry.
   */
  async callAI(options: CallAIOptions): Promise<AIResponse> {
    const { concurrency, ...aiOptions } = options;

    const acquireOpts: AcquireOptions = {
      caller: concurrency?.caller ?? 'callAI',
      priority: concurrency?.priority,
      timeoutMs: concurrency?.timeoutMs,
    };

    return this.limiter.execute(() => this._callAIRaw(aiOptions), acquireOpts);
  }

  /**
   * Stream AI response with concurrency control.
   */
  async *streamAI(options: StreamAIOptions): AsyncGenerator<string, void, unknown> {
    const { concurrency, ...aiOptions } = options;

    const acquireOpts: AcquireOptions = {
      caller: concurrency?.caller ?? 'streamAI',
      priority: concurrency?.priority,
      timeoutMs: concurrency?.timeoutMs,
    };

    const release = await this.limiter.acquire(acquireOpts);

    try {
      yield* this._streamAIRaw(aiOptions);
    } finally {
      release();
    }
  }

  // --- Internal ---

  private async _callAIRaw(options: Omit<CallAIOptions, 'concurrency'>): Promise<AIResponse> {
    const { provider, model, messages, tools, temperature, topP, maxTokens } = options;

    const { baseUrl, path, extraBody } = getProviderConfig(provider);

    // Anthropic format
    if (isAnthropicProvider(provider)) {
      const anthropicPayload = convertToAnthropicFormat(messages, tools);
      const body: Record<string, unknown> = {
        model,
        ...anthropicPayload,
        max_tokens: maxTokens || 4096,
      };
      if (temperature !== undefined) body.temperature = temperature;
      if (topP !== undefined) body.top_p = topP;

      const retryResult = await this.retryEngine.execute<Response>(
        'ai_api_call',
        async () => {
          const res = await this.fetchFn(`${baseUrl}${path}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': provider.apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Anthropic API error: ${res.status} - ${errorText}`);
          }
          return res;
        },
        RETRY_STRATEGIES.agent,
      );
      if (!retryResult.success) {
        throw retryResult.error?.originalError ?? new Error('Anthropic API call failed');
      }
      const jsonResponse = (await retryResult.value!.json()) as Record<string, unknown>;
      return convertFromAnthropicFormat(jsonResponse);
    }

    // OpenAI-compatible format
    const body: Record<string, unknown> = {
      model,
      messages,
    };
    if (temperature !== undefined) body.temperature = temperature;
    if (topP !== undefined) body.top_p = topP;
    if (maxTokens !== undefined) body.max_tokens = maxTokens;
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    if (extraBody) {
      Object.assign(body, extraBody);
    }

    const retryResult = await this.retryEngine.execute<Response>(
      'ai_api_call',
      async () => {
        const res = await this.fetchFn(`${baseUrl}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.apiKey}`,
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`AI API error: ${res.status} - ${errorText}`);
        }
        return res;
      },
      RETRY_STRATEGIES.agent,
    );

    if (!retryResult.success) {
      throw retryResult.error?.originalError ?? new Error('AI API call failed');
    }

    const response = retryResult.value!;
    const jsonResponse = (await response.json()) as any;

    // Handle reasoning content from various providers
    if (provider.type === 'minimax' || provider.options?.includeReasoning) {
      const reasoningDetails = jsonResponse.choices?.[0]?.message?.reasoning_details;
      if (reasoningDetails && Array.isArray(reasoningDetails)) {
        const reasoningText = reasoningDetails
          .map((r: { text?: string }) => r.text || '')
          .join('\n');
        if (reasoningText && jsonResponse.choices?.[0]?.message) {
          jsonResponse.choices[0].message.content =
            `<thinking>\n${reasoningText}\n</thinking>\n\n${jsonResponse.choices[0].message.content || ''}`;
        }
      }
    }

    const reasoningContent = jsonResponse.choices?.[0]?.message?.reasoning_content;
    if (reasoningContent && typeof reasoningContent === 'string') {
      const finalContent = jsonResponse.choices?.[0]?.message?.content || '';
      if (!finalContent) {
        jsonResponse.choices[0].message.content = reasoningContent;
      }
    }

    return jsonResponse as AIResponse;
  }

  private async *_streamAIRaw(options: Omit<StreamAIOptions, 'concurrency'>): AsyncGenerator<string, void, unknown> {
    const { provider, model, messages, tools, temperature, topP, maxTokens } = options;

    const { baseUrl, path } = getProviderConfig(provider);
    const isAnthropic = isAnthropicProvider(provider);

    const body: Record<string, unknown> = isAnthropic
      ? {
          model,
          ...convertToAnthropicFormat(messages, tools),
          max_tokens: maxTokens || 4096,
          stream: true,
        }
      : {
          model,
          messages,
          stream: true,
        };

    if (!isAnthropic) {
      if (temperature !== undefined) body.temperature = temperature;
      if (topP !== undefined) body.top_p = topP;
      if (maxTokens !== undefined) body.max_tokens = maxTokens;
      if (tools && tools.length > 0) {
        body.tools = tools;
        body.tool_choice = 'auto';
      }
    } else {
      if (temperature !== undefined) body.temperature = temperature;
      if (topP !== undefined) body.top_p = topP;
    }

    const headers: Record<string, string> = isAnthropic
      ? {
          'Content-Type': 'application/json',
          'x-api-key': provider.apiKey,
          'anthropic-version': '2023-06-01',
        }
      : {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.apiKey}`,
        };

    const retryResult = await this.retryEngine.execute<Response>(
      'ai_api_stream',
      async () => {
        const res = await this.fetchFn(`${baseUrl}${path}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`AI API error: ${res.status} - ${errorText}`);
        }
        return res;
      },
      RETRY_STRATEGIES.agent,
    );

    if (!retryResult.success) {
      throw retryResult.error?.originalError ?? new Error('AI API stream call failed');
    }

    const response = retryResult.value!;
    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    const toolCallChunks = new Map<number, { id: string; type: string; function: { name: string; arguments: string } }>();

    try {
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (isAnthropic) {
            if (!trimmed.startsWith('data: ')) continue;

            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              if (toolCallChunks.size > 0) {
                yield `\n<!--tool_calls:${JSON.stringify(Array.from(toolCallChunks.values()))}-->`;
              }
              return;
            }

            try {
              const parsed = JSON.parse(data);

              if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                if (parsed.delta.text) yield parsed.delta.text;
                continue;
              }

              if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
                const idx = parsed.index ?? toolCallChunks.size;
                toolCallChunks.set(idx, {
                  id: parsed.content_block.id || '',
                  type: 'function',
                  function: {
                    name: parsed.content_block.name || '',
                    arguments: '',
                  },
                });
                continue;
              }

              if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'input_json_delta') {
                const idx = parsed.index ?? 0;
                const existing = toolCallChunks.get(idx);
                if (existing && parsed.delta.partial_json) {
                  existing.function.arguments += parsed.delta.partial_json;
                }
                continue;
              }

              if (parsed.type === 'message_delta' && parsed.delta?.stop_reason) {
                if (toolCallChunks.size > 0) {
                  yield `\n<!--tool_calls:${JSON.stringify(Array.from(toolCallChunks.values()))}-->`;
                }
                return;
              }

              if (parsed.type === 'message_stop') {
                if (toolCallChunks.size > 0) {
                  yield `\n<!--tool_calls:${JSON.stringify(Array.from(toolCallChunks.values()))}-->`;
                }
                return;
              }
            } catch {
              continue;
            }

            continue;
          }

          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              if (toolCallChunks.size > 0) {
                yield `\n<!--tool_calls:${JSON.stringify(Array.from(toolCallChunks.values()))}-->`;
              }
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;
              const content = delta?.content;
              if (content) yield content;

              if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  const existing = toolCallChunks.get(idx);
                  if (!existing) {
                    toolCallChunks.set(idx, {
                      id: tc.id || '',
                      type: tc.type || 'function',
                      function: {
                        name: tc.function?.name || '',
                        arguments: tc.function?.arguments || '',
                      },
                    });
                  } else {
                    if (tc.id) existing.id = tc.id;
                    if (tc.function?.name) existing.function.name += tc.function.name;
                    if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
                  }
                }
              }
            } catch {
              // Skip invalid JSON
            }
          } else if (trimmed.startsWith('{')) {
            try {
              const parsed = JSON.parse(trimmed);
              const delta = parsed.choices?.[0]?.delta;
              const content = delta?.content || parsed.choices?.[0]?.message?.content;
              if (content) yield content;

              if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  const existing = toolCallChunks.get(idx);
                  if (!existing) {
                    toolCallChunks.set(idx, {
                      id: tc.id || '',
                      type: tc.type || 'function',
                      function: {
                        name: tc.function?.name || '',
                        arguments: tc.function?.arguments || '',
                      },
                    });
                  } else {
                    if (tc.id) existing.id = tc.id;
                    if (tc.function?.name) existing.function.name += tc.function.name;
                    if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
                  }
                }
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }

      // Stream ended without [DONE]
      if (toolCallChunks.size > 0) {
        yield `\n<!--tool_calls:${JSON.stringify(Array.from(toolCallChunks.values()))}-->`;
      }
    } finally {
      reader.releaseLock();
    }
  }
}

// ============================================================================
// Standalone functions (backward-compatible API)
// ============================================================================

/**
 * Check if response has tool calls.
 */
export function hasToolCalls(response: AIResponse): boolean {
  return response.choices.some(
    (c) => c.message.tool_calls && c.message.tool_calls.length > 0,
  );
}

/**
 * Extract tool calls from response.
 */
export function extractToolCalls(response: AIResponse): ToolCall[] {
  return response.choices.flatMap((c) => c.message.tool_calls || []);
}

/**
 * Extract text content from response.
 */
export function extractContent(response: AIResponse): string {
  if (!response) {
    throw new Error('Cannot extract content from null response');
  }

  if (!response.choices || !Array.isArray(response.choices)) {
    throw new Error('Invalid response format: missing or invalid choices array');
  }

  if (response.choices.length === 0) {
    return '';
  }

  return response.choices.map((c) => c.message.content || '').join('');
}

/**
 * Execute tool calls sequentially.
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  executor: ToolExecutor,
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];

  for (const call of toolCalls) {
    try {
      const params = JSON.parse(call.function.arguments);
      const result = await executor(call.function.name, params);

      results.push({
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    } catch (error) {
      results.push({
        tool_call_id: call.id,
        content: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
      });
    }
  }

  return results;
}

// Types are already exported via their interface declarations above.
