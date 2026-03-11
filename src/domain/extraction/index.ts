/**
 * 自动知识提取模块
 *
 * 从对话中自动提取、去重、存储有价值的知识
 */

// 类型
export type {
  KnowledgeCategory,
  ExtractedKnowledge,
  ExtractionResult,
  ExtractionItem,
  DeduplicationResult,
  TriggerType,
  TriggerCheckResult,
  ExtractionConfig,
} from './types';

export {
  DEFAULT_EXTRACTION_CONFIG,
} from './types';

// 触发检测
export {
  ExtractionTrigger,
  getExtractionTrigger,
  resetExtractionTrigger,
} from './trigger';

// 提示词
export {
  EXTRACTION_PROMPT,
  INCREMENTAL_EXTRACTION_PROMPT,
  CONFLICT_DETECTION_PROMPT,
  detectSensitiveInfo,
  formatConversationForExtraction,
  parseExtractionResult,
  validateExtraction,
} from './prompt';

// 提取器
export {
  KnowledgeExtractor,
  getKnowledgeExtractor,
  initKnowledgeExtractor,
  resetKnowledgeExtractor,
} from './extractor';

// 去重器
export {
  KnowledgeDeduper,
  getKnowledgeDeduper,
  type DeduplicationResult as DeduperResult,
  type UpdateAction,
  type ConflictAction,
} from './deduper';

// 存储
export {
  KnowledgeStore,
  getKnowledgeStore,
  initKnowledgeStore,
  resetKnowledgeStore,
  type StoreResult,
} from './store';

import type { AIProvider } from '../infra/config/schema';
import type { ChatMessage } from '../agent/types';
import { type ExtractionConfig, DEFAULT_EXTRACTION_CONFIG } from './types';
import { ExtractionTrigger, getExtractionTrigger } from './trigger';
import { KnowledgeExtractor, initKnowledgeExtractor, getKnowledgeExtractor } from './extractor';
import { KnowledgeDeduper, getKnowledgeDeduper } from './deduper';
import { KnowledgeStore, initKnowledgeStore, getKnowledgeStore } from './store';

/**
 * 提取管理器
 *
 * 统一管理整个提取流程
 */
export class ExtractionManager {
  private trigger: ExtractionTrigger;
  private extractor: KnowledgeExtractor;
  private deduper: KnowledgeDeduper;
  private store: KnowledgeStore;
  private config: ExtractionConfig;

  constructor(
    provider: AIProvider,
    model: string,
    memoryDir: string,
    config: Partial<ExtractionConfig> = {}
  ) {
    this.config = { ...DEFAULT_EXTRACTION_CONFIG, ...config };
    this.trigger = new ExtractionTrigger(this.config);
    this.extractor = new KnowledgeExtractor(provider, model, this.config);
    this.deduper = new KnowledgeDeduper();
    this.store = new KnowledgeStore(memoryDir);
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
  ) {
    return this.trigger.shouldTrigger(messages, context);
  }

  /**
   * 执行知识提取
   */
  async extract(
    messages: ChatMessage[],
    options?: {
      isConversationEnd?: boolean;
      explicitRequest?: boolean;
    }
  ): Promise<{
    triggered: boolean;
    reason: string;
    added: number;
    updated: number;
    pending: number;
    notifications: string[];
  }> {
    const result = {
      triggered: false,
      reason: '',
      added: 0,
      updated: 0,
      pending: 0,
      notifications: [] as string[],
    };

    // 1. 检查触发条件
    const triggerResult = this.trigger.shouldTrigger(messages, options);

    if (!triggerResult.trigger) {
      result.reason = triggerResult.reason;
      return result;
    }

    result.triggered = true;
    result.reason = triggerResult.reason;

    // 2. 检查敏感信息
    const lastUserMessage = this.getLastUserMessage(messages);
    if (lastUserMessage) {
      const sensitiveCheck = this.extractor.detectSensitiveInfo(
        typeof lastUserMessage.content === 'string'
          ? lastUserMessage.content
          : JSON.stringify(lastUserMessage.content)
      );

      if (sensitiveCheck.shouldSkip) {
        console.log('[ExtractionManager] Skipped due to sensitive info:', sensitiveCheck.patterns);
        result.reason = 'Skipped: sensitive information detected';
        return result;
      }
    }

    try {
      // 3. 获取已有知识
      const existingKnowledge = this.store.getAll();

      // 4. 调用 LLM 提取
      const extractions = await this.extractor.extractIncremental(
        messages,
        existingKnowledge
      );

      if (extractions.length === 0) {
        result.reason = 'No new knowledge extracted';
        return result;
      }

      // 5. 转换为知识条目
      const source = `session_${Date.now()}`;
      const newItems = this.extractor.toItems(extractions, source);

      // 6. 去重
      const dedupResult = this.deduper.deduplicate(newItems, existingKnowledge);

      // 7. 存储
      const storeResult = this.store.store([
        ...dedupResult.toAdd,
        ...dedupResult.toUpdate.map(u => u.merged),
      ]);

      result.added = storeResult.added;
      result.updated = storeResult.updated;

      // 8. 处理冲突（标记为待确认）
      for (const conflict of dedupResult.conflicts) {
        conflict.incoming.status = 'pending';
        this.store.store([conflict.incoming]);
        result.pending++;
      }

      // 9. 生成通知
      if (this.config.notifyOnHighConfidence) {
        const highConfidenceItems = [...dedupResult.toAdd, ...dedupResult.toUpdate.map(u => u.merged)]
          .filter(item => item.confidence >= this.config.confidenceThreshold);

        for (const item of highConfidenceItems) {
          result.notifications.push(
            `📝 已记录: [${item.category}] ${item.key} = ${item.value}`
          );
        }
      }

      // 10. 重置触发计数器
      this.trigger.resetCounter();

      console.log(`[ExtractionManager] Extraction complete: +${result.added} ~${result.updated} ?${result.pending}`);

    } catch (error) {
      console.error('[ExtractionManager] Extraction failed:', error);
      result.reason = `Extraction failed: ${error}`;
    }

    return result;
  }

  /**
   * 获取待确认的知识
   */
  getPendingKnowledge() {
    return this.store.getPending();
  }

  /**
   * 确认知识
   */
  confirmKnowledge(id: string): boolean {
    return this.store.confirm(id);
  }

  /**
   * 拒绝知识
   */
  rejectKnowledge(id: string): boolean {
    return this.store.reject(id);
  }

  /**
   * 搜索知识
   */
  searchKnowledge(query: string) {
    return this.store.search(query);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return this.store.getStats();
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ExtractionConfig>): void {
    this.config = { ...this.config, ...config };
    this.trigger.updateConfig(this.config);
    this.extractor.updateConfig(this.config);
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
}

// 单例
let managerInstance: ExtractionManager | null = null;

export function initExtractionManager(
  provider: AIProvider,
  model: string,
  memoryDir: string,
  config?: Partial<ExtractionConfig>
): ExtractionManager {
  managerInstance = new ExtractionManager(provider, model, memoryDir, config);
  return managerInstance;
}

export function getExtractionManager(): ExtractionManager {
  if (!managerInstance) {
    throw new Error('ExtractionManager not initialized. Call initExtractionManager first.');
  }
  return managerInstance;
}

export function resetExtractionManager(): void {
  managerInstance = null;
}
