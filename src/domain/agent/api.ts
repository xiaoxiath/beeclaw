import type { AIProvider } from '../../infra/config/schema';
import type { AIResponse, ChatMessage, OpenAITool, ToolCall, ToolResult, ToolExecutor } from './types';
import { getRetryEngine, RETRY_STRATEGIES } from '../../infra/resilience/unified-retry';
import { logger } from '../../infra/observability/logger';
import { getLLMConcurrencyLimiter, type AcquireOptions } from '../../infra/ai/concurrency-limiter';

// Re-use bee's Anthropic format conversion (extracted from beeclaw)
import { convertToAnthropicFormat, convertFromAnthropicFormat } from '@bee/provider/format/anthropic';

// Per-request fetch timeout (prevents hung server from pinning a concurrency slot forever)
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  createRequestTimeoutScope,
  withTimeoutSignal,
} from '@bee/provider/timeout';

// Single source of truth for provider endpoint table (shared with bee's AIClient)
import { resolveProviderEndpoint, type ProviderEndpoint } from '@bee/provider/provider-configs';

// Re-use bee's utility functions (extracted from beeclaw)
export { hasToolCalls, extractToolCalls } from '@bee/provider/call-ai';

function getRequestTimeoutMs(provider: AIProvider): number {
  const opt = provider.options as Record<string, unknown> | undefined;
  const candidate = opt?.requestTimeoutMs ?? opt?.timeoutMs;
  return typeof candidate === 'number' ? candidate : DEFAULT_REQUEST_TIMEOUT_MS;
}

function getProviderConfig(provider: AIProvider): ProviderEndpoint {
  return resolveProviderEndpoint(provider);
}

// ============================================================================
// B-P0-03: Anthropic API Format Conversion (imported from bee)
// ============================================================================

/**
 * Check if a provider is Anthropic-type.
 */
function isAnthropicProvider(provider: AIProvider): boolean {
  return provider.type === 'anthropic';
}

/**
 * Check if a provider speaks the OpenAI Responses API (Codex / GPT-5+ codex
 * variants). Format conversion lives in codex-adapter.ts.
 */
function isCodexProvider(provider: AIProvider): boolean {
  return provider.type === 'codex';
}

// ============================================================================
// Concurrency-controlled call options
// ============================================================================

export interface CallAIOptions {
  provider: AIProvider;
  model: string;
  messages: ChatMessage[];
  tools?: OpenAITool[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stream?: boolean;
  /** Concurrency control options (optional, used for priority scheduling) */
  concurrency?: AcquireOptions;
}

export interface StreamAIOptions {
  provider: AIProvider;
  model: string;
  messages: ChatMessage[];
  tools?: OpenAITool[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  /** Concurrency control options (optional, used for priority scheduling) */
  concurrency?: AcquireOptions;
}

// ============================================================================
// Raw AI call (no concurrency control — internal use only)
// ============================================================================

async function _callAIRaw(options: {
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

  // Codex (OpenAI Responses API) — wired in A-PR4.
  // Check BEFORE getProviderConfig so the unknown-type error from the
  // shared endpoint table doesn't pre-empt our explicit "not yet wired"
  // diagnostic. PR1 just ships the type + clear error; PR4 will route
  // through codex-adapter.
  if (isCodexProvider(provider)) {
    throw new Error(
      `Codex provider "${provider.name}" is registered but the Responses API ` +
      `adapter is not yet wired (A-PR4). Until then, point your role at a ` +
      `non-codex provider.`
    );
  }

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
    const timeoutMs = getRequestTimeoutMs(provider);
    const retryResult = await engine.execute<Response>(
      'ai_api_call',
      async () => {
        const timeout = createRequestTimeoutScope(timeoutMs, 'Anthropic API call');
        try {
          const res = await fetch(
            `${baseUrl}${path}`,
            withTimeoutSignal({
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': provider.apiKey,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify(body),
            }, timeout),
          );
          if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Anthropic API error: ${res.status} - ${errorText}`);
          }
          return res;
        } catch (error) {
          throw timeout.translateError(error);
        } finally {
          timeout.clear();
        }
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
  const timeoutMs = getRequestTimeoutMs(provider);
  const retryResult = await engine.execute<Response>(
    'ai_api_call',
    async () => {
      const timeout = createRequestTimeoutScope(timeoutMs, 'AI API call');
      try {
        const res = await fetch(
          `${baseUrl}${path}`,
          withTimeoutSignal({
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${provider.apiKey}`,
            },
            body: JSON.stringify(body),
          }, timeout),
        );

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`AI API error: ${res.status} - ${errorText}`);
        }

