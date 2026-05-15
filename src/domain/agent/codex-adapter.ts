/**
 * Codex (OpenAI Responses API) format adapter.
 *
 * Pure functions converting beeclaw's chat-style messages and OpenAI
 * function tools into the input shape the OpenAI Responses API expects.
 *
 * Reference: hermes-agent's codex_responses_adapter.py. Beeclaw's MVP
 * scope intentionally drops:
 *   - codex_reasoning_items / codex_message_items replay (prefix-cache
 *     continuity for long sessions — useful but not load-bearing)
 *   - GitHub Copilot / xAI / chatgpt.com backend variants
 *   - Streaming-event reconstruction
 *
 * What's here is enough to round-trip a multi-turn conversation with
 * function calling against the canonical OpenAI Responses API.
 *
 * Responses API request shape we target:
 *   {
 *     model: "gpt-5.3-codex",
 *     instructions: "<system prompt>",
 *     input: [
 *       { type: "message", role: "user",      content: [{ type: "input_text",  text: "..." }] },
 *       { type: "message", role: "assistant", content: [{ type: "output_text", text: "..." }] },
 *       { type: "function_call",        call_id: "c1", name: "...", arguments: "..." },
 *       { type: "function_call_output", call_id: "c1", output: "..." },
 *     ],
 *     tools: [{ type: "function", name: "...", description: "...", parameters: {...} }],
 *     reasoning: { effort: "medium" },
 *     max_output_tokens: 4096,
 *   }
 */

import type {
  ChatMessage,
  OpenAITool,
  MultimodalContent,
  ToolCall,
  AIResponse,
} from './types';

// ─── Types ─────────────────────────────────────────────────────────────────

/** Responses API content part inside a message item. */
export interface ResponsesContentPart {
  type: 'input_text' | 'output_text' | 'input_image';
  text?: string;
  image_url?: string;
}

/** A single Responses API input item — message, function_call, or function_call_output. */
export type ResponsesInputItem =
  | {
      type: 'message';
      role: 'user' | 'assistant';
      content: ResponsesContentPart[];
    }
  | {
      type: 'function_call';
      call_id: string;
      name: string;
      arguments: string;
    }
  | {
      type: 'function_call_output';
      call_id: string;
      output: string;
    };

/** Responses API tool definition. */
export interface ResponsesTool {
  type: 'function';
  name: string;
  description: string;
  strict: boolean;
  parameters: Record<string, unknown>;
}

/** Codex provider options understood by the adapter. */
export interface CodexProviderOptions {
  reasoning_effort?: 'low' | 'medium' | 'high';
  reasoning_enabled?: boolean;
  instructions?: string;
  request_overrides?: Record<string, unknown>;
}

/** Output of buildCodexRequestBody — a JSON-serializable POST body. */
export interface CodexRequestBody {
  model: string;
  instructions: string;
  input: ResponsesInputItem[];
  tools?: ResponsesTool[];
  reasoning?: { effort: 'low' | 'medium' | 'high' };
  max_output_tokens?: number;
  /** Required false for chatgpt.com backend; see builder for rationale. */
  store?: boolean;
  /** Required true for chatgpt.com backend; see builder + consumeCodexStream. */
  stream?: boolean;
  // Allow request_overrides to inject anything else (temperature, top_p, etc).
  [extra: string]: unknown;
}

// ─── Tools converter ───────────────────────────────────────────────────────

/**
 * Convert chat-completions tool schemas to Responses function-tool schemas.
 * Mirrors hermes' _responses_tools(). Returns undefined when input is empty
 * so the JSON request omits the field rather than sending an empty array.
 */
export function openaiToolsToResponsesTools(
  tools: OpenAITool[] | undefined,
): ResponsesTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  const out: ResponsesTool[] = [];
  for (const t of tools) {
    const fn = t.function;
    if (!fn?.name || typeof fn.name !== 'string' || !fn.name.trim()) continue;
    out.push({
      type: 'function',
      name: fn.name,
      description: fn.description ?? '',
      strict: false,
      parameters: fn.parameters ?? { type: 'object', properties: {} },
    });
  }
  return out.length > 0 ? out : undefined;
}

