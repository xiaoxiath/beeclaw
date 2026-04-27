import { Hono } from 'hono';
import { listSessions, getAgent } from '@/app';
import { getSkillStore } from '@/domain/skills/store';

// Track app start time
const appStartTime = Date.now();

export default new Hono()
  .get('/', (c) => {
    try {
      // Get session count
      const sessions = listSessions();
      const sessionCount = sessions.length;

      // Get skill count
      const skillStore = getSkillStore();
      const skills = skillStore.list();
      const skillCount = skills.length;

      // Calculate uptime
      const uptime = Math.floor((Date.now() - appStartTime) / 1000); // in seconds

      // Get agent stats if available
      const tokenUsage: number | null = null; // TODO: Wire to actual token tracking
      try {
        getAgent();
        // Agent might have token stats in the future
        // For now, we'll return 0
        // TODO: Wire to actual token tracking
      } catch {
        // Agent not initialized yet
      }

      return c.json({
        sessions: sessionCount,
        skills: skillCount,
        uptime,
        tokenUsage,
        status: 'ok',
      });
    } catch (error) {
      return c.json({
        error: 'Failed to get stats',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  });
