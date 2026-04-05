/**
 * bee — Tiered Compressor.
 *
 * Three-tier compression orchestrator that selects and applies compression
 * levels based on context utilization.
 *
 * L1 (Format): 10-30% compression, ~99% retention, <1ms
 * L2 (Extractive): 30-60% compression, ~85% retention, ~10ms
 * L3 (Abstractive): 60-90% compression, ~70% retention, ~1s
 *
 * Extracted from beeclaw's src/domain/agent/compression/tiered-compressor.ts.
 * Changes: no singletons, uses bee's getLogger/estimateTokens, direct instantiation.
 */

import { getLogger } from '../../core/logger';
import { estimateTokens } from '../token-estimator';
import { L1FormatCompressor } from './l1-format-compressor';
import { L2ExtractiveCompressor } from './l2-extractive-compressor';
import { L3AbstractiveCompressor } from './l3-abstractive-compressor';
import type { CompressionLevel, CompressionLLMClient, CompressionResult, CompressionStats } from './types';
import { createEmptyStats } from './types';

export interface CompressionPlan {
  level: CompressionLevel;
  estimatedRatio: number;
  estimatedLatency: string;
  reason: string;
}

export class TieredCompressor {
  private l1: L1FormatCompressor;
  private l2: L2ExtractiveCompressor;
  private l3: L3AbstractiveCompressor;
  private stats: CompressionStats;

  constructor(config?: { llmClient?: CompressionLLMClient }) {
    this.l1 = new L1FormatCompressor();
    this.l2 = new L2ExtractiveCompressor();
    this.l3 = new L3AbstractiveCompressor(
      config?.llmClient ? { llmClient: config.llmClient } : undefined,
    );
    this.stats = createEmptyStats();
  }

  setLLMClient(client: CompressionLLMClient): void {
    this.l3.setLLMClient(client);
  }

  /**
   * Plan compression strategy based on context utilization.
   */
  plan(currentTokens: number, budgetTokens: number): CompressionPlan {
    const utilization = budgetTokens > 0 ? currentTokens / budgetTokens : 0;

    if (utilization < 0.7) {
      return {
        level: 'L1',
        estimatedRatio: 0.15,
        estimatedLatency: '<1ms',
        reason: `Utilization ${(utilization * 100).toFixed(0)}% < 70%, L1 sufficient`,
      };
    } else if (utilization < 0.85) {
      return {
        level: 'L1+L2',
        estimatedRatio: 0.45,
        estimatedLatency: '~10ms',
        reason: `Utilization ${(utilization * 100).toFixed(0)}% in [70%, 85%), applying L1+L2`,
      };
    } else {
      return {
        level: 'L1+L2+L3',
        estimatedRatio: 0.75,
        estimatedLatency: '~1s',
        reason: `Utilization ${(utilization * 100).toFixed(0)}% >= 85%, aggressive compression needed`,
      };
    }
  }

