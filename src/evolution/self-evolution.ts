/**
 * Self-Evolution Scheduler
 *
 * [P2 FIX 4.6] Cleaned up and properly marked as experimental.
 *
 * Initializes and manages the periodic self-reflection task
 * that updates SOUL.md based on lessons learned.
 *
 * @experimental This module is actively under development.
 * Current implementation uses a cron-scheduled task that delegates
 * to the beeclaw-self-evolution skill. Future versions will add:
 * - Automated principle extraction from conversation patterns
 * - Weighted confidence scoring for proposed SOUL.md updates
 * - Rollback mechanism for SOUL.md changes that degrade performance
 */

import { getScheduler } from '../proactive';
import { join } from 'path';

/** @experimental */
export interface SelfEvolutionConfig {
  /** Cron expression for evolution schedule (default: 4 AM daily) */
  cron: string;
  /** Whether to auto-approve SOUL.md changes or require confirmation */
  autoApprove: boolean;
  /** Minimum confidence score (0-1) to apply a change automatically */
  minConfidence: number;
  /** Maximum number of principles to add per evolution cycle */
  maxNewPrinciples: number;
}

const DEFAULT_EVOLUTION_CONFIG: SelfEvolutionConfig = {
  cron: '0 4 * * *',
  autoApprove: false,
  minConfidence: 0.8,
  maxNewPrinciples: 3,
};

/**
 * Initialize self-evolution schedule.
 * Called during bot startup with --daemon flag.
 *
 * @experimental
 */
export function initSelfEvolution(
  basePath: string,
  config: Partial<SelfEvolutionConfig> = {},
): void {
  const mergedConfig = { ...DEFAULT_EVOLUTION_CONFIG, ...config };
  const scheduler = getScheduler(join(basePath, 'proactive'));
  scheduler.init();

  // Check if self-evolution schedule already exists
  const existingSchedules = scheduler.listSchedules({ enabled: true });
  const hasSelfEvolution = existingSchedules.some(
    s => s.name === 'Daily Self-Evolution' || s.task?.type === 'self_evolution'
  );

  if (!hasSelfEvolution) {
    console.log('   Creating daily self-evolution schedule...');
    scheduler.createSchedule({
      name: 'Daily Self-Evolution',
      description: 'Review lessons and update SOUL.md principles',
      cron: mergedConfig.cron,
      taskType: 'self_evolution',
      taskParams: {
        skill: 'beeclaw-self-evolution',
        action: 'Review facts/lessons.md and update SOUL.md if new principles emerge',
        autoApprove: mergedConfig.autoApprove,
        minConfidence: mergedConfig.minConfidence,
        maxNewPrinciples: mergedConfig.maxNewPrinciples,
      },
      enabled: true,
    });
    console.log(`   ✓ Self-evolution scheduled at cron: ${mergedConfig.cron}`);
  } else {
    console.log('   ✓ Self-evolution schedule already exists');
  }
}

/**
 * Get self-evolution status.
 *
 * @experimental
 */
export function getSelfEvolutionStatus(basePath: string): {
  enabled: boolean;
  nextRun?: string;
  lastRun?: string;
  runCount?: number;
} {
  const scheduler = getScheduler(join(basePath, 'proactive'));
  const schedules = scheduler.listSchedules({ enabled: true });
  const selfEvolution = schedules.find(s => s.task?.type === 'self_evolution');

  if (!selfEvolution) {
    return { enabled: false };
  }

  return {
    enabled: selfEvolution.enabled,
    nextRun: selfEvolution.nextRun,
    lastRun: selfEvolution.lastRun,
    runCount: selfEvolution.runCount,
  };
}

/**
 * Trigger immediate self-evolution (manual execution).
 *
 * @experimental
 * TODO: Implement direct execution instead of just returning instructions.
 */
export async function triggerSelfEvolution(): Promise<{
  success: boolean;
  message: string;
}> {
  return {
    success: true,
    message: 'Use the beeclaw-self-evolution skill to review and update SOUL.md',
  };
}

// Re-export config type for external usage
export type { SelfEvolutionConfig };
