/**
 * ContentBlock Types
 *
 * Unified message block types that connect Agent output to message rendering.
 * These types represent different stages of AI response generation.
 */

import { z } from 'zod';

// ============================================
// Thinking Block - Agent's reasoning process
// ============================================

export const ThinkingBlockSchema = z.object({
  type: z.literal('thinking'),
  thinking: z.string(),
});

export type ThinkingBlock = z.infer<typeof ThinkingBlockSchema>;

// ============================================
// Tool Use Block - Tool call invocation
// ============================================

export const ToolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.record(z.unknown()),
});

export type ToolUseBlock = z.infer<typeof ToolUseBlockSchema>;

// ============================================
// Tool Result Block - Tool execution result
// ============================================

export const ToolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  toolUseId: z.string(),
  content: z.string(),
  isError: z.boolean().optional(),
});

export type ToolResultBlock = z.infer<typeof ToolResultBlockSchema>;

// ============================================
// Text Block - Final text answer
// ============================================

export const TextBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export type TextBlock = z.infer<typeof TextBlockSchema>;

// ============================================
// Image Block - Image content
// ============================================

export const ImageBlockSchema = z.object({
  type: z.literal('image'),
  source: z.object({
    type: z.enum(['base64', 'url']),
    mediaType: z.string(),
    data: z.string(),
  }),
});

export type ImageBlock = z.infer<typeof ImageBlockSchema>;

// ============================================
// Confirmation Request Block - HITL tool confirmation
// ============================================

export const ConfirmationRequestBlockSchema = z.object({
  type: z.literal('confirmation_request'),
  toolCallId: z.string(),
  toolName: z.string(),
  params: z.record(z.unknown()),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
  timeoutMs: z.number().optional(),
  expiresAt: z.number().optional(),
  message: z.string(),
  sessionId: z.string().optional(),
});

export type ConfirmationRequestBlock = z.infer<typeof ConfirmationRequestBlockSchema>;

// ============================================
// User Input Request Block - HITL information gathering
// ============================================

export const UserInputRequestBlockSchema = z.object({
  type: z.literal('user_input_request'),
  question: z.string(),
  options: z.array(z.string()).optional(),
  context: z.string().optional(),
  inputType: z.enum(['text', 'choice', 'confirmation', 'multi_choice']).optional(),
  timestamp: z.number().optional(),
  requestId: z.string().optional(),
  sessionId: z.string().optional(),
});

export type UserInputRequestBlock = z.infer<typeof UserInputRequestBlockSchema>;

// ============================================
// Chart Data Block - Data visualization
// ============================================

export const ChartDataBlockSchema = z.object({
  type: z.literal('chart_data'),
  chartType: z.enum([
    'line',
    'area',
    'bar',
    'pie',
    'scatter',
    'radar',
    'funnel',
    'wordCloud',
    'linearProgress',
    'circularProgress',
    'common',
  ]),
  title: z.string().optional(),
  data: z.array(z.record(z.unknown())),
  spec: z.record(z.unknown()).optional(), // Additional VChart spec options
  aspectRatio: z.enum(['1:1', '2:1', '4:3', '16:9']).optional(),
  colorTheme: z.enum(['brand', 'rainbow', 'complementary', 'converse', 'primary']).optional(),
});

export type ChartDataBlock = z.infer<typeof ChartDataBlockSchema>;

// ============================================
// ContentBlock Union Type
// ============================================

export const ContentBlockSchema = z.discriminatedUnion('type', [
  ThinkingBlockSchema,
  ToolUseBlockSchema,
  ToolResultBlockSchema,
  TextBlockSchema,
  ImageBlockSchema,
  ConfirmationRequestBlockSchema,
  UserInputRequestBlockSchema,
  ChartDataBlockSchema,
]);

export type ContentBlock = z.infer<typeof ContentBlockSchema>;

// ============================================
// Helper Functions
// ============================================

/**
 * Type guard for ThinkingBlock
 */
export function isThinkingBlock(block: ContentBlock): block is ThinkingBlock {
  return block.type === 'thinking';
}

/**
 * Type guard for ToolUseBlock
 */
export function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
  return block.type === 'tool_use';
}

/**
 * Type guard for ToolResultBlock
 */
export function isToolResultBlock(block: ContentBlock): block is ToolResultBlock {
  return block.type === 'tool_result';
}

/**
 * Type guard for TextBlock
 */
export function isTextBlock(block: ContentBlock): block is TextBlock {
  return block.type === 'text';
}

/**
 * Type guard for ImageBlock
 */
export function isImageBlock(block: ContentBlock): block is ImageBlock {
  return block.type === 'image';
}

/**
 * Type guard for ConfirmationRequestBlock
 */
export function isConfirmationRequestBlock(block: ContentBlock): block is ConfirmationRequestBlock {
  return block.type === 'confirmation_request';
}

