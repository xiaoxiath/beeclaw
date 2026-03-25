// @deprecated - Dead code identified in audit (2026-03-25). Not imported by any production module. Scheduled for removal.
/**
 * BeeClaw Resilience Patch — 动态 Budget 管理器
 * 
 * 解决问题:
 *   - 无 token/cost 累计消耗预算 (#7)
 *   - maxToolIterations 硬编码 30, 对简单任务太大对复杂任务太小 (#6)
 *   - 缺乏多维度资源管控 (token + 调用次数 + 时间 + 成本)
 * 
 * 核心能力:
 *   - 四维预算: token / 调用次数 / wall-clock 时间 / 估算成本
 *   - 动态预算估算: 根据任务描述和可用工具自动调整
 *   - 实时消耗追踪: 每次 LLM/Tool 调用后更新
 *   - 预算告警: 接近上限时注入提示让 LLM 收敛
 *   - 预算报告: 调用结束后生成完整的资源消耗报告
 * 
 * 集成方式: 在 chat() 方法中创建 BudgetManager 实例, 在主循环中调用 check()
 */

// ============================================================================
// Types
// ============================================================================

export interface BudgetConfig {
  /** 单轮最大输入 token */
  maxInputTokens: number;
  /** 单轮最大输出 token */
  maxOutputTokens: number;
  /** 单轮总 token 上限 */
  maxTotalTokens: number;
  /** 最大 LLM 调用次数 (对应 maxToolIterations) */
  maxLLMCalls: number;
  /** 最大工具调用总次数 (含并行展开) */
  maxToolCalls: number;
  /** 最大 wall-clock 时间 (ms) */
  maxWallClockMs: number;
  /** 最大估算成本 (USD, 可选) */
  maxCostUSD: number | null;
  /** 接近上限告警阈值 (0-1, 默认 0.8) */
  warningThreshold: number;
  /** 强制停止阈值 (0-1, 默认 0.95) */
  hardLimitThreshold: number;
}

export interface BudgetConsumption {
  inputTokens: number;
  outputTokens: number;
  llmCalls: number;
  toolCalls: number;
  startTime: number;
  estimatedCostUSD: number;
  /** 每次 LLM 调用的 token 详情 */
  llmCallDetails: Array<{
    iteration: number;
    inputTokens: number;
    outputTokens: number;
    model?: string;
    timestamp: number;
  }>;
  /** 每次工具调用的记录 */
  toolCallDetails: Array<{
    iteration: number;
    toolName: string;
    durationMs: number;
    timestamp: number;
  }>;
}

export type BudgetDimension = 'inputTokens' | 'outputTokens' | 'totalTokens' | 'llmCalls' | 'toolCalls' | 'wallClock' | 'cost';

export interface BudgetStatus {
  /** 各维度的利用率 (0-1) */
  utilization: Record<BudgetDimension, number>;
  /** 最高利用率的维度 */
  bottleneck: BudgetDimension;
  /** 最高利用率值 */
  maxUtilization: number;
  /** 是否超限 */
  exceeded: boolean;
  /** 哪些维度超限 */
  exceededDimensions: BudgetDimension[];
  /** 是否接近上限 */
  nearLimit: boolean;
  /** 建议动作 */
  recommendation: 'continue' | 'wrap_up' | 'abort';
  /** 消耗快照 */
  consumed: Readonly<BudgetConsumption>;
  /** 预算配置 */
  budget: Readonly<BudgetConfig>;
}

export interface BudgetReport {
  /** 总耗时 */
  totalDurationMs: number;
  /** 总 token 消耗 */
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  /** 调用次数 */
  llmCalls: number;
  toolCalls: number;
  /** 估算成本 */
  estimatedCostUSD: number;
  /** 各维度利用率 */
  utilization: Record<BudgetDimension, number>;
  /** 是否有维度超限 */
  anyExceeded: boolean;
  /** 平均每次 LLM 调用的 token */
  avgTokensPerLLMCall: number;
  /** 最耗 token 的 LLM 调用 */
  peakLLMCall: { iteration: number; totalTokens: number } | null;
  /** 耗时最长的工具调用 */
  slowestToolCall: { toolName: string; durationMs: number } | null;
}

