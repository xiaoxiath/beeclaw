/**
 * bee — L3 Abstractive Compressor.
 *
 * Compress text using LLM to generate semantic summary.
 * Compression rate: 60-90%, Information retention: ~70%, Latency: ~1s
 *
 * Extracted from beeclaw's src/domain/agent/compression/l3-abstractive-compressor.ts.
 * Changes: uses bee's getLogger and estimateTokens, no singleton.
 *
 * P1-3: Added iterative L3 summary support — when a previous summary exists,
 * the prompt instructs the LLM to merge rather than summarize from scratch.
 */

import { estimateTokens } from '../token-estimator';
import type { CompressionResult, CompressionLLMClient } from './types';

export class L3AbstractiveCompressor {
  readonly name = 'L3-Abstractive';

  private llmClient: CompressionLLMClient | null;
  private previousSummary: string | null = null;

  constructor(config?: {
    llmClient?: CompressionLLMClient;
    fallbackToL2?: boolean;
  }) {
    this.llmClient = config?.llmClient ?? null;
    // fallbackToL2 reserved for future L2 cascade
  }

  setLLMClient(client: CompressionLLMClient): void {
    this.llmClient = client;
  }

  /**
   * Set the previous L3 summary for iterative compression.
   * When set, the next compression will merge new content with this summary
   * instead of summarizing from scratch.
   */
  setPreviousSummary(summary: string | null): void {
    this.previousSummary = summary;
  }

  async compress(text: string, targetTokens?: number): Promise<CompressionResult> {
    const startTime = Date.now();
    const originalTokens = estimateTokens(text);

    if (!this.llmClient) {
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

    const target = targetTokens ?? Math.ceil(originalTokens * 0.3);

    try {
      const maxInputTokens = 4000;
      let inputText = text;

      if (originalTokens > maxInputTokens) {
        const charsPerToken = 4;
        const keepChars = Math.floor((maxInputTokens / 2) * charsPerToken);
        inputText =
          text.slice(0, keepChars) +
          '\n\n... [middle content omitted for summarization] ...\n\n' +
          text.slice(-keepChars);
      }

      const summary = await this.generateSummary(inputText, target);
      const compressedTokens = estimateTokens(summary);
      const latencyMs = Date.now() - startTime;

      return {
        compressed: summary,
        originalTokens,
        compressedTokens,
        ratio: originalTokens > 0 ? 1 - compressedTokens / originalTokens : 0,
        infoRetention: 0.70,
        method: this.previousSummary
          ? 'L3-Abstractive[llm-summary:iterative]'
          : 'L3-Abstractive[llm-summary]',
        latencyMs,
      };
    } catch (_error) {
      // Fallback: simple truncation
      const truncated = this.simpleTruncate(text, target);
      const compressedTokens = estimateTokens(truncated);

      return {
        compressed: truncated,
        originalTokens,
        compressedTokens,
        ratio: originalTokens > 0 ? 1 - compressedTokens / originalTokens : 0,
        infoRetention: 0.50,
        method: 'L3-Abstractive[fallback:truncate]',
        latencyMs: Date.now() - startTime,
      };
    }
  }

  private async generateSummary(text: string, targetTokens: number): Promise<string> {
    if (!this.llmClient) throw new Error('LLM client not configured');

    const prompt = this.buildPrompt(text, targetTokens);
    const maxOutputTokens = Math.ceil(targetTokens * 1.5);
    const response = await this.llmClient.complete(prompt, maxOutputTokens);

    return this.extractSummary(response);
  }

  private buildPrompt(text: string, targetTokens: number): string {
    if (this.previousSummary) {
      return `You are a text compression expert. Your task is to create a concise summary that:

1. Preserves all key facts, decisions, and data
2. Removes redundancy, filler words, and low-information content
3. Uses clear, concise sentences
4. Target length: approximately ${targetTokens} tokens
5. Merge with existing summary — update, do not duplicate

## EXISTING SUMMARY (from a previous compaction)
Update and merge this summary with new information below.
Preserve resolved/pending tracking. Do NOT simply append.

${this.previousSummary}

## NEW CONVERSATION (since last compaction)
---
${text}
---

Produce a single merged summary using this structure:

### Resolved
Items that have been completed or answered.

### Pending
Open questions, unresolved tasks, or items still in progress.

### Key Context
Important facts, decisions, constraints, and background information.

Compressed summary:`;
    }

    return `You are a text compression expert. Your task is to create a concise summary that:

1. Preserves all key facts, decisions, and data
2. Removes redundancy, filler words, and low-information content
3. Uses clear, concise sentences
4. Target length: approximately ${targetTokens} tokens

Content to compress:
---
${text}
---

Produce a structured summary using this format:

### Resolved
Items that have been completed or answered.

### Pending
Open questions, unresolved tasks, or items still in progress.

### Key Context
Important facts, decisions, constraints, and background information.

Compressed summary:`;
  }

  private extractSummary(response: string): string {
    let summary = response
      .replace(/^(Here is|Here's)\s+(the\s+)?summary:?\s*/i, '')
      .replace(/^(Compressed\s+)?summary:?\s*/i, '')
      .replace(/^(The|This)\s+(summary|compressed version)\s+(is|states)?:?\s*/i, '')
      .trim();

    const summaryMatch = summary.match(/SUMMARY_START\s*\n([\s\S]*?)\nSUMMARY_END/);
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
    }

    return summary;
  }

  private simpleTruncate(text: string, targetTokens: number): string {
    const charsPerToken = 4;
    const targetChars = targetTokens * charsPerToken;

    if (text.length <= targetChars) return text;

    const startChars = Math.floor(targetChars * 0.6);
    const endChars = Math.floor(targetChars * 0.4);

    return (
      text.slice(0, startChars) +
      '\n\n... [content truncated] ...\n\n' +
      text.slice(-endChars)
    );
  }
}