  /**
   * Execute compression according to plan.
   */
  async execute(text: string, plan: CompressionPlan): Promise<CompressionResult> {
    const startTime = Date.now();
    const logger = getLogger();
    let result = text;
    const totalOriginalTokens = estimateTokens(text);
    const methods: string[] = [];

    // Always apply L1 first
    const l1Result = this.l1.compress(result);
    result = l1Result.compressed;
    methods.push(l1Result.method);

    if (plan.level === 'L1') {
      const latencyMs = Date.now() - startTime;
      this.updateStats('L1', totalOriginalTokens, estimateTokens(result), latencyMs);

      return {
        compressed: result,
        originalTokens: totalOriginalTokens,
        compressedTokens: estimateTokens(result),
        ratio: totalOriginalTokens > 0 ? 1 - estimateTokens(result) / totalOriginalTokens : 0,
        infoRetention: 0.99,
        method: methods.join(' -> '),
        latencyMs,
      };
    }

    // Apply L2
    const l2Ratio = plan.level === 'L1+L2' ? 0.5 : 0.4;
    const l2Result = this.l2.compress(result, l2Ratio);
    result = l2Result.compressed;
    methods.push(l2Result.method);

    if (plan.level === 'L1+L2') {
      const latencyMs = Date.now() - startTime;
      this.updateStats('L1+L2', totalOriginalTokens, estimateTokens(result), latencyMs);

      return {
        compressed: result,
        originalTokens: totalOriginalTokens,
        compressedTokens: estimateTokens(result),
        ratio: totalOriginalTokens > 0 ? 1 - estimateTokens(result) / totalOriginalTokens : 0,
        infoRetention: 0.85,
        method: methods.join(' -> '),
        latencyMs,
      };
    }

    // Apply L3 with fallback
    const l2FallbackResult = result;
    const l3Target = Math.ceil(estimateTokens(result) * 0.3);

    try {
      const l3Result = await this.l3.compress(result, l3Target);
      result = l3Result.compressed;
      methods.push(l3Result.method);

      const latencyMs = Date.now() - startTime;
      this.updateStats('L1+L2+L3', totalOriginalTokens, estimateTokens(result), latencyMs);

      return {
        compressed: result,
        originalTokens: totalOriginalTokens,
        compressedTokens: estimateTokens(result),
        ratio: totalOriginalTokens > 0 ? 1 - estimateTokens(result) / totalOriginalTokens : 0,
        infoRetention: 0.70,
        method: methods.join(' -> '),
        latencyMs,
      };
    } catch (l3Error) {
      logger.warn(
        '[TieredCompressor] L3 failed, degrading to L2:',
        l3Error instanceof Error ? l3Error.message : l3Error,
      );
      methods.push('L3_FALLBACK_TO_L2');

      const latencyMs = Date.now() - startTime;
      const compressedTokens = estimateTokens(l2FallbackResult);
      this.updateStats('L1+L2', totalOriginalTokens, compressedTokens, latencyMs);

      return {
        compressed: l2FallbackResult,
        originalTokens: totalOriginalTokens,
        compressedTokens,
        ratio: totalOriginalTokens > 0 ? 1 - compressedTokens / totalOriginalTokens : 0,
        infoRetention: 0.85,
        method: methods.join(' -> '),
        latencyMs,
      };
    }
  }

  /**
   * Convenience: plan and execute in one call.
   */
  async compress(text: string, currentTokens?: number, budgetTokens?: number): Promise<CompressionResult> {
    const actualCurrentTokens = currentTokens ?? estimateTokens(text);
    const actualBudgetTokens = budgetTokens ?? actualCurrentTokens * 1.5;

    const plan = this.plan(actualCurrentTokens, actualBudgetTokens);
    return this.execute(text, plan);
  }

  getStats(): CompressionStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = createEmptyStats();
  }

  private updateStats(
    level: CompressionLevel,
    originalTokens: number,
    compressedTokens: number,
    latencyMs: number,
  ): void {
    const ratio = originalTokens > 0 ? 1 - compressedTokens / originalTokens : 0;
    const tokensSaved = originalTokens - compressedTokens;

    const levelStats = this.stats.byLevel[level];
    const newCount = levelStats.count + 1;
    levelStats.avgRatio = (levelStats.avgRatio * levelStats.count + ratio) / newCount;
    levelStats.avgLatencyMs = (levelStats.avgLatencyMs * levelStats.count + latencyMs) / newCount;
    levelStats.count = newCount;

    const newTotal = this.stats.totalCompressions + 1;
    this.stats.avgRatio = (this.stats.avgRatio * this.stats.totalCompressions + ratio) / newTotal;
    this.stats.avgLatencyMs = (this.stats.avgLatencyMs * this.stats.totalCompressions + latencyMs) / newTotal;
    this.stats.totalCompressions = newTotal;
    this.stats.totalTokensSaved += tokensSaved;
  }
}
