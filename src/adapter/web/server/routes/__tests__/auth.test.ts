import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { createAuthRoutes } from '../auth';
import type { WebConfig } from '@/infra/config/schema';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function createApp(config: Partial<WebConfig>) {
  const fullConfig: WebConfig = {
    enabled: true,
    port: 3000,
    host: '0.0.0.0',
    auth: { level: 'none' },
    ...config,
  };
  return createAuthRoutes(fullConfig);
}

describe('Auth Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.WEB_AUTH_TOKEN;
    delete process.env.NODE_ENV;
  });

  // ─── GET /login ───
  describe('GET /login', () => {
    it('redirects to / when auth level is none', async () => {
      const app = createApp({ auth: { level: 'none' } });

      const res = await app.request('/login', { redirect: 'manual' });

      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe('/');
    });

    it('returns login HTML for token auth', async () => {
      const app = createApp({ auth: { level: 'token', token: 'secret' } });

      const res = await app.request('/login');
      const html = await res.text();

      expect(res.status).toBe(200);
      expect(html).toContain('Access Token');
      expect(html).toContain('Beeclaw');
    });

    it('returns login HTML for basic auth', async () => {
      const app = createApp({
        auth: {
          level: 'basic',
          basicUsers: [{ username: 'admin', password: 'pass' }],
        },
      });

      const res = await app.request('/login');
      const html = await res.text();

      expect(res.status).toBe(200);
      expect(html).toContain('Username');
      expect(html).toContain('Password');
    });
  });

  // ─── POST /login (token auth) ───
  describe('POST /login (token)', () => {
    const config = {
      auth: { level: 'token' as const, token: 'my-secret-token' },
    };

    it('returns success with valid token', async () => {
      const app = createApp(config);

      const res = await app.request('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'my-secret-token' }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.message).toBe('Login successful');
      // Should set cookie
      const setCookie = res.headers.get('Set-Cookie');
      expect(setCookie).toContain('auth_token=');
    });

    it('returns 401 with invalid token', async () => {
      const app = createApp(config);

      const res = await app.request('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'wrong-token' }),
      });
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.error).toBe('Unauthorized');
    });

    it('returns 401 when no token provided', async () => {
      const app = createApp(config);

      const res = await app.request('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();

      expect(res.status).toBe(401);
    });

    it('uses WEB_AUTH_TOKEN env var when config token is absent', async () => {
      process.env.WEB_AUTH_TOKEN = 'env-token';
      const app = createApp({ auth: { level: 'token' } });

      const res = await app.request('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'env-token' }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
    });

    it('sets secure cookie in production', async () => {
      process.env.NODE_ENV = 'production';
      const app = createApp(config);

      const res = await app.request('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'my-secret-token' }),
      });

      const setCookie = res.headers.get('Set-Cookie');
      expect(setCookie).toContain('Secure');
    });
  });

  // ─── POST /login (basic auth) ───
  describe('POST /login (basic)', () => {
    const config = {
      auth: {
        level: 'basic' as const,
        basicUsers: [
          { username: 'admin', password: 'pass123' },
        ],
      },
    };

    it('returns success with valid credentials', async () => {
      const app = createApp(config);

      const res = await app.request('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'pass123' }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(res.headers.get('Set-Cookie')).toContain('auth_token=');
    });

    it('returns 401 with invalid credentials', async () => {
      const app = createApp(config);

      const res = await app.request('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'wrong' }),
      });
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.error).toBe('Unauthorized');
    });

    it('handles missing basicUsers config', async () => {
      const app = createApp({ auth: { level: 'basic' } });

      const res = await app.request('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'pass' }),
      });
      const json = await res.json();

      expect(res.status).toBe(401);
    });
  });

  // ─── POST /login (none / invalid level) ───
  describe('POST /login (none)', () => {
    it('returns 400 for "none" auth level', async () => {
      const app = createApp({ auth: { level: 'none' } });

      const res = await app.request('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe('Bad Request');
    });
  });

  // ─── POST /logout ───
  describe('POST /logout', () => {
    it('clears auth cookie and returns success', async () => {
      const app = createApp({ auth: { level: 'token', token: 'secret' } });

      const res = await app.request('/logout', { method: 'POST' });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.message).toBe('Logged out');
      const setCookie = res.headers.get('Set-Cookie');
      expect(setCookie).toContain('auth_token=');
      expect(setCookie).toContain('Max-Age=0');
    });
  });

  // ─── GET /me ───
  describe('GET /me', () => {
    it('returns authenticated=true when auth is none', async () => {
      const app = createApp({ auth: { level: 'none' } });

      const res = await app.request('/me');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.authenticated).toBe(true);
      expect(json.level).toBe('none');
    });

    it('returns 401 when no cookie present (token)', async () => {
      const app = createApp({ auth: { level: 'token', token: 'secret' } });

      const res = await app.request('/me');
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.authenticated).toBe(false);
    });

    it('returns authenticated=true with valid token cookie', async () => {
      const app = createApp({ auth: { level: 'token', token: 'my-secret' } });
      const hash = hashToken('my-secret');

      const res = await app.request('/me', {
        headers: { Cookie: `auth_token=${hash}` },
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.authenticated).toBe(true);
      expect(json.level).toBe('token');
    });

    it('returns authenticated=true with valid basic user cookie', async () => {
      const app = createApp({
        auth: {
          level: 'basic',
          basicUsers: [{ username: 'admin', password: 'pass123' }],
        },
      });
      const hash = hashToken('admin:pass123');

      const res = await app.request('/me', {
        headers: { Cookie: `auth_token=${hash}` },
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.authenticated).toBe(true);
      expect(json.level).toBe('basic');
      expect(json.user).toBe('admin');
    });

    it('returns 401 with invalid cookie for token auth', async () => {
      const app = createApp({ auth: { level: 'token', token: 'secret' } });

      const res = await app.request('/me', {
        headers: { Cookie: 'auth_token=invalidhash' },
      });
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.authenticated).toBe(false);
    });

    it('returns 401 with invalid cookie for basic auth', async () => {
      const app = createApp({
        auth: {
          level: 'basic',
          basicUsers: [{ username: 'admin', password: 'pass123' }],
        },
      });

      const res = await app.request('/me', {
        headers: { Cookie: 'auth_token=invalidhash' },
      });
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.authenticated).toBe(false);
    });

    it('returns 401 when cookie has other cookies but no auth_token', async () => {
      const app = createApp({ auth: { level: 'token', token: 'secret' } });

      const res = await app.request('/me', {
        headers: { Cookie: 'other_cookie=value' },
      });
      const json = await res.json();

      expect(res.status).toBe(401);
    });
  });
});
