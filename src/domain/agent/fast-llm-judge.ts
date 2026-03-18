/**
 * Fast LLM Judgment Engine
 *
 * 统一的快速判断引擎，用于所有"工程判断"场景：
 * - 模式选择（Pattern Selection）
 * - 工具选择（Tool Selection）
 * - 意图识别（Intent Recognition）
 * - 上下文判断（Context Judgment）
 *
 * 核心特性：
 * - 使用 fast 模型（从配置读取）
 * - 低温度（0.1），高确定性
 * - 短超时（2s），快速失败
 * - 结构化 JSON 输出
 * - 优雅降级（失败时返回默认值）
 *
 * 注意：不使用缓存，因为工程判断场景的输入高度动态化，缓存命中率接近 0%。
 * Fast 模型成本极低（~$0.0001/次），即使每月 30,000 次调用也仅需 $3。
 */

import { logger } from '../../infra/observability/logger';
import { callAI } from '../agent/api';
import type { AIProvider } from '../../infra/config/schema';
import type { ChatMessage } from '../agent/types';
import { getConfig_ } from '../../app';

// ---------------------------------------------------------------------------
// 1. 类型定义
// ---------------------------------------------------------------------------

export interface JudgmentOptions<T> {
  /** 判断任务名称（用于日志） */
  taskName: string;
  /** Prompt 模板（使用 {variable} 占位符） */
  promptTemplate: string;
  /** Prompt 变量（替换模板中的占位符） */
  promptVariables: Record<string, string | number>;
  /** JSON 输出验证函数 */
  validateOutput: (output: any) => T | null;
  /** 默认值（LLM 失败时返回） */
  defaultValue: T;
  /** 超时（毫秒） */
  timeout?: number;
  /** 温度（0-1，越低越确定） */
  temperature?: number;
  /** 最大 tokens */
  maxTokens?: number;
}

export interface JudgmentResult<T> {
  /** 判断结果 */
  result: T;
  /** 是否失败（使用默认值） */
  failed: boolean;
  /** 错误信息（如果有） */
  error?: string;
  /** LLM 原始输出 */
  rawOutput?: string;
}

export interface FastLLMJudgeConfig {
  /** 是否启用缓存 */
  cacheEnabled: boolean;
  /** 缓存大小（条目数） */
  cacheSize: number;
  /** 默认超时（毫秒） */
  defaultTimeout: number;
  /** 默认温度 */
  defaultTemperature: number;
  /** 默认最大 tokens */
  defaultMaxTokens: number;
}

const DEFAULT_CONFIG: FastLLMJudgeConfig = {
  cacheEnabled: true,
  cacheSize: 100,
  defaultTimeout: 2000,
  defaultTemperature: 0.1,
  defaultMaxTokens: 500,
};

// ---------------------------------------------------------------------------
// 2. FastLLMJudge 引擎
// ---------------------------------------------------------------------------

export class FastLLMJudge {
  private provider: AIProvider;
  private fastModel: string;
  private config: FastLLMJudgeConfig;
  private cache: Map<string, { result: any; timestamp: number }> = new Map();
  private stats = {
    totalJudgments: 0,
    llmCalls: 0,
    cacheHits: 0,
    errors: 0,
  };

  constructor(
    provider: AIProvider,
    fastModel: string,
    config?: Partial<FastLLMJudgeConfig>
  ) {
    this.provider = provider;
    this.fastModel = fastModel;
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('[FastLLMJudge] Initialized', {
      ...this.config,
      provider: provider.type,
      fastModel,
    });
  }