        return res;
      } catch (error) {
        throw timeout.translateError(error);
      } finally {
        timeout.clear();
      }
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

// ============================================================================
// Concurrency-controlled public API
// ============================================================================

/**
 * Call AI API with concurrency control.
 *
 * All LLM calls in beeclaw go through this function, which automatically
 * enforces the global concurrency limit (default: 2).
 *
 * Callers can optionally pass `concurrency` options for priority scheduling:
 *
 * ```ts
 * await callAI({
 *   provider, model, messages,
 *   concurrency: {
 *     priority: LLMRequestPriority.CRITICAL,
 *     caller: 'Agent.chat',
 *   },
 * });
 * ```
 */
export async function callAI(options: CallAIOptions): Promise<AIResponse> {
  const limiter = getLLMConcurrencyLimiter();
  const { concurrency, ...aiOptions } = options;

  const acquireOpts: AcquireOptions = {
    caller: concurrency?.caller ?? 'callAI',
    priority: concurrency?.priority,
    timeoutMs: concurrency?.timeoutMs,
  };

  return limiter.execute(() => _callAIRaw(aiOptions), acquireOpts);
}

/**
 * Stream AI response with concurrency control.
 *
 * NOTE: The semaphore permit is held for the entire duration of the stream
 * (from acquire until the last chunk is consumed or the generator returns).
 * This is intentional — a streaming connection occupies an API slot throughout.
 */
export async function* streamAI(options: StreamAIOptions): AsyncGenerator<string, void, unknown> {
  const limiter = getLLMConcurrencyLimiter();
  const { concurrency, ...aiOptions } = options;

  const acquireOpts: AcquireOptions = {
    caller: concurrency?.caller ?? 'streamAI',
    priority: concurrency?.priority,
    timeoutMs: concurrency?.timeoutMs,
  };

  // Acquire permit before starting the stream
  const release = await limiter.acquire(acquireOpts);

  try {
    yield* _streamAIRaw(aiOptions);
  } finally {
    release();
  }
}

// ============================================================================
// Raw stream (no concurrency control — internal use only)
// ============================================================================

async function* _streamAIRaw(options: {
  provider: AIProvider;
  model: string;
  messages: ChatMessage[];
  tools?: OpenAITool[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}): AsyncGenerator<string, void, unknown> {
  const { provider, model, messages, tools, temperature, topP, maxTokens } = options;

  // Codex Responses API streaming — wired in A-PR4. Check before
  // getProviderConfig (same rationale as in _callAIRaw).
  if (isCodexProvider(provider)) {
    throw new Error(
      `Codex provider "${provider.name}" streaming not yet wired (A-PR4).`
    );
  }

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
  const timeoutMs = getRequestTimeoutMs(provider);
  type TimedResponse = { response: Response; timeout: ReturnType<typeof createRequestTimeoutScope> };
  const retryResult = await engine.execute<TimedResponse>(
    'ai_api_stream',
    async () => {
      const timeout = createRequestTimeoutScope(timeoutMs, 'AI API stream call');
      try {
        const res = await fetch(
          `${baseUrl}${path}`,
          withTimeoutSignal({
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          }, timeout),
        );

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`AI API error: ${res.status} - ${errorText}`);
        }

        return { response: res, timeout };
      } catch (error) {
        timeout.clear();
        throw timeout.translateError(error);
      }
    },
    RETRY_STRATEGIES.agent
  );

  if (!retryResult.success) {
    throw retryResult.error?.originalError ?? new Error('AI API stream call failed');
  }

  const { response, timeout } = retryResult.value!;
  const reader = response.body?.getReader();
  if (!reader) {
    timeout.clear();
    return;
  }

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
  } catch (error) {
    throw timeout.translateError(error);
  } finally {
    // Cancel the reader so consumer break/abort tears down the underlying
    // HTTP connection (releaseLock alone leaves the body draining in the bg).
    try { await reader.cancel(); } catch { /* noop */ }
    reader.releaseLock();
    timeout.clear();
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
      logger.debug(`  Parameters:`, JSON.stringify(params, null, 2).split('\n').map((line: string, i: number) => i === 0 ? line : '  ' + line).join('\n'));

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

// hasToolCalls and extractToolCalls — re-exported from bee (see import at top)

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