/**
 * Type guard for UserInputRequestBlock
 */
export function isUserInputRequestBlock(block: ContentBlock): block is UserInputRequestBlock {
  return block.type === 'user_input_request';
}

/**
 * Create a ThinkingBlock
 */
export function createThinkingBlock(thinking: string): ThinkingBlock {
  return ThinkingBlockSchema.parse({ type: 'thinking', thinking });
}

/**
 * Create a ToolUseBlock
 */
export function createToolUseBlock(
  id: string,
  name: string,
  input: Record<string, unknown>
): ToolUseBlock {
  return ToolUseBlockSchema.parse({ type: 'tool_use', id, name, input });
}

/**
 * Create a ToolResultBlock
 */
export function createToolResultBlock(
  toolUseId: string,
  content: string,
  isError?: boolean
): ToolResultBlock {
  return ToolResultBlockSchema.parse({ type: 'tool_result', toolUseId, content, isError });
}

/**
 * Create a TextBlock
 */
export function createTextBlock(text: string): TextBlock {
  return TextBlockSchema.parse({ type: 'text', text });
}

/**
 * Create an ImageBlock
 */
export function createImageBlock(
  sourceType: 'base64' | 'url',
  mediaType: string,
  data: string
): ImageBlock {
  return ImageBlockSchema.parse({
    type: 'image',
    source: { type: sourceType, mediaType, data },
  });
}

/**
 * Create a ConfirmationRequestBlock for HITL tool confirmation
 */
export function createConfirmationRequestBlock(
  toolCallId: string,
  toolName: string,
  params: Record<string, unknown>,
  riskLevel: 'low' | 'medium' | 'high' | 'critical',
  message: string,
  timeoutMs?: number,
  sessionId?: string
): ConfirmationRequestBlock {
  const block: ConfirmationRequestBlock = {
    type: 'confirmation_request',
    toolCallId,
    toolName,
    params,
    riskLevel,
    message,
  };

  if (timeoutMs !== undefined) {
    block.timeoutMs = timeoutMs;
    block.expiresAt = Date.now() + timeoutMs;
  }

  if (sessionId !== undefined) {
    block.sessionId = sessionId;
  }

  return ConfirmationRequestBlockSchema.parse(block);
}

/**
 * Create a UserInputRequestBlock for HITL information gathering
 */
export function createUserInputRequestBlock(
  question: string,
  options?: string[],
  context?: string,
  inputType?: 'text' | 'choice' | 'confirmation' | 'multi_choice',
  requestId?: string,
  sessionId?: string
): UserInputRequestBlock {
  const block: UserInputRequestBlock = {
    type: 'user_input_request',
    question,
    timestamp: Date.now(),
  };

  if (options !== undefined) {
    block.options = options;
  }

  if (context !== undefined) {
    block.context = context;
  }

  if (inputType !== undefined) {
    block.inputType = inputType;
  }

  if (requestId !== undefined) {
    block.requestId = requestId;
  }

  if (sessionId !== undefined) {
    block.sessionId = sessionId;
  }

  return UserInputRequestBlockSchema.parse(block);
}

/**
 * [AUDIT FIX M-2] Structured vision analysis result for two-stage multimodal processing.
 * Stage 1 (Vision model) produces this, Stage 2 (Text model) consumes it.
 */
export interface VisionAnalysisResult {
  /** Index of the image in the original multimodal message */
  imageIndex: number;
  /** Reference identifier for the image */
  imageRef: string;
  /** Natural language description from the vision model */
  description: string;
  /** Detected elements (e.g., food items, UI elements, text segments) */
  detectedElements: string[];
  /** Confidence score from the vision model (0-1) */
  confidence: number;
}

/**
 * Estimate token cost of an image block based on its source type and data size.
 * Used for context budget calculations.
 */
export function estimateImageTokens(image: ImageBlock): number {
  if (image.source.type === 'base64') {
    const dataLen = image.source.data.length;
    if (dataLen > 100_000) return 1600; // High-res
    if (dataLen > 10_000) return 800;   // Medium-res
    return 300;                          // Low-res / thumbnail
  }
  // URL-referenced images: assume medium complexity
  return 800;
}

/**
 * Validate ContentBlock array
 */
export function validateContentBlocks(blocks: unknown[]): ContentBlock[] {
  return blocks.map((block) => ContentBlockSchema.parse(block));
}

/**
 * Create a ChartDataBlock for data visualization
 */
export function createChartDataBlock(options: {
  chartType: ChartDataBlock['chartType'];
  title?: string;
  data: Array<Record<string, unknown>>;
  spec?: Record<string, unknown>;
  aspectRatio?: ChartDataBlock['aspectRatio'];
  colorTheme?: ChartDataBlock['colorTheme'];
}): ChartDataBlock {
  return ChartDataBlockSchema.parse({
    type: 'chart_data',
    ...options,
  });
}
