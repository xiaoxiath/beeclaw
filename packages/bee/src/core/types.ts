/**
 * bee — Core types for the AI agent harness.
 *
 * These types are provider-agnostic and form the foundation
 * for all other bee modules.
 */

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image_url';
  image_url: { url: string };
}

export type MultimodalContent = TextContent | ImageContent;

export interface MessageMetadata {
  compressed?: boolean;
  compressedAt?: number;
  originalTokenCount?: number;
}

export interface ChatMessage {
  role: ChatRole;
  content: string | MultimodalContent[];
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  metadata?: MessageMetadata;
}

/**
 * Strip internal metadata from messages before sending to LLM API.
 * Returns a new array; does not mutate the input.
 */
export function stripMessageMetadata(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(msg => {
    if (!msg.metadata) return msg;
    const { metadata, ...clean } = msg;
    return clean;
  });
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResult {
  tool_call_id: string;
  content: string;
  success?: boolean;
  error?: string;
  data?: unknown;
}

export interface ToolContext {
  sessionId?: string;
  messages: ChatMessage[];
  iteration: number;
}

export type ToolExecutor = (
  name: string,
  params: Record<string, unknown>,
  context?: ToolContext,
) => Promise<{ success: boolean; data?: unknown; error?: string }>;

// ---------------------------------------------------------------------------
// AI Response
// ---------------------------------------------------------------------------

export interface AIResponse {
  id: string;
  choices: {
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

export type StreamEvent =
  | { type: 'content'; content: string }
  | { type: 'tool_call'; name: string; params: Record<string, unknown> }
  | { type: 'tool_result'; name: string; result: unknown }
  | { type: 'done'; usage?: { prompt_tokens: number; completion_tokens: number } };

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface AgentContextConfig {
  maxTokens: number;
  keepRecent: number;
  keepSystem: boolean;
  compressionThreshold: number;
}

export const DEFAULT_CONTEXT_CONFIG: AgentContextConfig = {
  maxTokens: 120000,
  keepRecent: 6,
  keepSystem: true,
  compressionThreshold: 0.8,
};

export interface TokenStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  contextTokensBefore: number;
  contextTokensAfter: number;
  maxContextTokens: number;
  contextUtilization: number;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  type: string;
  apiKey: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  options?: Record<string, unknown>;
}

export interface ProviderAdapter {
  formatMessages(messages: ChatMessage[], tools?: OpenAITool[]): unknown;
  parseResponse(raw: unknown): AIResponse;
  getHeaders(apiKey: string): Record<string, string>;
}
