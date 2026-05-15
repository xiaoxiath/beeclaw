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

  if (typeof args.maxTokens === 'number' && args.maxTokens > 0) {
    body.max_output_tokens = args.maxTokens;
  }

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

// ─── Re-exports for tests ─────────────────────────────────────────────────

export type { ChatMessage, OpenAITool, ToolCall };
