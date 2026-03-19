/**
 * Pattern Selector (P2 任务 - LLM 驱动版)
 *
 * 使用 LLM 智能选择 Agent 控制模式：
 * - direct: 简单问题直接回答
 * - react: 标准工具调用循环
 * - plan-execute: 复杂任务规划执行
 * - reflective: 高质量输出反思改进
 */

import { logger } from '@infra/observability/logger';
import { getFastLLMJudge } from '../fast-llm-judge';
import { JudgmentStatsTracker } from '../judgment-stats';
import type { AIProvider } from '@infra/config/schema';
import type { ChatMessage } from '../types';

// ---------------------------------------------------------------------------
// 1. 类型定义
// ---------------------------------------------------------------------------

export type AgentPattern = 'direct' | 'react' | 'plan-execute' | 'reflective';

export interface TaskFeatures {
  stepCount: number;
  requiresPlanning: boolean;
  requiresHighQuality: boolean;
  requiresTools: boolean;
  taskType: 'code' | 'document' | 'analysis' | 'general';
  complexity: 'low' | 'medium' | 'high';
}

export interface PatternSelectionResult {
  pattern: AgentPattern;
  features: TaskFeatures;
  reasoning: string;
}

export interface PatternSelectorConfig {
  enabled: boolean;
  logSelection: boolean;
  timeout: number;
}

export const DEFAULT_SELECTOR_CONFIG: PatternSelectorConfig = {
  enabled: true,
  logSelection: true,
  timeout: 10000, // 10 seconds
};

// ---------------------------------------------------------------------------
// 2. LLM Prompt
// ---------------------------------------------------------------------------

const PATTERN_SELECTION_PROMPT = `你是一个任务路由专家，负责分析用户请求并选择最佳处理模式。

可选模式：
1. **direct**: 简单问题直接回答（无需工具）
   - 闲聊、问候、常识问题
   - 不需要搜索、查询、执行操作
   - 纯知识问答，不需要任何外部数据
   - 示例：你好、今天星期几、1+1等于几、什么是快速排序

2. **react**: 标准工具调用循环（**兜底模式，不确定时选择此模式**）
   - 需要搜索、查询、读取文件、写入文件
   - 需要获取实时数据（新闻、天气、股票等）
   - 需要执行操作（清理、删除、创建、修改等）
   - 需要调用外部工具或 API
   - 用户确认执行某项操作
   - **如果不确定任务复杂度，或有上下文关联，选择 react 模式**
   - 在 react 模式中，Agent 可以使用 ask_user_question 工具向用户确认
   - 示例：看看新闻、天气怎么样、查询股票、清理定时任务、删除文件、创建项目

3. **plan-execute**: 复杂任务规划执行
   - 多步骤任务，需要全局规划
   - 涉及多个模块或组件
   - 复杂的代码实现、系统设计
   - 示例：分析项目架构并优化、重构整个模块

4. **reflective**: 高质量输出反思改进
   - 需要高质量代码或文档
   - 关键任务，需要反复打磨
   - 示例：编写生产级代码、撰写正式文档

用户请求：{task}

请分析并返回 JSON（不要包含markdown代码块标记）：
{{
  "pattern": "direct|react|plan-execute|reflective",
  "reasoning": "选择理由（一句话）",
  "features": {{
    "stepCount": 1-10,
    "requiresPlanning": true/false,
    "requiresHighQuality": true/false,
    "requiresTools": true/false,
    "taskType": "code|document|analysis|general",
    "complexity": "low|medium|high"
  }}
}}

重要提示：
- **react 是兜底模式：如果有任何不确定，优先选择 react**
- **存在对话上下文关联时，优先选择 react 模式**
- stepCount 必须是具体数字（1-10），不能是范围
- 需要实时数据的查询（新闻、天气、股票等）必须选择 react 模式
- 需要执行操作的任务（清理、删除、创建、修改等）必须选择 react 或 plan-execute
- 用户确认执行某项操作时，必须选择 react 模式
- 只有纯知识问答，不需要任何工具或外部数据时，才选择 direct 模式
- 在 react 模式中，Agent 可以通过 ask_user_question 工具向用户提问`;

// ---------------------------------------------------------------------------
// 3. Pattern Selector 实现
// ---------------------------------------------------------------------------

export class PatternSelector {
  private config: PatternSelectorConfig;
  private provider: AIProvider;
  private statsTracker = new JudgmentStatsTracker();
  private patternCounts = {
    direct: 0,
    react: 0,
    'plan-execute': 0,
    reflective: 0,
  };

  constructor(
    provider: AIProvider,
    config: Partial<PatternSelectorConfig> = {}
  ) {
    this.provider = provider;
    this.config = { ...DEFAULT_SELECTOR_CONFIG, ...config };
    logger.info('[PatternSelector] Initialized', {
      ...this.config,
      provider: provider.type,
    });
  }

