import type { AIProvider } from '../../infra/config/schema';
import type { AIResponse, ChatMessage, OpenAITool, ToolCall, ToolResult, ToolExecutor } from './types';
import { getRetryEngine, RETRY_STRATEGIES } from '../../infra/resilience/unified-retry';
import { logger } from '../../infra/observability/logger';

// Provider-specific configurations
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
    extraBody: { reasoning_split: true }, // Enable reasoning separation
  },
};

// Get provider-specific base URL
function getProviderConfig(provider: AIProvider): { baseUrl: string; path: string; extraBody?: Record<string, unknown> } {
  if (provider.baseUrl) {
    return {
      baseUrl: provider.baseUrl,
      path: '/chat/completions',
      extraBody: provider.options?.extraBody as Record<string, unknown> | undefined,
    };
  }

  const config = PROVIDER_CONFIGS[provider.type];
  if (!config) {
    throw new Error(`Unknown provider type: ${provider.type}`);
  }

  return config;
}

// ============================================================================
// B-P0-03: Anthropic API Format Conversion
// ============================================================================

/**
 * Convert OpenAI-format messages and tools to Anthropic format.
 */
function convertToAnthropicFormat(
  messages: ChatMessage[],
  tools?: OpenAITool[],
): { system?: string; messages: Record<string, unknown>[]; tools?: Record<string, unknown>[] } {
  let systemPrompt: string | undefined;
  const anthropicMessages: Record<string, unknown>[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      // Anthropic uses a top-level `system` field instead of system messages
      systemPrompt = systemPrompt
        ? `${systemPrompt}\n\n${msg.content}`
        : (msg.content as string);
      continue;
    }

    if (msg.role === 'assistant') {
      const content: unknown[] = [];
      if (msg.content) {
        content.push({ type: 'text', text: msg.content });
      }
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          let input: unknown = {};
          try { input = JSON.parse(tc.function.arguments); } catch { /* keep empty */ }
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
      }
      anthropicMessages.push({ role: 'assistant', content });
      continue;
    }

    if (msg.role === 'tool') {
      // Anthropic expects tool results inside a user message with type tool_result
      anthropicMessages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: (msg as any).tool_call_id,
          content: msg.content,
        }],
      });
      continue;
    }

    // user messages
    anthropicMessages.push({ role: msg.role, content: msg.content });
  }

  // Convert tools
  let anthropicTools: Record<string, unknown>[] | undefined;
  if (tools && tools.length > 0) {
    anthropicTools = tools.map(t => ({
      name: t.function.name,
      description: t.function.description || '',
      input_schema: t.function.parameters,
    }));
  }

  return {
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages: anthropicMessages,
    ...(anthropicTools ? { tools: anthropicTools } : {}),
  };
}

/**
 * Convert Anthropic response to OpenAI-compatible AIResponse format.
 */
function convertFromAnthropicFormat(response: Record<string, unknown>): AIResponse {
  const content = response.content as Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }> || [];
  let textContent = '';
  const toolCalls: ToolCall[] = [];

  for (const block of content) {
    if (block.type === 'text' && block.text) {
      textContent += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id || `call_${Date.now()}`,
        type: 'function',
        function: {
          name: block.name || '',
          arguments: JSON.stringify(block.input || {}),
        },
      });
    }
  }

  return {
    id: (response.id as string) || '',
    object: 'chat.completion',
    created: Date.now(),
    model: (response.model as string) || '',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: textContent || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: toolCalls.length > 0 ? 'tool_calls' : ((response.stop_reason as string) || 'stop'),
    }],
    usage: response.usage as any,
  } as AIResponse;
}

/**
 * Check if a provider is Anthropic-type.
 */
function isAnthropicProvider(provider: AIProvider): boolean {
  return provider.type === 'anthropic';
}

