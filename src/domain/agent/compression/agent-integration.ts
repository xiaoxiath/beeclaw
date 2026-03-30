/**
 * Context Compression Integration for Beeclaw Agent
 *
 * This module provides helper functions to integrate the three-tier compression
 * system into the existing Beeclaw agent without major refactoring.
 */

import { getTieredCompressor } from './index';
import { estimateTokens, estimateTotalTokens } from '../context';
import { logger } from '../../../infra/observability/logger';
import type { ChatMessage } from '../types';

/**
 * Compress messages using the three-tier compression system
 *
 * @param messages Messages to potentially compress
 * @param maxTokens Maximum token budget
 * @param keepRecent Number of recent messages to keep uncompressed
 * @returns Compressed messages (if compression was applied)
 */
export async function compressMessages(
  messages: ChatMessage[],
  maxTokens: number,
  keepRecent: number = 6
): Promise<{
  messages: ChatMessage[];
  stats?: {
    originalTokens: number;
    compressedTokens: number;
    ratio: number;
  };
}> {
  const currentTokens = estimateTotalTokens(messages);
  const threshold = maxTokens * 0.8; // Start compression at 80% usage

  // No compression needed
  if (currentTokens <= threshold) {
    return { messages };
  }

  logger.info(
    `[ContextCompression] Starting compression: ${currentTokens}/${maxTokens} tokens (${((currentTokens / maxTokens) * 100).toFixed(1)}%)`
  );

  const compressor = getTieredCompressor();

  // Separate system, old, and recent messages
  const systemMessages = messages.filter(m => m.role === 'system');
  const recentMessages = messages.slice(-keepRecent);
  const oldMessages = messages.slice(
    systemMessages.length,
    -keepRecent
  );

  // Compress old messages
  const compressedOld: ChatMessage[] = [];
  let totalSaved = 0;

  for (const msg of oldMessages) {
    // Only compress string content
    if (typeof msg.content === 'string' && msg.content.length > 100) {
      const msgTokens = estimateTokens(msg.content);

      // Compress each message, allocating small budget per message
      const result = await compressor.compress(
        msg.content,
        msgTokens,
        maxTokens * 0.03 // 3% of budget per message
      );

      if (result.compressed !== msg.content) {
        totalSaved += result.originalTokens - result.compressedTokens;

        logger.debug(
          `[ContextCompression] Compressed ${msg.role} message: ${result.originalTokens} → ${result.compressedTokens} tokens`
        );
      }

      compressedOld.push({
        ...msg,
        content: result.compressed,
      });
    } else {
      // Keep as-is
      compressedOld.push(msg);
    }
  }

  // Reassemble messages
  const finalMessages = [...systemMessages, ...compressedOld, ...recentMessages];
  const finalTokens = estimateTotalTokens(finalMessages);
  const ratio = (currentTokens - finalTokens) / currentTokens;

  logger.info(
    `[ContextCompression] Completed: ${currentTokens} → ${finalTokens} tokens ` +
    `(${(ratio * 100).toFixed(1)}% reduction, saved ${totalSaved} tokens)`
  );

  return {
    messages: finalMessages,
    stats: {
      originalTokens: currentTokens,
      compressedTokens: finalTokens,
      ratio,
    },
  };
}

/**
 * Quick compression check - determines if compression is needed
 */
export function shouldCompress(currentTokens: number, maxTokens: number): boolean {
  return currentTokens > maxTokens * 0.8;
}

/**
 * Get compression statistics from the tiered compressor
 */
export function getCompressionStats() {
  const compressor = getTieredCompressor();
  return compressor.getStats();
}

/**
 * Reset compression statistics
 */
export function resetCompressionStats() {
  const compressor = getTieredCompressor();
  compressor.resetStats();
}
