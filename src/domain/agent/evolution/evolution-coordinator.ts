/**
 * Evolution Coordinator — thin wrapper extracted from Agent orchestrator.
 *
 * Encapsulates the evolution-related state and logic that was previously
 * inline in the Agent class (turnsSinceLastReflection, REFLECTION_TURN_INTERVAL,
 * checkEvolutionTriggers, collectPreferenceSignals).
 *
 * This is a Method Object refactoring — the Agent delegates evolution
 * concerns to this coordinator instead of implementing them inline.
 */

import { getReflectionStats } from './reflection-trigger';
import { logger } from '../../../infra/observability/logger';

export class EvolutionCoordinator {
  private enabled: boolean = true;
  private turnsSinceLastReflection: number = 0;
  private readonly REFLECTION_TURN_INTERVAL = 5;

  /** Disable evolution tracking (e.g., for subagents) */
  disable(): void {
    this.enabled = false;
  }

  /**
   * Post-turn evolution check.
   *
   * Only tracks skill failures for observability. Self-evolution
   * no longer auto-modifies SOUL.md — it only generates suggestions.
   *
   * Call after each successful chat() completion. Fire-and-forget.
   */
  async checkTriggers(): Promise<void> {
    if (!this.enabled) return;

    this.turnsSinceLastReflection++;

    try {
      const reflectionStats = getReflectionStats();
      const hasRecentFailures = reflectionStats.recentFailures >= 3;

      if (!hasRecentFailures && this.turnsSinceLastReflection < this.REFLECTION_TURN_INTERVAL) return;

      logger.info('[Evolution] Reflection stats logged (no auto-apply)', {
        recentFailures: reflectionStats.recentFailures,
        turnsSinceLastReflection: this.turnsSinceLastReflection,
      });

      this.turnsSinceLastReflection = 0;
    } catch (error) {
      logger.warn('[Evolution] checkTriggers failed (non-fatal):', error);
    }
  }
}