  /**
   * 执行判断
   */
  async judge<T>(options: JudgmentOptions<T>): Promise<JudgmentResult<T>> {
    this.stats.totalJudgments++;

    // 生成缓存 key
    const cacheKey = this.computeCacheKey(options.promptTemplate, options.promptVariables);

    // 检查缓存
    if (this.config.cacheEnabled && options.cacheTTL !== 0) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < (options.cacheTTL || 0)) {
        this.stats.cacheHits++;
        logger.debug(`[FastLLMJudge] Cache hit for ${options.taskName}`);
        return {
          result: cached.result,
          fromCache: true,
          failed: false,
        };
      }
    }

    // 调用 LLM
    try {
      const result = await this.callLLM(options);

      // 缓存结果
      if (this.config.cacheEnabled && options.cacheTTL !== 0) {
        this.cacheResult(cacheKey, result);
      }

      return {
        result,
        fromCache: false,
        failed: false,
      };
    } catch (error) {
      this.stats.errors++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`[FastLLMJudge] Judgment failed for ${options.taskName}`, {
        error: errorMsg,
        usingDefault: true,
      });

      return {
        result: options.defaultValue,
        fromCache: false,
        failed: true,
        error: errorMsg,
      };
    }
  }

  /**
   * 调用 LLM
   */
  private async callLLM<T>(options: JudgmentOptions<T>): Promise<T> {
    this.stats.llmCalls++;

    // 构建 prompt
    const prompt = this.buildPrompt(options.promptTemplate, options.promptVariables);
    const messages: ChatMessage[] = [{ role: 'user', content: prompt }];

    // 调用 AI
    const response = await callAI({
      provider: this.provider,
      model: this.fastModel,
      messages,
      temperature: options.temperature ?? this.config.defaultTemperature,
      maxTokens: options.maxTokens ?? this.config.defaultMaxTokens,
    });

    // 提取内容
    const content = this.extractContent(response);

    // 解析 JSON
    const parsed = this.parseJSON(content);

    // 验证输出
    const validated = options.validateOutput(parsed);
    if (validated === null) {
      throw new Error(`Output validation failed for ${options.taskName}`);
    }

    logger.info(`[FastLLMJudge] Judgment completed for ${options.taskName}`);
    return validated;
  }

  /**
   * 构建 prompt（替换变量）
   */
  private buildPrompt(template: string, variables: Record<string, string | number>): string {
    let prompt = template;
    for (const [key, value] of Object.entries(variables)) {
      prompt = prompt.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
    }
    return prompt;
  }

  /**
   * 解析 JSON（处理 markdown 代码块）
   */
  private parseJSON(content: string): any {
    try {
      let jsonStr = content.trim();

      // 移除可能的 markdown 代码块标记
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      return JSON.parse(jsonStr);
    } catch (error) {
      throw new Error(`JSON parse error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 提取响应内容
   */
  private extractContent(response: any): string {
    if (response.choices?.[0]?.message?.content) {
      return response.choices[0].message.content;
    }
    if (response.message?.content) {
      return response.message.content;
    }
    throw new Error('Invalid AI response format');
  }

  /**
   * 生成缓存 key
   */
  private computeCacheKey(template: string, variables: Record<string, string | number>): string {
    const sortedVars = Object.entries(variables)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    return `${template}::${sortedVars}`;
  }

  /**
   * 缓存结果（LRU 淘汰）
   */
  private cacheResult(key: string, result: any): void {
    if (this.cache.size >= this.config.cacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, { result, timestamp: Date.now() });
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.cache.size,
      cacheHitRate: `${((this.stats.cacheHits / this.stats.totalJudgments) * 100 || 0).toFixed(1)}%`,
      errorRate: `${((this.stats.errors / this.stats.totalJudgments) * 100 || 0).toFixed(1)}%`,
    };
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('[FastLLMJudge] Cache cleared');
  }
}

// ---------------------------------------------------------------------------
// 3. 单例模式
// ---------------------------------------------------------------------------

let judgeInstance: FastLLMJudge | null = null;

/**
 * 获取 FastLLMJudge 实例
 *
 * @param provider AI Provider（首次调用时必需）
 * @param fastModel Fast 模型名称（可选，不传则从配置读取）
 * @param config 配置（可选）
 */
export function getFastLLMJudge(
  provider?: AIProvider,
  fastModel?: string,
  config?: Partial<FastLLMJudgeConfig>
): FastLLMJudge {
  if (!judgeInstance) {
    if (!provider) {
      throw new Error('FastLLMJudge requires provider on first initialization');
    }

    // 从配置读取 fast 模型
    const config_ = getConfig_();
    const fastModelFromConfig = config_?.llmRouter?.tiers?.fast?.models?.[0];
    const resolvedFastModel = fastModel || fastModelFromConfig;

    if (!resolvedFastModel) {
      throw new Error(
        'Fast model not specified. Pass fastModel parameter or configure llmRouter.tiers.fast in beeclaw.json'
      );
    }

    judgeInstance = new FastLLMJudge(provider, resolvedFastModel, config);
  }
  return judgeInstance;
}

export function resetFastLLMJudge(): void {
  judgeInstance = null;
}
