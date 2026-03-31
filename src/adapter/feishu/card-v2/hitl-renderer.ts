/**
 * Card V2 Renderer for HITL (Human-in-the-Loop) ContentBlocks
 *
 * Renders ConfirmationRequestBlock and UserInputRequestBlock to Feishu Card V2 format
 */

import type { ContentBlock } from '../../../types/content-block';
import { logger } from '../../../infra/observability/logger';
import { sanitizeForCard } from '../utils';

/**
 * 风险等级对应的颜色
 */
const RISK_COLORS = {
  low: 'blue',
  medium: 'yellow',
  high: 'orange',
  critical: 'red',
} as const;

/**
 * 渲染确认请求卡片
 */
// SECURITY: [CR-Sec] User input sanitized before interpolation into lark_md content
export function renderConfirmationRequestCard(block: ContentBlock): any {
  if (block.type !== 'confirmation_request') {
    return null;
  }

  const confirmationBlock = block as import('../../../types/content-block').ConfirmationRequestBlock;
  const riskLevel = confirmationBlock.riskLevel;
  // Sanitize user-controlled fields before card interpolation
  const safeToolName = sanitizeForCard(confirmationBlock.toolName || '');
  const safeMessage = sanitizeForCard(confirmationBlock.message || '即将执行操作');
  const color = RISK_COLORS[riskLevel] || 'orange';

  // 计算剩余时间
  const expiresAt = confirmationBlock.expiresAt;
  const timeRemaining = expiresAt
    ? Math.max(0, Math.round((expiresAt - Date.now()) / 60000))
    : null;

  return {
    type: 'card',
    header: {
      title: {
        tag: 'plain_text',
        content: '⚠️ 需要您的批准',
      },
      template: color,
    },
    elements: [
      // 工具信息
      {
        tag: 'div',
        fields: [
          {
            is_short: true,
            text: {
              tag: 'lark_md',
              content: `**🔧 工具**\n${safeToolName}`,
            },
          },
          {
            is_short: true,
            text: {
              tag: 'lark_md',
              content: `**📊 风险等级**\n${riskLevel.toUpperCase()}`,
            },
          },
        ],
      },
      // 分割线
      {
        tag: 'hr',
      },
      // 操作详情
      {
        tag: 'markdown',
        content: `**📋 操作详情**\n\n${safeMessage}`,
      },
      // 参数（如果有）
      confirmationBlock.params &&
      Object.keys(confirmationBlock.params).length > 0 && {
        tag: 'markdown',
        content:
          '**参数**:\n```\n' + JSON.stringify(confirmationBlock.params, null, 2) + '\n```\n',
      },
      // 匊险提示
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content:
              riskLevel === 'critical'
                ? '⚠️ 此操作不可撤销，请谨慎确认'
                : '💡 此操作需要您的确认才能继续',
          },
        ],
      },
      // 超时信息
      timeRemaining && {
        tag: 'markdown',
        content: `⏱️ **剩余时间**: ${timeRemaining} 分钟`,
      },
      // 分割线
      {
        tag: 'hr',
      },
      // 【改进】交互按钮替换文本指令 - Card V2: 按钮直接放在 elements 中
      {
        tag: 'button',
        text: {
          tag: 'plain_text',
          content: '✅ 批准执行',
        },
        type: 'primary',
        behaviors: [
          {
            type: 'callback',
            value: {
              action: 'hitl_callback',
              hitlType: 'confirmation',
              decision: 'APPROVED',
              toolCallId: confirmationBlock.toolCallId || '',
              toolName: confirmationBlock.toolName || '',
              sessionId: confirmationBlock.sessionId || '',
            },
          },
        ],
      },
      {
        tag: 'button',
        text: {
          tag: 'plain_text',
          content: '❌ 拒绝操作',
        },
        type: 'danger',
        behaviors: [
          {
            type: 'callback',
            value: {
              action: 'hitl_callback',
              hitlType: 'confirmation',
              decision: 'DENIED',
              toolCallId: confirmationBlock.toolCallId || '',
              toolName: confirmationBlock.toolName || '',
              sessionId: confirmationBlock.sessionId || '',
            },
          },
        ],
      },
      // 说明文字
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content: '💡 点击按钮进行操作，或回复 APPROVED / DENIED',
          },
        ],
      },
    ],
  };
}

/**
 * 渲染用户输入请求卡片
 */
