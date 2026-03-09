/**
 * Evolution Statistics System
 *
 * [P2 FIX 4.6] Cleaned up deprecated dead code.
 *
 * Records skill usage statistics for maturity tracking.
 * Trigger detection is handled by LLM through System Prompt.
 *
 * @experimental
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

/**
 * @deprecated Kept for backward compatibility only.
 * LLM now handles trigger detection through System Prompt.
 * Will be removed in a future major version.
 */
export interface ReflectionTrigger {
  type: 'skill_failure' | 'user_correction' | 'repetitive_pattern' | 'workaround_detected';
  severity: 'low' | 'medium' | 'high';
  context: string;
  suggestedAction: string;
  skillName?: string;
}

/**
 * @deprecated No-op stub. LLM handles detection now.
 */
export function checkReflectionTriggers(
  _userMessage: string,
  _context: {
    skillJustFailed?: string;
    recentSkillUsage?: Array<{ name: string; success: boolean }>;
  }
): { shouldReflect: boolean; trigger: ReflectionTrigger | null; context: string } {
  return { shouldReflect: false, trigger: null, context: '' };
}