// ============================================================================
// Default Configuration & Presets
// ============================================================================

export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  maxInputTokens: 500_000,
  maxOutputTokens: 100_000,
  maxTotalTokens: 600_000,
  maxLLMCalls: 30,
  maxToolCalls: 100,
  maxWallClockMs: 15 * 60 * 1000,
  maxCostUSD: null,
  warningThreshold: 0.8,
  hardLimitThreshold: 0.95,
};

/** 预设 Budget 模板 */
export const BUDGET_PRESETS: Record<string, Partial<BudgetConfig>> = {
  /** 简单问答 */
  simple: {
    maxInputTokens: 50_000,
    maxOutputTokens: 10_000,
    maxTotalTokens: 60_000,
    maxLLMCalls: 5,
    maxToolCalls: 10,
    maxWallClockMs: 2 * 60 * 1000,
  },
  /** 标准任务 */
  standard: {
    maxInputTokens: 200_000,
    maxOutputTokens: 50_000,
    maxTotalTokens: 250_000,
    maxLLMCalls: 15,
    maxToolCalls: 50,
    maxWallClockMs: 10 * 60 * 1000,
  },
  /** 复杂任务 */
  complex: {
    maxInputTokens: 500_000,
    maxOutputTokens: 100_000,
    maxTotalTokens: 600_000,
    maxLLMCalls: 30,
    maxToolCalls: 100,
    maxWallClockMs: 15 * 60 * 1000,
  },
  /** 深度研究 */
  deep_research: {
    maxInputTokens: 1_000_000,
    maxOutputTokens: 200_000,
    maxTotalTokens: 1_200_000,
    maxLLMCalls: 60,
    maxToolCalls: 200,
    maxWallClockMs: 30 * 60 * 1000,
  },
};

/** 常见模型的 token 单价 (USD per 1K tokens) */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
  'claude-3.5-sonnet': { input: 0.003, output: 0.015 },
  'glm-4': { input: 0.014, output: 0.014 },
  'glm-4-flash': { input: 0.0001, output: 0.0001 },
  'glm-4.7-flash': { input: 0.0001, output: 0.0001 },
  'deepseek-chat': { input: 0.00014, output: 0.00028 },
  'deepseek-reasoner': { input: 0.00055, output: 0.00219 },
};

// ============================================================================
// BudgetManager
// ============================================================================

export class BudgetManager {
  private readonly config: BudgetConfig;
  private readonly consumed: BudgetConsumption;
  private warningInjected = false;

  constructor(config: Partial<BudgetConfig> = {}) {
    this.config = { ...DEFAULT_BUDGET_CONFIG, ...config };
    this.consumed = {
      inputTokens: 0,
      outputTokens: 0,
      llmCalls: 0,
      toolCalls: 0,
      startTime: Date.now(),
      estimatedCostUSD: 0,
      llmCallDetails: [],
      toolCallDetails: [],
    };
  }

  // --- 记录消耗 ---

  /**
   * 记录一次 LLM 调用的 token 消耗
   */
  recordLLMCall(detail: {
    inputTokens: number;
    outputTokens: number;
    model?: string;
    iteration?: number;
  }): void {
    this.consumed.inputTokens += detail.inputTokens;
    this.consumed.outputTokens += detail.outputTokens;
    this.consumed.llmCalls++;

    // 估算成本
    const pricing = this.getModelPricing(detail.model);
    const cost = (detail.inputTokens / 1000 * pricing.input) +
                 (detail.outputTokens / 1000 * pricing.output);
    this.consumed.estimatedCostUSD += cost;

    this.consumed.llmCallDetails.push({
      iteration: detail.iteration ?? this.consumed.llmCalls,
      inputTokens: detail.inputTokens,
      outputTokens: detail.outputTokens,
      model: detail.model,
      timestamp: Date.now(),
    });
  }