// ─── Content parts converter (multimodal) ─────────────────────────────────

/**
 * Convert beeclaw's multimodal content array to Responses content parts.
 * Image variants only get input_image (output_image isn't a thing — assistant
 * messages with images are not part of the round-trip in MVP scope).
 */
function multimodalToResponsesParts(
  content: MultimodalContent[],
  role: 'user' | 'assistant',
): ResponsesContentPart[] {
  const textType = role === 'assistant' ? 'output_text' : 'input_text';
  const parts: ResponsesContentPart[] = [];
  for (const c of content) {
    if (c.type === 'text') {
      parts.push({ type: textType, text: c.text });
    } else if (c.type === 'image_url') {
      // Assistant-emitted images would need output_image_url; not modeled here.
      // Drop on assistant role to keep the round-trip clean.
      if (role === 'user') {
        parts.push({ type: 'input_image', image_url: c.image_url.url });
      }
    }
  }
  return parts;
}

function stringContentToParts(
  content: string,
  role: 'user' | 'assistant',
): ResponsesContentPart[] {
  const textType = role === 'assistant' ? 'output_text' : 'input_text';
  return [{ type: textType, text: content }];
}

// ─── Messages converter ───────────────────────────────────────────────────

/**
 * Convert beeclaw's chat-style messages to Responses input items.
 *
 * - system messages are dropped (they live in `instructions`, NOT `input`).
 *   Use extractInstructions() to pull them out.
 * - user/assistant messages → message items with content parts.
 * - assistant messages with tool_calls → emit a message item (if there's
 *   text) followed by one function_call item per tool call.
 * - tool messages → function_call_output items, paired by tool_call_id.
 */
export function chatMessagesToResponsesInput(
  messages: ChatMessage[],
): ResponsesInputItem[] {
  const items: ResponsesInputItem[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    if (msg.role === 'user' || msg.role === 'assistant') {
      const role = msg.role;
      const parts = Array.isArray(msg.content)
        ? multimodalToResponsesParts(msg.content, role)
        : stringContentToParts(String(msg.content ?? ''), role);

      // Only emit a message item if there's actual content.
      // (Assistants that ONLY emit tool calls produce no text part.)
      const hasContent = parts.some(p => (p.text ?? '').length > 0 || p.image_url);
      if (hasContent) {
        items.push({ type: 'message', role, content: parts });
      }

      // Append function_call items for any tool_calls on the message.
      if (role === 'assistant' && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          items.push({
            type: 'function_call',
            call_id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments ?? '',
          });
        }
      }
      continue;
    }

    if (msg.role === 'tool') {
      const callId = msg.tool_call_id;
      if (!callId) continue; // Without a call_id, the API can't pair the output.
      const output = typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content);
      items.push({ type: 'function_call_output', call_id: callId, output });
      continue;
    }
  }

  return items;
}

// ─── Instructions extraction ───────────────────────────────────────────────

/**
 * Pull the system prompt from messages. Used for the Responses API's
 * top-level `instructions` field. Returns the joined system content
 * (multiple system messages are concatenated with double newlines) or
 * an empty string if none.
 */
export function extractInstructions(messages: ChatMessage[]): string {
  const systems: string[] = [];
  for (const msg of messages) {
    if (msg.role !== 'system') continue;
    if (typeof msg.content === 'string') {
      systems.push(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const c of msg.content) {
        if (c.type === 'text') systems.push(c.text);
      }
    }
  }
  return systems.join('\n\n');
}

// ─── Request body builder ─────────────────────────────────────────────────

export interface BuildCodexRequestArgs {
  model: string;
  messages: ChatMessage[];
  tools?: OpenAITool[];
  /** Override the system prompt; otherwise extracted from messages. */
  instructions?: string;
  /** Defaults pulled from provider.options if absent. */
  options?: CodexProviderOptions;
  /** Maps to Responses API max_output_tokens. */
  maxTokens?: number;
}

