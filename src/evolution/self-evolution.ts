/**
 * Self-Evolution Scheduler
 *
 * Initializes and manages the periodic self-reflection task
 * that updates SOUL.md based on lessons learned.
 */

import { getScheduler } from '../proactive';
import { join } from 'path';

/**
 * Initialize self-evolution schedule
 * Called during bot startup with --daemon flag
 */
export function initSelfEvolution(basePath: string): void {
  const scheduler = getScheduler(join(basePath, 'proactive'));
  scheduler.init();

  // Check if self-evolution schedule already exists
  const existingSchedules = scheduler.listSchedules({ enabled: true });
  const hasSelfEvolution = existingSchedules.some(
    s => s.task?.type === 'self_evolution'
  );

  if (!hasSelfEvolution) {
    console.log('   Creating daily self-evolution schedule...');
    scheduler.createSchedule({
      name: 'Daily Self-Evolution',
      description: 'Review lessons and update SOUL.md principles',
      cron: '0 4 * * *', // 4:00 AM daily (after memory compression at 3 AM)
      taskType: 'self_evolution',
      taskParams: {
        skill: 'beeclaw-self-evolution',
        action: 'Review facts/lessons.md and update SOUL.md if new principles emerge',
      },
      enabled: true,
    });
    console.log('   ✓ Self-evolution scheduled at 4:00 AM daily');
  } else {
    console.log('   ✓ Self-evolution schedule already exists');
  }
}

/**
 * Get self-evolution status
 */
export function getSelfEvolutionStatus(basePath: string): {
  enabled: boolean;
  nextRun?: string;
  lastRun?: string;
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
  };
}

/**
 * Trigger immediate self-evolution (manual execution)
 */
export async function triggerSelfEvolution(): Promise<{
  success: boolean;
  message: string;
}> {
  // This will be handled by the daemon's job handler
  // For now, return instructions for manual execution
  return {
    success: true,
    message: 'Use the beeclaw-self-evolution skill to review and update SOUL.md',
  };
}
