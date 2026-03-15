/**
 * Feishu Silent Auth - 静默授权
 *
 * 无感知获取 user_access_token
 */

import type { Client } from '@larksuiteoapi/node-sdk';
import { getLogger } from '../../infra/observability/logger';
import { cache } from '../../infra/cache';

const logger = getLogger('feishu:silent-auth');

/**
 * 静默授权选项
 */
export interface SilentAuthOptions {
  openId: string;
  userId?: string;
  forceRefresh?: boolean;
}

/**
 * 静默授权结果
 */
export interface SilentAuthResult {
  success: boolean;
  token?: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    expiresAt: number;
    scope: string;
  };
  error?: string;
  reason?: 'NOT_IN_FEISHU' | 'PERMISSION_DENIED' | 'USER_NOT_LOGGED_IN' | 'UNKNOWN';
}

/**
 * 静默授权 - 尝试无感知获取 user_access_token
 *
 * 适用场景：
 * 1. 用户在飞书桌面端或移动端内使用
 * 2. 用户已登录飞书
 * 3. 应用已获得相关权限
 *
 * @param client 飞书客户端
 * @param options 授权选项
 * @returns 授权结果
 */
export async function silentAuth(
  client: Client,
  options: SilentAuthOptions
): Promise<SilentAuthResult> {
  const { openId, forceRefresh = false } = options;

  try {
    logger.info(`🔐 Attempting silent auth for ${openId}`);

    // 1. 检查缓存（除非强制刷新）
    if (!forceRefresh) {
      const cachedToken = cache.get<string>(`feishu:user:token:${openId}`);
      if (cachedToken) {
        const tokenData = JSON.parse(cachedToken);

        // 检查是否过期（提前 5 分钟）
        if (tokenData.expiresAt > Date.now() + 300000) {
          logger.info(`✅ Using cached token for ${openId}`);
          return {
            success: true,
            token: tokenData,
          };
        }
      }
    }

    // 2. 调用飞书静默授权 API
    const response = await client.authen.v1.accessToken.create({
      data: {
        grant_type: 'silent_auth',
        silent_auth: {
          open_id: openId,
        },
      },
    });

    // 3. 处理响应
    if (response.code !== 0) {
      const errorMap: Record<number, { reason: SilentAuthResult['reason']; message: string }> = {
        10003: { reason: 'USER_NOT_LOGGED_IN', message: '用户未登录' },
        10014: { reason: 'NOT_IN_FEISHU', message: '不在飞书环境内' },
        10015: { reason: 'PERMISSION_DENIED', message: '权限不足' },
      };

      const errorInfo = errorMap[response.code] || {
        reason: 'UNKNOWN' as const,
        message: response.msg || '未知错误',
      };

      logger.warn(`❌ Silent auth failed for ${openId}: ${errorInfo.message} (code: ${response.code})`);

      return {
        success: false,
        error: errorInfo.message,
        reason: errorInfo.reason,
      };
    }

    // 4. 成功获取 token
    const data = response.data!;
    const token = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      expiresAt: Date.now() + data.expires_in * 1000,
      scope: data.scope,
    };

    // 5. 缓存 token
    cache.set(
      `feishu:user:token:${openId}`,
      JSON.stringify(token),
      data.expires_in
    );

    logger.info(`✅ Silent auth succeeded for ${openId}, expires in ${data.expires_in}s`);

    return {
      success: true,
      token,
    };

  } catch (error: any) {
    logger.error('Silent auth exception:', error);

    return {
      success: false,
      error: error.message || 'Exception during silent auth',
      reason: 'UNKNOWN',
    };
  }
}

/**
 * 批量静默授权
 *
 * 用于多个用户同时需要授权的场景
 */
export async function batchSilentAuth(
  client: Client,
  openIds: string[]
): Promise<Map<string, SilentAuthResult>> {
  const results = new Map<string, SilentAuthResult>();

  // 并发执行（限制并发数）
  const concurrencyLimit = 5;
  const batches = [];

  for (let i = 0; i < openIds.length; i += concurrencyLimit) {
    const batch = openIds.slice(i, i + concurrencyLimit);
    batches.push(batch);
  }

  for (const batch of batches) {
    const batchResults = await Promise.all(
      batch.map(async (openId) => ({
        openId,
        result: await silentAuth(client, { openId }),
      }))
    );

    batchResults.forEach(({ openId, result }) => {
      results.set(openId, result);
    });
  }

  return results;
}

/**
 * 检查静默授权是否可用
 *
 * 快速检查，不实际获取 token
 */
export async function checkSilentAuthAvailable(
  client: Client,
  openId: string
): Promise<boolean> {
  const result = await silentAuth(client, { openId, forceRefresh: true });
  return result.success;
}

/**
 * 获取缓存的用户 token
 */
export function getCachedUserToken(openId: string): SilentAuthResult['token'] | null {
  const cached = cache.get<string>(`feishu:user:token:${openId}`);

  if (!cached) {
    return null;
  }

  try {
    const token = JSON.parse(cached);

    // 检查是否过期
    if (token.expiresAt <= Date.now()) {
      cache.delete(`feishu:user:token:${openId}`);
      return null;
    }

    return token;
  } catch {
    return null;
  }
}

/**
 * 清除用户 token 缓存
 */
export function clearUserTokenCache(openId: string): void {
  cache.delete(`feishu:user:token:${openId}`);
  logger.info(`🗑️ Cleared token cache for ${openId}`);
}

/**
 * 获取或刷新用户 token
 *
 * 如果 token 即将过期，自动刷新
 */
export async function getOrRefreshUserToken(
  client: Client,
  openId: string
): Promise<SilentAuthResult> {
  // 1. 尝试从缓存获取
  const cachedToken = getCachedUserToken(openId);

  if (cachedToken) {
    // 检查是否需要刷新（提前 5 分钟）
    if (cachedToken.expiresAt > Date.now() + 300000) {
      return {
        success: true,
        token: cachedToken,
      };
    }

    // Token 即将过期，尝试刷新
    try {
      const refreshResponse = await client.authen.v1.refreshAccessToken.create({
        data: {
          grant_type: 'refresh_token',
          refresh_token: cachedToken.refreshToken,
        },
      });

      if (refreshResponse.code === 0) {
        const data = refreshResponse.data!;
        const newToken = {
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresIn: data.expires_in,
          expiresAt: Date.now() + data.expires_in * 1000,
          scope: data.scope,
        };

        // 更新缓存
        cache.set(
          `feishu:user:token:${openId}`,
          JSON.stringify(newToken),
          data.expires_in
        );

        logger.info(`🔄 Refreshed token for ${openId}`);

        return {
          success: true,
          token: newToken,
        };
      }
    } catch (error) {
      logger.warn(`Failed to refresh token for ${openId}, will try silent auth`);
    }
  }

  // 2. 刷新失败或无缓存，尝试静默授权
  return await silentAuth(client, { openId, forceRefresh: true });
}
