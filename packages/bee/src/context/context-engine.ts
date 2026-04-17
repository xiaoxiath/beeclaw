/**
 * Pluggable Context Engine Interface
 *
 * Defines the contract for context compression strategies.
 * TieredCompressor is the default implementation.
 * Future alternatives: LCM, vector-retrieval compression, hybrid strategies.
 */

import type { AIResponse, OpenAITool, ToolCall, ToolResult } from '../core/types';

/**
 * Pluggable context engine interface.
 * TieredCompressor is the default implementation.
 * Future alternatives: LCM, vector-retrieval compression, hybrid strategies.
 */
export interface ContextEngine {
  /**
   * Determine whether compression is needed given estimated vs budget tokens.
   */
  shouldCompress(estimatedTokens: number, budgetTokens: number): boolean;

  /**
   * Compress a text blob to fit within the token budget.
   *
   * @param textBlob        - The raw text to compress
   * @param estimatedTokens - Estimated token count of the text blob
   * @param budgetTokens    - Target token budget to fit within
   * @returns Compression result with the compressed text and metrics
   */
  compress(textBlob: string, estimatedTokens: number, budgetTokens: number): Promise<CompressResult>;

  /**
   * Optional hook: update internal state after receiving an AI response.
   * Useful for adaptive compression strategies that learn from usage patterns.
   */
  updateFromResponse?(response: AIResponse): void;

  /**
   * Optional hook: reset internal state when the session is cleared.
   */
  onSessionReset?(): void;

  /**
   * Optional: expose tool schemas if the engine provides its own tools
   * (e.g., a "summarize_context" tool the model can invoke explicitly).
   */
  getToolSchemas?(): OpenAITool[];

  /**
   * Optional: handle tool calls routed to this engine.
   */
  handleToolCall?(call: ToolCall): Promise<ToolResult>;
}

/**
 * Result of a compression operation.
 */
export interface CompressResult {
  /** The compressed text */
  compressed: string;
  /** Token count of the original text */
  originalTokens: number;
  /** Token count of the compressed text */
  compressedTokens: number;
  /** Compression ratio (compressedTokens / originalTokens) */
  ratio: number;
}
