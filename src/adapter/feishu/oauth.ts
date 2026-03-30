/**
 * Feishu OAuth 2.0 User Authorization
 *
 * 飞书用户授权管理
 */

import type * as Lark from '@larksuiteoapi/node-sdk';
import { getLogger } from '../../infra/observability/logger';
import { cache } from '../../infra/cache';

const logger = getLogger('feishu:oauth');

/** Client type alias for the Lark SDK Client */
type Client = InstanceType<typeof Lark.Client>;

/**
 * OAuth 配置
 */
export interface OAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  scopes: string[];
}

/**
 * 用户授权 Token
 */
export interface UserToken {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  expiresAt: number;
  tokenType: string;
  scope: string;
}

/**
 * 授权状态缓存
 */
interface AuthState {
  userId: string;
  openId: string;
  unionId?: string;
  chatId?: string;
  createdAt: number;
}

/**
 * 生成授权 URL
 */
export function generateAuthUrl(
  config: OAuthConfig,
  options: {
    userId: string;
    openId: string;
    chatId?: string;
    state?: string;
  }
): string {
  const state = options.state || `${options.userId}:${options.openId}:${options.chatId || ''}:${Date.now()}`;

  // 缓存状态，用于回调验证
  cache.set(`feishu:oauth:state:${state}`, {
    userId: options.userId,
    openId: options.openId,
    chatId: options.chatId,
    createdAt: Date.now(),
  }, 600); // 10 分钟有效

  const params = new URLSearchParams({
    app_id: config.appId,
    redirect_uri: config.redirectUri,
    state,
    scope: config.scopes.join(' '),
  });

  const authUrl = `https://open.feishu.cn/open-apis/authen/v1/authorize?${params}`;

  logger.info(`Generated OAuth URL for user ${options.openId}`);
  return authUrl;
}

/**
 * 用授权码换取访问令牌
 */
export async function exchangeCodeForToken(
  client: Client,
  code: string
): Promise<UserToken> {
  try {
    const response = await client.authen.v1.accessToken.create({
      data: {
        grant_type: 'authorization_code',
        code,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to exchange code: ${response.msg}`);
    }

    const data = response.data!;

    const token: UserToken = {
      accessToken: data.access_token ?? '',
      refreshToken: data.refresh_token ?? '',
      expiresIn: data.expires_in ?? 0,
      expiresAt: Date.now() + (data.expires_in ?? 0) * 1000,
      tokenType: data.token_type ?? '',
      scope: '',
    };

    logger.info(`✅ Got user access token, expires in ${data.expires_in ?? 0}s`);
    return token;
  } catch (error) {
    logger.error('Failed to exchange code for token:', error);
    throw error;
  }
}

/**
 * 刷新访问令牌
 */
export async function refreshUserToken(
  client: Client,
  refreshToken: string
): Promise<UserToken> {
  try {
    const response = await client.authen.v1.refreshAccessToken.create({
      data: {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to refresh token: ${response.msg}`);
    }

    const data = response.data!;

    const token: UserToken = {
      accessToken: data.access_token ?? '',
      refreshToken: data.refresh_token ?? '',
      expiresIn: data.expires_in ?? 0,
      expiresAt: Date.now() + (data.expires_in ?? 0) * 1000,
      tokenType: data.token_type ?? '',
      scope: '',
    };

    logger.info(`✅ Refreshed user access token`);
    return token;
  } catch (error) {
    logger.error('Failed to refresh token:', error);
    throw error;
  }
}

/**
 * 获取用户信息
 */
export async function getUserInfo(
  client: Client,
  accessToken: string
): Promise<{
  openId: string;
  unionId: string;
  userId: string;
  name: string;
  avatarUrl?: string;
  email?: string;
  mobile?: string;
}> {
  try {
    const response = await client.authen.v1.userInfo.get({
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to get user info: ${response.msg}`);
    }

    const data = response.data!;

    return {
      openId: data.open_id ?? '',
      unionId: data.union_id ?? '',
      userId: data.user_id ?? '',
      name: data.name ?? '',
      avatarUrl: data.avatar_url,
      email: data.email,
      mobile: data.mobile,
    };
  } catch (error) {
    logger.error('Failed to get user info:', error);
    throw error;
  }
}

/**
 * 存储用户 Token
 */
export async function saveUserToken(
  openId: string,
  token: UserToken
): Promise<void> {
  const cacheKey = `feishu:user:token:${openId}`;

  // 缓存到内存（快速访问）
  cache.set(cacheKey, token, token.expiresIn);

}

/**
 * 获取用户 Token
 */
export async function getUserToken(
  client: Client,
  openId: string
): Promise<UserToken | null> {
  const cacheKey = `feishu:user:token:${openId}`;

  // 1. 从缓存获取
  const cachedToken = cache.get<UserToken>(cacheKey);

  if (cachedToken) {
    // 检查是否即将过期（提前 5 分钟刷新）
    if (Date.now() > cachedToken.expiresAt - 300000) {
      logger.info(`Token expiring soon, refreshing for ${openId}`);
      try {
        const refreshedToken = await refreshUserToken(client, cachedToken.refreshToken);
        await saveUserToken(openId, refreshedToken);
        return refreshedToken;
      } catch (_error) {
        logger.error('Failed to refresh token, removing from cache');
        cache.delete(cacheKey);
        return null;
      }
    }
    return cachedToken;
  }

  return null;
}

/**
 * 验证授权状态
 */
export function verifyAuthState(state: string): AuthState | null {
  const cacheKey = `feishu:oauth:state:${state}`;
  const authState = cache.get<AuthState>(cacheKey);

  if (!authState) {
    logger.warn(`Invalid or expired OAuth state: ${state}`);
    return null;
  }

  // 删除已使用的 state
  cache.delete(cacheKey);

  return authState;
}

/**
 * 检查用户是否已授权
 */
export async function isUserAuthorized(
  client: Client,
  openId: string
): Promise<boolean> {
  const token = await getUserToken(client, openId);
  return token !== null;
}

/**
 * 创建带用户授权的 Client
 */
export function createUserAuthorizedClient(
  client: Client,
  userAccessToken: string
): Client {
  // Create a proxy that intercepts requests and adds user authorization
  const originalRequest = client.request.bind(client);

  // Use Object.create to maintain the Client prototype chain
  const authorizedClient = Object.create(client) as Client;

  authorizedClient.request = async (config: any) => {
    config.headers = {
      ...config.headers,
      Authorization: `Bearer ${userAccessToken}`,
    };
    return originalRequest(config);
  };

  return authorizedClient;
}

/**
 * 需要授权的装饰器
 */
export function requireUserAuth(
  client: Client,
  openId: string,
  scope?: string
): Promise<UserToken> {
  return new Promise(async (resolve, reject) => {
    const token = await getUserToken(client, openId);

    if (!token) {
      reject(new Error('USER_AUTH_REQUIRED'));
      return;
    }

    // 检查权限范围
    if (scope && !token.scope.includes(scope)) {
      reject(new Error(`SCOPE_REQUIRED:${scope}`));
      return;
    }

    resolve(token);
  });
}
