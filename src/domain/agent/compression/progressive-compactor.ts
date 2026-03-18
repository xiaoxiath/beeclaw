/**
 * Progressive Compactor
 *
 * Implements progressive compaction strategy inspired by LSM-Tree:
 * - Messages are grouped into age zones (hot/warm/cool/cold)
 * - Older zones are compressed more aggressively
 * - Preserves recent context while compressing old context
 *
 * Age zones:
 * - Hot (0-5 turns): No compression
 * - Warm (6-20 turns): L1 only
 * - Cool (21-50 turns): L1+L2
 * - Cold (51+ turns): L1+L2+L3
 */

import type { AgeZone, CompressionLevel, TimedMessage } from './types';
import { DEFAULT_AGE_ZONES } from './types';
import { TieredCompressor, getTieredCompressor } from './tiered-compressor';
import { estimateTokens } from '../context';
import { logger } from '../../../infra/observability/logger';

export interface CompactResult {
  /** Compacted messages */
  messages: string[];
  /** Total original tokens */
  originalTokens: number;
  /** Total compacted tokens */
  compactedTokens: number;
  /** Compression ratio */
  ratio: number;
  /** Breakdown by zone */
  byZone: Record<string, {
    count: number;
    originalTokens: number;
    compactedTokens: number;
    compressionLevel: string;
  }>;
}

export class ProgressiveCompactor {
  private zones: AgeZone[];
  private compressor: TieredCompressor;

  constructor(config?: {
    zones?: AgeZone[];
    compressor?: TieredCompressor;
  }) {
    this.zones = config?.zones ?? DEFAULT_AGE_ZONES;
    this.compressor = config?.compressor ?? getTieredCompressor();
  }

  /**
   * Compact messages using progressive strategy
   *
   * @param messages Messages with turn numbers
   * @param currentTurn Current turn number
   */
  async compact(messages: TimedMessage[], currentTurn: number): Promise<CompactResult> {
    const startTime = Date.now();

    const result: CompactResult = {
      messages: [],
      originalTokens: 0,
      compactedTokens: 0,
      ratio: 0,
      byZone: {},
    };

    // Initialize zone stats
    for (const zone of this.zones) {
      result.byZone[zone.name] = {
        count: 0,
        originalTokens: 0,
        compactedTokens: 0,
        compressionLevel: zone.compressionLevel,
      };
    }

    // Process each message
    for (const msg of messages) {
      const age = currentTurn - msg.turn;
      const zone = this.findZone(age);

      const originalTokens = estimateTokens(msg.content);
      result.originalTokens += originalTokens;
      result.byZone[zone.name].count++;
      result.byZone[zone.name].originalTokens += originalTokens;

      let compactedContent: string;
      let compactedTokens: number;

      if (zone.compressionLevel === 'none') {
        // No compression
        compactedContent = `[${msg.role}] ${msg.content}`;
        compactedTokens = originalTokens;
      } else {
        // Apply compression
        const plan = {
          level: zone.compressionLevel as CompressionLevel,
          estimatedRatio: 0,
          estimatedLatency: '',
          reason: `Age zone: ${zone.name}`,
        };

        try {
          const compResult = await this.compressor.execute(msg.content, plan);
          compactedContent = `[${msg.role}|${zone.name}] ${compResult.compressed}`;
          compactedTokens = estimateTokens(compResult.compressed);
        } catch (error) {
          logger.warn(
            `[ProgressiveCompactor] Compression failed for zone ${zone.name}, using original:`,
            error
          );
          compactedContent = `[${msg.role}|${zone.name}] ${msg.content}`;
          compactedTokens = originalTokens;
        }
      }

      result.messages.push(compactedContent);
      result.compactedTokens += compactedTokens;
      result.byZone[zone.name].compactedTokens += compactedTokens;
    }

    result.ratio =
      result.originalTokens > 0
        ? 1 - result.compactedTokens / result.originalTokens
        : 0;

    const latencyMs = Date.now() - startTime;
    logger.info(
      `[ProgressiveCompactor] Compacted ${messages.length} messages: ${result.originalTokens} → ${result.compactedTokens} tokens (${(result.ratio * 100).toFixed(1)}% reduction) in ${latencyMs}ms`
    );

    return result;
  }

  /**
   * Find age zone for a given message age
   */
  private findZone(age: number): AgeZone {
    for (const zone of this.zones) {
      if (age <= zone.maxAge) {
        return zone;
      }
    }
    // Fallback to last zone (should have maxAge: Infinity)
    return this.zones[this.zones.length - 1];
  }

  /**
   * Get current zone configuration
   */
  getZones(): AgeZone[] {
    return [...this.zones];
  }

  /**
   * Update zone configuration
   */
  setZones(zones: AgeZone[]): void {
    this.zones = zones;
    logger.info(`[ProgressiveCompactor] Updated zones: ${zones.map(z => z.name).join(', ')}`);
  }

  /**
   * Get zone statistics for a set of messages
   */
  getZoneStats(
    messages: TimedMessage[],
    currentTurn: number
  ): Record<string, { count: number; totalTokens: number }> {
    const stats: Record<string, { count: number; totalTokens: number }> = {};

    for (const zone of this.zones) {
      stats[zone.name] = { count: 0, totalTokens: 0 };
    }

    for (const msg of messages) {
      const age = currentTurn - msg.turn;
      const zone = this.findZone(age);
      stats[zone.name].count++;
      stats[zone.name].totalTokens += estimateTokens(msg.content);
    }

    return stats;
  }
}

/**
 * Singleton instance
 */
let progressiveInstance: ProgressiveCompactor | null = null;

/**
 * Get progressive compactor instance
 */
export function getProgressiveCompactor(): ProgressiveCompactor {
  if (!progressiveInstance) {
    progressiveInstance = new ProgressiveCompactor();
  }
  return progressiveInstance;
}

/**
 * Reset progressive compactor (for testing)
 */
export function resetProgressiveCompactor(): void {
  progressiveInstance = null;
}
