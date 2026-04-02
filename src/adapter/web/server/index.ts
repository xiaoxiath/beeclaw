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
  // Note: config.host is a bind address (e.g., '0.0.0.0'), NOT a valid browser origin.
  // Use explicit origin allowlist derived from port, or allow all in dev mode.
  const port = config?.port || 3000;
  const corsOrigins = [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ];
  app.use('*', cors({
    origin: (origin) => {
      // Allow requests with no origin (e.g., curl, server-to-server)
      if (!origin) return corsOrigins[0];
      // Allow listed origins
      if (corsOrigins.includes(origin)) return origin;
      // In development, allow all localhost variants
      if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) return origin;
      // Reject unknown origins
      return corsOrigins[0];
    },
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
  app.use('/*', serveStatic({ root: './dist/web' }));

  // SPA fallback - serve index.html for all unmatched routes
  app.get('*', serveStatic({ path: './dist/web/index.html' }));

  return { app, api };
}

// Export API type for client
export type ApiType = ReturnType<typeof createWebApp> extends { api: infer T } ? T : never;
