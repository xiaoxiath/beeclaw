/**
 * Tiered LLM Router
 *
 * 分级 LLM 路由系统，根据任务复杂度选择合适的模型
 */

import type { AIProvider } from '../../infra/config/schema';

// ============================================================================
// LLM Tier Definitions
// ============================================================================

export enum LLMTier {
  /** Level 1: Fast - 快速响应，低成本 */
  FAST = 'fast',
  /** Level 2: Standard - 平衡性能和成本 */
  STANDARD = 'standard',
  /** Level 3: Advanced - 高质量，深度推理 */
  ADVANCED = 'advanced',
}

export interface LLMTierConfig {
  tier: LLMTier;
  models: string[];  // 优先级排序的模型列表
  maxTokens: number;
  temperature: number;
  timeout: number;
  costPer1kTokens: number;  // USD
  description: string;
}

export const LLM_TIER_CONFIGS: Record<LLMTier, LLMTierConfig> = {
  [LLMTier.FAST]: {
    tier: LLMTier.FAST,
    models: [
      'gpt-4o-mini',
      'glm-4-flash',
      'claude-3-5-haiku-20241022',
    ],
    maxTokens: 1000,
    temperature: 0.3,
    timeout: 3000,  // 3s
    costPer1kTokens: 0.0005,
    description: 'Fast responses for simple tasks (intent, classification)',
  },
  [LLMTier.STANDARD]: {
    tier: LLMTier.STANDARD,
    models: [
      'gpt-4o-mini',
      'glm-4',
      'claude-sonnet-4-6',
    ],
    maxTokens: 2000,
    temperature: 0.5,
    timeout: 5000,  // 5s
    costPer1kTokens: 0.003,
    description: 'Balanced performance for medium tasks (matching, extraction)',
  },
  [LLMTier.ADVANCED]: {
    tier: LLMTier.ADVANCED,
    models: [
      'gpt-4o',
      'claude-opus-4-6',
      'o1',
    ],
    maxTokens: 4000,
    temperature: 0.7,
    timeout: 10000,  // 10s
    costPer1kTokens: 0.03,
    description: 'High quality for complex tasks (creation, reasoning)',
  },
};

// ============================================================================
// Task Types
// ============================================================================

export enum LLMTask {
  // Level 1 (Fast)
  INTENT_RECOGNITION = 'intent_recognition',
  MESSAGE_ROUTING = 'message_routing',
  CONTENT_CATEGORIZATION = 'content_categorization',
  KEYWORD_EXTRACTION = 'keyword_extraction',

  // Level 2 (Standard)
  SKILL_MATCHING = 'skill_matching',
  KNOWLEDGE_EXTRACTION = 'knowledge_extraction',
  QUERY_GENERATION = 'query_generation',
  CONTEXT_COMPRESSION = 'context_compression',
  MEMORY_COMPRESSION = 'memory_compression',

  // Level 3 (Advanced)
  SKILL_CREATION = 'skill_creation',
  COMPLEX_REASONING = 'complex_reasoning',
  DEEP_RESEARCH = 'deep_research',
  CODE_GENERATION = 'code_generation',
}

export const TASK_TIER_MAP: Record<LLMTask, LLMTier> = {
  // Level 1
  [LLMTask.INTENT_RECOGNITION]: LLMTier.FAST,
  [LLMTask.MESSAGE_ROUTING]: LLMTier.FAST,
  [LLMTask.CONTENT_CATEGORIZATION]: LLMTier.FAST,
  [LLMTask.KEYWORD_EXTRACTION]: LLMTier.FAST,

  // Level 2
  [LLMTask.SKILL_MATCHING]: LLMTier.STANDARD,
  [LLMTask.KNOWLEDGE_EXTRACTION]: LLMTier.STANDARD,
  [LLMTask.QUERY_GENERATION]: LLMTier.STANDARD,
  [LLMTask.CONTEXT_COMPRESSION]: LLMTier.FAST,  // 可以用快速模型
  [LLMTask.MEMORY_COMPRESSION]: LLMTier.FAST,

  // Level 3
  [LLMTask.SKILL_CREATION]: LLMTier.ADVANCED,
  [LLMTask.COMPLEX_REASONING]: LLMTier.ADVANCED,
  [LLMTask.DEEP_RESEARCH]: LLMTier.ADVANCED,
  [LLMTask.CODE_GENERATION]: LLMTier.ADVANCED,
};

// ============================================================================
// Tiered LLM Router
// ============================================================================

export interface TieredLLMRouterOptions {
  provider: AIProvider;
  modelPreferences?: Partial<Record<LLMTier, string>>;  // 用户偏好
  fallbackEnabled?: boolean;  // 是否启用降级
  costTracking?: boolean;  // 是否跟踪成本
}

export class TieredLLMRouter {
  private modelPreferences: Partial<Record<LLMTier, string>>;
  private fallbackEnabled: boolean;
  private costTracking: boolean;
  private costLog: Array<{ task: LLMTask; tier: LLMTier; tokens: number; cost: number }> = [];

  constructor(options: TieredLLMRouterOptions) {
    this.modelPreferences = options.modelPreferences || {};
    this.fallbackEnabled = options.fallbackEnabled ?? true;
    this.costTracking = options.costTracking ?? false;
  }

