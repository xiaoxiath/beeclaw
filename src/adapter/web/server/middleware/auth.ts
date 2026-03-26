import { Context, Next } from 'hono';
import { createHash } from 'crypto';
import { posix } from 'path';
import type { WebConfig } from '@/infra/config/schema';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createAuthMiddleware(config: WebConfig) {
  return async (c: Context, next: Next) => {
    const authLevel = config.auth?.level || 'none';

    // No auth required
    if (authLevel === 'none') {
      return next();
    }

    // Normalize path to prevent traversal bypass (e.g., /api/../admin)
    const rawPath = new URL(c.req.url, 'http://localhost').pathname;
    const normalizedPath = posix.normalize(decodeURIComponent(rawPath)).replace(/\/+/g, '/');

    // Token auth
    if (authLevel === 'token') {
      const authHeader = c.req.header('Authorization');
      const token = authHeader?.replace('Bearer ', '') || c.req.query('token');

      // Also check cookie for token
      const cookieHash = c.req.header('Cookie')
        ?.split(';')
        .find(c => c.trim().startsWith('auth_token='))
        ?.split('=')[1];

      const validToken = config.auth?.token || process.env.WEB_AUTH_TOKEN;

      // If no valid token is configured, skip auth (dev mode)
      if (!validToken || validToken.trim() === '') {
        console.warn('[Auth] No WEB_AUTH_TOKEN configured, skipping authentication');
        return next();
      }

      const expectedHash = hashToken(validToken);

      if (!token && !cookieHash) {
        // Check if this is an API request
        if (normalizedPath.startsWith('/api/')) {
          return c.json({ error: 'Unauthorized', message: 'Token required' }, 401);
        }
        // Redirect to login page for HTML requests
        return c.redirect('/login');
      }

      if (token && token !== validToken) {
        if (normalizedPath.startsWith('/api/')) {
          return c.json({ error: 'Unauthorized', message: 'Invalid token' }, 401);
        }
        return c.redirect('/login');
      }

      if (cookieHash && cookieHash !== expectedHash) {
        if (normalizedPath.startsWith('/api/')) {
          return c.json({ error: 'Unauthorized', message: 'Invalid token' }, 401);
        }
        return c.redirect('/login');
      }

      return next();
    }

    // Basic auth
    if (authLevel === 'basic') {
      const authHeader = c.req.header('Authorization');

      if (!authHeader || !authHeader.startsWith('Basic ')) {
        if (normalizedPath.startsWith('/api/')) {
          return c.json({ error: 'Unauthorized', message: 'Basic auth required' }, 401);
        }
        return c.redirect('/login');
      }

      const credentials = Buffer.from(authHeader.replace('Basic ', ''), 'base64').toString();
      const [username, password] = credentials.split(':');

      const validUsers = config.auth?.basicUsers || [];
      const validUser = validUsers.find(u => u.username === username && u.password === password);

      if (!validUser) {
        if (normalizedPath.startsWith('/api/')) {
          return c.json({ error: 'Unauthorized', message: 'Invalid credentials' }, 401);
        }
        return c.redirect('/login');
      }

      return next();
    }

    return next();
  };
}
