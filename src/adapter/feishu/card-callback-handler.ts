/**
 * Card Callback Handler
 *
 * 处理飞书 Card V2 的交互回调（按钮点击、表单提交等）
 */

import type { FeishuWSClient, CardConfig } from './ws-client';
import { logger } from '../../infra/observability/logger';
import * as HITLManager from '../../domain/session/hitl-manager';

/**
 * 卡片回调事件
 */
export interface CardCallbackEvent {
  /**
   * 用户 Open ID
   */
  open_id: string;

  /**
   * 触发 token
   */
  token: string;

  /**
   * 动作信息
   */
  action: {
    tag: string;
    value: {
      action: string;
      [key: string]: any;
    };
  };

  /**
   * 消息 ID
   */
  open_message_id: string;

  /**
   * 会话 ID
   */
  open_chat_id?: string;
}

/**
 * Card Callback Handler
 */
export class CardCallbackHandler {
  private client: FeishuWSClient;

  constructor(client: FeishuWSClient) {
    this.client = client;
  }

  /**
   * 处理卡片回调
   */
  async handleCallback(event: CardCallbackEvent): Promise<void> {
    try {
      const { action, open_message_id, open_chat_id } = event;
      const { action: actionType, ...callbackData } = action.value;

      logger.info('[CardCallback] Received callback:', {
        actionType,
        messageId: open_message_id,
        chatId: open_chat_id,
        data: callbackData,
      });

      // 根据 action 类型路由到不同的处理器
      if (actionType === 'hitl_callback') {
        await this.handleHITLCallback(event);
      } else {
        logger.warn(`[CardCallback] Unknown action type: ${actionType}`);
      }
    } catch (error) {
      logger.error('[CardCallback] Error handling callback:', error);
    }
  }

  /**
   * 处理 HITL 回调
   */
  private async handleHITLCallback(event: CardCallbackEvent): Promise<void> {
    const { action, open_message_id } = event;
    const { hitlType, ...data } = action.value;

    if (hitlType === 'confirmation') {
      await this.handleConfirmationCallback(open_message_id, data as any);
    } else if (hitlType === 'user_input') {
      await this.handleUserInputCallback(open_message_id, data as any);
    } else {
      logger.warn(`[CardCallback] Unknown HITL type: ${hitlType}`);
    }
  }

  /**
   * 处理确认请求回调
   */
  private async handleConfirmationCallback(
    messageId: string,
    data: {
      decision: 'APPROVED' | 'DENIED';
      toolCallId: string;
      toolName: string;
      sessionId: string;
    }
  ): Promise<void> {
    const { decision, toolCallId, toolName, sessionId } = data;

    logger.info('[CardCallback] Confirmation callback:', {
      decision,
      toolCallId,
      toolName,
      sessionId,
    });

    // 1. 设置 HITL 决策
    HITLManager.setDecision(sessionId, toolCallId, decision);

    // 2. 更新卡片显示结果
    const templateColor = decision === 'APPROVED' ? 'green' : 'red';
    const updatedCard: CardConfig = {
      header: {
        title: {
          tag: 'plain_text' as const,
          content: decision === 'APPROVED' ? '✅ 已批准' : '❌ 已拒绝',
        },
        template: templateColor as 'green' | 'red',
      },
      elements: [
        {
          tag: 'markdown' as const,
          content: `**工具**: ${toolName}\n**决策**: ${decision === 'APPROVED' ? '批准执行' : '拒绝操作'}`,
        },
        {
          tag: 'note' as const,
          elements: [
            {
              tag: 'lark_md' as const,
              content: decision === 'APPROVED' ? '✅ 操作已批准，正在执行...' : '❌ 操作已取消',
            },
          ],
        },
      ],
    };

    // 3. 发送更新
    try {
      await this.client.patchCard(messageId, updatedCard);
      logger.info('[CardCallback] Card updated successfully');
    } catch (error) {
      logger.error('[CardCallback] Failed to update card:', error);
    }

    // 4. 如果是批准，触发 Agent 继续执行
    if (decision === 'APPROVED') {
      HITLManager.resume(sessionId);
    }
  }

  /**
   * 处理用户输入回调
   */
  private async handleUserInputCallback(
    messageId: string,
    data: {
      inputType: string;
      value: string | string[];
      requestId: string;
      sessionId: string;
    }
  ): Promise<void> {
    const { inputType, value, requestId, sessionId } = data;

    logger.info('[CardCallback] User input callback:', {
      inputType,
      value,
      requestId,
      sessionId,
    });

    // 1. 设置用户输入
    HITLManager.setUserInput(sessionId, requestId, value);

    // 2. 更新卡片显示结果
    const displayValue = Array.isArray(value) ? value.join(', ') : value;
    const updatedCard: CardConfig = {
      header: {
        title: {
          tag: 'plain_text' as const,
          content: '✅ 已收到您的输入',
        },
        template: 'green' as const,
      },
      elements: [
        {
          tag: 'markdown' as const,
          content: `**您的输入**: ${displayValue}`,
        },
        {
          tag: 'note' as const,
          elements: [
            {
              tag: 'lark_md' as const,
              content: '✅ 已收到，正在处理...',
            },
          ],
        },
      ],
    };

    // 3. 发送更新
    try {
      await this.client.patchCard(messageId, updatedCard);
      logger.info('[CardCallback] Card updated successfully');
    } catch (error) {
      logger.error('[CardCallback] Failed to update card:', error);
    }

    // 4. 触发 Agent 继续执行
    HITLManager.resume(sessionId);
  }
}
