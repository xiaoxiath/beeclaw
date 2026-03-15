/**
 * Feishu User Authorization Middleware
 *
 * 在工具执行前检查用户授权状态，自动处理授权流程
 */

import type { Context, Next } from 'hono';
import { getFeishuWSClient } from '../../adapter/feishu';
import { getUserToken, generateAuthUrl, isUserAuthorized } from '../../adapter/feishu/oauth';
import { getLogger } from '../../infra/observability/logger';
import { loadConfig } from '../../infra/config';

const logger = getLogger('middleware:feishu-auth');

/**
 * 需要用户授权的工具列表
 */
const USER_AUTH_REQUIRED_TOOLS = [
  // 日历工具 - 需要访问用户个人日历
  'feishu_calendar_list',
  'feishu_calendar_get',
  'feishu_calendar_event_create',
  'feishu_calendar_event_list',
  'feishu_calendar_event_get',
  'feishu_calendar_event_update',
  'feishu_calendar_event_delete',
  'feishu_calendar_event_search',
  'feishu_calendar_today',
  'feishu_calendar_quick_event',

  // 云文档工具 - 需要访问用户云盘
  'feishu_drive_list',
  'feishu_drive_get',
  'feishu_drive_create_folder',
  'feishu_drive_move',
  'feishu_drive_copy',
  'feishu_drive_delete',
  'feishu_drive_rename',
  'feishu_drive_search',
  'feishu_drive_upload',
  'feishu_drive_download',

  // 知识库工具 - 需要访问用户知识库
  'feishu_wiki_list_spaces',
  'feishu_wiki_get_space',
  'feishu_wiki_list_nodes',
  'feishu_wiki_get_node',
  'feishu_wiki_create_page',
  'feishu_wiki_move_node',
  'feishu_wiki_rename_node',
  'feishu_wiki_delete_node',
  'feishu_wiki_copy_node',
  'feishu_wiki_search',
];

/**
 * 工具对应的权限范围
 */
const TOOL_SCOPES: Record<string, string[]> = {
  // 日历工具
  feishu_calendar_list: ['calendar:calendar:readonly'],
  feishu_calendar_get: ['calendar:calendar:readonly'],
  feishu_calendar_event_create: ['calendar:calendar'],
  feishu_calendar_event_list: ['calendar:calendar:readonly'],
  feishu_calendar_today: ['calendar:calendar:readonly'],

  // 云文档工具
  feishu_drive_list: ['drive:drive:readonly'],
  feishu_drive_get: ['drive:drive:readonly'],
  feishu_drive_create_folder: ['drive:drive'],
  feishu_drive_upload: ['drive:drive', 'drive:file:upload'],
  feishu_drive_download: ['drive:drive:readonly', 'drive:file:download'],

  // 知识库工具
  feishu_wiki_list_spaces: ['wiki:wiki:readonly'],
  feishu_wiki_get_space: ['wiki:wiki:readonly'],
  feishu_wiki_create_page: ['wiki:wiki'],
};

/**
 * 检查工具是否需要用户授权
 */
export function isUserAuthRequired(toolName: string): boolean {
  return USER_AUTH_REQUIRED_TOOLS.includes(toolName);
}

/**
 * 用户授权中间件
 *
 * 拦截需要用户授权的工具调用，检查授权状态
 */