export function buildCodexRequestBody(args: BuildCodexRequestArgs): CodexRequestBody {
  const { model, messages, tools, options } = args;
  const instructions = args.instructions ?? extractInstructions(messages);
  const input = chatMessagesToResponsesInput(messages);
  const responsesTools = openaiToolsToResponsesTools(tools);

  const body: CodexRequestBody = {
    model,
    instructions,
    input,
    // chatgpt.com/backend-api/codex requires both:
    //   store:  false  → server returns 400 {"detail":"Store must be set to false"}
    //                    otherwise. With store=false, encrypted reasoning items
    //                    are self-contained (server can't look them up by id),
    //                    which matches our MVP scope of not replaying reasoning.
    //   stream: true   → server returns 400 {"detail":"Stream must be set to true"}
    //                    otherwise. We consume the SSE response in
    //                    consumeCodexStream() and reduce events into the same
    //                    CodexRawResponse shape that normalizeCodexResponse
    //                    already understands.
    store: false,
    stream: true,
  };

  if (responsesTools) {
    body.tools = responsesTools;
  }

  // Reasoning is enabled by default unless the operator explicitly
  // disabled it — Codex models are reasoning-first; turning it off
  // is the unusual case, not the common one.
  const reasoningEnabled = options?.reasoning_enabled !== false;
  if (reasoningEnabled) {
    body.reasoning = { effort: options?.reasoning_effort ?? 'medium' };
  }

  // NOTE: chatgpt.com/backend-api/codex rejects max_output_tokens with
  // 400 {"detail":"Unsupported parameter: max_output_tokens"}. The
  // backend uses an internal ceiling tied to the ChatGPT subscription
  // tier. We intentionally drop the field. Operators who need to pin
  // a ceiling for some reason can use options.request_overrides.
  void args.maxTokens;

  // Spread request_overrides last so operators can patch any field
  // (e.g. temperature, parallel_tool_calls) without code changes.
  if (options?.request_overrides && typeof options.request_overrides === 'object') {
    Object.assign(body, options.request_overrides);
  }

  return body;
}

// ─── Response normalization ───────────────────────────────────────────────

/**
 * Tool-call leak pattern (gpt-5.x Codex degeneration).
 *
 * The model occasionally emits what should be a structured `function_call`
 * item as plain assistant text using Harmony/Codex serialization:
 *   "to=functions.web_search"
 *   "assistant to=functions.web_search"
 *   "<|channel|>commentary to=functions.web_search"
 *
 * Detection lets us mark the response incomplete so the caller retries
 * instead of surfacing a confident-looking summary with no tool trace.
 * Lifted from hermes' _TOOL_CALL_LEAK_PATTERN.
 */
const TOOL_CALL_LEAK_PATTERN = /(?:^|[\s>|])to=functions\.[A-Za-z_][\w.]*/i;

/** Raw Responses API output item — only the fields we read. */
export interface ResponsesOutputItem {
  type: string;
  id?: string;
  // message item
  role?: 'assistant';
  status?: string;
  content?: Array<{ type?: string; text?: string }>;
  // function_call item
  call_id?: string;
  name?: string;
  arguments?: string;
  // reasoning item (encrypted blob)
  encrypted_content?: string;
}

/** Raw Responses API response — only the fields we read. */
export interface CodexRawResponse {
  id?: string;
  output?: ResponsesOutputItem[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  // Some backends embed the bare assistant text on the top level for
  // convenience; we tolerate it but prefer output[].
  output_text?: string;
}

/**
 * Convert a Responses API response into beeclaw's AIResponse shape.
 *
 * Walks `output[]` and:
 *   - Concatenates text from `message` items into `choices[0].message.content`
 *   - Promotes `function_call` items to `choices[0].message.tool_calls`
 *   - Drops `reasoning` items (encrypted, not user-visible; preserved upstream
 *     by hermes for prefix-cache continuity, out of MVP scope here)
 *
 * Finish reason resolution:
 *   1. tool_calls present  → 'tool_calls'
 *   2. leak pattern hit + no real tool_calls → 'incomplete' (caller retries)
 *   3. only reasoning, no text and no calls → 'incomplete'
 *   4. otherwise → 'stop'
 */
export function normalizeCodexResponse(raw: CodexRawResponse): AIResponse {
  const output = Array.isArray(raw.output) ? raw.output : [];
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  let sawReasoning = false;

  for (const item of output) {
    const type = item.type;
    if (type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (typeof part?.text === 'string' && part.text.length > 0) {
          textParts.push(part.text);
        }
      }
    } else if (type === 'function_call') {
      const callId = item.call_id;
      const name = item.name;
      if (typeof callId === 'string' && typeof name === 'string') {
        toolCalls.push({
          id: callId,
          type: 'function',
          function: {
            name,
            arguments: typeof item.arguments === 'string' ? item.arguments : '',
          },
        });
      }
    } else if (type === 'reasoning') {
      sawReasoning = true;
    }
  }

