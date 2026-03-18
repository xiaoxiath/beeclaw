/**
 * L3 Abstractive Compressor
 *
 * Compress text using LLM to generate semantic summary.
 * Highest compression but with some information loss.
 *
 * Compression rate: 60-90%
 * Information retention: ~70%
 * Latency: ~1s (depends on LLM)
 */

import type { Compressor, CompressionResult, CompressionLLMClient } from './types';
import { estimateTokens } from '../context';
import { logger } from '../../../infra/observability/logger';

export class L3AbstractiveCompressor implements Compressor {
  readonly name = 'L3-Abstractive';

  private llmClient: CompressionLLMClient | null;
  private fallbackToL2: boolean;

  constructor(config?: {
    llmClient?: CompressionLLMClient;
    fallbackToL2?: boolean;
  }) {
    this.llmClient = config?.llmClient ?? null;
    this.fallbackToL2 = config?.fallbackToL2 ?? true;
  }

  /**
   * Set LLM client (can be injected after construction)
   */
  setLLMClient(client: CompressionLLMClient): void {
    this.llmClient = client;
    logger.info('[L3Compressor] LLM client configured');
  }

  /**
   * Compress text using LLM summarization
   * @param text Text to compress
   * @param targetTokens Target token count (default: 30% of original)
   */
  async compress(text: string, targetTokens?: number): Promise<CompressionResult> {
    const startTime = Date.now();
    const originalTokens = estimateTokens(text);

    // If no LLM client, fallback or error
    if (!this.llmClient) {
      if (this.fallbackToL2) {
        logger.warn('[L3Compressor] No LLM client, returning as-is (L2 should handle this)');
        return {
          compressed: text,
          originalTokens,
          compressedTokens: originalTokens,
          ratio: 0,
          infoRetention: 1.0,
          method: 'L3-Abstractive[no-llm:fallback]',
          latencyMs: Date.now() - startTime,
        };
      }
      throw new Error('L3 compression requires LLM client. Call setLLMClient() first.');
    }

    // If already small enough, return as-is
    if (originalTokens <= (targetTokens ?? 100)) {
      return {
        compressed: text,
        originalTokens,
        compressedTokens: originalTokens,
        ratio: 0,
        infoRetention: 1.0,
        method: 'L3-Abstractive[skipped:already_small]',
        latencyMs: Date.now() - startTime,
      };
    }

    // Calculate target tokens (default to 30% of original)
    const target = targetTokens ?? Math.ceil(originalTokens * 0.3);

    try {
      // Truncate very long texts to avoid exceeding LLM context
      const maxInputTokens = 4000;
      let inputText = text;

      if (originalTokens > maxInputTokens) {
        // Keep first half and last half
        const charsPerToken = 4; // Rough estimate
        const keepChars = Math.floor((maxInputTokens / 2) * charsPerToken);
        inputText =
          text.slice(0, keepChars) +
          '\n\n... [middle content omitted for summarization] ...\n\n' +
          text.slice(-keepChars);

        logger.debug(
          `[L3Compressor] Truncated input from ${originalTokens} to ~${maxInputTokens} tokens`
        );
      }

      // Generate summary
      const summary = await this.generateSummary(inputText, target);

      const compressedTokens = estimateTokens(summary);
      const latencyMs = Date.now() - startTime;

      logger.info(
        `[L3Compressor] Compressed ${originalTokens} → ${compressedTokens} tokens (${((1 - compressedTokens / originalTokens) * 100).toFixed(1)}% reduction) in ${latencyMs}ms`
      );

      return {
        compressed: summary,
        originalTokens,
        compressedTokens,
        ratio: originalTokens > 0 ? 1 - compressedTokens / originalTokens : 0,
        infoRetention: 0.70, // Estimated based on LLM summarization quality
        method: 'L3-Abstractive[llm-summary]',
        latencyMs,
      };
    } catch (error) {
      logger.error('[L3Compressor] LLM summarization failed:', error);

      // Fallback: simple truncation
      const truncated = this.simpleTruncate(text, target);
      const compressedTokens = estimateTokens(truncated);

      return {
        compressed: truncated,
        originalTokens,
        compressedTokens,
        ratio: originalTokens > 0 ? 1 - compressedTokens / originalTokens : 0,
        infoRetention: 0.50, // Lower retention for truncation
        method: 'L3-Abstractive[fallback:truncate]',
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Generate summary using LLM
   */
  private async generateSummary(text: string, targetTokens: number): Promise<string> {
    if (!this.llmClient) {
      throw new Error('LLM client not configured');
    }

    const prompt = this.buildPrompt(text, targetTokens);
    const maxOutputTokens = Math.ceil(targetTokens * 1.5); // Allow some buffer

    const response = await this.llmClient.complete(prompt, maxOutputTokens);

    // Extract summary from response (handle different formats)
    return this.extractSummary(response);
  }

  /**
   * Build LLM prompt for summarization
   */
  private buildPrompt(text: string, targetTokens: number): string {
    return `You are a text compression expert. Your task is to create a concise summary that:

1. Preserves all key facts, decisions, and data
2. Removes redundancy, filler words, and low-information content
3. Uses clear, concise sentences
4. Target length: approximately ${targetTokens} tokens

Content to compress:
---
${text}
---

Compressed summary:`;
  }

  /**
   * Extract summary from LLM response
   * Handles various response formats
   */
  private extractSummary(response: string): string {
    // Remove common prefixes (case-insensitive, allow "the" before summary)
    let summary = response
      .replace(/^(Here is|Here's)\s+(the\s+)?summary:?\s*/i, '')
      .replace(/^(Compressed\s+)?summary:?\s*/i, '')
      .replace(/^(The|This)\s+(summary|compressed version)\s+(is|states)?:?\s*/i, '')
      .trim();

    // If response has SUMMARY tags, extract content
    const summaryMatch = summary.match(/SUMMARY_START\s*\n([\s\S]*?)\nSUMMARY_END/);
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
    }

    return summary;
  }

  /**
   * Simple truncation fallback
   * Keeps first and last portions
   */
  private simpleTruncate(text: string, targetTokens: number): string {
    const charsPerToken = 4; // Rough estimate
    const targetChars = targetTokens * charsPerToken;

    if (text.length <= targetChars) {
      return text;
    }

    // Keep 60% from start, 40% from end
    const startChars = Math.floor(targetChars * 0.6);
    const endChars = Math.floor(targetChars * 0.4);

    return (
      text.slice(0, startChars) +
      '\n\n... [content truncated] ...\n\n' +
      text.slice(-endChars)
    );
  }
}

/**
 * Singleton instance
 */
let l3Instance: L3AbstractiveCompressor | null = null;

/**
 * Get L3 compressor instance
 */
export function getL3Compressor(): L3AbstractiveCompressor {
  if (!l3Instance) {
    l3Instance = new L3AbstractiveCompressor();
  }
  return l3Instance;
}

/**
 * Reset L3 compressor (for testing)
 */
export function resetL3Compressor(): void {
  l3Instance = null;
}

/**
 * Configure L3 compressor with LLM client
 */
export function configureL3Compressor(client: CompressionLLMClient): void {
  getL3Compressor().setLLMClient(client);
}
