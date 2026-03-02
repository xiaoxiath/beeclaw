/**
 * Feishu API Client
 *
 * Handles authentication and API calls to Feishu/Lark Open Platform
 */

import type {
  FeishuAuthConfig,
  TenantAccessTokenResponse,
  SendMessageRequest,
  SendMessageResponse,
  TokenCache,
  TextContent,
  PostContent,
  ReceiveIdType,
  UserInfoResponse,
  MessageEvent,
} from './types';

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

/**
 * Feishu API Client
 *
 * Manages authentication and provides methods for API calls
 */
export class FeishuClient {
  private config: FeishuAuthConfig;
  private tokenCache: TokenCache | null = null;

  constructor(config: FeishuAuthConfig) {
    this.config = config;
  }

  /**
   * Check if the client is enabled
   */
  get isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get tenant access token (with caching)
   */
  async getTenantAccessToken(): Promise<string> {
    // Check cache
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt) {
      return this.tokenCache.accessToken;
    }

    // Request new token
    const response = await fetch(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        app_id: this.config.appId,
        app_secret: this.config.appSecret,
      }),
    });

    const data: TenantAccessTokenResponse = await response.json();

    if (data.code !== 0) {
      throw new Error(`Failed to get tenant access token: ${data.msg}`);
    }

    // Cache token (expire 5 minutes before actual expiry for safety)
    this.tokenCache = {
      accessToken: data.tenant_access_token,
      expiresAt: Date.now() + (data.expire - 300) * 1000,
    };

    return this.tokenCache.accessToken;
  }

  /**
   * Send a text message
   */
  async sendTextMessage(
    receiveId: string,
    receiveIdType: ReceiveIdType,
    text: string
  ): Promise<SendMessageResponse> {
    const content: TextContent = { text };
    return this.sendMessage(receiveId, receiveIdType, 'text', JSON.stringify(content));
  }

  /**
   * Send a rich text (post) message
   */
  async sendPostMessage(
    receiveId: string,
    receiveIdType: ReceiveIdType,
    content: PostContent
  ): Promise<SendMessageResponse> {
    return this.sendMessage(receiveId, receiveIdType, 'post', JSON.stringify(content));
  }

  /**
   * Send a message (generic)
   */
  async sendMessage(
    receiveId: string,
    receiveIdType: ReceiveIdType,
    msgType: SendMessageRequest['msg_type'],
    content: string
  ): Promise<SendMessageResponse> {
    const token = await this.getTenantAccessToken();

    const response = await fetch(
      `${FEISHU_API_BASE}/im/v1/messages?receive_id_type=${receiveIdType}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          receive_id: receiveId,
          msg_type: msgType,
          content: content,
        }),
      }
    );

    const data: SendMessageResponse = await response.json();

    if (data.code !== 0) {
      console.error('[Feishu] Send message failed:', data.msg);
    }

    return data;
  }

  /**
   * Reply to a message
   */
  async replyToMessage(
    messageId: string,
    msgType: SendMessageRequest['msg_type'],
    content: string
  ): Promise<SendMessageResponse> {
    const token = await this.getTenantAccessToken();

    const response = await fetch(
      `${FEISHU_API_BASE}/im/v1/messages/${messageId}/reply`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          msg_type: msgType,
          content: content,
        }),
      }
    );

    const data: SendMessageResponse = await response.json();

    if (data.code !== 0) {
      console.error('[Feishu] Reply message failed:', data.msg);
    }

    return data;
  }

  /**
   * Reply with text
   */
  async replyText(messageId: string, text: string): Promise<SendMessageResponse> {
    const content: TextContent = { text };
    return this.replyToMessage(messageId, 'text', JSON.stringify(content));
  }

  /**
   * Get user info
   */
  async getUserInfo(openId: string): Promise<UserInfoResponse> {
    const token = await this.getTenantAccessToken();

    const response = await fetch(
      `${FEISHU_API_BASE}/contact/v3/users/${openId}?user_id_type=open_id`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }
    );

    return response.json();
  }

  /**
   * Get chat info
   */
  async getChatInfo(chatId: string): Promise<{ code: number; msg: string; data?: unknown }> {
    const token = await this.getTenantAccessToken();

    const response = await fetch(
      `${FEISHU_API_BASE}/im/v1/chats/${chatId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }
    );

    return response.json();
  }

  /**
   * Parse message content from event
   */
  parseMessageContent(event: MessageEvent): string {
    const content = event.event.message.content;

    try {
      const parsed = JSON.parse(content);

      // Handle different message types
      switch (event.event.message.message_type) {
        case 'text':
          return parsed.text || content;

        case 'post':
          // Extract text from rich text message
          const post = parsed;
          const texts: string[] = [];
          for (const locale of ['zh_cn', 'en_us'] as const) {
            if (post[locale]) {
              texts.push(post[locale].title || '');
              for (const paragraph of post[locale].content || []) {
                for (const element of paragraph) {
                  if (element.text) {
                    texts.push(element.text);
                  }
                }
              }
            }
          }
          return texts.join('\n');

        default:
          return content;
      }
    } catch {
      // Not JSON, return as-is
      return content;
    }
  }

  /**
   * Extract user ID from event
   */
  extractUserId(event: MessageEvent): string {
    return event.event.sender.sender_id.open_id
      || event.event.sender.sender_id.user_id
      || event.event.sender.sender_id.union_id
      || 'unknown';
  }

  /**
   * Extract chat ID from event
   */
  extractChatId(event: MessageEvent): string {
    return event.event.message.chat_id;
  }

  /**
   * Extract message ID from event
   */
  extractMessageId(event: MessageEvent): string {
    return event.event.message.message_id;
  }
}

// ============================================================
// Singleton Instance
// ============================================================

let clientInstance: FeishuClient | null = null;

/**
 * Initialize the Feishu client with configuration
 */
export function initFeishuClient(config: FeishuAuthConfig): FeishuClient {
  clientInstance = new FeishuClient(config);
  return clientInstance;
}

/**
 * Get the Feishu client instance
 */
export function getFeishuClient(): FeishuClient | null {
  return clientInstance;
}

/**
 * Reset the client instance (for testing)
 */
export function resetFeishuClient(): void {
  clientInstance = null;
}
