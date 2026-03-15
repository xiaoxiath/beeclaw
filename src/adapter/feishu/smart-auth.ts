/**
 * Feishu Smart Auth Manager - 智能授权管理器
 *
 * 混合授权策略：静默授权优先，降级到卡片授权
 */

import type { Client } from '@larksuiteoapi/node-sdk';
import { getLogger } from '../../infra/observability/logger';
import {
  silentAuth,
  getOrRefreshUserToken,
  SilentAuthResult,
} from './silent-auth';

const logger = getLogger('feishu:smart-auth');

/**
 * 工具权限配置
 */
const TOOL_SCOPES: Record<string, string[]> = {
  // 日历工具 - 需要访问用户个人日历
  feishu_calendar_list: ['calendar:calendar:readonly'],
  feishu_calendar_get: ['calendar:calendar:readonly'],
  feishu_calendar_event_create: ['calendar:calendar'],
  feishu_calendar_event_list: ['calendar:calendar:readonly'],
  feishu_calendar_event_get: ['calendar:calendar:readonly'],
  feishu_calendar_event_update: ['calendar:calendar'],
  feishu_calendar_event_delete: ['calendar:calendar'],
  feishu_calendar_event_search: ['calendar:calendar:readonly'],
  feishu_calendar_today: ['calendar:calendar:readonly'],
  feishu_calendar_quick_event: ['calendar:calendar'],

  // 云文档工具 - 需要访问用户云盘
  feishu_drive_list: ['drive:drive:readonly'],
  feishu_drive_get: ['drive:drive:readonly'],
  feishu_drive_create_folder: ['drive:drive'],
  feishu_drive_move: ['drive:drive'],
  feishu_drive_copy: ['drive:drive'],
  feishu_drive_delete: ['drive:drive'],
  feishu_drive_rename: ['drive:drive'],
  feishu_drive_search: ['drive:drive:readonly'],
  feishu_drive_upload: ['drive:drive', 'drive:file:upload'],
  feishu_drive_download: ['drive:drive:readonly', 'drive:file:download'],

  // 知识库工具 - 需要访问用户知识库
  feishu_wiki_list_spaces: ['wiki:wiki:readonly'],
  feishu_wiki_get_space: ['wiki:wiki:readonly'],
  feishu_wiki_list_nodes: ['wiki:wiki:readonly'],
  feishu_wiki_get_node: ['wiki:wiki:readonly'],
  feishu_wiki_create_page: ['wiki:wiki'],
  feishu_wiki_move_node: ['wiki:wiki'],
  feishu_wiki_rename_node: ['wiki:wiki'],
  feishu_wiki_delete_node: ['wiki:wiki'],
  feishu_wiki_copy_node: ['wiki:wiki'],
  feishu_wiki_search: ['wiki:wiki:readonly'],
};

/**
 * 检查工具是否需要用户授权
 */
export function requiresUserAuth(toolName: string): boolean {
  return toolName in TOOL_SCOPES;
}

/**
 * 获取工具所需的权限范围
 */
export function getRequiredScopes(toolName: string): string[] {
  return TOOL_SCOPES[toolName] || [];
}

/**
 * 授权结果
 */
export interface AuthResult {
  /** 是否授权成功 */
  authorized: boolean;

  /** 用户 access token（如果授权成功） */
  accessToken?: string;

  /** 是否需要手动授权 */
  requiresManualAuth?: boolean;

  /** 授权卡片（如果需要手动授权） */
  authCard?: any;

  /** 错误信息 */
  error?: string;
}

/**
 * 智能授权管理器
 *
 * 自动选择最佳授权方式：
 * 1. 优先尝试静默授权（无感知）
 * 2. 失败后生成授权卡片（在飞书内完成）
 * 3. 最后降级到网页授权（外部网页）
 */
export class SmartAuthManager {
  private client: Client;
  private appId: string;
  private redirectUri: string;

  constructor(
    client: Client,
    config: { appId: string; redirectUri: string }
  ) {
    this.client = client;
    this.appId = config.appId;
    this.redirectUri = config.redirectUri;
  }

