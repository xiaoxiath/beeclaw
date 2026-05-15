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

// ─── Re-exports for tests ─────────────────────────────────────────────────

export type { ChatMessage, OpenAITool, ToolCall };