  let content: string | null = textParts.length > 0
    ? textParts.join('')
    : (typeof raw.output_text === 'string' && raw.output_text.length > 0
        ? raw.output_text
        : null);

  // Leak recovery: model emitted tool-call serialization as plain text
  // and produced no real function_call items. Caller must retry.
  let leakedToolCall = false;
  if (content && toolCalls.length === 0 && TOOL_CALL_LEAK_PATTERN.test(content)) {
    leakedToolCall = true;
    content = null; // Don't surface the garbage as a summary.
  }

  let finishReason: string;
  if (toolCalls.length > 0) {
    finishReason = 'tool_calls';
  } else if (leakedToolCall) {
    finishReason = 'incomplete';
  } else if (sawReasoning && !content) {
    // Response contained only reasoning (encrypted thinking state).
    // Mark incomplete so callers continue rather than treating as success.
    finishReason = 'incomplete';
  } else {
    finishReason = 'stop';
  }

  const usage = raw.usage
    ? {
        prompt_tokens: raw.usage.input_tokens ?? 0,
        completion_tokens: raw.usage.output_tokens ?? 0,
        total_tokens: raw.usage.total_tokens
          ?? ((raw.usage.input_tokens ?? 0) + (raw.usage.output_tokens ?? 0)),
      }
    : undefined;

  return {
    id: raw.id ?? `codex-${Date.now()}`,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: finishReason,
    }],
    ...(usage ? { usage } : {}),
  };
}

// ─── SSE stream consumer ──────────────────────────────────────────────────

/**
 * Parse a single SSE block into { event, data } pair.
 * Block format:
 *   event: response.completed
 *   data: {"type":"...","response":{...}}
 * Comment lines (starting with `:`) are ignored. Multi-line data folds
 * into a single string with `\n` joiners (per the SSE spec).
 */
function parseSseBlock(block: string): { event?: string; data?: string } {
  const out: { event?: string; data?: string } = {};
  const dataLines: string[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.length === 0 || line.startsWith(':')) continue;
    const idx = line.indexOf(':');
    const field = idx === -1 ? line : line.slice(0, idx);
    let value = idx === -1 ? '' : line.slice(idx + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') out.event = value;
    else if (field === 'data') dataLines.push(value);
  }
  if (dataLines.length > 0) out.data = dataLines.join('\n');
  return out;
}

/**
 * Consume an SSE Response stream from the chatgpt.com Codex backend and
 * reduce its events into a CodexRawResponse that normalizeCodexResponse
 * already knows how to handle.
 *
 * Strategy:
 *   - Prefer the happy path: when `response.completed` event arrives,
 *     its `response` field holds the FULL final shape — return it
 *     directly. This is the standard OpenAI Responses API behavior.
 *   - Fall back to incremental reduction if completed never arrives:
 *     accumulate output items as they're added, append text deltas to
 *     the matching message item's content[].text, append function_call
 *     argument deltas to the matching item's arguments string.
 */
