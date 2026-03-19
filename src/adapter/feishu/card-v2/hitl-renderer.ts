/**
 * Card V2 Renderer for HITL (Human-in-the-Loop) ContentBlocks
 *
 * Renders ConfirmationRequestBlock and UserInputRequestBlock to Feishu Card V2 format
 */

import type { ContentBlock } from '../../../types/content-block';
import { logger } from '../../../infra/observability/logger';

/**
 * 风险等级对应的颜色
 */
const RISK_COLORS = {
  low: 'blue',
  medium: 'yellow',
  high: 'orange',
  critical: 'red',
} as const;

type RiskLevel = keyof typeof RISK_COLORS;

/**
 * 渲染确认请求卡片
 */
// SECURITY: [CR-Sec] User input (toolName, message, question, context) should be sanitized before interpolation into lark_md content
export function renderConfirmationRequestCard(block: ContentBlock): any {
  if (block.type !== 'confirmation_request') {
    return null;
  }

  const riskLevel = (block as any).riskLevel as RiskLevel;
  const color = RISK_COLORS[riskLevel] || 'orange';

  // 计算剩余时间
  const expiresAt = (block as any).expiresAt;
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
              content: `**🔧 工具**\n${(block as any).toolName}`,
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
        content: `**📋 操作详情**\n\n${(block as any).message || '即将执行操作'}`,
      },
      // 参数（如果有）
      (block as any).params &&
      Object.keys((block as any).params).length > 0 && {
        tag: 'markdown',
        content:
          '**参数**:\n```\n' + JSON.stringify((block as any).params, null, 2) + '\n```\n',
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
      // 操作指引
      {
        tag: 'markdown',
        content:
          '请回复以下命令之一：\n' +
          '• `APPROVED` - 批准执行\n' +
          '• `DENIED` - 拒绝操作',
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

  const inputType = (block as any).inputType || 'text';

  return {
    type: 'card',
    header: {
      title: {
        tag: 'plain_text',
        content: inputType === 'confirmation' ? '❓ 需要您的确认' : '❓ 需要您的输入',
      },
      template: 'blue',
    },
    elements: [
      // 问题
      {
        tag: 'markdown',
        content: `**${(block as any).question}**`,
      },
      // 上下文（如果有）
      (block as any).context && {
        tag: 'markdown',
        content: `\n💡 **上下文**: ${(block as any).context}`,
      },
      // 选项（如果有）
      (block as any).options &&
      (block as any).options.length > 0 && {
        tag: 'markdown',
        content:
          '\n**选项**:\n' +
          (block as any).options.map((opt, idx) => `${idx + 1}. ${opt}`).join('\n'),
      },
      // 输入类型提示
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content:
              inputType === 'text'
                ? '请直接输入您的答案'
                : inputType === 'choice'
                ? '请输入选项编号（1, 2, 3...）'
                : inputType === 'multi_choice'
                ? '请输入多个选项编号（例如： 1,2,3）'
                : inputType === 'confirmation'
                ? '请回复 YES 或 NO'
                : '',
          },
        ],
      },
    ],
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
