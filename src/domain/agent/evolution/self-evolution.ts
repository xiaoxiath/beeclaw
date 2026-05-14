/**
 * Self-Evolution Scheduler (Simplified)
 *
 * REFACTORED: Removed automatic SOUL.md modification. Self-evolution now
 * generates recommendations only — human approval is always required.
 *
 * Rationale:
 * - Unsupervised SOUL.md modification risks agent behavior drift
 * - The minConfidence=0.8 threshold was difficult to calibrate in practice
 * - maxNewPrinciples=3/day was an ad-hoc safety valve, indicating the
 *   designers themselves were cautious about auto-modification
 *
 * What remains:
 * - initSelfEvolution() — registers the daily cron that runs the
 *   external `beeclaw-self-evolution` skill (never modifies SOUL.md)
 * - getSelfEvolutionStatus() — status query for the schedule
 *
 * What was removed:
 * - autoApprove config (always false now)
 * - minConfidence / maxNewPrinciples (not needed without auto-apply)
 * - The daily cron that automatically mutated SOUL.md
 */

import { logger } from '../../../infra/observability/logger';
import { getScheduler } from '../../proactive';
import { join } from 'path';

/** Self-evolution configuration (simplified — no auto-approve options) */
export interface SelfEvolutionConfig {
  /** Cron expression for evolution report generation (default: 4 AM daily) */
  cron: string;
  /** Whether evolution is enabled at all */
  enabled: boolean;
}

const DEFAULT_EVOLUTION_CONFIG: SelfEvolutionConfig = {
  cron: '0 4 * * *',
  enabled: true,
};

/**
 * Initialize self-evolution schedule.
 *
 * The schedule now only generates a recommendation report (stored in
 * facts/evolution-suggestions.md). It never modifies SOUL.md directly.
 */
export function initSelfEvolution(
  basePath: string,
  config: Partial<SelfEvolutionConfig> = {},
): void {
  const mergedConfig = { ...DEFAULT_EVOLUTION_CONFIG, ...config };

  if (!mergedConfig.enabled) {
    logger.debug('[SelfEvolution] Disabled by config');
    return;
  }

  const scheduler = getScheduler(join(basePath, 'proactive'));
  scheduler.init();

  const existingSchedules = scheduler.listSchedules({ enabled: true });
  const hasSelfEvolution = existingSchedules.some(
    s => s.name === 'Daily Self-Evolution' || s.task?.type === 'self_evolution',
  );

  if (!hasSelfEvolution) {
    logger.debug('   Creating daily self-evolution report schedule...');
    scheduler.createSchedule({
      name: 'Daily Self-Evolution',
      description: 'Generate evolution suggestions (human approval required)',
      cron: mergedConfig.cron,
      taskType: 'self_evolution',
      taskParams: {
        skill: 'beeclaw-self-evolution',
        action: 'Review facts/lessons.md and generate suggestions in facts/evolution-suggestions.md',
        // autoApprove is always false — human must review and apply
        autoApprove: false,
      },
      enabled: true,
    });
    logger.debug(`   ✓ Self-evolution report scheduled at cron: ${mergedConfig.cron}`);
  } else {
    logger.debug('   ✓ Self-evolution schedule already exists');
  }
}

/**
 * Get self-evolution status.
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

// triggerSelfEvolution() removed — was a stub that returned a hardcoded
// "use the beeclaw-self-evolution skill" message and had no callers in
// production code. The actual evolution logic lives in the external
// `beeclaw-self-evolution` skill that the cron schedule above already
// points to (via taskParams.skill). If callers need to kick off an
// out-of-band evolution run, they should invoke that skill directly.
