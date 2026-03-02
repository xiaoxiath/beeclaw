import { z } from 'zod';
import type { AIProvider } from '../config/schema';

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

export interface ChatMessage {
  role: ChatRole;
  content: string | MultimodalContent[];  // Support both text and multimodal
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
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
}

// Conversation context
export interface ConversationContext {
  messages: ChatMessage[];
  sessionId?: string;
  metadata?: Record<string, unknown>;
}
