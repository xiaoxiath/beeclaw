import type { AIProvider, CompressionConfig } from '../../infra/config/schema';

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
  success?: boolean;
  error?: string;
  data?: unknown;
  /** Human-readable output text (used by state tools) */
  output?: string;
  /** HITL signal: the tool needs user input before completing */
  needsUserInput?: boolean;
  /** HITL: the question to ask the user */
  question?: string;
  /** HITL: available options for the user */
  options?: string[];
  /** HITL: additional context */
  context?: string;
  /** HITL: expected input type */
  inputType?: string;
  /** HITL: status message */
  message?: string;
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

// User context for tool execution (especially for Feishu user authorization)
export interface UserContext {
  openId?: string;      // Feishu user open ID
  chatId?: string;      // Feishu chat ID
  messageId?: string;   // Feishu message ID
  userId?: string;      // Generic user ID
  sessionId?: string;   // Session ID for HITL callbacks
}

/**
 * Message source tracking — identifies the origin of each message
 * in the conversation history for context-aware processing.
 */
export type MessageSource = 'user' | 'proactive' | 'recovery' | 'system';

/**
 * Execution context passed to tool handlers when source tracking is needed.
 */
export interface ToolExecContext {
  source: MessageSource;
  sourceTaskId?: string;
  sessionId?: string;
}

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
export type ToolExecutor = (name: string, params: Record<string, unknown>, userContext?: UserContext) => Promise<{
  success: boolean;
  data?: unknown;
  error?: string;
  _contentBlock?: boolean;
}>;

// ============================================
// [AUDIT FIX M-03] Vision model configuration
// ============================================

/**
 * Configuration for two-stage multimodal (vision) processing.
 * Replaces hardcoded model names and system prompts.
 */
export interface VisionConfig {
  /** Vision model for Stage 1 image recognition (default: 'GLM-4.6V') */
  visionModel: string;
  /** Text model for Stage 2 intent/skill processing (default: 'glm-5') */
  textModel: string;
  /** System prompt for vision recognition (configurable) */
  visionSystemPrompt: string;
  /** Behaviour when vision model fails */
  fallbackOnError: 'description' | 'placeholder' | 'retry';
  /** Max retries for vision model (default: 1) */
  maxRetries: number;
}

/**
 * Default vision configuration
 *
 * NOTE: In session/index.ts, textModel is overridden to use agentConfig.model
 * by default, instead of the hardcoded 'glm-5' here. This ensures vision
 * processing uses the same model configured in beeclaw.json's agent.role.
 *
 * Users can still override by setting agent.visionConfig.textModel in config.
 */
export const DEFAULT_VISION_CONFIG: VisionConfig = {
  visionModel: 'glm-4.6v',
  textModel: 'glm-5', // Fallback only; overridden by agentConfig.model in runtime
  visionSystemPrompt:
    '请识别并详细描述这张图片的内容。包括：主要物体、文字、场景、颜色等关键信息。' +
    '如果是食物，列出所有可见的食材和菜品名称。' +
    '如果是代码截图或文档，提取其中的文字内容。' +
    '如果是其他内容（风景、人物、图表等），也请详细描述。',
  fallbackOnError: 'placeholder',
  maxRetries: 1,
};

// ============================================
// [AUDIT FIX M-06] Default blocked tools for proactive tasks
// ============================================

/**
 * Tools that should be blocked by default when executing proactive/scheduled tasks
 * to prevent unintended side effects in unattended scenarios.
 */
export const PROACTIVE_DEFAULT_BLOCKED_TOOLS: string[] = [
  'schedule_create',          // Prevent self-replication
  'schedule_update',          // Prevent schedule mutation loops
  'send_reminder',            // Prevent recursive reminders
];

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
  /** Tools that should be blocked from execution (e.g., scheduling tools in proactive context) */
  blockedTools?: string[];
  compressionConfig?: Partial<CompressionConfig>;  // Context compression config
  /**
   * Per-turn token budget cap, expressed as a *fraction* of the model's
   * context window (e.g. 0.6 = 60%). When a single turn's tool loop
   * consumes more than this, the agent forces completion with a fallback
   * message rather than running away. Default 0.6.
   */
  tokenBudgetPctPerTurn?: number;
  /**
   * Per-turn absolute token budget. Takes precedence over
   * tokenBudgetPctPerTurn if both are set. For ops who want a hard
   * dollar-cost ceiling regardless of context window size.
   */
  maxTokensPerTurn?: number;
  /**
   * User-visible fallback messages emitted when the agent has to bail
   * mid-turn (token budget exceeded, max iterations reached). Defaults
   * are Chinese to match historical behavior; operators on other
   * locales should override via AgentConfig in beeclaw.json.
   */
  fallbackMessages?: {
    tokenBudgetExceeded?: string;
    maxIterationsReached?: string;
  };
}

/**
 * Per-turn defaults. Inlined at call sites in orchestrator and
 * stream-handler too (so tests that mock '@domain/agent/types' don't
 * need to re-list every export); these named constants are the
 * canonical contract for downstream consumers and config-builders.
 */
export const DEFAULT_MAX_TOOL_ITERATIONS = 5;
export const DEFAULT_TOKEN_BUDGET_PCT_PER_TURN = 0.6;

/**
 * Default user-visible fallback messages. Exported so callers (CLI,
 * web, tests) can compose their own messages on top of the same
 * defaults, and so the value is documentable in one place.
 */
export const DEFAULT_FALLBACK_MESSAGES = {
  tokenBudgetExceeded: '处理过程中消耗了过多 Token，已提前终止。请尝试简化问题或拆分为多个步骤。',
  maxIterationsReached: '抱歉，处理您的请求时达到了工具调用次数限制。请尝试简化您的问题。',
} as const;

// Conversation context
export interface ConversationContext {
  messages: ChatMessage[];
  sessionId?: string;
  metadata?: Record<string, unknown>;
}
