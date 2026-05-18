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

// Codex (OpenAI Responses API) request/response converters
import {
  buildCodexRequestBody,
  normalizeCodexResponse,
  consumeCodexStream,
  type CodexProviderOptions,
} from './codex-adapter';
import {
  loadCodexTokens,
  refreshAndPersistCodexTokens,
  buildCodexCloudflareHeaders,
  CodexAuthError,
  defaultCodexAuthPath,
  type CodexTokens,
} from './codex-auth';

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

// Canonical Codex (ChatGPT-subscription) backend. Distinct from
// api.openai.com — this endpoint is fronted by Cloudflare with a
// strict originator allowlist; see codex-auth.buildCodexCloudflareHeaders.
const DEFAULT_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const CODEX_RESPONSES_PATH = '/responses';

/**
 * Call Codex's Responses API. Auth comes from `~/.codex/auth.json`
 * (written by the upstream `codex` CLI; user logs in once). On a 401
 * we try a single refresh + retry before surfacing the error — that
 * covers the common "access_token expired but refresh_token still
 * valid" case without requiring the operator to do anything.
 *
 * provider.options understood:
 *   - tokenFile?: string  override path to the auth.json file
 *   - all CodexProviderOptions fields (reasoning_effort, etc.)
 *
 * provider.apiKey is intentionally ignored — the bearer comes from
 * the OAuth file. Documented in docs/configuration.md.
 */
