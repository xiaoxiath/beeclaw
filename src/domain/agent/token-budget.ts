/**
 * TokenBudgetManager — Extracted from Agent god-object (Phase 4)
 *
 * Manages context-window token budget: trimming, three-tier compression,
 * SimHash deduplication, and health-dashboard alerts.
 */

import type { ChatMessage } from './types';
import {
  estimateMessageTokens, estimateTotalTokens, estimateTokens,
  compressToolResult, compressAssistantMessage,
  type AgentContextConfig,
} from './context';
import { compressMessages, shouldCompress } from './compression';
import { getSimHasher } from './context/simhash';
import { getContextHealthDashboard } from './context/health-dashboard';
import { logger } from '../../infra/observability/logger';

export interface TokenBudget {
  estimated: number;
  max: number;
  utilization: number;
}

export interface TurnBudgetCheck {
  exceeded: boolean;
  tokensUsed: number;
  limit: number;
}

export class TokenBudgetManager {
  private estimatedTokens: number;

  constructor(
    private contextConfig: AgentContextConfig,
    initialTokens: number,
  ) {
    this.estimatedTokens = initialTokens;
  }

  get tokens(): number { return this.estimatedTokens; }
  setTokens(n: number): void { this.estimatedTokens = n; }
  addTokens(delta: number): void { this.estimatedTokens += delta; }

  getBudget(): TokenBudget {
    return {
      estimated: this.estimatedTokens,
      max: this.contextConfig.maxTokens,
      utilization: this.estimatedTokens / this.contextConfig.maxTokens,
    };
  }

  checkTurnBudget(turnStartTokens: number, maxTokensPerTurn: number): TurnBudgetCheck {
    const tokensUsed = this.estimatedTokens - turnStartTokens;
    return { exceeded: tokensUsed > maxTokensPerTurn, tokensUsed, limit: maxTokensPerTurn };
  }

  trimContextIfNeeded(messages: ChatMessage[]): void {
    const threshold = this.contextConfig.maxTokens * this.contextConfig.compressionThreshold;
    if (this.estimatedTokens <= threshold) return;

    logger.info(`[TokenBudget] Trim triggered: ${this.estimatedTokens} > ${threshold}`);
    const systemIndex = messages.findIndex(m => m.role === 'system');
    const startIndex = systemIndex >= 0 ? systemIndex + 1 : 0;
    const keepRecent = this.contextConfig.keepRecent;
    const endIndex = messages.length - keepRecent;

    if (endIndex <= startIndex) {
      if (startIndex < messages.length - 2) {
        const removed = messages.splice(startIndex, 1);
        this.estimatedTokens -= estimateMessageTokens(removed[0]);
      }
      return;
    }

    let tokensFreed = 0;
    for (let i = startIndex; i < endIndex && this.estimatedTokens > threshold; i++) {
      const msg = messages[i];
      if (msg.metadata?.compressed) continue;
      const originalTokens = estimateMessageTokens(msg);
      let compressed = false;

      if (msg.role === 'tool' && typeof msg.content === 'string') {
        const c = compressToolResult(msg.content);
        if (c !== msg.content) {
          msg.content = c;
          msg.metadata = { ...msg.metadata, compressed: true, compressedAt: Date.now(), originalTokenCount: originalTokens };
          compressed = true;
        }
      }
      if (msg.role === 'assistant' && msg.tool_calls?.length && typeof msg.content === 'string') {
        const c = compressAssistantMessage(msg.content || '', msg.tool_calls);
        if (c !== msg.content) {
          msg.content = c;
          msg.metadata = { ...msg.metadata, compressed: true, compressedAt: Date.now(), originalTokenCount: originalTokens };
          compressed = true;
        }
      }
      if (compressed) {
        const newTokens = estimateMessageTokens(msg);
        tokensFreed += originalTokens - newTokens;
        this.estimatedTokens -= originalTokens - newTokens;
      }
    }

    while (this.estimatedTokens > this.contextConfig.maxTokens * 0.9 && messages.length > keepRecent + 1) {
      const removeIndex = systemIndex >= 0 ? 1 : 0;
      if (removeIndex < messages.length - keepRecent) {
        const removed = messages.splice(removeIndex, 1);
        this.estimatedTokens -= estimateMessageTokens(removed[0]);
      } else break;
    }
    logger.info(`[TokenBudget] Freed ${tokensFreed} tokens, now at ${this.estimatedTokens}`);
  }

  async manageContextCompression(messages: ChatMessage[]): Promise<void> {
    if (messages.length <= 10) return;
    const usage = this.estimatedTokens / this.contextConfig.maxTokens;

    const dashboard = getContextHealthDashboard();
    const healthMetrics = dashboard.measure(
      messages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '', timestamp: Date.now() })),
      this.contextConfig.maxTokens,
    );
    const alerts = dashboard.checkAlerts(healthMetrics);
    if (alerts.length > 0) logger.warn(`[TokenBudget] Health alerts: ${alerts.map(a => a.message).join('; ')}`);

    const hasher = getSimHasher();
    const originalCount = messages.length;
    const withContent = messages.map((m, idx) => ({ ...m, content: typeof m.content === 'string' ? m.content : '', _index: idx }));
    const deduped = hasher.deduplicateItems(withContent, 3);
    const removed = originalCount - deduped.length;
    if (removed > 0) {
      logger.info(`[TokenBudget] Removed ${removed} near-duplicate messages`);
      messages.length = 0;
      for (const item of deduped) { const { _index, ...msg } = item; messages.push(msg as ChatMessage); }
      this.estimatedTokens = estimateTotalTokens(messages);
    }

    if (shouldCompress(this.estimatedTokens, this.contextConfig.maxTokens)) {
      logger.info(`[TokenBudget] Context at ${Math.round(usage * 100)}% — three-tier compression`);
      try {
        const result = await compressMessages(messages, this.contextConfig.maxTokens, this.contextConfig.keepRecent);
        messages.length = 0;
        for (const m of result.messages) messages.push(m);
        if (result.stats) {
          this.estimatedTokens = result.stats.compressedTokens;
          logger.info(`[TokenBudget] ${result.stats.originalTokens} -> ${result.stats.compressedTokens} (${(result.stats.ratio * 100).toFixed(1)}% reduction)`);
        }
      } catch (error) {
        logger.error('[TokenBudget] Compression failed, falling back to trim:', error);
        this.trimContextIfNeeded(messages);
      }
    }
  }
}
