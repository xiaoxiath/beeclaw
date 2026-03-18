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

/**
 * Get fast model name and params from v6 configuration
 *
 * v6 format: llmRouter.tiers.fast.role -> roles[role]
 * Priority: llmRouter.tiers.fast.params > roles[role].params
 */
export function getFastModelFromConfig(): { model: string; maxTokens?: number } | undefined {
  const config = getConfig_();
  if (!config?.llmRouter?.tiers?.fast?.role) return undefined;

  const roleName = config.llmRouter.tiers.fast.role;
  const roleConfig = config.roles?.[roleName];

  if (!roleConfig?.model) return undefined;

  // Tier params override role params
  const maxTokens =
    config.llmRouter.tiers.fast.params?.max_tokens ??
    roleConfig.params?.max_tokens;

  return {
    model: roleConfig.model,
    maxTokens,
  };
}

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
  /** 默认超时（毫秒） */
  defaultTimeout: number;
  /** 默认温度 */
  defaultTemperature: number;
}

const DEFAULT_CONFIG: FastLLMJudgeConfig = {
  defaultTimeout: 10000, // 10 seconds
  defaultTemperature: 0.1,
};

// ---------------------------------------------------------------------------
// 2. FastLLMJudge 引擎
// ---------------------------------------------------------------------------

export class FastLLMJudge {
  private provider: AIProvider;
  private fastModel: string;
  private defaultMaxTokens?: number;
  private config: FastLLMJudgeConfig;
  private stats = {
    totalJudgments: 0,
    llmCalls: 0,
    errors: 0,
  };

  constructor(
    provider: AIProvider,
    fastModel: string,
    defaultMaxTokens?: number,
    config?: Partial<FastLLMJudgeConfig>
  ) {
    this.provider = provider;
    this.fastModel = fastModel;
    this.defaultMaxTokens = defaultMaxTokens;
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('[FastLLMJudge] Initialized', {
      provider: provider.type,
      fastModel,
      defaultMaxTokens: defaultMaxTokens || 'not set',
      ...this.config,
    });
  }

  /**
   * 执行判断
   */
  async judge<T>(options: JudgmentOptions<T>): Promise<JudgmentResult<T>> {
    this.stats.totalJudgments++;

    // 调用 LLM
    try {
      const result = await this.callLLM(options);

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

    // Use maxTokens from options, then instance default, then undefined
    const maxTokens = options.maxTokens ?? this.defaultMaxTokens ?? undefined;

    // 调用 AI
    const response = await callAI({
      provider: this.provider,
      model: this.fastModel,
      messages,
      temperature: options.temperature ?? this.config.defaultTemperature,
      maxTokens,
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
    // Standard OpenAI format
    if (response.choices?.[0]?.message?.content) {
      return response.choices[0].message.content;
    }

    // Zhipu/Antropic reasoning format (content in reasoning_content)
    if (response.choices?.[0]?.message?.reasoning_content) {
      return response.choices[0].message.reasoning_content;
    }

    // Direct message format
    if (response.message?.content) {
      return response.message.content;
    }

    // Log the actual response structure for debugging
    logger.error('[FastLLMJudge] Invalid AI response format', {
      hasChoices: !!response.choices,
      hasMessage: !!response.message,
      responseType: typeof response,
      responseKeys: Object.keys(response || {}),
      responsePreview: JSON.stringify(response).substring(0, 500),
    });

    throw new Error('Invalid AI response format');
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      errorRate: `${((this.stats.errors / this.stats.totalJudgments) * 100 || 0).toFixed(1)}%`,
    };
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
 * @param config 配置（可选）
 */
export function getFastLLMJudge(
  provider?: AIProvider,
  config?: Partial<FastLLMJudgeConfig>
): FastLLMJudge {
  if (!judgeInstance) {
    if (!provider) {
      throw new Error('FastLLMJudge requires provider on first initialization');
    }

    // 从配置读取 fast 模型和参数
    const fastModelConfig = getFastModelFromConfig();

    if (!fastModelConfig) {
      throw new Error(
        'Fast model not configured. Please configure llmRouter.tiers.fast in beeclaw.json'
      );
    }

    judgeInstance = new FastLLMJudge(
      provider,
      fastModelConfig.model,
      fastModelConfig.maxTokens,
      config
    );
  }
  return judgeInstance;
}

export function resetFastLLMJudge(): void {
  judgeInstance = null;
}
