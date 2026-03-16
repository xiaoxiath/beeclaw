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
// ContentBlock Union Type
// ============================================

export const ContentBlockSchema = z.discriminatedUnion('type', [
  ThinkingBlockSchema,
  ToolUseBlockSchema,
  ToolResultBlockSchema,
  TextBlockSchema,
  ImageBlockSchema,
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
