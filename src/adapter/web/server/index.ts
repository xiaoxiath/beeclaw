import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { serveStatic } from 'hono/bun';
import type { WebConfig } from '../../../infra/config/schema';
import { createAuthMiddleware } from './middleware/auth';
import { createAuthRoutes } from './routes/auth';
import healthRoutes from './routes/health';
import statsRoutes from './routes/stats';
import skillsRoutes from './routes/skills';
import chatRoutes from './routes/chat';
import memoryRoutes from './routes/memory';
import sessionsRoutes from './routes/sessions';
import configRoutes from './routes/config';

export function createWebApp(config?: WebConfig) {
  const app = new Hono();
  const api = new Hono();

  // Middleware
  app.use('*', logger());
  app.use('*', secureHeaders());

  // CORS configuration
  app.use('*', cors({
    origin: config?.host === 'localhost' ? '*' : config?.host || '*',
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }));

  // Auth routes (always accessible)
  const authRoutes = createAuthRoutes(config || { enabled: false, port: 3000, host: '0.0.0.0', auth: { level: 'none' } });
  api.route('/auth', authRoutes);

  // Health check (always accessible)
  api.route('/health', healthRoutes);

  // Protected API routes (require auth)
  api.use('/*', createAuthMiddleware(config || { enabled: false, port: 3000, host: '0.0.0.0', auth: { level: 'none' } }));
  api.route('/stats', statsRoutes);
  api.route('/skills', skillsRoutes);
  api.route('/chat', chatRoutes);
  api.route('/memory', memoryRoutes);
  api.route('/sessions', sessionsRoutes);
  api.route('/config', configRoutes);

  // Mount API
  app.route('/api', api);

  // Serve React SPA static files
  app.use('/*', serveStatic({ root: './src/web/client/dist' }));

  // SPA fallback - serve index.html for all unmatched routes
  app.get('*', serveStatic({ path: './src/web/client/dist/index.html' }));

  return { app, api };
}

// Export API type for client
export type ApiType = ReturnType<typeof createWebApp> extends { api: infer T } ? T : never;
