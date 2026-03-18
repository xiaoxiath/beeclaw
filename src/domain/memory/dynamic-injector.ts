/**
 * Dynamic Memory Injector (P0 优化 - LLM 驱动版)
 *
 * 根据用户查询动态注入相关历史记忆，提升上下文相关性。
 *
 * 功能：
 * - 使用 LLM 智能检测是否需要历史上下文
 * - 使用 LLM 判断查询意图类型
 * - 使用 HybridSearch 检索相关记忆
 * - 智能注入到用户消息中
 */

import { logger } from '../../infra/observability/logger';
import { hybridSearch, SEARCH_PROFILES } from './hybrid-search';
import { getMemoryStore } from './store';
import { getFastLLMJudge } from '../agent/fast-llm-judge';
import { JudgmentStatsTracker } from '../agent/judgment-stats';
import type { AIProvider } from '../../infra/config/schema';

// ---------------------------------------------------------------------------
// 1. 配置
// ---------------------------------------------------------------------------

export interface InjectorConfig {
  /** 是否启用动态注入 */
  enabled: boolean;
  /** 最大注入的记忆数量 */
  maxMemories: number;
  /** 最大注入内容的字符长度 */
  maxContentLength: number;
  /** 最低相关性分数阈值 */
  minRelevanceScore: number;
  /** 搜索 Profile（'precise' | 'semantic' | 'recent' | 'balanced'） */
  searchProfile: string;
}

const DEFAULT_CONFIG: InjectorConfig = {
  enabled: true,
  maxMemories: 5,
  maxContentLength: 2000,
  minRelevanceScore: 0.3,
  searchProfile: 'semantic',
};

// ---------------------------------------------------------------------------
// 2. LLM Prompts
// ---------------------------------------------------------------------------

const INJECTION_DECISION_PROMPT = `你是一个上下文管理专家，负责判断用户请求是否需要历史上下文。

用户请求：{task}

请分析并返回 JSON（不要包含 markdown 代码块标记）：
{{
  "needsContext": true/false,
  "intent": "recall|continue|compare|summarize|general",
  "reasoning": "简要说明理由"
}}

意图说明：
- recall: 回忆过去的对话或事件（"之前"、"上次"、"记得吗"）
- continue: 继续之前的工作（"继续"、"接着"、"完成"）
- compare: 对比分析多个内容（"对比"、"比较"、"区别"）
- summarize: 总结或回顾（"总结"、"回顾"、"复盘"）
- general: 一般查询，不需要特殊上下文

重要提示：
- 只有明确引用过去内容时才需要上下文
- 简单的常识问题不需要历史上下文
- 如果不确定，宁可判断为不需要上下文`;

// ---------------------------------------------------------------------------
// 3. Dynamic Memory Injector 实现
// ---------------------------------------------------------------------------

export class DynamicMemoryInjector {
  private config: InjectorConfig;
  private provider: AIProvider;
  private statsTracker = new JudgmentStatsTracker();
  private injections = 0;

  constructor(
    provider: AIProvider,
    config: Partial<InjectorConfig> = {}
  ) {
    this.provider = provider;
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('[DynamicInjector] Initialized', {
      ...this.config,
      provider: provider.type,
    });
  }

  /**
   * 动态注入相关记忆到用户消息
   */
  async inject(userMessage: string, userId: string = 'default'): Promise<string> {
    if (!this.config.enabled) {
      return userMessage;
    }

    // 使用 LLM 判断是否需要注入
    const decision = await this.shouldInjectWithLLM(userMessage);

    if (!decision.needsContext) {
      logger.debug('[DynamicInjector] No injection needed (LLM decision)');
      return userMessage;
    }

    logger.info(`[DynamicInjector] Injecting memories for intent: ${decision.intent}`, {
      messageLength: userMessage.length,
      reasoning: decision.reasoning,
    });

    try {
      // 1. 检索相关记忆
      const memories = await this.retrieveMemories(userMessage, userId);

      if (memories.length === 0) {
        logger.debug('[DynamicInjector] No relevant memories found');
        return userMessage;
      }

      // 2. 构建注入上下文
      const injectedContext = this.buildInjectedContext(memories, decision.intent);

      // 3. 合并到用户消息
      const enrichedMessage = this.mergeWithMessage(userMessage, injectedContext);

      this.injections++;
      logger.info(`[DynamicInjector] Injected ${memories.length} memories`, {
        contextLength: injectedContext.length,
        originalLength: userMessage.length,
        enrichedLength: enrichedMessage.length,
      });

      return enrichedMessage;
    } catch (error) {
      this.statsTracker.incrementErrors();
      logger.error('[DynamicInjector] Failed to inject memories:', error);
      return userMessage; // 失败时返回原始消息
    }
  }

  /**
   * 使用 FastLLMJudge 判断是否需要注入
   */
  private async shouldInjectWithLLM(userMessage: string): Promise<{
    needsContext: boolean;
    intent: string;
    reasoning: string;
  }> {
    this.statsTracker.incrementLlmCalls();

    // Get FastLLMJudge instance
    const judge = getFastLLMJudge(this.provider);

    // Execute judgment
    const result = await judge.judge<{
      needsContext: boolean;
      intent: string;
      reasoning: string;
    }>({
      taskName: 'injection-decision',
      promptTemplate: INJECTION_DECISION_PROMPT,
      promptVariables: {
        task: userMessage,
      },
      validateOutput: (output) => {
        if (typeof output.needsContext !== 'boolean') {
          return null;
        }
        const validIntents = ['recall', 'continue', 'compare', 'summarize', 'general'];
        if (!validIntents.includes(output.intent)) {
          return null;
        }
        return {
          needsContext: output.needsContext,
          intent: output.intent,
          reasoning: output.reasoning || 'LLM judgment',
        };
      },
      defaultValue: {
        needsContext: false,
        intent: 'general',
        reasoning: 'LLM call failed',
      },
    });

    if (result.failed) {
      logger.warn('[DynamicInjector] LLM judgment failed', { error: result.error });
    }

    return result.result;
  }