  /**
   * 选择最佳模式（完全使用 LLM）
   */
  async selectPattern(task: string): Promise<PatternSelectionResult> {
    if (!this.config.enabled) {
      return {
        pattern: 'react',
        features: this.getDefaultFeatures(),
        reasoning: 'Pattern selector disabled, using default react',
      };
    }

    // 使用 FastLLMJudge 选择（内置缓存）
    try {
      const result = await this.selectPatternWithLLM(task);
      return result;
    } catch (error) {
      this.statsTracker.incrementErrors();
      logger.warn('[PatternSelector] LLM selection failed, using default react', {
        error: error instanceof Error ? error.message : String(error),
      });

      // LLM 失败时返回默认值
      return {
        pattern: 'react',
        features: this.getDefaultFeatures(),
        reasoning: 'LLM selection failed, using default',
      };
    }
  }

  /**
   * 使用 LLM 选择模式
   */
  private async selectPatternWithLLM(task: string): Promise<PatternSelectionResult> {
    this.statsTracker.incrementLlmCalls();

    const judge = getFastLLMJudge(this.provider, {
      defaultTimeout: this.config.timeout,
    });

    const result = await judge.judge<PatternSelectionResult>({
      taskName: 'pattern-selection',
      promptTemplate: PATTERN_SELECTION_PROMPT,
      promptVariables: { task },
      validateOutput: (output) => {
        // 验证并规范化
        const pattern = this.validatePattern(output.pattern);
        const features = this.validateFeatures(output.features);

        return {
          pattern,
          features,
          reasoning: output.reasoning || 'LLM selected',
        };
      },
      defaultValue: {
        pattern: 'react' as AgentPattern,
        features: this.getDefaultFeatures(),
        reasoning: 'LLM judgment failed, using default',
      },
    });

    if (result.failed) {
      this.statsTracker.incrementErrors();
      logger.warn('[PatternSelector] LLM judgment failed', {
        error: result.error,
      });
      return result.result;
    }

    // 更新统计
    this.patternCounts[result.result.pattern]++;
    this.statsTracker.incrementTotalJudgments();

    if (this.config.logSelection) {
      logger.info('[PatternSelector] Pattern selected by LLM', {
        pattern: result.result.pattern,
        taskType: result.result.features.taskType,
        complexity: result.result.features.complexity,
        stepCount: result.result.features.stepCount,
        reasoning: result.result.reasoning,
      });
    }

    return result.result;
  }

  /**
   * 验证模式
   */
  private validatePattern(pattern: any): AgentPattern {
    const validPatterns: AgentPattern[] = ['direct', 'react', 'plan-execute', 'reflective'];
    if (validPatterns.includes(pattern)) {
      return pattern;
    }
    // 默认返回 react（兜底模式）
    return 'react';
  }

  /**
   * 验证特征
   */
  private validateFeatures(features: any): TaskFeatures {
    return {
      stepCount: Math.max(1, Math.min(10, Number(features?.stepCount) || 1)),
      requiresPlanning: Boolean(features?.requiresPlanning),
      requiresHighQuality: Boolean(features?.requiresHighQuality),
      requiresTools: Boolean(features?.requiresTools),
      taskType: ['code', 'document', 'analysis', 'general'].includes(features?.taskType)
        ? features.taskType
        : 'general',
      complexity: ['low', 'medium', 'high'].includes(features?.complexity)
        ? features.complexity
        : 'low',
    };
  }

  /**
   * 获取默认特征
   */
  private getDefaultFeatures(): TaskFeatures {
    return {
      stepCount: 1,
      requiresPlanning: false,
      requiresHighQuality: false,
      requiresTools: false,
      taskType: 'general',
      complexity: 'low',
    };
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const stats = this.statsTracker.getStats();
    const total = stats.totalJudgments;

    return {
      ...stats,
      selections: { ...this.patternCounts },
      distribution: {
        direct: `${((this.patternCounts.direct / total) * 100 || 0).toFixed(1)}%`,
        react: `${((this.patternCounts.react / total) * 100 || 0).toFixed(1)}%`,
        'plan-execute': `${((this.patternCounts['plan-execute'] / total) * 100 || 0).toFixed(1)}%`,
        reflective: `${((this.patternCounts.reflective / total) * 100 || 0).toFixed(1)}%`,
      },
    };
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<PatternSelectorConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('[PatternSelector] Config updated', this.config);
  }
}

// ---------------------------------------------------------------------------
// 4. 单例模式
// ---------------------------------------------------------------------------

let selectorInstance: PatternSelector | null = null;

/**
 * 获取 PatternSelector 实例
 *
 * @param provider AI Provider（首次调用时必需）
 * @param config 配置（可选）
 */
export function getPatternSelector(
  provider?: AIProvider,
  config?: Partial<PatternSelectorConfig>
): PatternSelector {
  if (!selectorInstance) {
    if (!provider) {
      throw new Error('PatternSelector requires provider on first initialization');
    }

    selectorInstance = new PatternSelector(provider, config);
  }
  return selectorInstance;
}

export function resetPatternSelector(): void {
  selectorInstance = null;
}
