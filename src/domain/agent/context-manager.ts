/**
 * Context Manager — Context window management and compression coordination.
 *
 * Responsible for:
 * - Token-aware context trimming (trimContextIfNeeded)
 * - Coordinated multi-tier compression (manageContextCompression)
 * - LLM-based context summarization (compressContextWithLLM)
 *
 * Extracted from the Agent god-object (index.ts) for single-responsibility.
 */

import type { AIProvider } from '../../infra/config/schema';
import type { ChatMessage } from './types';
import type { AgentContextConfig } from './context';
import type { IHookRunner } from '../ports';
import {
  estimateMessageTokens,
  estimateTotalTokens,
  estimateTokens,
  compressToolResult,
  compressAssistantMessage,
} from './context';
import {
  compressMessages,
  shouldCompress,
  hybridCompress,
  type LegacyCompressionResult as CompressionResult,
} from './compression';
import { getSimHasher } from './context/simhash';
import { getContextHealthDashboard } from './context/health-dashboard';
import { logger } from '../../infra/observability/logger';

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
  /** B-P1-06: Mutex flag to prevent concurrent compression */
  _compressing: boolean;
}

/**
 * Trim context if exceeding token limit.
 *
 * [P0 FIX] Uses `metadata.compressed` instead of `(msg as any)._compressed`
 * for type-safe compression tracking.
 */
export function trimContextIfNeeded(state: ContextManagerState): void {
  // B-P1-06: Skip if compression is already in progress
  if (state._compressing) return;
  state._compressing = true;
  try {
    const threshold = state.contextConfig.maxTokens * state.contextConfig.compressionThreshold;

    if (state.estimatedTokens <= threshold) {
      return;
    }

    logger.debug(`[Agent] Context compression triggered: ${state.estimatedTokens} tokens > ${threshold} threshold`);

    const systemIndex = state.messages.findIndex(m => m.role === 'system');
    const startIndex = systemIndex >= 0 ? systemIndex + 1 : 0;
    const keepRecent = state.contextConfig.keepRecent;
    const endIndex = state.messages.length - keepRecent;

    if (endIndex <= startIndex) {
      if (startIndex < state.messages.length - 2) {
        const removed = state.messages.splice(startIndex, 1);
        state.estimatedTokens -= estimateMessageTokens(removed[0]);
        logger.debug(`[Agent] Removed oldest message to free space`);
      }
      return;
    }

    let tokensFreed = 0;
    for (let i = startIndex; i < endIndex && state.estimatedTokens > threshold; i++) {
      const msg = state.messages[i];

      // [P0 FIX] Type-safe compressed check via metadata
      if (msg.metadata?.compressed) continue;

      const originalTokens = estimateMessageTokens(msg);
      let compressed = false;

      if (msg.role === 'tool' && msg.content && typeof msg.content === 'string') {
        const compressedContent = compressToolResult(msg.content);
        if (compressedContent !== msg.content) {
          msg.content = compressedContent;
          // [P0 FIX] Type-safe metadata instead of (msg as any)._compressed
          msg.metadata = {
            ...msg.metadata,
            compressed: true,
            compressedAt: Date.now(),
            originalTokenCount: originalTokens,
          };
          compressed = true;
        }
      }

      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0 && typeof msg.content === 'string') {
        const compressedContent = compressAssistantMessage(msg.content || '', msg.tool_calls);
        if (compressedContent !== msg.content) {
          msg.content = compressedContent;
          msg.metadata = {
            ...msg.metadata,
            compressed: true,
            compressedAt: Date.now(),
            originalTokenCount: originalTokens,
          };
          compressed = true;
        }
      }

      if (compressed) {
        const newTokens = estimateMessageTokens(msg);
        tokensFreed += originalTokens - newTokens;
        state.estimatedTokens -= originalTokens - newTokens;
      }
    }

    while (state.estimatedTokens > state.contextConfig.maxTokens * 0.9 && state.messages.length > keepRecent + 1) {
      const removeIndex = systemIndex >= 0 ? 1 : 0;
      if (removeIndex < state.messages.length - keepRecent) {
        const removed = state.messages.splice(removeIndex, 1);
        state.estimatedTokens -= estimateMessageTokens(removed[0]);
        logger.debug(`[Agent] Removed message at index ${removeIndex} to free space`);
      } else {
        break;
      }
    }

    logger.debug(`[Agent] Context compressed: freed ${tokensFreed} tokens, now at ${state.estimatedTokens}`);
  } finally {
    state._compressing = false;
  }
}

/**
 * Compress old messages using LLM for intelligent summarization.
 */