  /**
   * 记录一次工具调用
   */
  recordToolCall(detail: {
    toolName: string;
    durationMs: number;
    iteration?: number;
  }): void {
    this.consumed.toolCalls++;
    this.consumed.toolCallDetails.push({
      iteration: detail.iteration ?? this.consumed.toolCalls,
      toolName: detail.toolName,
      durationMs: detail.durationMs,
      timestamp: Date.now(),
    });
  }

  // --- 预算检查 ---

  /**
   * 检查当前预算状态
   */
  check(): BudgetStatus {
    const utilization = this.computeUtilization();
    const exceededDimensions: BudgetDimension[] = [];
    let maxUtil = 0;
    let bottleneck: BudgetDimension = 'totalTokens';

    for (const [dim, util] of Object.entries(utilization)) {
      if (util > maxUtil) {
        maxUtil = util;
        bottleneck = dim as BudgetDimension;
      }
      if (util >= this.config.hardLimitThreshold) {
        exceededDimensions.push(dim as BudgetDimension);
      }
    }

    const exceeded = exceededDimensions.length > 0;
    const nearLimit = maxUtil >= this.config.warningThreshold;

    let recommendation: 'continue' | 'wrap_up' | 'abort' = 'continue';
    if (exceeded) {
      recommendation = 'abort';
    } else if (nearLimit) {
      recommendation = 'wrap_up';
    }

    return {
      utilization,
      bottleneck,
      maxUtilization: maxUtil,
      exceeded,
      exceededDimensions,
      nearLimit,
      recommendation,
      consumed: { ...this.consumed },
      budget: { ...this.config },
    };
  }

  /**
   * 生成预算告警消息 — 注入到 LLM 的 system message
   */
  generateBudgetWarning(status: BudgetStatus): string | null {
    if (!status.nearLimit || this.warningInjected) {
      return null;
    }

    this.warningInjected = true;

    const lines: string[] = [
      '⚠️ 资源预算告警',
      '',
    ];

    if (status.utilization.totalTokens >= this.config.warningThreshold) {
      const remaining = this.config.maxTotalTokens - (this.consumed.inputTokens + this.consumed.outputTokens);
      lines.push(`- Token 预算已用 ${(status.utilization.totalTokens * 100).toFixed(0)}%, 剩余约 ${Math.round(remaining / 1000)}K tokens`);
    }
    if (status.utilization.llmCalls >= this.config.warningThreshold) {
      const remaining = this.config.maxLLMCalls - this.consumed.llmCalls;
      lines.push(`- LLM 调用次数已用 ${(status.utilization.llmCalls * 100).toFixed(0)}%, 剩余 ${remaining} 次`);
    }
    if (status.utilization.wallClock >= this.config.warningThreshold) {
      const remainingSec = Math.round((this.config.maxWallClockMs - (Date.now() - this.consumed.startTime)) / 1000);
      lines.push(`- 时间预算已用 ${(status.utilization.wallClock * 100).toFixed(0)}%, 剩余约 ${remainingSec} 秒`);
    }
    if (status.utilization.toolCalls >= this.config.warningThreshold) {
      const remaining = this.config.maxToolCalls - this.consumed.toolCalls;
      lines.push(`- 工具调用次数已用 ${(status.utilization.toolCalls * 100).toFixed(0)}%, 剩余 ${remaining} 次`);
    }

    lines.push('', '请尽快完成当前任务并给出最终回答。如果无法完成，请总结已完成的部分并告知用户。');

    return lines.join('\n');
  }

  // --- 预算报告 ---