  /**
   * 为任务选择合适的模型
   */
  selectModelForTask(task: LLMTask): string {
    const tier = TASK_TIER_MAP[task];
    return this.selectModelForTier(tier);
  }

  /**
   * 为层级选择模型
   */
  selectModelForTier(tier: LLMTier): string {
    // 1. 检查用户偏好
    if (this.modelPreferences[tier]) {
      return this.modelPreferences[tier];
    }

    // 2. 从配置中选择第一个可用的模型
    const config = LLM_TIER_CONFIGS[tier];
    return config.models[0];
  }

  /**
   * 获取任务的配置
   */
  getTaskConfig(task: LLMTask): LLMTierConfig {
    const tier = TASK_TIER_MAP[task];
    return LLM_TIER_CONFIGS[tier];
  }

  /**
   * 执行任务（带降级）
   */
  async execute<T>(
    task: LLMTask,
    executor: (model: string, config: LLMTierConfig) => Promise<T>,
    options?: {
      forceTier?: LLMTier;  // 强制使用特定层级
      skipFallback?: boolean;  // 跳过降级
    }
  ): Promise<T> {
    const tier = options?.forceTier || TASK_TIER_MAP[task];
    const config = LLM_TIER_CONFIGS[tier];
    const model = this.selectModelForTier(tier);

    try {
      const result = await executor(model, config);

      // 记录成本（如果启用）
      if (this.costTracking) {
        this.logCost(task, tier, config.maxTokens);
      }

      return result;
    } catch (error) {
      // 降级逻辑
      if (this.fallbackEnabled && !options?.skipFallback) {
        return this.handleFallback(task, executor, error);
      }
      throw error;
    }
  }

  /**
   * 处理降级
   *
   * [P1 FIX] Adjacent-tier fallback strategy.
   *
   * Previous behavior: ADVANCED → STANDARD → FAST (always downward),
   * causing all failing requests to funnel toward the worst model.
   *
   * New behavior: Try the closest adjacent tier first, preferring
   * the HIGHER quality tier when equidistant. This keeps quality
   * as high as possible while still providing resilience.
   *
   * Fallback order per tier:
   *   ADVANCED  → STANDARD → FAST   (can only go down)
   *   STANDARD  → ADVANCED → FAST   (try up first, then down)
   *   FAST      → STANDARD → ADVANCED (can only go up)
   */
  private async handleFallback<T>(
    task: LLMTask,
    executor: (model: string, config: LLMTierConfig) => Promise<T>,
    originalError: any
  ): Promise<T> {
    const currentTier = TASK_TIER_MAP[task];

    // Build fallback order: prefer adjacent higher-quality tier first
    const fallbackOrder: Record<LLMTier, LLMTier[]> = {
      [LLMTier.ADVANCED]:  [LLMTier.STANDARD, LLMTier.FAST],
      [LLMTier.STANDARD]:  [LLMTier.ADVANCED, LLMTier.FAST],
      [LLMTier.FAST]:      [LLMTier.STANDARD, LLMTier.ADVANCED],
    };

    const candidates = fallbackOrder[currentTier] || [];

    for (const fallbackTier of candidates) {
      console.warn(`[TieredLLMRouter] Falling back from ${currentTier} to ${fallbackTier}`);

      const fallbackConfig = LLM_TIER_CONFIGS[fallbackTier];
      const fallbackModel = this.selectModelForTier(fallbackTier);

      try {
        return await executor(fallbackModel, fallbackConfig);
      } catch (fallbackError) {
        console.warn(`[TieredLLMRouter] Fallback to ${fallbackTier} also failed, trying next...`);
        continue;
      }
    }

    // All fallbacks exhausted
    console.error(`[TieredLLMRouter] All fallback tiers exhausted for task`);
    throw originalError;
  }

  /**
   * 记录成本
   */
  private logCost(task: LLMTask, tier: LLMTier, tokens: number): void {
    const config = LLM_TIER_CONFIGS[tier];
    const cost = (tokens / 1000) * config.costPer1kTokens;

    this.costLog.push({
      task,
      tier,
      tokens,
      cost,
    });
  }

  /**
   * 获取成本统计
   */
  getCostStats(): {
    totalCost: number;
    byTier: Record<LLMTier, number>;
    byTask: Record<LLMTask, number>;
  } {
    const stats = {
      totalCost: 0,
      byTier: {} as Record<LLMTier, number>,
      byTask: {} as Record<LLMTask, number>,
    };

    for (const log of this.costLog) {
      stats.totalCost += log.cost;
      stats.byTier[log.tier] = (stats.byTier[log.tier] || 0) + log.cost;
      stats.byTask[log.task] = (stats.byTask[log.task] || 0) + log.cost;
    }

    return stats;
  }

  /**
   * 清除成本日志
   */
  clearCostLog(): void {
    this.costLog = [];
  }
}

// ============================================================================
// Factory
// ============================================================================

let defaultRouter: TieredLLMRouter | null = null;

export function getTieredLLMRouter(options?: TieredLLMRouterOptions): TieredLLMRouter {
  if (!defaultRouter || options) {
    if (!options?.provider) {
      throw new Error('Provider is required for first-time initialization');
    }
    defaultRouter = new TieredLLMRouter(options);
  }
  return defaultRouter;
}

export function resetTieredLLMRouter(): void {
  defaultRouter = null;
}
