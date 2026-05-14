import { Hono } from 'hono';
import { listSessions } from '@/app';
import { getSkillStore } from '@/domain/skills/store';
import { getTokenUsageTracker } from '@/infra/observability/token-usage';
import { getCircuitBreakerRegistry } from '@/infra/resilience/circuit-breaker';
import { getTieredCompressor } from '@/domain/agent/compression/tiered-compressor';

// Track app start time
const appStartTime = Date.now();

export default new Hono()
  .get('/', (c) => {
    try {
      const sessions = listSessions();
      const skillStore = getSkillStore();
      const skills = skillStore.list();
      const uptime = Math.floor((Date.now() - appStartTime) / 1000); // seconds
      const usage = getTokenUsageTracker().snapshot();

      // Circuit breaker observability — best-effort. The registry singleton
      // is lazy-init, so reading it is always safe; if no breakers have been
      // instantiated, we report an empty health summary.
      let circuitHealth: {
        total: number; closed: number; open: number; halfOpen: number;
        healthy: boolean; openCircuits: string[];
      };
      let circuitDetails: Record<string, unknown> = {};
      try {
        const registry = getCircuitBreakerRegistry();
        const summary = registry.getHealthSummary();
        circuitHealth = {
          ...summary,
          openCircuits: registry.getOpenCircuits(),
        };
        circuitDetails = registry.getAllStats();
      } catch {
        circuitHealth = { total: 0, closed: 0, open: 0, halfOpen: 0, healthy: true, openCircuits: [] };
      }

      // Skill dependency-graph health — surfaces missing-dep / cycle issues
      // that would otherwise only show up when the LLM tries to use a skill.
      // Best-effort: if the validator throws (e.g., file-system race during
      // skill reload), we report unknown rather than 500ing the route.
      let skillDeps: {
        healthy: boolean;
        totalSkills: number;
        missing: Array<{ source: string; missing: string }>;
        cycles: Array<{ path: string[] }>;
      };
      try {
        const dep = skillStore.validateAllDependencies();
        skillDeps = {
          healthy: dep.healthy,
          totalSkills: dep.totalSkills,
          missing: dep.missing,
          cycles: dep.cycles,
        };
      } catch {
        skillDeps = { healthy: true, totalSkills: 0, missing: [], cycles: [] };
      }

      // Compression aggregate — bee's TieredCompressor tracks per-level
      // counts, ratios, and latencies. Best-effort: if the compressor
      // hasn't been used yet (cold start), getStats() returns the zero
      // baseline which is a perfectly valid "no compressions yet" state.
      let compressionStats: unknown;
      try {
        compressionStats = getTieredCompressor().getStats();
      } catch {
        compressionStats = { totalCompressions: 0 };
      }

      return c.json({
        sessions: sessions.length,
        skills: skills.length,
        uptime,
        // Back-compat: scalar total for existing UI consumers.
        tokenUsage: usage.totalTokens,
        // Detailed breakdown for dashboards.
        tokens: {
          prompt: usage.promptTokens,
          completion: usage.completionTokens,
          total: usage.totalTokens,
          callCount: usage.callCount,
          lastRecordedAt: usage.lastRecordedAt,
          byModel: usage.byModel,
        },
        circuits: {
          ...circuitHealth,
          // Detailed per-breaker stats — useful for triage when openCircuits != [].
          breakers: circuitDetails,
        },
        skillDeps,
        compression: compressionStats,
        status: 'ok',
      });
    } catch (error) {
      return c.json({
        error: 'Failed to get stats',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  });