  /**
   * 获取用户授权
   *
   * @param openId 用户 openId
   * @param toolName 工具名称
   * @param chatId 聊天 ID（用于发送授权卡片）
   * @returns 授权结果
   */
  async authorize(
    openId: string,
    toolName: string,
    chatId?: string
  ): Promise<AuthResult> {
    // 1. 检查工具是否需要用户授权
    if (!requiresUserAuth(toolName)) {
      return { authorized: true };
    }

    const requiredScopes = getRequiredScopes(toolName);
    logger.info(`🔐 Authorizing ${openId} for tool ${toolName}, scopes: ${requiredScopes.join(', ')}`);

    // 2. 尝试获取或刷新 token（优先使用缓存，自动刷新）
    const authResult = await getOrRefreshUserToken(this.client, openId);

    if (authResult.success && authResult.token) {
      // 3. 检查权限范围
      const hasAllScopes = requiredScopes.every(
        scope => authResult.token!.scope.includes(scope)
      );

      if (hasAllScopes) {
        logger.info(`✅ User ${openId} authorized via cached/refreshed token`);
        return {
          authorized: true,
          accessToken: authResult.token.accessToken,
        };
      } else {
        logger.warn(`User ${openId} missing required scopes: ${requiredScopes.join(', ')}`);
      }
    }

    // 4. 尝试静默授权
    const silentResult = await silentAuth(this.client, { openId });

    if (silentResult.success && silentResult.token) {
      // 检查权限范围
      const hasAllScopes = requiredScopes.every(
        scope => silentResult.token!.scope.includes(scope)
      );

      if (hasAllScopes) {
        logger.info(`✅ User ${openId} authorized via silent auth`);
        return {
          authorized: true,
          accessToken: silentResult.token.accessToken,
        };
      }
    }

    // 5. 静默授权失败，生成授权卡片
    logger.info(`⚠️ Silent auth failed for ${openId}, generating auth card`);

    const authUrl = this.generateAuthUrl(openId, chatId, requiredScopes);
    const authCard = this.createAuthCard(authUrl, toolName);

    return {
      authorized: false,
      requiresManualAuth: true,
      authCard,
      error: '需要授权才能访问你的个人资源',
    };
  }

  /**
   * 生成授权 URL
   */
  private generateAuthUrl(
    openId: string,
    chatId?: string,
    scopes?: string[]
  ): string {
    const state = Buffer.from(
      JSON.stringify({
        openId,
        chatId,
        timestamp: Date.now(),
      })
    ).toString('base64');

    const params = new URLSearchParams({
      app_id: this.appId,
      redirect_uri: this.redirectUri,
      state,
      scope: (scopes || []).join(' '),
    });

    return `https://open.feishu.cn/open-apis/authen/v1/authorize?${params}`;
  }

  /**
   * 创建授权卡片
   */
  private createAuthCard(authUrl: string, toolName: string): any {
    const toolDescriptions: Record<string, string> = {
      feishu_calendar_list: '访问你的个人日历',
      feishu_drive_list: '访问你的云盘文件',
      feishu_wiki_list_spaces: '访问你的知识库',
    };

    const description = toolDescriptions[toolName] || '访问你的个人资源';

    return {
      schema: '2.0',
      config: {
        wide_screen_mode: true,
      },
      header: {
        title: {
          tag: 'plain_text',
          content: '需要授权',
        },
        template: 'blue',
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `为了${description}，需要你的授权。\n\n授权后，我就可以帮你：`,
          },
        },
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `• 📅 查看和管理你的日历\n• 📁 访问你的云盘文件\n• 📚 浏览你的知识库`,
          },
        },
        {
          tag: 'note',
          elements: [
            {
              tag: 'plain_text',
              content: '💡 授权仅用于访问你的个人资源，不会获取你的敏感信息。',
            },
          ],
        },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: {
                tag: 'plain_text',
                content: '授权访问',
              },
              url: authUrl,
              type: 'primary',
            },
            {
              tag: 'button',
              text: {
                tag: 'plain_text',
                content: '暂不授权',
              },
              type: 'default',
            },
          ],
        },
      ],
    };
  }

  /**
   * 检查用户授权状态
   */
  async checkAuthorizationStatus(
    openId: string,
    toolName: string
  ): Promise<{
    authorized: boolean;
    expiresAt?: number;
    scopes?: string[];
  }> {
    if (!requiresUserAuth(toolName)) {
      return { authorized: true };
    }

    const authResult = await getOrRefreshUserToken(this.client, openId);

    if (!authResult.success || !authResult.token) {
      return { authorized: false };
    }

    const requiredScopes = getRequiredScopes(toolName);
    const hasAllScopes = requiredScopes.every(
      scope => authResult.token!.scope.includes(scope)
    );

    return {
      authorized: hasAllScopes,
      expiresAt: authResult.token.expiresAt,
      scopes: authResult.token.scope.split(' '),
    };
  }

  /**
   * 撤销用户授权
   */
  async revokeAuthorization(openId: string): Promise<void> {
    // 清除缓存
    const { clearUserTokenCache } = await import('./silent-auth');
    clearUserTokenCache(openId);

    logger.info(`🗑️ Revoked authorization for ${openId}`);
  }
}

/**
 * 创建智能授权管理器实例
 */
export function createSmartAuthManager(
  client: Client,
  config: { appId: string; redirectUri: string }
): SmartAuthManager {
  return new SmartAuthManager(client, config);
}