async function callCodexResponses(
  provider: AIProvider,
  model: string,
  messages: ChatMessage[],
  tools: OpenAITool[] | undefined,
  maxTokens: number | undefined,
): Promise<AIResponse> {
  const baseUrl = provider.baseUrl ?? DEFAULT_CODEX_BASE_URL;
  const url = `${baseUrl}${CODEX_RESPONSES_PATH}`;

  const opts = provider.options as (CodexProviderOptions & { tokenFile?: string }) | undefined;
  const tokenFile = typeof opts?.tokenFile === 'string' && opts.tokenFile.length > 0
    ? opts.tokenFile
    : defaultCodexAuthPath();

  const body = buildCodexRequestBody({
    model,
    messages,
    tools,
    options: opts,
    maxTokens,
  });
  const serializedBody = JSON.stringify(body);

  // Load the access_token. If the file is missing or malformed we
  // fail fast with a clear "run codex login" message rather than
  // attempting a refresh against a non-existent refresh_token.
  let tokens: CodexTokens;
  try {
    tokens = loadCodexTokens(tokenFile);
  } catch (e) {
    if (e instanceof CodexAuthError) {
      throw new Error(`[Codex] ${e.message}`);
    }
    throw e;
  }

  const performCall = async (accessToken: string): Promise<Response> => {
    const timeout = createRequestTimeoutScope(getRequestTimeoutMs(provider), 'Codex Responses API call');
    try {
      const res = await fetch(
        url,
        withTimeoutSignal({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            ...buildCodexCloudflareHeaders(accessToken),
          },
          body: serializedBody,
        }, timeout),
      );
      return res;
    } catch (error) {
      throw timeout.translateError(error);
    } finally {
      timeout.clear();
    }
  };

  const engine = getRetryEngine();
  const retryResult = await engine.execute<Response>(
    'ai_api_call',
    async () => {
      let res = await performCall(tokens.access_token);

      // 401 → try refresh once, then retry. We deliberately do NOT
      // treat 403 as refreshable: 403 from this endpoint usually means
      // the Cloudflare layer rejected us (missing/wrong header), not
      // that the token expired.
      if (res.status === 401) {
        try {
          tokens = await refreshAndPersistCodexTokens({ authFilePath: tokenFile });
          logger.info('[Codex] access_token refreshed via OAuth, retrying request');
        } catch (refreshErr) {
          if (refreshErr instanceof CodexAuthError) {
            const hint = refreshErr.opts.reloginRequired
              ? ' Re-run `codex` (the Codex CLI) to mint fresh tokens.'
              : '';
            throw new Error(`[Codex] Token refresh failed: ${refreshErr.message}.${hint}`);
          }
          throw refreshErr;
        }
        res = await performCall(tokens.access_token);
      }

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Codex Responses API error: ${res.status} - ${errorText}`);
      }
      return res;
    },
    RETRY_STRATEGIES.agent,
  );
  if (!retryResult.success) {
    throw retryResult.error?.originalError ?? new Error('Codex API call failed');
  }
  // chatgpt.com backend forces stream:true (request body), so the response
  // is text/event-stream regardless. consumeCodexStream reduces SSE events
  // back into a CodexRawResponse for normalizeCodexResponse to handle.
  const raw = await consumeCodexStream(retryResult.value!);
  return normalizeCodexResponse(raw);
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

  // Codex (OpenAI Responses API) — checked BEFORE getProviderConfig so
  // the shared endpoint table doesn't try to resolve a chat-completions
  // path. The Responses API has its own endpoint shape.
  if (isCodexProvider(provider)) {
    return callCodexResponses(provider, model, messages, tools, maxTokens);
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

// ============================================================================
// Fallback wrapper — try primary, on hard failure try a single alternate
// ============================================================================

/** Subset of CallAIOptions a fallback needs — provider/model/params only. */
export interface FallbackTarget {
  provider: AIProvider;
  model: string;
  /** Optional param overrides (temperature/maxTokens). Merged shallow. */
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

/**
 * Decide whether a thrown error from a primary call is worth a fallback
 * attempt. Returns false for cancellations and 4xx client errors that a
 * different model would also reject (bad request, model-not-found).
 *
 * We DO retry on:
 *   - OAuth / auth (401 + reloginRequired)
 *   - quota (429 after retries)
 *   - server errors (5xx)
 *   - network / timeout
 *   - SSE stream aborts mid-response
 */
export function shouldFallback(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof Error && err.name === 'AbortError') return false;
  const msg = err instanceof Error ? err.message : String(err);
  // Bad request / unsupported parameter / context length — fallback model
  // would hit the same logical issue. Don't waste a second call.
  if (/\b400\b|context_length_exceeded|invalid_request_error/i.test(msg)) {
    return false;
  }
  // Everything else (including 401/403/429/5xx/timeout/network/auth/stream
  // abort) is fair game for the fallback hop.
  return true;
}

/**
 * Call primary; on a fallback-worthy failure, call the alternate once.
 *
 * Latency note: the primary's retry engine has already exhausted by the
 * time we get here (callAI wraps RETRY_STRATEGIES.agent internally), so
 * "fall through to alternate" can add 10–20s on top of the failed retry
 * window. A per-provider circuit breaker would short-circuit that —
 * worth doing as a follow-up if the primary stays flaky.
 */
export async function callAIWithFallback(
  options: CallAIOptions,
  fallback: FallbackTarget | undefined,
  // Testing seam: injectable callAI impl. Defaults to the real one in prod.
  // ESM same-file spies don't intercept internal calls, so we expose a
  // parameter rather than rely on vi.spyOn(api, 'callAI').
  callImpl: (o: CallAIOptions) => Promise<AIResponse> = callAI,
): Promise<AIResponse> {
  if (!fallback) return callImpl(options);

  try {
    return await callImpl(options);
  } catch (err) {
    if (!shouldFallback(err)) throw err;
    const primaryName = options.provider.name;
    const primaryModel = options.model;
    const fallbackName = fallback.provider.name;
    const fallbackModel = fallback.model;
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      `[callAI] primary ${primaryName}/${primaryModel} failed — falling back to ${fallbackName}/${fallbackModel}: ${msg}`,
    );
    return callImpl({
      ...options,
      provider: fallback.provider,
      model: fallback.model,
      ...(fallback.temperature !== undefined ? { temperature: fallback.temperature } : {}),
      ...(fallback.topP !== undefined ? { topP: fallback.topP } : {}),
      ...(fallback.maxTokens !== undefined ? { maxTokens: fallback.maxTokens } : {}),
    });
  }
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

  // Codex Responses API: MVP uses a non-streaming call and yields the
  // full content as a single chunk. The Responses API does support
  // streaming events (response.output_text.delta etc.) — wiring those
  // through is a follow-up. For now web SSE consumers see one chunk
  // per turn instead of token-by-token; chat correctness is unaffected.
  if (isCodexProvider(provider)) {
    const fullResponse = await callCodexResponses(provider, model, messages, tools, maxTokens);
    const content = fullResponse.choices[0]?.message?.content;
    if (typeof content === 'string' && content.length > 0) {
      yield content;
    }
    return;
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