export async function consumeCodexStream(response: Response): Promise<CodexRawResponse> {
  if (!response.body) {
    throw new Error('Codex SSE: response has no body');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = '';
  let completed: CodexRawResponse | undefined;

  // Incremental fallback state. items[] is the running output[]; the
  // index map lets us find a partially-built item by id when delta
  // events arrive.
  const items: ResponsesOutputItem[] = [];
  const itemIndexById = new Map<string, number>();
  let responseId: string | undefined;
  let usage: CodexRawResponse['usage'] | undefined;

  const handleEvent = (eventType: string | undefined, dataStr: string): void => {
    let payload: any;
    try {
      payload = JSON.parse(dataStr);
    } catch {
      return; // malformed event — skip, don't crash the whole turn
    }
    const type = eventType ?? payload?.type;
    if (typeof type !== 'string') return;

    if (type === 'response.completed') {
      const r = payload?.response;
      if (r && typeof r === 'object') {
        completed = r as CodexRawResponse;
      }
      return;
    }

    if (type === 'response.created') {
      const r = payload?.response;
      if (r && typeof r === 'object' && typeof r.id === 'string') {
        responseId = r.id;
      }
      return;
    }

    if (type === 'response.output_item.added') {
      const item = payload?.item;
      if (item && typeof item === 'object' && typeof item.type === 'string') {
        const copy: ResponsesOutputItem = { ...item };
        // Initialize content for messages we'll be folding deltas into.
        if (copy.type === 'message' && !Array.isArray(copy.content)) {
          copy.content = [];
        }
        if (copy.type === 'function_call' && typeof copy.arguments !== 'string') {
          copy.arguments = '';
        }
        const idx = items.push(copy) - 1;
        if (typeof copy.id === 'string') itemIndexById.set(copy.id, idx);
      }
      return;
    }

    if (type === 'response.output_item.done') {
      const item = payload?.item;
      if (item && typeof item.id === 'string') {
        const idx = itemIndexById.get(item.id);
        if (idx !== undefined) items[idx] = { ...item };
      }
      return;
    }

    if (type === 'response.output_text.delta') {
      const itemId = payload?.item_id;
      const delta = typeof payload?.delta === 'string' ? payload.delta : '';
      if (typeof itemId === 'string' && delta) {
        const idx = itemIndexById.get(itemId);
        if (idx !== undefined) {
          const it = items[idx];
          if (Array.isArray(it.content)) {
            // Append to the last text part, or create one.
            const last = it.content[it.content.length - 1];
            if (last && (last.type === 'output_text' || last.type === 'text')) {
              last.text = (last.text ?? '') + delta;
            } else {
              it.content.push({ type: 'output_text', text: delta });
            }
          }
        }
      }
      return;
    }

    if (type === 'response.function_call_arguments.delta') {
      const itemId = payload?.item_id;
      const delta = typeof payload?.delta === 'string' ? payload.delta : '';
      if (typeof itemId === 'string' && delta) {
        const idx = itemIndexById.get(itemId);
        if (idx !== undefined) {
          const it = items[idx];
          if (it.type === 'function_call') {
            it.arguments = (it.arguments ?? '') + delta;
          }
        }
      }
      return;
    }

    // Some backends emit usage in a dedicated event; tolerate either
    // location (top-level on response.completed handled above).
    if (type === 'response.usage' || type === 'response.completed.usage') {
      if (payload?.usage && typeof payload.usage === 'object') {
        usage = payload.usage;
      }
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Split on blank-line event boundary.
      let nlIdx;
      while ((nlIdx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, nlIdx);
        buffer = buffer.slice(nlIdx + 2);
        const { event, data } = parseSseBlock(block);
        if (data === undefined) continue;
        handleEvent(event, data);
      }
    }
    // Drain trailing buffer, if any.
    if (buffer.trim().length > 0) {
      const { event, data } = parseSseBlock(buffer);
      if (data !== undefined) handleEvent(event, data);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }

  // chatgpt.com/backend-api/codex: response.completed carries metadata
  // (id, usage, model) but `output` arrives empty — the actual output
  // streams via per-event deltas accumulated in items[]. So we always
  // take output from the incremental reduction. We DO use completed for
  // id and usage when they're present and the incremental fallback
  // doesn't have them.
  //
  // For backends where completed.output is the full final shape (the
  // generic OpenAI Responses API), we fall back to it when items[] is
  // empty — that path is unverified live but matches the documented
  // event spec.
  const outputFromIncremental = items.length > 0;
  const finalOutput = outputFromIncremental
    ? items
    : (Array.isArray(completed?.output) ? completed!.output : []);
  return {
    id: completed?.id ?? responseId,
    output: finalOutput,
    usage: completed?.usage ?? usage,
  };
}

// ─── Re-exports for tests ─────────────────────────────────────────────────

export type { ChatMessage, OpenAITool, ToolCall };
