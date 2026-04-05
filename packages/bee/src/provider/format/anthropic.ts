/**
 * bee — Anthropic API format conversion.
 *
 * Converts between OpenAI-compatible format (bee's canonical format)
 * and Anthropic's native API format.
 *
 * Extracted from beeclaw's src/domain/agent/api.ts.
 */

import type { ChatMessage, OpenAITool, AIResponse } from '../../core/types';

// ============================================================================
// convertToAnthropicFormat
// ============================================================================

/**
 * Convert OpenAI-format messages and tools to Anthropic format.
 *
 * Key differences:
 * - System messages → top-level `system` field
 * - Tool messages → user message with `tool_result` content blocks
 * - Assistant tool_calls → content blocks of type `tool_use`
 * - Tools → `input_schema` instead of `parameters`
 */
export function convertToAnthropicFormat(
  messages: ChatMessage[],
  tools?: OpenAITool[],
): { system?: string; messages: Record<string, unknown>[]; tools?: Record<string, unknown>[] } {
  let systemPrompt: string | undefined;
  const anthropicMessages: Record<string, unknown>[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
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
          try {
            input = JSON.parse(tc.function.arguments);
          } catch {
            /* keep empty */
          }
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
      anthropicMessages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: (msg as any).tool_call_id,
            content: msg.content,
          },
        ],
      });
      continue;
    }

    // user messages
    anthropicMessages.push({ role: msg.role, content: msg.content });
  }

  // Convert tools
  let anthropicTools: Record<string, unknown>[] | undefined;
  if (tools && tools.length > 0) {
    anthropicTools = tools.map((t) => ({
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

// ============================================================================
// convertFromAnthropicFormat
// ============================================================================

/**
 * Convert Anthropic response to OpenAI-compatible AIResponse format.
 */
export function convertFromAnthropicFormat(response: Record<string, unknown>): AIResponse {
  const content =
    (response.content as Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
    }>) || [];
  let textContent = '';
  const toolCalls: ToolCall[] = [];

  // Avoid circular import — inline the ToolCall shape
  interface ToolCall {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }

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
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: textContent || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason:
          toolCalls.length > 0
            ? 'tool_calls'
            : (response.stop_reason as string) || 'stop',
      },
    ],
    usage: response.usage as any,
  } as AIResponse;
}