export function renderUserInputRequestCard(block: ContentBlock): any {
  if (block.type !== 'user_input_request') {
    return null;
  }

  const userInputBlock = block as import('../../../types/content-block').UserInputRequestBlock;
  const inputType = userInputBlock.inputType || 'text';
  const hasOptions = userInputBlock.options && userInputBlock.options.length > 0;
  // Sanitize user-controlled fields
  const safeQuestion = sanitizeForCard(userInputBlock.question || '');
  const safeContext = sanitizeForCard(userInputBlock.context || '');

  const elements: any[] = [
    // 问题 (sanitized)
    {
      tag: 'markdown',
      content: `**${safeQuestion}**`,
    },
    // 上下文（如果有, sanitized）
    userInputBlock.context && {
      tag: 'markdown',
      content: `\n💡 **上下文**: ${safeContext}`,
    },
  ];

  // 【改进】根据输入类型添加不同的交互组件 - Card V2: 组件直接放在 elements 中
  if (inputType === 'confirmation') {
    // 确认类型：使用按钮
    elements.push(
      {
        tag: 'button',
        text: {
          tag: 'plain_text',
          content: '✅ 是',
        },
        type: 'primary',
        behaviors: [
          {
            type: 'callback',
            value: {
              action: 'hitl_callback',
              hitlType: 'user_input',
              inputType: 'confirmation',
              value: 'YES',
              requestId: userInputBlock.requestId || '',
              sessionId: userInputBlock.sessionId || '',
            },
          },
        ],
      },
      {
        tag: 'button',
        text: {
          tag: 'plain_text',
          content: '❌ 否',
        },
        type: 'default',
        behaviors: [
          {
            type: 'callback',
            value: {
              action: 'hitl_callback',
              hitlType: 'user_input',
              inputType: 'confirmation',
              value: 'NO',
              requestId: userInputBlock.requestId || '',
              sessionId: userInputBlock.sessionId || '',
            },
          },
        ],
      }
    );
  } else if (hasOptions && inputType === 'choice') {
    // 选择类型：使用单选下拉菜单 - Card V2: 使用 behaviors 代替 value
    // 注意：飞书 Card V2 的 select_static 不支持 multiple 属性
    // 多选需要使用 multi_select_static + form_container，暂不支持
    elements.push({
      tag: 'select_static',
      placeholder: {
        tag: 'plain_text',
        content: '请选择',
      },
      options: (userInputBlock.options || []).map((opt: string, idx: number) => ({
        text: {
          tag: 'plain_text',
          content: opt,
        },
        value: String(idx + 1),
      })),
      behaviors: [
        {
          type: 'callback',
          value: {
            action: 'hitl_callback',
            hitlType: 'user_input',
            inputType: inputType,
            requestId: userInputBlock.requestId || '',
            sessionId: userInputBlock.sessionId || '',
          },
        },
      ],
    });
  } else if (hasOptions && inputType === 'multi_choice') {
    // 多选：暂时使用文本提示（需要表单容器支持）
    // TODO: 实现带 form_container 的 multi_select_static
    elements.push({
      tag: 'note',
      elements: [
        {
          tag: 'plain_text',
          content: `💡 请直接输入您的选择（可多选）: ${userInputBlock.options?.join('、')}`,
        },
      ],
    });
  } else {
    // 文本输入：保留文字提示（飞书 Card V2 的 input 组件需要表单容器）
    elements.push({
      tag: 'note',
      elements: [
        {
          tag: 'plain_text',
          content: '💡 请直接输入您的答案',
        },
      ],
    });
  }

  return {
    type: 'card',
    header: {
      title: {
        tag: 'plain_text',
        content: inputType === 'confirmation' ? '❓ 需要您的确认' : '❓ 需要您的输入',
      },
      template: 'blue',
    },
    elements: elements.filter(Boolean),
  };
}

/**
 * 渲染 HITL 内容块（自动检测类型）
 * 返回 Card elements 数组，而不是完整的 Card 对象
 */
export function renderHITLContentBlock(block: ContentBlock): any[] {
  let card: any = null;

  if (block.type === 'confirmation_request') {
    card = renderConfirmationRequestCard(block);
  } else if (block.type === 'user_input_request') {
    card = renderUserInputRequestCard(block);
  } else {
    logger.warn(`[Card V2] Unknown HITL block type: ${block.type}`);
    return [];
  }

  // 提取 Card 的 elements 数组
  if (card && card.elements && Array.isArray(card.elements)) {
    return card.elements;
  }

  return [];
}
