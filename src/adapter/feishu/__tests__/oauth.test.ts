/**
 * Tests for oauth.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../infra/observability/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(() => {}),
    info: vi.fn(() => {}),
    warn: vi.fn(() => {}),
    error: vi.fn(() => {}),
  }),
}));

// Mock cache
const cacheStore = new Map<string, { value: any; ttl?: number }>();
vi.mock('../../../infra/cache', () => ({
  cache: {
    set: vi.fn((key: string, value: any, ttl?: number) => {
      cacheStore.set(key, { value, ttl });
    }),
    get: vi.fn((key: string) => {
      const entry = cacheStore.get(key);
      return entry ? entry.value : undefined;
    }),
    delete: vi.fn((key: string) => {
      cacheStore.delete(key);
    }),
  },
}));

import {
  generateAuthUrl,
  exchangeCodeForToken,
  refreshUserToken,
  getUserInfo,
  saveUserToken,
  getUserToken,
  verifyAuthState,
  isUserAuthorized,
  createUserAuthorizedClient,
  requireUserAuth,
} from '../oauth';
import type { OAuthConfig, UserToken } from '../oauth';

const testOAuthConfig: OAuthConfig = {
  appId: 'app_123',
  appSecret: 'secret_456',
  redirectUri: 'https://example.com/callback',
  scopes: ['user:read', 'contact:read'],
};

function makeClient(overrides: Record<string, any> = {}) {
  return {
    authen: {
      v1: {
        accessToken: {
          create: vi.fn(() =>
            Promise.resolve({
              code: 0,
              data: {
                access_token: 'at_123',
                refresh_token: 'rt_456',
                expires_in: 7200,
                token_type: 'Bearer',
                scope: 'user:read',
              },
            })
          ),
        },
        refreshAccessToken: {
          create: vi.fn(() =>
            Promise.resolve({
              code: 0,
              data: {
                access_token: 'at_refreshed',
                refresh_token: 'rt_refreshed',
                expires_in: 7200,
                token_type: 'Bearer',
                scope: 'user:read',
              },
            })
          ),
        },
        userInfo: {
          get: vi.fn(() =>
            Promise.resolve({
              code: 0,
              data: {
                open_id: 'ou_1',
                union_id: 'un_1',
                user_id: 'u_1',
                name: 'Alice',
                avatar_url: 'https://example.com/avatar.png',
                email: 'alice@example.com',
                mobile: '+1234567890',
              },
            })
          ),
        },
      },
    },
    request: vi.fn(() => Promise.resolve({})),
    ...overrides,
  } as any;
}

describe('oauth', () => {
  beforeEach(() => {
    cacheStore.clear();
  });

  // ===================== generateAuthUrl =====================
  describe('generateAuthUrl', () => {
    it('generates a valid auth URL', () => {
      const url = generateAuthUrl(testOAuthConfig, {
        userId: 'u_1',
        openId: 'ou_1',
      });
      expect(url).toContain('https://open.feishu.cn/open-apis/authen/v1/authorize');
      expect(url).toContain('app_id=app_123');
      expect(url).toContain(encodeURIComponent('https://example.com/callback'));
    });

    it('includes scope in URL', () => {
      const url = generateAuthUrl(testOAuthConfig, {
        userId: 'u_1',
        openId: 'ou_1',
      });
      expect(url).toContain('scope=');
    });

    it('uses custom state if provided', () => {
      const url = generateAuthUrl(testOAuthConfig, {
        userId: 'u_1',
        openId: 'ou_1',
        state: 'custom_state_123',
      });
      expect(url).toContain('state=custom_state_123');
    });

    it('caches auth state', () => {
      generateAuthUrl(testOAuthConfig, {
        userId: 'u_1',
        openId: 'ou_1',
        chatId: 'oc_1',
      });
      // State should be cached
      expect(cacheStore.size).toBeGreaterThan(0);
    });
  });

  // ===================== exchangeCodeForToken =====================
  describe('exchangeCodeForToken', () => {
    it('exchanges code for token', async () => {
      const client = makeClient();
      const token = await exchangeCodeForToken(client, 'auth_code_123');
      expect(token.accessToken).toBe('at_123');
      expect(token.refreshToken).toBe('rt_456');
      expect(token.expiresIn).toBe(7200);
      expect(token.tokenType).toBe('Bearer');
      expect(token.expiresAt).toBeGreaterThan(Date.now());
    });

    it('throws on API error', async () => {
      const client = makeClient();
      client.authen.v1.accessToken.create.mockResolvedValue({ code: 99999, msg: 'invalid code' });
      await expect(exchangeCodeForToken(client, 'bad')).rejects.toThrow('Failed to exchange code');
    });
  });

  // ===================== refreshUserToken =====================
  describe('refreshUserToken', () => {
    it('refreshes token', async () => {
      const client = makeClient();
      const token = await refreshUserToken(client, 'rt_old');
      expect(token.accessToken).toBe('at_refreshed');
      expect(token.refreshToken).toBe('rt_refreshed');
    });

    it('throws on API error', async () => {
      const client = makeClient();
      client.authen.v1.refreshAccessToken.create.mockResolvedValue({ code: 99999, msg: 'expired' });
      await expect(refreshUserToken(client, 'rt')).rejects.toThrow('Failed to refresh token');
    });
  });

  // ===================== getUserInfo =====================
  describe('getUserInfo', () => {
    it('returns user info', async () => {
      const client = makeClient();
      const info = await getUserInfo(client, 'at_123');
      expect(info.openId).toBe('ou_1');
      expect(info.name).toBe('Alice');
      expect(info.email).toBe('alice@example.com');
    });

    it('throws on API error', async () => {
      const client = makeClient();
      client.authen.v1.userInfo.get.mockResolvedValue({ code: 99999, msg: 'unauthorized' });
      await expect(getUserInfo(client, 'bad')).rejects.toThrow('Failed to get user info');
    });
  });

  // ===================== saveUserToken / getUserToken =====================
  describe('saveUserToken', () => {
    it('saves token to cache', async () => {
      const token: UserToken = {
        accessToken: 'at_1',
        refreshToken: 'rt_1',
        expiresIn: 7200,
        expiresAt: Date.now() + 7200000,
        tokenType: 'Bearer',
        scope: 'user:read',
      };
      await saveUserToken('ou_1', token);
      expect(cacheStore.has('feishu:user:token:ou_1')).toBe(true);
    });
  });

  describe('getUserToken', () => {
    it('returns null when not cached', async () => {
      const client = makeClient();
      const token = await getUserToken(client, 'ou_nonexistent');
      expect(token).toBeNull();
    });

    it('returns cached token', async () => {
      const token: UserToken = {
        accessToken: 'at_1',
        refreshToken: 'rt_1',
        expiresIn: 7200,
        expiresAt: Date.now() + 7200000,
        tokenType: 'Bearer',
        scope: 'user:read',
      };
      await saveUserToken('ou_cache', token);
      const client = makeClient();
      const result = await getUserToken(client, 'ou_cache');
      expect(result?.accessToken).toBe('at_1');
    });

    it('refreshes token if about to expire', async () => {
      const token: UserToken = {
        accessToken: 'at_old',
        refreshToken: 'rt_old',
        expiresIn: 7200,
        expiresAt: Date.now() + 100000, // less than 5 min
        tokenType: 'Bearer',
        scope: 'user:read',
      };
      await saveUserToken('ou_expiring', token);
      const client = makeClient();
      const result = await getUserToken(client, 'ou_expiring');
      expect(result?.accessToken).toBe('at_refreshed');
    });

    it('returns null if refresh fails', async () => {
      const token: UserToken = {
        accessToken: 'at_old',
        refreshToken: 'rt_old',
        expiresIn: 7200,
        expiresAt: Date.now() + 100000,
        tokenType: 'Bearer',
        scope: 'user:read',
      };
      await saveUserToken('ou_fail', token);
      const client = makeClient();
      client.authen.v1.refreshAccessToken.create.mockRejectedValue(new Error('refresh fail'));
      const result = await getUserToken(client, 'ou_fail');
      expect(result).toBeNull();
    });
  });

  // ===================== verifyAuthState =====================
  describe('verifyAuthState', () => {
    it('returns auth state and deletes it', () => {
      cacheStore.set('feishu:oauth:state:test_state', {
        value: { userId: 'u_1', openId: 'ou_1', createdAt: Date.now() },
      });
      const result = verifyAuthState('test_state');
      expect(result).not.toBeNull();
      expect(result!.userId).toBe('u_1');
      // Should be deleted after verification
      expect(cacheStore.has('feishu:oauth:state:test_state')).toBe(false);
    });

    it('returns null for invalid state', () => {
      expect(verifyAuthState('nonexistent')).toBeNull();
    });
  });

  // ===================== isUserAuthorized =====================
  describe('isUserAuthorized', () => {
    it('returns true when token exists', async () => {
      await saveUserToken('ou_auth', {
        accessToken: 'at',
        refreshToken: 'rt',
        expiresIn: 7200,
        expiresAt: Date.now() + 7200000,
        tokenType: 'Bearer',
        scope: 'user:read',
      });
      const client = makeClient();
      expect(await isUserAuthorized(client, 'ou_auth')).toBe(true);
    });

    it('returns false when no token', async () => {
      const client = makeClient();
      expect(await isUserAuthorized(client, 'ou_no')).toBe(false);
    });
  });

  // ===================== createUserAuthorizedClient =====================
  describe('createUserAuthorizedClient', () => {
    it('creates a client with user auth header', () => {
      const client = makeClient();
      const authClient = createUserAuthorizedClient(client, 'user_at_123');
      expect(authClient).toBeDefined();
      expect(authClient).not.toBe(client); // should be a copy
    });
  });

  // ===================== requireUserAuth =====================
  describe('requireUserAuth', () => {
    it('resolves with token when authorized', async () => {
      await saveUserToken('ou_req', {
        accessToken: 'at',
        refreshToken: 'rt',
        expiresIn: 7200,
        expiresAt: Date.now() + 7200000,
        tokenType: 'Bearer',
        scope: 'user:read contact:read',
      });
      const client = makeClient();
      const token = await requireUserAuth(client, 'ou_req');
      expect(token.accessToken).toBe('at');
    });

    it('rejects when no token', async () => {
      const client = makeClient();
      await expect(requireUserAuth(client, 'ou_none')).rejects.toThrow('USER_AUTH_REQUIRED');
    });

    it('rejects when scope missing', async () => {
      await saveUserToken('ou_scope', {
        accessToken: 'at',
        refreshToken: 'rt',
        expiresIn: 7200,
        expiresAt: Date.now() + 7200000,
        tokenType: 'Bearer',
        scope: 'user:read',
      });
      const client = makeClient();
      await expect(requireUserAuth(client, 'ou_scope', 'admin:write')).rejects.toThrow('SCOPE_REQUIRED');
    });
  });
});