  /**
   * 生成最终的预算消耗报告
   */
  generateReport(): BudgetReport {
    const utilization = this.computeUtilization();
    const totalTokens = this.consumed.inputTokens + this.consumed.outputTokens;

    // 找到 token 消耗最高的 LLM 调用
    let peakLLMCall: BudgetReport['peakLLMCall'] = null;
    for (const detail of this.consumed.llmCallDetails) {
      const total = detail.inputTokens + detail.outputTokens;
      if (!peakLLMCall || total > peakLLMCall.totalTokens) {
        peakLLMCall = { iteration: detail.iteration, totalTokens: total };
      }
    }

    // 找到耗时最长的工具调用
    let slowestToolCall: BudgetReport['slowestToolCall'] = null;
    for (const detail of this.consumed.toolCallDetails) {
      if (!slowestToolCall || detail.durationMs > slowestToolCall.durationMs) {
        slowestToolCall = { toolName: detail.toolName, durationMs: detail.durationMs };
      }
    }

    return {
      totalDurationMs: Date.now() - this.consumed.startTime,
      totalTokens,
      inputTokens: this.consumed.inputTokens,
      outputTokens: this.consumed.outputTokens,
      llmCalls: this.consumed.llmCalls,
      toolCalls: this.consumed.toolCalls,
      estimatedCostUSD: this.consumed.estimatedCostUSD,
      utilization,
      anyExceeded: Object.values(utilization).some(u => u >= this.config.hardLimitThreshold),
      avgTokensPerLLMCall: this.consumed.llmCalls > 0
        ? Math.round(totalTokens / this.consumed.llmCalls)
        : 0,
      peakLLMCall,
      slowestToolCall,
    };
  }

  // --- 预算估算 ---

  /**
   * 获取剩余 LLM 调用次数
   */
  remainingLLMCalls(): number {
    return Math.max(0, this.config.maxLLMCalls - this.consumed.llmCalls);
  }

  /**
   * 获取剩余工具调用次数
   */
  remainingToolCalls(): number {
    return Math.max(0, this.config.maxToolCalls - this.consumed.toolCalls);
  }

  /**
   * 获取剩余 token
   */
  remainingTokens(): number {
    return Math.max(0, this.config.maxTotalTokens - this.consumed.inputTokens - this.consumed.outputTokens);
  }

  /**
   * 获取当前消耗快照
   */
  getConsumed(): Readonly<BudgetConsumption> {
    return { ...this.consumed };
  }

  // --- 内部方法 ---

  private computeUtilization(): Record<BudgetDimension, number> {
    const elapsedMs = Date.now() - this.consumed.startTime;
    const totalTokens = this.consumed.inputTokens + this.consumed.outputTokens;

    return {
      inputTokens: this.config.maxInputTokens > 0
        ? this.consumed.inputTokens / this.config.maxInputTokens : 0,
      outputTokens: this.config.maxOutputTokens > 0
        ? this.consumed.outputTokens / this.config.maxOutputTokens : 0,
      totalTokens: this.config.maxTotalTokens > 0
        ? totalTokens / this.config.maxTotalTokens : 0,
      llmCalls: this.config.maxLLMCalls > 0
        ? this.consumed.llmCalls / this.config.maxLLMCalls : 0,
      toolCalls: this.config.maxToolCalls > 0
        ? this.consumed.toolCalls / this.config.maxToolCalls : 0,
      wallClock: this.config.maxWallClockMs > 0
        ? elapsedMs / this.config.maxWallClockMs : 0,
      cost: this.config.maxCostUSD !== null && this.config.maxCostUSD > 0
        ? this.consumed.estimatedCostUSD / this.config.maxCostUSD : 0,
    };
  }

  private getModelPricing(model?: string): { input: number; output: number } {
    if (!model) return { input: 0.003, output: 0.015 }; // 默认 Claude Sonnet 级别

    // 精确匹配
    if (MODEL_PRICING[model]) return MODEL_PRICING[model];

    // 模糊匹配
    const lowerModel = model.toLowerCase();
    for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
      if (lowerModel.includes(key) || key.includes(lowerModel)) {
        return pricing;
      }
    }