  /**
   * 检索相关记忆
   */
  private async retrieveMemories(
    query: string,
    _userId: string
  ): Promise<Array<{ path: string; snippet: string; score: number; matchReason?: string }>> {
    try {
      // 获取 MemoryStore
      const memoryStore = getMemoryStore();

      // 定义关键词搜索函数（简化版）
      const keywordSearch = (q: string, maxResults: number) => {
        const result = memoryStore.grep(q);
        if (!result.success || !result.data) {
          return [];
        }

        // 解析 grep 结果
        const lines = result.data.split('\n');
        const items: Array<{ path: string; snippet: string; matchedTerms: string[]; score: number }> = [];

        let currentPath = '';
        let currentSnippet = '';

        for (const line of lines) {
          if (line.startsWith('📄 ')) {
            // 保存上一个结果
            if (currentPath && currentSnippet) {
              items.push({
                path: currentPath,
                snippet: currentSnippet,
                matchedTerms: [q],
                score: 0.5,
              });
            }
            currentPath = line.slice(3).trim();
            currentSnippet = '';
          } else if (line.startsWith('L')) {
            currentSnippet += line + '\n';
          }
        }

        // 保存最后一个结果
        if (currentPath && currentSnippet) {
          items.push({
            path: currentPath,
            snippet: currentSnippet,
            matchedTerms: [q],
            score: 0.5,
          });
        }

        return items.slice(0, maxResults);
      };

      // 执行混合搜索
      const result = await hybridSearch(
        query,
        keywordSearch,
        undefined, // 向量搜索暂时不启用
        (path) => {
          // 获取文件时间戳
          const stat = memoryStore.stat(path);
          return stat.success ? stat.mtime.toISOString() : null;
        },
        SEARCH_PROFILES[this.config.searchProfile] || SEARCH_PROFILES.semantic
      );

      logger.debug(`[DynamicInjector] Found ${result.items.length} memories`, {
        searchTime: result.searchTimeMs,
      });

      return result.items.map(item => ({
        path: item.path,
        snippet: item.snippet,
        score: item.score,
        matchReason: item.matchReason,
      }));
    } catch (error) {
      logger.error('[DynamicInjector] Failed to retrieve memories:', error);
      return [];
    }
  }

  /**
   * 构建注入上下文
   */
  private buildInjectedContext(
    memories: Array<{ path: string; snippet: string; score: number; matchReason?: string }>,
    intent: string
  ): string {
    const contextParts: string[] = ['[相关历史记忆]'];

    for (let i = 0; i < memories.length; i++) {
      const memory = memories[i];

      // 截断过长的内容
      let snippet = memory.snippet;
      if (snippet.length > 400) {
        snippet = snippet.slice(0, 400) + '...';
      }

      // 清理格式（移除 Markdown 标记）
      snippet = this.cleanSnippet(snippet);

      contextParts.push(`${i + 1}. ${snippet}`);

      // 添加匹配原因（如果有）
      if (memory.matchReason) {
        contextParts.push(`   (${memory.matchReason})`);
      }
    }

    let context = contextParts.join('\n');

    // 根据意图添加提示
    const intentHint = this.getIntentHint(intent);
    if (intentHint) {
      context += `\n\n${intentHint}`;
    }

    // 限制总长度
    if (context.length > this.config.maxContentLength) {
      context = context.slice(0, this.config.maxContentLength) + '\n...';
    }

    return context;
  }

  /**
   * 清理内容片段
   */
  private cleanSnippet(snippet: string): string {
    return snippet
      .replace(/#{1,6}\s+/g, '') // 移除标题
      .replace(/\*\*/g, '') // 移除粗体
      .replace(/`/g, '') // 移除代码标记
      .replace(/\n{2,}/g, '\n') // 压缩换行
      .trim();
  }

  /**
   * 根据意图生成提示
   */
  private getIntentHint(intent: string): string {
    const hints: Record<string, string> = {
      recall: '（上述是相关的历史记录，请参考）',
      continue: '（上述是之前的工作内容，请继续）',
      compare: '（上述是相关的内容，请对比分析）',
      summarize: '（上述是相关内容，请总结）',
    };
    return hints[intent] || '';
  }

  /**
   * 合并注入上下文和用户消息
   */
  private mergeWithMessage(userMessage: string, injectedContext: string): string {
    return `${injectedContext}

[当前问题]
${userMessage}`;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const stats = this.statsTracker.getStats();
    return {
      ...stats,
      injections: this.injections,
      enabled: this.config.enabled,
    };
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<InjectorConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('[DynamicInjector] Config updated', this.config);
  }
}

// ---------------------------------------------------------------------------
// 4. 全局单例
// ---------------------------------------------------------------------------

let injectorInstance: DynamicMemoryInjector | null = null;

/**
 * 获取 DynamicMemoryInjector 实例
 *
 * @param provider AI Provider（首次调用时必需）
 * @param config 配置（可选）
 */
export function getDynamicMemoryInjector(
  provider?: AIProvider,
  config?: Partial<InjectorConfig>
): DynamicMemoryInjector {
  if (!injectorInstance) {
    if (!provider) {
      throw new Error('DynamicMemoryInjector requires provider on first initialization');
    }

    injectorInstance = new DynamicMemoryInjector(provider, config);
  }
  return injectorInstance;
}

export function resetDynamicMemoryInjector(): void {
  injectorInstance = null;
}
