/**
 * Tiered Compressor - Three-Tier Compression Orchestrator
 *
 * Intelligently selects and applies compression levels based on:
 * - Current token utilization
 * - Performance requirements
 * - Quality requirements
 *
 * L1 (Format): 10-30% compression, ~99% retention, <1ms
 * L2 (Extractive): 30-60% compression, ~85% retention, ~10ms
 * L3 (Abstractive): 60-90% compression, ~70% retention, ~1s
 */

import type {
  CompressionLevel,
  CompressionPlan,
  CompressionResult,
  CompressionStats,
  CompressionLLMClient,
} from './types';
import { L1FormatCompressor, getL1Compressor } from './l1-format-compressor';
import { L2ExtractiveCompressor, getL2Compressor } from './l2-extractive-compressor';
import { L3AbstractiveCompressor, getL3Compressor } from './l3-abstractive-compressor';
import { estimateTokens } from '../context';
import { logger } from '../../../infra/observability/logger';

export class TieredCompressor {
  private l1: L1FormatCompressor;
  private l2: L2ExtractiveCompressor;
  private l3: L3AbstractiveCompressor;
  private stats: CompressionStats;

  constructor(config?: { llmClient?: CompressionLLMClient }) {
    this.l1 = getL1Compressor();
    this.l2 = getL2Compressor();
    this.l3 = getL3Compressor();

    if (config?.llmClient) {
      this.l3.setLLMClient(config.llmClient);
    }

    // Initialize stats
    this.stats = {
      totalCompressions: 0,
      avgRatio: 0,
      avgLatencyMs: 0,
      totalTokensSaved: 0,
      byLevel: {
        L1: { count: 0, avgRatio: 0, avgLatencyMs: 0 },
        L2: { count: 0, avgRatio: 0, avgLatencyMs: 0 },
        L3: { count: 0, avgRatio: 0, avgLatencyMs: 0 },
        'L1+L2': { count: 0, avgRatio: 0, avgLatencyMs: 0 },
        'L1+L2+L3': { count: 0, avgRatio: 0, avgLatencyMs: 0 },
      },
    };
  }

  /**
   * Set LLM client for L3 compression
   */
  setLLMClient(client: CompressionLLMClient): void {
    this.l3.setLLMClient(client);
  }

  /**
   * Plan compression strategy based on current context utilization
   *
   * @param currentTokens Current token count
   * @param budgetTokens Maximum token budget
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
   * Execute compression according to plan
   *
   * @param text Text to compress
   * @param plan Compression plan (from plan() method)
   * @param targetTokens Optional target token count
   */
  async execute(
    text: string,
    plan: CompressionPlan,
    targetTokens?: number
  ): Promise<CompressionResult> {
    const startTime = Date.now();
    let result = text;
    let totalOriginalTokens = estimateTokens(text);
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

    // Apply L3
    const l3Target = targetTokens ?? Math.ceil(estimateTokens(result) * 0.3);
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
  }

  /**
   * Convenience method: plan and execute in one call
   *
   * @param text Text to compress
   * @param currentTokens Current token count
   * @param budgetTokens Maximum token budget
   */
  async compress(
    text: string,
    currentTokens?: number,
    budgetTokens?: number
  ): Promise<CompressionResult> {
    const actualCurrentTokens = currentTokens ?? estimateTokens(text);
    const actualBudgetTokens = budgetTokens ?? actualCurrentTokens * 1.5; // Default budget

    const plan = this.plan(actualCurrentTokens, actualBudgetTokens);
    logger.debug(
      `[TieredCompressor] Plan: ${plan.level} (${plan.reason})`
    );

    return this.execute(text, plan);
  }

  /**
   * Get compression statistics
   */
  getStats(): CompressionStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalCompressions: 0,
      avgRatio: 0,
      avgLatencyMs: 0,
      totalTokensSaved: 0,
      byLevel: {
        L1: { count: 0, avgRatio: 0, avgLatencyMs: 0 },
        L2: { count: 0, avgRatio: 0, avgLatencyMs: 0 },
        L3: { count: 0, avgRatio: 0, avgLatencyMs: 0 },
        'L1+L2': { count: 0, avgRatio: 0, avgLatencyMs: 0 },
        'L1+L2+L3': { count: 0, avgRatio: 0, avgLatencyMs: 0 },
      },
    };
  }

  /**
   * Update compression statistics
   */
  private updateStats(
    level: CompressionLevel,
    originalTokens: number,
    compressedTokens: number,
    latencyMs: number
  ): void {
    const ratio = originalTokens > 0 ? 1 - compressedTokens / originalTokens : 0;
    const tokensSaved = originalTokens - compressedTokens;

    // Update level-specific stats
    const levelStats = this.stats.byLevel[level];
    const newCount = levelStats.count + 1;
    levelStats.avgRatio =
      (levelStats.avgRatio * levelStats.count + ratio) / newCount;
    levelStats.avgLatencyMs =
      (levelStats.avgLatencyMs * levelStats.count + latencyMs) / newCount;
    levelStats.count = newCount;

    // Update overall stats
    const newTotal = this.stats.totalCompressions + 1;
    this.stats.avgRatio =
      (this.stats.avgRatio * this.stats.totalCompressions + ratio) / newTotal;
    this.stats.avgLatencyMs =
      (this.stats.avgLatencyMs * this.stats.totalCompressions + latencyMs) / newTotal;
    this.stats.totalCompressions = newTotal;
    this.stats.totalTokensSaved += tokensSaved;
  }
}

/**
 * Singleton instance
 */
let tieredInstance: TieredCompressor | null = null;

/**
 * Get tiered compressor instance
 */
export function getTieredCompressor(): TieredCompressor {
  if (!tieredInstance) {
    tieredInstance = new TieredCompressor();
  }
  return tieredInstance;
}

/**
 * Reset tiered compressor (for testing)
 */
export function resetTieredCompressor(): void {
  tieredInstance = null;
}

/**
 * Configure tiered compressor with LLM client
 */
export function configureTieredCompressor(client: CompressionLLMClient): void {
  getTieredCompressor().setLLMClient(client);
}