export async function feishuUserAuthMiddleware(c: Context, next: Next) {
  const body = await c.req.json();
  const { toolName, params, context } = body;

  // 只处理飞书工具
  if (!toolName?.startsWith('feishu_')) {
    return next();
  }

  // 只处理需要用户授权的工具
  if (!isUserAuthRequired(toolName)) {
    return next();
  }

  const openId = context?.openId;
  const chatId = context?.chatId;

  if (!openId) {
    return c.json({
      success: false,
      error: 'Missing user context (openId)',
      requiresAuth: false,
    });
  }

  const wsClient = getFeishuWSClient();
  if (!wsClient) {
    return c.json({
      success: false,
      error: 'Feishu client not initialized',
      requiresAuth: false,
    });
  }

  // Create temporary SDK client for OAuth operations (tools use CLI runner)
  const { default: Lark } = await import('@larksuiteoapi/node-sdk');
  const config = loadConfig();
  const client = new Lark.Client({
    appId: config.feishu.appId!,
    appSecret: config.feishu.appSecret!,
  });

  try {
    // 检查用户是否已授权
    const token = await getUserToken(client, openId);

    if (!token) {
      // 用户未授权，生成授权链接
      const authUrl = generateAuthUrl(
        {
          appId: config.feishu.appId!,
          appSecret: config.feishu.appSecret!,
          redirectUri: config.feishu.oauthRedirectUri || `http://localhost:${config.server.port}/api/feishu/oauth/callback`,
          scopes: TOOL_SCOPES[toolName] || [],
        },
        {
          userId: openId,
          openId,
          chatId,
        }
      );

      logger.info(`User ${openId} not authorized for tool ${toolName}, generating auth URL`);

      // 返回需要授权的响应
      return c.json({
        success: false,
        error: 'USER_AUTH_REQUIRED',
        requiresAuth: true,
        authUrl,
        message: '需要授权才能访问你的个人资源',
        authInstructions: `请点击链接授权：${authUrl}`,
      });
    }

    // 检查权限范围
    const requiredScopes = TOOL_SCOPES[toolName] || [];
    const hasAllScopes = requiredScopes.every(scope => token.scope.includes(scope));

    if (!hasAllScopes) {
      // 权限不足，需要重新授权
      const authUrl = generateAuthUrl(
        {
          appId: config.feishu.appId!,
          appSecret: config.feishu.appSecret!,
          redirectUri: config.feishu.oauthRedirectUri || `http://localhost:${config.server.port}/api/feishu/oauth/callback`,
          scopes: requiredScopes,
        },
        {
          userId: openId,
          openId,
          chatId,
        }
      );

      logger.info(`User ${openId} missing scopes for tool ${toolName}, generating auth URL`);

      return c.json({
        success: false,
        error: 'INSUFFICIENT_SCOPES',
        requiresAuth: true,
        authUrl,
        message: '需要额外权限',
        requiredScopes,
        currentScopes: token.scope.split(' '),
        authInstructions: `请点击链接授权新权限：${authUrl}`,
      });
    }

    // 用户已授权且权限足够，将 token 注入到 context
    c.set('userAccessToken', token.accessToken);

    logger.info(`User ${openId} authorized for tool ${toolName}`);
    return next();

  } catch (error) {
    logger.error('User auth middleware failed:', error);
    return c.json({
      success: false,
      error: 'Authorization check failed',
      requiresAuth: false,
    });
  }
}

/**
 * 获取用户授权 token
 */
export function getUserAccessToken(c: Context): string | undefined {
  return c.get('userAccessToken');
}

/**
 * 创建用户授权的 API Client
 * DEPRECATED: Tools now use CLI runner. This function creates a temporary SDK client for legacy use cases.
 */
export async function createUserAuthorizedApiClient(c: Context): Promise<any> {
  const userAccessToken = getUserAccessToken(c);

  // Create temporary SDK client
  const { default: Lark } = await import('@larksuiteoapi/node-sdk');
  const config = loadConfig();
  const client = new Lark.Client({
    appId: config.feishu.appId!,
    appSecret: config.feishu.appSecret!,
  });

  if (!userAccessToken) {
    // 如果没有用户 token，使用默认的应用授权
    return client;
  }

  // 创建带用户授权的 client wrapper
  const originalRequest = client.request.bind(client);

  client.request = async (config: any) => {
    // 对于需要用户授权的 API，添加 user_access_token
    config.headers = {
      ...config.headers,
      Authorization: `Bearer ${userAccessToken}`,
    };
    return originalRequest(config);
  };

  return client;
}
