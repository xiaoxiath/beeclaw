/**
 * Context Manager — Unified context budget control and compression coordination.
 *
 * REFACTORED: Consolidated three overlapping compression mechanisms into a single
 * ContextBudgetController that delegates to TieredCompressor as the sole engine.
 *
 * BEFORE (3 overlapping paths):
 *   1. TieredCompressor (L1/L2/L3 based on utilization)
 *   2. ProgressiveCompactor (age-zone based, also delegates to TieredCompressor)
 *   3. Agent-level trimContextIfNeeded + compressContextWithLLM (legacy LLM call)
 *   4. manageContextCompression (orchestrator that called all of the above with
 *      complex fallback chains)
 *
 * AFTER (single path):
 *   ContextBudgetController
 *     ├── measure()      — check utilization, dedup, health alerts
 *     ├── compress()      — delegates to TieredCompressor.compress() as sole engine
 *     ├── trim()          — emergency message eviction (last resort)
 *     └── manage()        — orchestrates measure → compress → trim in sequence
 *
 * The TieredCompressor's plan() method already handles level selection (L1/L2/L3)
 * based on utilization. There is no need for a separate ProgressiveCompactor or
 * a legacy hybridCompress path.
 */

import type { AIProvider } from '../../infra/config/schema';
import type { ChatMessage } from './types';
import type { AgentContextConfig } from './context';
import type { IHookRunner } from '../ports';
import {
  estimateMessageTokens,
  estimateTotalTokens,
  compressToolResult,
  compressAssistantMessage,
} from './context';
import { getTieredCompressor } from './compression/tiered-compressor';
import { getSimHasher } from './context/simhash';
import { getContextHealthDashboard } from './context/health-dashboard';
import { logger } from '../../infra/observability/logger';
import { scanForInjection, sanitizeText } from '@bee';

// Re-export legacy type for backward compatibility
export type { LegacyCompressionResult as CompressionResult } from './compression';

/**
 * Shared mutable state that the context manager reads/writes.
 * Passed by the Agent class so the manager can operate on the agent's internals.
 */
export interface ContextManagerState {
  messages: ChatMessage[];
  estimatedTokens: number;
  contextConfig: AgentContextConfig;
  hookRunner: IHookRunner | null;
  provider?: AIProvider;
  compressionConfig?: any;
  compressedSummary: string;
  /** Mutex flag to prevent concurrent compression */
  _compressing: boolean;
}

// ============================================================================
// Public API (backward-compatible function signatures)
// ============================================================================

/**
 * Trim context if exceeding token limit — emergency eviction.
 *
 * Compresses tool results and assistant messages in-place, then evicts
 * oldest messages if still over budget. This is a synchronous, lossless
 * operation (no LLM calls).
 */
export function trimContextIfNeeded(state: ContextManagerState): void {
  if (state._compressing) return;
  state._compressing = true;
  try {
    const threshold = state.contextConfig.maxTokens * state.contextConfig.compressionThreshold;

    if (state.estimatedTokens <= threshold) {
      return;
    }

    logger.debug(`[ContextBudgetController] Trim triggered: ${state.estimatedTokens} tokens > ${threshold} threshold`);

    // Find first non-system message
    const systemIndex = state.messages.findIndex(m => m.role === 'system');
    const startIndex = systemIndex >= 0 ? systemIndex + 1 : 0;
    const keepRecent = state.contextConfig.keepRecent;
    const endIndex = state.messages.length - keepRecent;

    if (endIndex <= startIndex) {
      // Very few messages — just drop the oldest non-system one
      if (startIndex < state.messages.length - 2) {
        const removed = state.messages.splice(startIndex, 1);
        state.estimatedTokens -= estimateMessageTokens(removed[0]);
        logger.debug(`[ContextBudgetController] Removed oldest message to free space`);
      }
      return;
    }

    // Phase 1: In-place compression (tool results, assistant messages)
    let tokensFreed = 0;
    for (let i = startIndex; i < endIndex && state.estimatedTokens > threshold; i++) {
      const msg = state.messages[i];

      if (msg.metadata?.compressed) continue;

      const originalTokens = estimateMessageTokens(msg);
      let compressed = false;

      if (msg.role === 'tool' && msg.content && typeof msg.content === 'string') {
        const compressedContent = compressToolResult(msg.content);
        if (compressedContent !== msg.content) {
          msg.content = compressedContent;
          msg.metadata = { ...msg.metadata, compressed: true, compressedAt: Date.now(), originalTokenCount: originalTokens };
          compressed = true;
        }
      }

      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0 && typeof msg.content === 'string') {
        const compressedContent = compressAssistantMessage(msg.content || '', msg.tool_calls);
        if (compressedContent !== msg.content) {
          msg.content = compressedContent;
          msg.metadata = { ...msg.metadata, compressed: true, compressedAt: Date.now(), originalTokenCount: originalTokens };
          compressed = true;
        }
      }

      if (compressed) {
        const newTokens = estimateMessageTokens(msg);
        tokensFreed += originalTokens - newTokens;
        state.estimatedTokens -= originalTokens - newTokens;
      }
    }

    // Phase 2: Message eviction if still over 90%
    while (state.estimatedTokens > state.contextConfig.maxTokens * 0.9 && state.messages.length > keepRecent + 1) {
      const removeIndex = systemIndex >= 0 ? 1 : 0;
      if (removeIndex < state.messages.length - keepRecent) {
        const removed = state.messages.splice(removeIndex, 1);
        state.estimatedTokens -= estimateMessageTokens(removed[0]);
        logger.debug(`[ContextBudgetController] Evicted message at index ${removeIndex}`);
      } else {
        break;
      }
    }

    logger.debug(`[ContextBudgetController] Trim complete: freed ${tokensFreed} tokens, now at ${state.estimatedTokens}`);
  } finally {
    state._compressing = false;
  }
}