export async function compressContextWithLLM(state: ContextManagerState): Promise<CompressionResult> {
  // B-P1-06: Skip if compression is already in progress
  if (state._compressing) {
    return { summary: '', originalTokens: 0, compressedTokens: 0, compressionRatio: 1 };
  }
  state._compressing = true;
  try {
    if (!state.provider) {
      return { summary: '', originalTokens: 0, compressedTokens: 0, compressionRatio: 1 };
    }

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

    logger.debug(`[Agent] LLM compressing ${oldMessages.length} old messages...`);

    if (state.hookRunner) {
      await state.hookRunner.runBeforeCompaction({
        messages: oldMessages,
        tokensBefore: state.estimatedTokens,
        timestamp: new Date().toISOString(),
      });
    }

    try {
      const result = await hybridCompress(
        oldMessages,
        state.provider,
        {
          maxTokens: state.contextConfig.maxTokens,
          currentTokens: state.estimatedTokens,
          config: state.compressionConfig,
        }
      );

      if (result.summary) {
        state.compressedSummary = state.compressedSummary
          ? `${state.compressedSummary}\n\n---\n${result.summary}`
          : result.summary;

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
          `[Agent] LLM compression complete: ${oldTokens} → ${state.estimatedTokens} tokens ` +
          `(${Math.round((1 - state.estimatedTokens / oldTokens) * 100)}% reduction)`
        );

        if (state.hookRunner) {
          await state.hookRunner.runAfterCompaction({
            summary: result.summary,
            tokensBefore: oldTokens,
            tokensAfter: state.estimatedTokens,
            timestamp: new Date().toISOString(),
          });
        }
      }

      return {
        summary: result.summary,
        originalTokens: state.estimatedTokens,
        compressedTokens: estimateTokens(result.summary),
        compressionRatio: result.compressionRatio,
      };
    } catch (error) {
      logger.error('[Agent] LLM compression failed:', error);
      trimContextIfNeeded(state);
      return { summary: '', originalTokens: 0, compressedTokens: 0, compressionRatio: 1 };
    }
  } finally {
    state._compressing = false;
  }
}

/**
 * [AUDIT FIX M-04] Coordinated context compression.
 *
 * Enhanced with P0 Context Engineering features:
 * - Health monitoring (ContextHealthDashboard)
 * - Deduplication (SimHash)
 * - Smart selection (RRI + Lost-in-the-Middle)
 * - Three-tier compression
 *
 * This prevents the race condition where rule-trim runs before LLM summarize,
 * causing trimmed messages to be neither summarized nor retained.
 */
export async function manageContextCompression(state: ContextManagerState): Promise<void> {
  if (state.messages.length <= 10) return;

  const usage = state.estimatedTokens / state.contextConfig.maxTokens;

  // [P0] Step 1: Health monitoring
  const dashboard = getContextHealthDashboard();
  const healthMetrics = dashboard.measure(
    state.messages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : '',
      timestamp: Date.now(), // Use current time as approximation
    })),
    state.contextConfig.maxTokens
  );

  const alerts = dashboard.checkAlerts(healthMetrics);
  if (alerts.length > 0) {
    logger.warn(`[Agent] Context health alerts: ${alerts.map(a => a.message).join('; ')}`);
  }

  // [P0] Step 2: Deduplication using SimHash
  const hasher = getSimHasher();
  const originalCount = state.messages.length;

  // Convert messages to items with content for deduplication
  const messagesWithContent = state.messages.map((m, idx) => ({
    ...m,
    content: typeof m.content === 'string' ? m.content : '',
    _index: idx,
  }));

  const dedupedItems = hasher.deduplicateItems(messagesWithContent, 3);
  const duplicatesRemoved = originalCount - dedupedItems.length;

  if (duplicatesRemoved > 0) {
    logger.info(`[Agent] Removed ${duplicatesRemoved} near-duplicate messages`);
    state.messages = dedupedItems.map(item => {
      const { _index, ...msg } = item;
      return msg;
    });
    // Recalculate tokens after deduplication
    state.estimatedTokens = estimateTotalTokens(state.messages);
  }

  // Use new three-tier compression system
  if (shouldCompress(state.estimatedTokens, state.contextConfig.maxTokens)) {
    logger.info(`[Agent] Context at ${Math.round(usage * 100)}% — starting three-tier compression`);

    try {
      const result = await compressMessages(
        state.messages,
        state.contextConfig.maxTokens,
        state.contextConfig.keepRecent
      );

      state.messages = result.messages;

      if (result.stats) {
        state.estimatedTokens = result.stats.compressedTokens;
        logger.info(
          `[Agent] Compression complete: ${result.stats.originalTokens} → ${result.stats.compressedTokens} tokens ` +
          `(${(result.stats.ratio * 100).toFixed(1)}% reduction)`
        );
      }
    } catch (error) {
      logger.error('[Agent] Compression failed, falling back to legacy methods:', error);
      // Fallback to old compression strategy
      if (usage > 0.9) {
        try {
          await compressContextWithLLM(state);
        } catch (_error) {
          logger.warn('[Agent] LLM compression failed in critical mode');
        }
        trimContextIfNeeded(state);
      } else if (usage > 0.7) {
        try {
          await compressContextWithLLM(state);
        } catch (_error) {
          logger.warn('[Agent] LLM compression failed, falling back to trim');
          trimContextIfNeeded(state);
        }
      } else {
        trimContextIfNeeded(state);
      }
    }
  }
}
