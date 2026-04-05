/**
 * bee — Tiered LLM Router.
 *
 * Selects appropriate models based on task complexity.
 * Extracted from beeclaw's src/infra/ai/tiered-router.ts.
 *
 * Changes from beeclaw:
 * - Removed AIProvider dependency (bee is provider-agnostic)
 * - Removed singleton factory
 */

// ============================================================================
// LLM Tier Definitions
// ============================================================================

export enum LLMTier {
  /** Level 1: Fast — quick responses, low cost */
  FAST = 'fast',
  /** Level 2: Standard — balanced performance and cost */
  STANDARD = 'standard',
  /** Level 3: Advanced — high quality, deep reasoning */
  ADVANCED = 'advanced',
}

export interface LLMTierConfig {
  tier: LLMTier;
  models: string[];
  maxTokens: number;
  temperature: number;
  timeout: number;
  costPer1kTokens: number;
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
    timeout: 3000,
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
    timeout: 5000,
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
    timeout: 10000,
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
  [LLMTask.CONTEXT_COMPRESSION]: LLMTier.FAST,
  [LLMTask.MEMORY_COMPRESSION]: LLMTier.FAST,

  // Level 3
  [LLMTask.SKILL_CREATION]: LLMTier.ADVANCED,
  [LLMTask.COMPLEX_REASONING]: LLMTier.ADVANCED,
  [LLMTask.DEEP_RESEARCH]: LLMTier.ADVANCED,
  [LLMTask.CODE_GENERATION]: LLMTier.ADVANCED,
};

// ============================================================================
// TieredLLMRouter
// ============================================================================

export interface TieredLLMRouterOptions {
  /** User model preferences per tier */
  modelPreferences?: Partial<Record<LLMTier, string>>;
  /** Enable tier fallback on failure (default true) */
  fallbackEnabled?: boolean;
  /** Enable cost tracking (default false) */
  costTracking?: boolean;
}

export class TieredLLMRouter {
  private modelPreferences: Partial<Record<LLMTier, string>>;
  private fallbackEnabled: boolean;
  private costTracking: boolean;
  private costLog: Array<{ task: LLMTask; tier: LLMTier; tokens: number; cost: number }> = [];

  constructor(options: TieredLLMRouterOptions = {}) {
    this.modelPreferences = options.modelPreferences || {};
    this.fallbackEnabled = options.fallbackEnabled ?? true;
    this.costTracking = options.costTracking ?? false;
  }

  /**
   * Select a model for a specific task.
   */
  selectModelForTask(task: LLMTask): string {
    const tier = TASK_TIER_MAP[task];
    return this.selectModelForTier(tier);
  }

  /**
   * Select a model for a specific tier.
   */
  selectModelForTier(tier: LLMTier): string {
    if (this.modelPreferences[tier]) {
      return this.modelPreferences[tier];
    }
    return LLM_TIER_CONFIGS[tier].models[0];
  }

  /**
   * Get the config for a task's tier.
   */
  getTaskConfig(task: LLMTask): LLMTierConfig {
    const tier = TASK_TIER_MAP[task];
    return LLM_TIER_CONFIGS[tier];
  }

  /**
   * Execute a task with fallback.
   */
  async execute<T>(
    task: LLMTask,
    executor: (model: string, config: LLMTierConfig) => Promise<T>,
    options?: {
      forceTier?: LLMTier;
      skipFallback?: boolean;
    },
  ): Promise<T> {
    const tier = options?.forceTier || TASK_TIER_MAP[task];
    const config = LLM_TIER_CONFIGS[tier];
    const model = this.selectModelForTier(tier);

    try {
      const result = await executor(model, config);

      if (this.costTracking) {
        this.logCost(task, tier, config.maxTokens);
      }

      return result;
    } catch (error) {
      if (this.fallbackEnabled && !options?.skipFallback) {
        return this.handleFallback(task, executor, error);
      }
      throw error;
    }
  }

  /**
   * Get cost statistics.
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
   * Clear cost log.
   */
  clearCostLog(): void {
    this.costLog = [];
  }

  // --- Internal ---

  /**
   * Adjacent-tier fallback strategy.
   *
   * ADVANCED  → STANDARD → FAST
   * STANDARD  → ADVANCED → FAST
   * FAST      → STANDARD → ADVANCED
   */
  private async handleFallback<T>(
    task: LLMTask,
    executor: (model: string, config: LLMTierConfig) => Promise<T>,
    originalError: any,
  ): Promise<T> {
    const currentTier = TASK_TIER_MAP[task];

    const fallbackOrder: Record<LLMTier, LLMTier[]> = {
      [LLMTier.ADVANCED]: [LLMTier.STANDARD, LLMTier.FAST],
      [LLMTier.STANDARD]: [LLMTier.ADVANCED, LLMTier.FAST],
      [LLMTier.FAST]: [LLMTier.STANDARD, LLMTier.ADVANCED],
    };

    const candidates = fallbackOrder[currentTier] || [];

    for (const fallbackTier of candidates) {
      const fallbackConfig = LLM_TIER_CONFIGS[fallbackTier];
      const fallbackModel = this.selectModelForTier(fallbackTier);

      try {
        return await executor(fallbackModel, fallbackConfig);
      } catch {
        continue;
      }
    }

    throw originalError;
  }

  private logCost(task: LLMTask, tier: LLMTier, tokens: number): void {
    const config = LLM_TIER_CONFIGS[tier];
    const cost = (tokens / 1000) * config.costPer1kTokens;

    this.costLog.push({ task, tier, tokens, cost });
  }
}