    return { input: 0.003, output: 0.015 };
  }
}

// ============================================================================
// 动态预算估算器
// ============================================================================

/**
 * 根据任务描述和可用工具动态估算预算
 * 
 * 简单启发式:
 *   - 包含搜索+分析+总结类关键词 → 大预算
 *   - 单步操作 → 小预算
 *   - 工具数量多 → 可能需要更多调用
 * 
 * @param taskDescription - 用户的任务描述 (即用户消息)
 * @param availableTools - 可用工具名列表
 * @param baseConfig - 基础预算配置
 * @returns 调整后的预算配置
 */
export function estimateBudget(
  taskDescription: string,
  availableTools: string[] = [],
  baseConfig: Partial<BudgetConfig> = {}
): BudgetConfig {
  const text = taskDescription.toLowerCase();

  // 检测任务复杂度
  let complexity: 'simple' | 'standard' | 'complex' | 'deep_research' = 'standard';

  // 深度研究标志
  const deepResearchKeywords = [
    '深入分析', '详细研究', '全面调研', '深度报告', 'deep research', 'comprehensive',
    '对比分析', '调研报告', '竞品分析', '技术选型',
  ];
  if (deepResearchKeywords.some(kw => text.includes(kw))) {
    complexity = 'deep_research';
  }

  // 复杂任务标志
  const complexKeywords = [
    '搜索', '分析', '总结', '比较', '多个', '批量', 'search', 'analyze', 'compare',
    '创建文档', '写报告', '生成代码', '实现', 'implement',
  ];
  const complexMatches = complexKeywords.filter(kw => text.includes(kw)).length;
  if (complexMatches >= 3 && complexity !== 'deep_research') {
    complexity = 'complex';
  } else if (complexMatches >= 1 && complexity === 'standard') {
    // 保持 standard
  }

  // 简单任务标志
  const simpleKeywords = [
    '什么是', '怎么', '如何', '帮我', 'what is', 'how to',
    '翻译', '解释', '回答',
  ];
  const simpleMatches = simpleKeywords.filter(kw => text.includes(kw)).length;
  if (simpleMatches > 0 && complexMatches === 0 && text.length < 50) {
    complexity = 'simple';
  }

  // 根据工具数量微调
  const toolMultiplier = availableTools.length > 10 ? 1.2 : 1.0;

  const preset = BUDGET_PRESETS[complexity];
  const adjusted: BudgetConfig = {
    ...DEFAULT_BUDGET_CONFIG,
    ...preset,
    ...baseConfig,
  };

  // 应用工具数量乘数
  adjusted.maxToolCalls = Math.round(adjusted.maxToolCalls * toolMultiplier);

  return adjusted;
}

// ============================================================================
// 便捷工厂函数
// ============================================================================

/**
 * 创建 BudgetManager 实例
 * 
 * 用法:
 *   const budget = createBudgetManager({ maxLLMCalls: 20 });
 *   
 *   // 或自动估算
 *   const budget = createBudgetManager(
 *     estimateBudget(userMessage, Object.keys(tools))
 *   );
 *   
 *   // 在主循环中
 *   while (...) {
 *     const status = budget.check();
 *     if (status.recommendation === 'abort') break;
 *     if (status.recommendation === 'wrap_up') {
 *       const warning = budget.generateBudgetWarning(status);
 *       if (warning) messages.push({ role: 'system', content: warning });
 *     }
 *     
 *     // LLM 调用后
 *     budget.recordLLMCall({ inputTokens, outputTokens, model });
 *     // 工具调用后
 *     budget.recordToolCall({ toolName, durationMs });
 *   }
 *   
 *   // 结束后生成报告
 *   const report = budget.generateReport();
 */
export function createBudgetManager(config?: Partial<BudgetConfig>): BudgetManager {
  return new BudgetManager(config);
}
