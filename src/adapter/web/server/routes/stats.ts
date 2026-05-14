import { Hono } from 'hono';
import { listSessions } from '@/app';
import { getSkillStore } from '@/domain/skills/store';
import { getTokenUsageTracker } from '@/infra/observability/token-usage';

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
        status: 'ok',
      });
    } catch (error) {
      return c.json({
        error: 'Failed to get stats',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  });