// Call AI API
export async function callAI(options: {
  provider: AIProvider;
  model: string;
  messages: ChatMessage[];
  tools?: OpenAITool[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stream?: boolean;
}): Promise<AIResponse> {
  const { provider, model, messages, tools, temperature, topP, maxTokens, stream } = options;

  const { baseUrl, path, extraBody } = getProviderConfig(provider);

  // B-P0-03: Anthropic provider uses a different request/response format
  if (isAnthropicProvider(provider)) {
    const anthropicPayload = convertToAnthropicFormat(messages, tools);
    const body: Record<string, unknown> = {
      model,
      ...anthropicPayload,
      max_tokens: maxTokens || 4096,
    };
    if (temperature !== undefined) body.temperature = temperature;
    if (topP !== undefined) body.top_p = topP;

    const engine = getRetryEngine();
    const retryResult = await engine.execute<Response>(
      'ai_api_call',
      async () => {
        const res = await fetch(`${baseUrl}${path}`, {
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
    const jsonResponse = await retryResult.value!.json();
    return convertFromAnthropicFormat(jsonResponse);
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    stream,
  };

  // Add sampling parameters
  // Note: It's recommended to use either temperature OR top_p, not both
  if (temperature !== undefined) {
    body.temperature = temperature;
  }
  if (topP !== undefined) {
    body.top_p = topP;
  }

  // Add max_tokens
  if (maxTokens !== undefined) {
    body.max_tokens = maxTokens;
  }

  // Add tools if provided
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  // Add provider-specific extra body options (e.g., MiniMax reasoning_split)
  if (extraBody) {
    Object.assign(body, extraBody);
  }

  const engine = getRetryEngine();
  const retryResult = await engine.execute<Response>(
    'ai_api_call',
    async () => {
      const res = await fetch(`${baseUrl}${path}`, {
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
    RETRY_STRATEGIES.agent
  );

  if (!retryResult.success) {
    throw retryResult.error?.originalError ?? new Error('AI API call failed');
  }

  const response = retryResult.value!;
  const jsonResponse = await response.json();

  // Handle reasoning content from various providers
  // 1. MiniMax: reasoning_details (array format)
  // 2. Zhipu: reasoning_content (string format, e.g., glm-4.7-flashx)
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

  // Handle Zhipu reasoning_content (glm-4.7-flashx and similar reasoning models)
  // IMPORTANT: Don't wrap with <thinking> tags - it breaks JSON parsing in FastLLMJudge
  const reasoningContent = jsonResponse.choices?.[0]?.message?.reasoning_content;
  if (reasoningContent && typeof reasoningContent === 'string') {
    const finalContent = jsonResponse.choices?.[0]?.message?.content || '';

    if (!finalContent) {
      // If no content, use reasoning as content (for compression tasks)
      // Don't add thinking tags - keep it clean for JSON parsing
      jsonResponse.choices[0].message.content = reasoningContent;
    }
    // If both exist, prefer finalContent (it's the actual answer, not the reasoning)
    // Don't combine them - that would add thinking tags and break JSON parsing
  }

  return jsonResponse;
}

// Stream AI response
export async function* streamAI(options: {
  provider: AIProvider;
  model: string;
  messages: ChatMessage[];
  tools?: OpenAITool[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}): AsyncGenerator<string, void, unknown> {
  const { provider, model, messages, tools, temperature, topP, maxTokens } = options;

  const { baseUrl, path } = getProviderConfig(provider);

  // B-P0-03: Anthropic streaming uses a different format; skip for now (non-stream fallback)
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
    // Add sampling parameters
    if (temperature !== undefined) {
      body.temperature = temperature;
    }
    if (topP !== undefined) {
      body.top_p = topP;
    }
    if (maxTokens !== undefined) {
      body.max_tokens = maxTokens;
    }

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

  const engine = getRetryEngine();
  const retryResult = await engine.execute<Response>(
    'ai_api_stream',
    async () => {
      const res = await fetch(`${baseUrl}${path}`, {
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
    RETRY_STRATEGIES.agent
  );

  if (!retryResult.success) {
    throw retryResult.error?.originalError ?? new Error('AI API stream call failed');
  }

  const response = retryResult.value!;
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();

  // B-P0-01: Collect tool_calls from streamed deltas
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

        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            // B-P0-01: Before returning, yield collected tool_calls as a special JSON message
            if (toolCallChunks.size > 0) {
              const collectedToolCalls = Array.from(toolCallChunks.values());
              yield `\n<!--tool_calls:${JSON.stringify(collectedToolCalls)}-->`;
            }
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            const content = delta?.content;
            if (content) {
              yield content;
            }

            // B-P0-01: Collect tool_calls from delta chunks
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
          } catch (error) {
            logger.debug('Skip invalid JSON:', error);
          }
        } else if (trimmed.startsWith('{')) {
          // Some providers return raw JSON without "data: " prefix
          try {
            const parsed = JSON.parse(trimmed);
            const delta = parsed.choices?.[0]?.delta;
            const content = delta?.content || parsed.choices?.[0]?.message?.content;
            if (content) {
              yield content;
            }

            // B-P0-01: Also collect tool_calls from non-prefixed JSON
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
          } catch (error) {
            logger.debug('Skip invalid JSON:', error);
          }
        }
      }
    }

    // B-P0-01: If stream ended without [DONE], still yield collected tool_calls
    if (toolCallChunks.size > 0) {
      const collectedToolCalls = Array.from(toolCallChunks.values());
      yield `\n<!--tool_calls:${JSON.stringify(collectedToolCalls)}-->`;
    }
  } finally {
    reader.releaseLock();
  }
}

// Execute tool calls
export async function executeToolCalls(
  toolCalls: ToolCall[],
  executor: ToolExecutor
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];

  logger.debug(`\n[Tool Execution] Executing ${toolCalls.length} tool call(s)...`);

  for (const call of toolCalls) {
    try {
      const params = JSON.parse(call.function.arguments);
      logger.debug(`[Tool Call] ${call.function.name}`);
      logger.debug(`  Parameters:`, JSON.stringify(params, null, 2).split('\n').map((line, i) => i === 0 ? line : '  ' + line).join('\n'));

      const startTime = Date.now();
      const result = await executor(call.function.name, params);
      const elapsed = Date.now() - startTime;

      const resultPreview = typeof result === 'object'
        ? JSON.stringify(result).substring(0, 200) + (JSON.stringify(result).length > 200 ? '...' : '')
        : String(result);

      logger.debug(`[Tool Result] ${call.function.name} (${elapsed}ms)`);
      logger.debug(`  Result:`, resultPreview);

      results.push({
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[Tool Error] ${call.function.name}:`, errorMsg);

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

// Check if response has tool calls
export function hasToolCalls(response: AIResponse): boolean {
  return response.choices.some(
    c => c.message.tool_calls && c.message.tool_calls.length > 0
  );
}

// Extract tool calls from response
export function extractToolCalls(response: AIResponse): ToolCall[] {
  return response.choices.flatMap(c => c.message.tool_calls || []);
}

// Extract content from response
export function extractContent(response: AIResponse): string {
  if (!response) {
    logger.error('[API] extractContent called with null/undefined response');
    throw new Error('Cannot extract content from null response');
  }

  if (!response.choices || !Array.isArray(response.choices)) {
    logger.error('[API] extractContent: response.choices is missing or not an array', {
      hasResponse: !!response,
      hasChoices: !!response?.choices,
      isArray: Array.isArray(response?.choices),
      responseKeys: Object.keys(response || {}),
      responsePreview: JSON.stringify(response).substring(0, 200),
    });
    throw new Error('Invalid response format: missing or invalid choices array');
  }

  if (response.choices.length === 0) {
    logger.warn('[API] extractContent: response.choices is empty array');
    return '';
  }

  return response.choices.map(c => c.message.content || '').join('');
}
