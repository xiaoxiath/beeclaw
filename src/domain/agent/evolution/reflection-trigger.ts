/**
 * Skill Failure Statistics System
 *
 * Records skill usage statistics for maturity tracking.
 * Provides data for LLM-driven reflection decisions.
 *
 * @module evolution/reflection-trigger
 */

// Track recent skill failures for statistics
const recentFailures: Array<{ skillName: string; timestamp: number; context: string }> = [];

// Configuration
const REFLECTION_CONFIG = {
  /** Time window for failure tracking (10 minutes) */
  failureTimeWindowMs: 10 * 60 * 1000,
};

/**
 * Record a skill failure for statistics.
 * Called by skill_record tool when success=false.
 *
 * @param skillName - Name of the failed skill
 * @param context - Failure context/description
 */
export function recordSkillFailure(skillName: string, context: string): void {
  recentFailures.push({
    skillName,
    timestamp: Date.now(),
    context,
  });

  // Clean up old entries
  const cutoff = Date.now() - REFLECTION_CONFIG.failureTimeWindowMs;
  while (recentFailures.length > 0 && recentFailures[0].timestamp < cutoff) {
    recentFailures.shift();
  }
}

/**
 * Check consecutive skill failures (for maturity assessment).
 * Used by skill_maturity tool to assess skill quality.
 *
 * @param skillName - Name of the skill to check
 * @returns Number of recent failures for this skill
 */
export function checkConsecutiveFailures(skillName: string): number {
  const recentSkillFailures = recentFailures.filter(
    f => f.skillName === skillName &&
         f.timestamp > Date.now() - REFLECTION_CONFIG.failureTimeWindowMs
  );
  return recentSkillFailures.length;
}

/**
 * Clear tracking data (useful for testing or reset).
 */
export function clearReflectionTracking(): void {
  recentFailures.length = 0;
}

/**
 * Get current tracking stats (for debugging and maturity assessment).
 * Provides data for skill_maturity tool and LLM decision making.
 *
 * @returns Statistics about recent failures
 */
export function getReflectionStats(): {
  recentFailures: number;
  failureDetails: Array<{ skillName: string; count: number }>;
} {
  const failureCounts = new Map<string, number>();
  for (const f of recentFailures) {
    failureCounts.set(f.skillName, (failureCounts.get(f.skillName) || 0) + 1);
  }

  const failureDetails = Array.from(failureCounts.entries()).map(([skillName, count]) => ({
    skillName,
    count,
  }));

  return {
    recentFailures: recentFailures.length,
    failureDetails,
  };
}
