import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createHash } from 'crypto';
import { createAuthMiddleware } from '../../middleware/auth';
import type { WebConfig } from '@/infra/config/schema';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function createTestApp(config: Partial<WebConfig>) {
  const app = new Hono();
  const fullConfig: WebConfig = {
    enabled: true,
    port: 3000,
    host: '0.0.0.0',
    auth: { level: 'none' },
    ...config,
  };
  app.use('*', createAuthMiddleware(fullConfig));
  app.get('/api/test', (c) => c.json({ ok: true }));
  app.get('/page', (c) => c.html('<h1>Page</h1>'));
  app.get('/login', (c) => c.html('<h1>Login</h1>'));
  return app;
}

describe('Auth Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env
    delete process.env.WEB_AUTH_TOKEN;
  });

  // ─── No auth ───
  describe('level=none', () => {
    it('passes through when auth level is none', async () => {
      const app = createTestApp({ auth: { level: 'none' } });

      const res = await app.request('/api/test');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
    });

    it('passes through when auth config is missing', async () => {
      const app = createTestApp({});

      const res = await app.request('/api/test');

      expect(res.status).toBe(200);
    });
  });

  // ─── Token auth ───
  describe('level=token', () => {
    const config = {
      auth: { level: 'token' as const, token: 'my-secret-token-123' },
    };

    it('allows request with valid bearer token', async () => {
      const app = createTestApp(config);

      const res = await app.request('/api/test', {
        headers: { Authorization: 'Bearer my-secret-token-123' },
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
    });

    it('allows request with valid query token', async () => {
      const app = createTestApp(config);

      const res = await app.request('/api/test?token=my-secret-token-123');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
    });

    it('allows request with valid cookie hash', async () => {
      const app = createTestApp(config);
      const hash = hashToken('my-secret-token-123');

      const res = await app.request('/api/test', {
        headers: { Cookie: `auth_token=${hash}` },
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
    });

    it('returns 401 for API requests with no token', async () => {
      const app = createTestApp(config);

      const res = await app.request('/api/test');
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.error).toBe('Unauthorized');
      expect(json.message).toBe('Token required');
    });

    it('redirects to login for non-API requests with no token', async () => {
      const app = createTestApp(config);

      const res = await app.request('/page', { redirect: 'manual' });

      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe('/login');
    });

    it('returns 401 for invalid bearer token on API', async () => {
      const app = createTestApp(config);

      const res = await app.request('/api/test', {
        headers: { Authorization: 'Bearer wrong-token' },
      });
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.message).toBe('Invalid token');
    });

    it('redirects for invalid bearer token on non-API', async () => {
      const app = createTestApp(config);

      const res = await app.request('/page', {
        headers: { Authorization: 'Bearer wrong-token' },
        redirect: 'manual',
      });

      expect(res.status).toBe(302);
    });

    it('returns 401 for invalid cookie hash on API', async () => {
      const app = createTestApp(config);

      const res = await app.request('/api/test', {
        headers: { Cookie: 'auth_token=invalidhash' },
      });
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.message).toBe('Invalid token');
    });

    it('redirects for invalid cookie hash on non-API', async () => {
      const app = createTestApp(config);

      const res = await app.request('/page', {
        headers: { Cookie: 'auth_token=invalidhash' },
        redirect: 'manual',
      });

      expect(res.status).toBe(302);
    });

    it('skips auth when no valid token is configured (dev mode)', async () => {
      const app = createTestApp({ auth: { level: 'token', token: '' } });

      const res = await app.request('/api/test');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
    });

    it('uses WEB_AUTH_TOKEN env var when config token is not set', async () => {
      process.env.WEB_AUTH_TOKEN = 'env-token-456';
      const app = createTestApp({ auth: { level: 'token' } });

      const res = await app.request('/api/test', {
        headers: { Authorization: 'Bearer env-token-456' },
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
    });

    it('handles path traversal normalization', async () => {
      const app = createTestApp(config);

      // Attempt path traversal - should still require auth
      const res = await app.request('/api/../api/test');

      expect(res.status).toBe(401);
    });
  });

  // ─── Basic auth ───
  describe('level=basic', () => {
    const config = {
      auth: {
        level: 'basic' as const,
        basicUsers: [
          { username: 'admin', password: 'pass123' },
          { username: 'user', password: 'user456' },
        ],
      },
    };

    it('allows request with valid basic credentials', async () => {
      const app = createTestApp(config);
      const encoded = Buffer.from('admin:pass123').toString('base64');

      const res = await app.request('/api/test', {
        headers: { Authorization: `Basic ${encoded}` },
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
    });

    it('allows request for second user', async () => {
      const app = createTestApp(config);
      const encoded = Buffer.from('user:user456').toString('base64');

      const res = await app.request('/api/test', {
        headers: { Authorization: `Basic ${encoded}` },
      });

      expect(res.status).toBe(200);
    });

    it('returns 401 for missing auth header on API', async () => {
      const app = createTestApp(config);

      const res = await app.request('/api/test');
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.message).toBe('Basic auth required');
    });

    it('redirects for missing auth on non-API', async () => {
      const app = createTestApp(config);

      const res = await app.request('/page', { redirect: 'manual' });

      expect(res.status).toBe(302);
    });

    it('returns 401 for invalid credentials on API', async () => {
      const app = createTestApp(config);
      const encoded = Buffer.from('admin:wrongpass').toString('base64');

      const res = await app.request('/api/test', {
        headers: { Authorization: `Basic ${encoded}` },
      });
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.message).toBe('Invalid credentials');
    });

    it('redirects for invalid credentials on non-API', async () => {
      const app = createTestApp(config);
      const encoded = Buffer.from('admin:wrongpass').toString('base64');

      const res = await app.request('/page', {
        headers: { Authorization: `Basic ${encoded}` },
        redirect: 'manual',
      });

      expect(res.status).toBe(302);
    });

    it('returns 401 for non-Basic auth header', async () => {
      const app = createTestApp(config);

      const res = await app.request('/api/test', {
        headers: { Authorization: 'Bearer some-token' },
      });

      expect(res.status).toBe(401);
    });

    it('handles missing basicUsers config', async () => {
      const app = createTestApp({ auth: { level: 'basic' } });
      const encoded = Buffer.from('admin:pass123').toString('base64');

      const res = await app.request('/api/test', {
        headers: { Authorization: `Basic ${encoded}` },
      });
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.message).toBe('Invalid credentials');
    });
  });

  // ─── Unknown auth level ───
  describe('unknown auth level', () => {
    it('passes through for unknown auth level', async () => {
      const app = createTestApp({ auth: { level: 'unknown' as any } });

      const res = await app.request('/api/test');

      expect(res.status).toBe(200);
    });
  });
});
