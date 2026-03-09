import { z } from 'zod';
import type { AIProvider, CompressionConfig } from '../config/schema';

// OpenAI-compatible tool schema
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

// Tool call from AI
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// Tool result
export interface ToolResult {
  tool_call_id: string;
  content: string;
}

// Multimodal content types
export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image_url';
  image_url: {
    url: string;  // data:image/jpeg;base64,... or https://...
  };
}

export type MultimodalContent = TextContent | ImageContent;

// Chat message types
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * [P0 FIX] Added `metadata` field to ChatMessage to replace unsafe `(msg as any)._compressed`.
 * 
 * The metadata field provides type-safe storage for internal message state
 * that should NOT be sent to the LLM API. Call `stripMessageMetadata()` before
 * sending messages to any AI provider.
 */
export interface MessageMetadata {
  /** Whether this message has been compressed to save context space */
  compressed?: boolean;
  /** Timestamp when compression occurred */
  compressedAt?: number;
  /** Original token count before compression */
  originalTokenCount?: number;
}

export interface ChatMessage {
  role: ChatRole;
  content: string | MultimodalContent[];  // Support both text and multimodal
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  /** Internal metadata - NOT sent to LLM. Use stripMessageMetadata() before API calls. */
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

// AI response
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

// Tool executor type
export type ToolExecutor = (name: string, params: Record<string, unknown>) => Promise<{
  success: boolean;
  data?: unknown;
  error?: string;
}>;

// Agent options
export interface AgentOptions {
  provider: AIProvider;
  model: string;
  systemPrompt?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  tools?: OpenAITool[];
  toolExecutor?: ToolExecutor;
  maxToolIterations?: number;
  compressionConfig?: Partial<CompressionConfig>;  // Context compression config
}

// Conversation context
export interface ConversationContext {
  messages: ChatMessage[];
  sessionId?: string;
  metadata?: Record<string, unknown>;
}
