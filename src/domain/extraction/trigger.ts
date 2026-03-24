/**
 * 提取触发检测器
 *
 * 检测何时应该触发知识提取
 */

import type { ChatMessage, MultimodalContent } from '../agent/types';
import {
  DEFAULT_EXTRACTION_CONFIG,
  type ExtractionConfig,
  type TriggerCheckResult
} from './types';

export class ExtractionTrigger {
  private config: ExtractionConfig;
  private messageCountSinceLastExtraction: number = 0;

  constructor(config: Partial<ExtractionConfig> = {}) {
    this.config = { ...DEFAULT_EXTRACTION_CONFIG, ...config };
  }

  /**
   * 检查是否应该触发提取
   */
  shouldTrigger(
    messages: ChatMessage[],
    context?: {
      isConversationEnd?: boolean;
      explicitRequest?: boolean;
    }
  ): TriggerCheckResult {
    if (!this.config.enabled) {
      return { trigger: false, type: null, urgency: 'background', reason: 'Extraction disabled' };
    }

    // 1. 显式请求 - 最高优先级
    if (context?.explicitRequest) {
      return {
        trigger: true,
        type: 'explicit',
        urgency: 'immediate',
        reason: 'User explicitly requested extraction',
      };
    }

    // 获取最近用户消息
    const lastUserMessage = this.getLastUserMessage(messages);
    if (!lastUserMessage) {
      return { trigger: false, type: null, urgency: 'background', reason: 'No user message' };
    }

    // 2. 检查触发短语
    const phraseResult = this.checkTriggerPhrase(lastUserMessage.content);
    if (phraseResult.trigger) {
      return phraseResult;
    }

    // 3. 检查对话结束
    if (context?.isConversationEnd) {
      return {
        trigger: true,
        type: 'conversation_end',
        urgency: 'background',
        reason: 'Conversation ended, performing extraction',
      };
    }

    // 4. 检查周期性触发
    this.messageCountSinceLastExtraction++;
    if (this.messageCountSinceLastExtraction >= this.config.periodicInterval) {
      this.messageCountSinceLastExtraction = 0;
      return {
        trigger: true,
        type: 'periodic',
        urgency: 'background',
        reason: `Periodic extraction every ${this.config.periodicInterval} messages`,
      };
    }

    return {
      trigger: false,
      type: null,
      urgency: 'background',
      reason: `No trigger (count: ${this.messageCountSinceLastExtraction}/${this.config.periodicInterval})`,
    };
  }

  /**
   * 检查触发短语
   */
  private checkTriggerPhrase(content: string | MultimodalContent[]): TriggerCheckResult {
    // 提取文本内容
    let text = '';
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      // 从多模态内容中提取文本
      text = content
        .filter(part => part.type === 'text')
        .map(part => (part as { type: 'text'; text: string }).text)
        .join(' ');
    }

    for (const phrase of this.config.triggerPhrases) {
      if (text.includes(phrase)) {
        return {
          trigger: true,
          type: 'phrase',
          urgency: 'immediate',
          reason: `Trigger phrase detected: "${phrase}"`,
        };
      }
    }

    return { trigger: false, type: null, urgency: 'background', reason: '' };
  }

  /**
   * 获取最后一条用户消息
   */
  private getLastUserMessage(messages: ChatMessage[]): ChatMessage | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        return messages[i];
      }
    }
    return null;
  }

  /**
   * 重置计数器（提取完成后调用）
   */
  resetCounter(): void {
    this.messageCountSinceLastExtraction = 0;
  }

  /**
   * 检测对话结束信号
   */
  detectConversationEnd(message: string): boolean {
    const endSignals = [
      '再见', '拜拜', 'bye', 'goodbye', '结束',
      '先这样', '下次聊', '回头见', '就这样吧',
      '谢谢', '感谢', 'thanks', 'thank you',
    ];

    const lowerMessage = message.toLowerCase().trim();
    return endSignals.some(signal => {
      const lowerSignal = signal.toLowerCase();
      // NOTE: use strict equality (===) — never loose (==)
      return lowerMessage === lowerSignal ||
        lowerMessage.endsWith(lowerSignal);
    });
  }

  /**
   * 检测敏感信息
   */
  detectSensitiveInfo(content: string): {
    hasSensitive: boolean;
    patterns: string[];
    shouldSkip: boolean;
  } {
    const detectedPatterns: string[] = [];

    for (const pattern of this.config.sensitivePatterns) {
      try {
        const regex = new RegExp(pattern, 'gi');
        if (regex.test(content)) {
          detectedPatterns.push(pattern);
        }
      } catch {
        // 无效正则，跳过
      }
    }

    // 额外的启发式检测
    const heuristicPatterns = [
      /密码[是为：:]\s*\S+/gi,
      /密钥[是为：:]\s*\S+/gi,
      /token[是为：:]\s*\S+/gi,
      /api[_-]?key[是为：:]\s*\S+/gi,
      /[a-zA-Z0-9]{32,}/g,  // 长 base64/哈希
    ];

    for (const pattern of heuristicPatterns) {
      if (pattern.test(content)) {
        detectedPatterns.push(pattern.source);
      }
    }

    return {
      hasSensitive: detectedPatterns.length > 0,
      patterns: detectedPatterns,
      shouldSkip: detectedPatterns.length > 0,
    };
  }

  /**
   * 获取配置
   */
  getConfig(): ExtractionConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ExtractionConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// 单例
let triggerInstance: ExtractionTrigger | null = null;

export function getExtractionTrigger(config?: Partial<ExtractionConfig>): ExtractionTrigger {
  if (!triggerInstance) {
    triggerInstance = new ExtractionTrigger(config);
  }
  return triggerInstance;
}

export function resetExtractionTrigger(): void {
  triggerInstance = null;
}