/**
 * Compress old messages using the TieredCompressor (sole compression engine).
 *
 * Replaces the legacy compressContextWithLLM which had its own separate
 * LLM compression path. Now delegates entirely to TieredCompressor which
 * internally handles L1 (format) → L2 (extractive) → L3 (LLM abstractive)
 * based on utilization.
 */
export async function compressContextWithLLM(
  state: ContextManagerState,
): Promise<{ summary: string; originalTokens: number; compressedTokens: number; compressionRatio: number }> {
  if (state._compressing) {
    return { summary: '', originalTokens: 0, compressedTokens: 0, compressionRatio: 1 };
  }
  state._compressing = true;
  try {
    const systemIndex = state.messages.findIndex(m => m.role === 'system');
    const keepRecent = 8;
    const startIndex = systemIndex >= 0 ? systemIndex + 1 : 0;
    const endIndex = state.messages.length - keepRecent;

    if (endIndex <= startIndex) {
      return { summary: '', originalTokens: 0, compressedTokens: 0, compressionRatio: 1 };
    }

    const oldMessages = state.messages.slice(startIndex, endIndex);
    const recentMessages = state.messages.slice(-keepRecent);
    const systemMessage = systemIndex >= 0 ? state.messages[systemIndex] : null;

    logger.debug(`[ContextBudgetController] Compressing ${oldMessages.length} old messages via TieredCompressor`);

    if (state.hookRunner) {
      await state.hookRunner.runBeforeCompaction({
        messages: oldMessages,
        tokensBefore: state.estimatedTokens,
        timestamp: new Date().toISOString(),
      });
    }

    // Build a single text blob from old messages for TieredCompressor
    let textBlob = oldMessages.map(m => {
      const role = m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : '工具';
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return `[${role}] ${content}`;
    }).join('\n\n');

    const scanResult = scanForInjection(textBlob);
    if (!scanResult.safe) {
      logger.warn(`[ContextBudgetController] Injection detected in context: ${scanResult.threats.map((t) => `[${t.category}] ${t.pattern}`).join(', ')}`);
      textBlob = sanitizeText(textBlob);
    }

    const compressor = getTieredCompressor();
    const result = await compressor.compress(
      textBlob,
      state.estimatedTokens,
      state.contextConfig.maxTokens,
    );

    const summary = result.compressed;

    if (summary && summary.length < textBlob.length * 0.95) {
      state.compressedSummary = state.compressedSummary
        ? `${state.compressedSummary}\n\n---\n${summary}`
        : summary;

      const newMessages: ChatMessage[] = [];
      if (systemMessage) {
        newMessages.push({
          ...systemMessage,
          content: systemMessage.content + `\n\n## 历史对话摘要\n${state.compressedSummary}`,
        });
      }
      newMessages.push(...recentMessages);

      const oldTokens = state.estimatedTokens;
      state.messages = newMessages;
      state.estimatedTokens = estimateTotalTokens(newMessages);

      logger.debug(
        `[ContextBudgetController] Compression complete: ${oldTokens} → ${state.estimatedTokens} tokens ` +
        `(${Math.round((1 - state.estimatedTokens / oldTokens) * 100)}% reduction)`,
      );

      if (state.hookRunner) {
        await state.hookRunner.runAfterCompaction({
          summary,
          tokensBefore: oldTokens,
          tokensAfter: state.estimatedTokens,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return {
      summary,
      originalTokens: result.originalTokens,
      compressedTokens: result.compressedTokens,
      compressionRatio: result.compressedTokens / Math.max(1, result.originalTokens),
    };
  } catch (error) {
    logger.error('[ContextBudgetController] Compression failed, falling back to trim:', error);
    trimContextIfNeeded(state);
    return { summary: '', originalTokens: 0, compressedTokens: 0, compressionRatio: 1 };
  } finally {
    state._compressing = false;
  }
}

/**
 * Coordinated context management — the single entry point for per-turn
 * context budget control.
 *
 * Replaces the previous manageContextCompression which had complex fallback
 * chains between TieredCompressor, ProgressiveCompactor, hybridCompress,
 * and trimContextIfNeeded.
 *
 * New flow:
 *   1. Health check + deduplication (SimHash)
 *   2. If over budget → TieredCompressor (auto-selects L1/L2/L3)
 *   3. If still over budget → emergency trim (message eviction)
 */
export async function manageContextCompression(state: ContextManagerState): Promise<void> {
  if (state.messages.length <= 10) return;

  const usage = state.estimatedTokens / state.contextConfig.maxTokens;

  // Step 1: Health monitoring
  const dashboard = getContextHealthDashboard();
  const healthMetrics = dashboard.measure(
    state.messages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : '',
      timestamp: Date.now(),
    })),
    state.contextConfig.maxTokens,
  );

  const alerts = dashboard.checkAlerts(healthMetrics);
  if (alerts.length > 0) {
    logger.warn(`[ContextBudgetController] Health alerts: ${alerts.map(a => a.message).join('; ')}`);
  }

  // Step 2: Deduplication using SimHash
  const hasher = getSimHasher();
  const originalCount = state.messages.length;

  const messagesWithContent = state.messages.map((m, idx) => ({
    ...m,
    content: typeof m.content === 'string' ? m.content : '',
    _index: idx,
  }));

  const dedupedItems = hasher.deduplicateItems(messagesWithContent, 3);
  const duplicatesRemoved = originalCount - dedupedItems.length;

  if (duplicatesRemoved > 0) {
    logger.info(`[ContextBudgetController] Removed ${duplicatesRemoved} near-duplicate messages`);
    state.messages = dedupedItems.map(item => {
      const { _index, ...msg } = item;
      return msg;
    });
    state.estimatedTokens = estimateTotalTokens(state.messages);
  }

  // Step 3: Compression via TieredCompressor (sole engine)
  const threshold = state.contextConfig.maxTokens * 0.8;
  if (state.estimatedTokens > threshold) {
    logger.info(`[ContextBudgetController] Context at ${Math.round(usage * 100)}% — compressing via TieredCompressor`);

    try {
      const compressor = getTieredCompressor();
      const keepRecent = state.contextConfig.keepRecent;

      // Separate system, old, and recent messages
      const systemMessages = state.messages.filter(m => m.role === 'system');
      const recentMessages = state.messages.slice(-keepRecent);
      const oldMessages = state.messages.slice(systemMessages.length, -keepRecent);

      // Compress each old message through TieredCompressor
      const compressedOld: ChatMessage[] = [];
      let totalSaved = 0;

      for (const msg of oldMessages) {
        if (typeof msg.content === 'string' && msg.content.length > 100) {
          const result = await compressor.compress(
            msg.content,
            state.estimatedTokens,
            state.contextConfig.maxTokens,
          );

          if (result.compressed !== msg.content) {
            totalSaved += result.originalTokens - result.compressedTokens;
          }
          compressedOld.push({ ...msg, content: result.compressed });
        } else {
          compressedOld.push(msg);
        }
      }

      state.messages = [...systemMessages, ...compressedOld, ...recentMessages];
      state.estimatedTokens = estimateTotalTokens(state.messages);

      logger.info(
        `[ContextBudgetController] Compression complete: saved ${totalSaved} tokens, now at ${state.estimatedTokens}`,
      );
    } catch (error) {
      logger.error('[ContextBudgetController] Compression failed, falling back to trim:', error);
      trimContextIfNeeded(state);
    }
  }
}
