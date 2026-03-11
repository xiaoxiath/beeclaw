import { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppConfig } from '../infra/config/schema';

// Auth middleware
export async function authMiddleware(c: Context, next: Next): Promise<void> {
  const config = c.get('config') as AppConfig;

  if (!config.auth.enabled) {
    await next();
    return;
  }

  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    throw new HTTPException(401, { message: 'Missing Authorization header' });
  }

  // Bearer token authentication
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);

    if (config.auth.tokens.includes(token)) {
      await next();
      return;
    }
  }

  // Basic authentication (password only)
  if (authHeader.startsWith('Basic ')) {
    const encoded = authHeader.slice(6);
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const [_username, password] = decoded.split(':');

    if (config.auth.password && password === config.auth.password) {
      await next();
      return;
    }
  }

  throw new HTTPException(401, { message: 'Invalid credentials' });
}

// Rate limiting middleware (simple in-memory)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export function rateLimitMiddleware(windowMs: number = 60000, maxRequests: number = 100) {
  return async (c: Context, next: Next): Promise<void> => {
    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
    const key = `rate:${ip}`;
    const now = Date.now();

    const record = rateLimitStore.get(key);

    if (record && record.resetAt > now) {
      if (record.count >= maxRequests) {
        throw new HTTPException(429, { message: 'Too many requests' });
      }
      record.count++;
    } else {
      rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    }

    await next();
  };
}

// Request logging middleware
export function requestLoggerMiddleware(c: Context, next: Next): Promise<void> {
  const start = Date.now();

  c.res = new Response();

  return next().then(() => {
    const duration = Date.now() - start;
    console.log(`${c.req.method} ${c.req.path} - ${c.res.status} (${duration}ms)`);
  });
}
