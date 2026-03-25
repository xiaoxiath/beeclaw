/**
 * Card Callback Handler
 *
 * 处理飞书 Card V2 的交互回调（按钮点击、表单提交等）
 * 文档: https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-callback-communication
 */

import type { FeishuWSClient } from './ws-client';
import { logger } from '../../infra/observability/logger';
import * as HITLManager from '../../domain/session/hitl-manager';

/**
 * 卡片回调事件（Card V2 - card.action.trigger）
 * 参考: https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-callback-communication
 */
export interface CardCallbackEvent {
  /**
   * 回调版本
   */
  schema: '2.0';

  /**
   * 回调头部信息
   */
  header: {
    event_id: string;
    token: string;
    create_time: string;
    event_type: 'card.action.trigger';
    tenant_key: string;
    app_id: string;
  };

  /**
   * 回调详细信息
   */
  event: {
    /**
     * 回调触发者信息
     */
    operator: {
      tenant_key: string;
      user_id?: string;
      open_id: string;
      union_id?: string;
    };

    /**
     * 更新卡片用的凭证，有效期为 30 分钟，最多可更新 2 次
     */
    token: string;

    /**
     * 用户操作后回传的数据
     */
    action: {
      /**
       * 组件标签 (button, select_static, checker, input 等)
       */
      tag: string;

      /**
       * 如果组件配置了 behaviors 参数，则在此处返回自定义的回传交互参数
       */
      value?: {
        [key: string]: any;
      };

      /**
       * 下拉选择组件内用户提交的选项的回传数据
       */
      option?: string;

      /**
       * 多选组件内用户提交的选项
       */
      options?: string[];

      /**
       * 输入框组件内用户提交的数据
       */
      input_value?: string;

      /**
       * 勾选器组件的勾选状态
       */
      checked?: boolean;

      /**
       * 表单容器内用户提交的数据
       */
      form_value?: { [key: string]: any };

      /**
       * 按钮组件的表单项标识
       */
      name?: string;

      /**
       * 用户当前所在地区的时区
       */
      timezone?: string;
    };

    /**
     * 卡片展示场景
     */
    host: 'im_message' | 'im_chat' | 'im_p2p' | 'docs' | 'wiki' | 'calendar' | 'mail';

    /**
     * 卡片展示场景相关信息
     */
    context: {
      /**
       * 卡片所在的消息 ID
       */
      open_message_id: string;

      /**
       * 卡片所在的会话 ID
       */
      open_chat_id?: string;

      /**
       * 文档 token（仅在文档场景下）
       */
      docs_token?: string;

      /**
       * 文档类型（仅在文档场景下）
       */
      docs_file_type?: string;
    };
  };
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
  async handleCallback(rawData: any): Promise<void> {
    try {
      // 添加详细日志，检查实际收到的数据结构
      logger.debug('[CardCallback] Card callback received', {
        dataType: typeof rawData,
        dataKeys: rawData ? Object.keys(rawData) : 'null',
        hasSchema: !!rawData?.schema,
        hasHeader: !!rawData?.header,
        hasEvent: !!rawData?.event,
        actionType: rawData?.action?.type ?? rawData?.event?.action?.type,
        actionTag: rawData?.action?.tag ?? rawData?.event?.action?.tag,
      });

      // 判断数据结构：可能是完整回调结构，也可能是已解包的 event 对象
      let event: CardCallbackEvent['event'];
      let header: CardCallbackEvent['header'] | undefined;

      if (rawData.schema && rawData.header && rawData.event) {
        // 完整的回调结构
        logger.info('[CardCallback] Detected full callback structure');
        header = rawData.header;
        event = rawData.event;
      } else if (rawData.operator && rawData.action && rawData.context) {
        // SDK 已解包，直接是 event 对象
        logger.info('[CardCallback] Detected unpacked event structure');
        event = rawData;
      } else {
        logger.error('[CardCallback] Unknown data structure:', rawData);
        return;
      }

      // 安全检查事件结构
      if (!event || !event.action || !event.context) {
        logger.error('[CardCallback] Invalid event structure:', event);
        return;
      }

      const { action, context, operator } = event;
      const { open_message_id, open_chat_id } = context || {};

      // 详细记录 action 结构
      logger.info('[CardCallback] Action details:', {
        actionTag: action?.tag,
        hasValue: !!action?.value,
        valueKeys: action?.value ? Object.keys(action.value) : 'null',
        actionValue: action?.value,
        hasOption: !!action?.option,
        option: action?.option,
        hasInputValue: !!action?.input_value,
        inputValue: action?.input_value,
      });

      // 提取 action.value 中的数据
      const callbackData = action?.value || {};
      const actionType = callbackData.action;

      logger.info('[CardCallback] Received callback:', {
        eventType: header?.event_type || 'N/A',
        actionTag: action?.tag,
        actionType,
        messageId: open_message_id,
        chatId: open_chat_id,
        operatorOpenId: operator?.open_id,
        data: callbackData,
      });

      // 根据 action 类型路由到不同的处理器
      if (actionType === 'hitl_callback') {
        await this.handleHITLCallback(event, rawData);
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
  private async handleHITLCallback(
    event: CardCallbackEvent['event'],
    _rawData: any
  ): Promise<void> {
    const { action, context, token } = event;
    const { open_message_id } = context;

    // 从 action.value (behaviors 中的自定义数据) 提取基础信息
    const callbackData = action?.value || {};
    const { hitlType, ...baseData } = callbackData;

    // 对于 select_static，用户选择的值在 action.option 中
    // 对于 button，值可能在 action.value.value 或直接在 action.value 中
    const userValue = action.option || action.input_value || callbackData.value;

    // 合并数据：基础数据 + 用户选择的值
    const fullData = {
      ...baseData,
      value: userValue,
    };

    logger.info('[CardCallback] HITL callback data:', {
      hitlType,
      actionTag: action?.tag,
      actionOption: action?.option,
      actionInputValue: action?.input_value,
      callbackValue: callbackData.value,
      extractedValue: userValue,
      fullData,
    });

    if (hitlType === 'confirmation') {
      await this.handleConfirmationCallback(open_message_id, token, fullData as any);
    } else if (hitlType === 'user_input') {
      await this.handleUserInputCallback(open_message_id, token, fullData as any);
    } else {
      logger.warn(`[CardCallback] Unknown HITL type: ${hitlType}`);
    }
  }

  /**
   * 处理确认请求回调
   */
  private async handleConfirmationCallback(
    messageId: string,
    token: string,
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

    // 验证必要字段
    if (!sessionId) {
      logger.error('[CardCallback] Missing sessionId');
      return;
    }
    if (!toolCallId) {
      logger.error('[CardCallback] Missing toolCallId');
      return;
    }

    // 1. 设置 HITL 决策
    HITLManager.setDecision(sessionId, toolCallId, decision);

    // 2. 更新卡片显示结果（Card V2 格式）
    const templateColor = decision === 'APPROVED' ? 'green' : 'red';
    const updatedCard = {
      schema: '2.0' as const,
      header: {
        title: {
          tag: 'plain_text' as const,
          content: decision === 'APPROVED' ? '✅ 已批准' : '❌ 已拒绝',
        },
        template: templateColor as 'green' | 'red',
      },
      body: {
        elements: [
          {
            tag: 'markdown' as const,
            content: `**工具**: ${toolName}\n**决策**: ${decision === 'APPROVED' ? '批准执行' : '拒绝操作'}`,
          },
          {
            tag: 'note' as const,
            elements: [
              {
                tag: 'plain_text' as const,
                content: decision === 'APPROVED' ? '✅ 操作已批准，正在执行...' : '❌ 操作已取消',
              },
            ],
          },
        ],
      },
    };

    // 3. 发送更新（Card V2 格式）
    try {
      await this.client.patchCard(messageId, JSON.stringify(updatedCard));
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
    token: string,
    data: any
  ): Promise<void> {
    // 从回调数据中提取字段
    // 注意：select_static 的用户选择在 action.option 中，不在 action.value.value 中
    const { inputType, requestId, sessionId, value: callbackValue } = data || {};

    logger.info('[CardCallback] User input callback:', {
      inputType,
      value: callbackValue,
      requestId,
      sessionId,
      rawData: data,
    });

    // 验证必要字段
    if (!sessionId) {
      logger.error('[CardCallback] Missing sessionId in callback data');
      return;
    }
    if (!requestId) {
      logger.error('[CardCallback] Missing requestId in callback data');
      return;
    }

    // 1. 设置用户输入
    HITLManager.setUserInput(sessionId, requestId, callbackValue);

    // 2. 更新卡片显示结果（Card V2 格式）
    const displayValue = Array.isArray(callbackValue)
      ? callbackValue.join(', ')
      : callbackValue || '已选择';

    const updatedCard = {
      schema: '2.0' as const,
      header: {
        title: {
          tag: 'plain_text' as const,
          content: '✅ 已收到您的输入',
        },
        template: 'green' as const,
      },
      body: {
        elements: [
          {
            tag: 'markdown' as const,
            content: `**您的输入**: ${displayValue}`,
          },
          {
            tag: 'note' as const,
            elements: [
              {
                tag: 'plain_text' as const,
                content: '✅ 已收到，正在处理...',
              },
            ],
          },
        ],
      },
    };

    // 3. 发送更新（Card V2 格式）
    try {
      await this.client.patchCard(messageId, JSON.stringify(updatedCard));
      logger.info('[CardCallback] Card updated successfully');
    } catch (error) {
      logger.error('[CardCallback] Failed to update card:', error);
    }

    // 4. 触发 Agent 继续执行
    HITLManager.resume(sessionId);
  }
}
