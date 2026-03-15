/**
 * Feishu Tool Auth Interceptor
 *
 * 工具执行拦截器 - 自动处理用户授权
 */

import type { Client } from '@larksuiteoapi/node-sdk';
import { getLogger } from '../../infra/observability/logger';
import {
  createSmartAuthManager,
  SmartAuthManager,
  requiresUserAuth,
} from './smart-auth';

const logger = getLogger('feishu:tool-interceptor');

/**
 * 工具执行上下文
 */
export interface ToolExecutionContext {
  openId: string;
  chatId?: string;
  userId?: string;
  messageId?: string;
}

/**
 * 工具执行结果
 */
export interface ToolExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  authCard?: any;
  requiresAuth?: boolean;
}

/**
 * 工具执行器
 */
type ToolExecutor = (
  client: Client,
  params: any,
  userAccessToken?: string
) => Promise<any>;

/**
 * 飞书工具授权拦截器
 *
 * 在执行工具前自动处理授权：
 * 1. 检查工具是否需要用户授权
 * 2. 自动尝试获取授权（静默授权优先）
 * 3. 必要时返回授权卡片
 */
export class FeishuToolAuthInterceptor {
  private authManager: SmartAuthManager;
  private client: Client;

  constructor(
    client: Client,
    config: { appId: string; redirectUri: string }
  ) {
    this.client = client;
    this.authManager = createSmartAuthManager(client, config);
  }

  /**
   * 执行工具（带自动授权）
   *
   * @param toolName 工具名称
   * @param params 工具参数
   * @param context 执行上下文
   * @param executor 工具执行器
   * @returns 执行结果
   */
  async execute(
    toolName: string,
    params: any,
    context: ToolExecutionContext,
    executor: ToolExecutor
  ): Promise<ToolExecutionResult> {
    logger.info(`🔧 Executing tool: ${toolName}`);

    // 1. 检查是否需要用户授权
    if (!requiresUserAuth(toolName)) {
      // 不需要授权，直接执行
      try {
        const result = await executor(this.client, params);
        return {
          success: true,
          data: result,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
        };
      }
    }

    // 2. 需要用户授权，获取授权
    const authResult = await this.authManager.authorize(
      context.openId,
      toolName,
      context.chatId
    );

    if (!authResult.authorized) {
      // 授权失败，返回授权卡片
      logger.warn(`❌ Authorization required for tool ${toolName}`);

      return {
        success: false,
        error: authResult.error,
        requiresAuth: true,
        authCard: authResult.authCard,
      };
    }

    // 3. 已授权，使用 user_access_token 执行工具
    try {
      logger.info(`✅ User authorized, executing tool ${toolName} with user token`);

      // 创建带用户授权的客户端
      const userClient = this.createUserAuthorizedClient(authResult.accessToken!);

      const result = await executor(userClient, params, authResult.accessToken);

      return {
        success: true,
        data: result,
      };

    } catch (error: any) {
      logger.error(`Tool execution failed: ${toolName}`, error);

      // 检查是否是授权错误
      if (this.isAuthError(error)) {
        // 清除授权缓存，需要重新授权
        await this.authManager.revokeAuthorization(context.openId);

        return {
          success: false,
          error: '授权已过期，请重新授权',
          requiresAuth: true,
        };
      }

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 创建用户授权的客户端
   *
   * 为需要用户授权的 API 调用添加 Authorization header
   */
  private createUserAuthorizedClient(userAccessToken: string): Client {
    // 创建客户端副本
    const userClient = this.client;

    // 拦截请求，添加用户授权头
    const originalRequest = userClient.request.bind(userClient);

    userClient.request = async (config: any) => {
      // 对于需要用户授权的 API，使用 user_access_token
      if (this.requiresUserAuth(config)) {
        config.headers = {
          ...config.headers,
          Authorization: `Bearer ${userAccessToken}`,
        };
      }

      return originalRequest(config);
    };

    return userClient;
  }

  /**
   * 判断 API 是否需要用户授权
   */
  private requiresUserAuth(config: any): boolean {
    // 根据路径判断
    const userAuthPaths = [
      '/calendar/v3/calendars',
      '/drive/v1/files',
      '/wiki/v2/spaces',
    ];

    return userAuthPaths.some(path => config.url?.includes(path));
  }

  /**
   * 判断是否是授权错误
   */
  private isAuthError(error: any): boolean {
    const authErrorCodes = [99991663, 99991672]; // 权限不足错误码

    return (
      error?.response?.data?.code && authErrorCodes.includes(error.response.data.code) ||
      error?.code && authErrorCodes.includes(error.code) ||
      error?.message?.includes('access token') ||
      error?.message?.includes('unauthorized')
    );
  }

  /**
   * 批量检查授权状态
   */
  async checkBatchAuthorization(
    openIds: string[],
    toolName: string
  ): Promise<Map<string, { authorized: boolean; expiresAt?: number }>> {
    const results = new Map<string, { authorized: boolean; expiresAt?: number }>();

    await Promise.all(
      openIds.map(async (openId) => {
        const status = await this.authManager.checkAuthorizationStatus(
          openId,
          toolName
        );
        results.set(openId, {
          authorized: status.authorized,
          expiresAt: status.expiresAt,
        });
      })
    );

    return results;
  }
}

/**
 * 创建工具授权拦截器
 */
export function createToolAuthInterceptor(
  client: Client,
  config: { appId: string; redirectUri: string }
): FeishuToolAuthInterceptor {
  return new FeishuToolAuthInterceptor(client, config);
}

/**
 * 工具执行包装器
 *
 * 为现有工具添加自动授权支持
 */
export function wrapToolWithAuth(
  toolName: string,
  executor: ToolExecutor,
  interceptor: FeishuToolAuthInterceptor
): (params: any, context: ToolExecutionContext) => Promise<ToolExecutionResult> {
  return async (params: any, context: ToolExecutionContext) => {
    return await interceptor.execute(toolName, params, context, executor);
  };
}
