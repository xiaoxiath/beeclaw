import { Hono } from 'hono';
import { listSessions } from '@/app';
import { getSkillStore } from '@/domain/skills/store';
import { getTokenUsageTracker } from '@/infra/observability/token-usage';
import { getCircuitBreakerRegistry } from '@/infra/resilience/circuit-breaker';

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
        status: 'ok',
      });
    } catch (error) {
      return c.json({
        error: 'Failed to get stats',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  });
