/**
import { deepMerge } from '../utils';
 * BeeClaw Resilience — Unified Configuration Center
 * 
 * 统一管理所有韧性模块的配置参数，消除 ~79 处硬编码常量。
 * 
 * 设计原则：
 *   1. 三层优先级：环境变量 > 用户覆写 > 预设 > 代码默认值
 *   2. 四套预设：quick_task / standard / complex_research / long_running
 *   3. Zod-compatible —— 可选集成 BeeClaw 现有 config/schema.ts
 *   4. 交叉校验 —— resolveConfig 时自动检查 L1 < L2 < L3 等约束
 *   5. 热重载友好 —— 纯函数式 resolveConfig，无模块级可变状态
 */

// ────────────────────────────────────────────
// § 0  Utility Types
// ────────────────────────────────────────────

/** 递归 Partial，允许任意层级只覆写部分字段 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? DeepPartial<U>[]
    : T[P] extends object
      ? DeepPartial<T[P]>
      : T[P];
};

/** 预设名称 */
export type PresetName = 'quick_task' | 'standard' | 'complex_research' | 'long_running';

// ────────────────────────────────────────────
// § 1  Config Interfaces
// ────────────────────────────────────────────

/** 四层超时体系 */
export interface TimeoutLayerConfig {
  /** L1 — 单次 HTTP 请求超时 (AbortController) */
  requestTimeoutMs: number;
  /** L1 — 流式请求超时（首 token 后重置） */
  streamingRequestTimeoutMs: number;
  /** L2 — 单步 LLM 调用超时 */
  llmStepTimeoutMs: number;
  /** L2 — 单步工具调用超时 */
  toolStepTimeoutMs: number;
  /** L3 — 整轮 Turn 墙钟 deadline */
  turnTimeoutMs: number;
  /** L4 — 不活跃超时（SmartTimeout 桥接） */
  inactivityTimeoutMs: number;
  /** L4 — 不活跃检查间隔 */
  inactivityCheckIntervalMs: number;
}

/** 熔断器默认值 */
export interface CircuitBreakerDefaults {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxAttempts: number;
  rollingWindowMs: number;
  rollingBuckets: number;
  volumeThreshold: number;
}

/** 循环检测 */
export interface LoopDetectorConfig {
  /** 精确重复 — 连续 N 条 SHA-256 相同即判定 */
  exactDuplicateThreshold: number;
  /** 语义重复 — Jaccard 相似度阈值 */
  semanticSimilarityThreshold: number;
  /** 语义重复 — 滑动窗口大小 */
  semanticWindowSize: number;
  /** 进度停滞 — 信息增益低于此值的连续轮数 */
  progressStallRounds: number;
  /** 进度停滞 — 信息增益阈值 */
  progressGainThreshold: number;
  /** 历史记录最大保留条数 */
  maxHistorySize: number;
}

/** 预算管理 */
export interface BudgetConfig {
  maxTokens: number;
  maxToolCalls: number;
  maxWallTimeMs: number;
  maxCostDollars: number;
  /** 各维度软限预警阈值 (0-1) */
  warningThreshold: number;
  /** 各维度硬限阈值 (0-1) */
  hardLimitThreshold: number;
}

/** 单个重试策略 */
export interface RetryStrategyConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterFactor: number;
}

/** 重试配置集合 */
export interface RetryConfig {
  ai_provider: RetryStrategyConfig;
  feishu: RetryStrategyConfig;
  mcp_tool: RetryStrategyConfig;
  local_tool: RetryStrategyConfig;
  rate_limit: RetryStrategyConfig;
}

/** 工具超时模式（字符串 → 运行时编译为 RegExp） */
export interface ToolTimeoutPattern {
  /** glob/regex 模式字符串，如 "browser_*" 或 "^code_" */
  pattern: string;
  /** 该类工具的超时 (ms) */
  timeoutMs: number;
  /** 人类可读描述 */
  description: string;
}

/** 并行执行器 */
export interface ExecutorConfig {
  maxConcurrency: number;
  defaultToolTimeoutMs: number;
  gracefulShutdownMs: number;
  /** 工具超时模式列表（按优先级排序，先匹配先生效） */
  toolTimeoutPatterns: ToolTimeoutPattern[];
}

/** 进度感知监控 */
export interface MonitorConfig {
  /** 健康评分窗口大小 */
  healthWindowSize: number;
  /** 评分权重 */
  weights: {
    informationGain: number;
    toolSuccess: number;
    responseLatency: number;
    errorRate: number;
  };
  /** 健康分低于此值触发告警 */
  healthAlertThreshold: number;
  /** 自适应超时最小倍率 */
  adaptiveTimeoutMinMultiplier: number;
  /** 自适应超时最大倍率 */
  adaptiveTimeoutMaxMultiplier: number;
}

/** 检查点 */
export interface CheckpointConfig {
  /** 是否启用自动检查点 */
  enabled: boolean;
  /** 每隔 N 步自动创建检查点 */
  intervalSteps: number;
  /** 最大保留检查点数 */
  maxSnapshots: number;
  /** 快照压缩阈值 (bytes) */
  compressionThresholdBytes: number;
  /** 恢复策略偏好顺序 */
  restoreStrategyOrder: ('replay' | 'snapshot' | 'reset')[];
}

/** 顶层韧性配置 */
export interface ResilienceConfig {
  timeout: TimeoutLayerConfig;
  circuitBreaker: CircuitBreakerDefaults;
  loopDetector: LoopDetectorConfig;
  budget: BudgetConfig;
  retry: RetryConfig;
  executor: ExecutorConfig;
  monitor: MonitorConfig;
  checkpoint: CheckpointConfig;
}

// ────────────────────────────────────────────
// § 2  Default Values
// ────────────────────────────────────────────

const DEFAULT_RETRY_STRATEGY: RetryStrategyConfig = {
  maxRetries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
  jitterFactor: 0.2,
};

export const DEFAULT_CONFIG: Readonly<ResilienceConfig> = {
  // ── 超时 ──
  timeout: {
    requestTimeoutMs: 30_000,
    streamingRequestTimeoutMs: 120_000,
    llmStepTimeoutMs: 180_000,
    toolStepTimeoutMs: 300_000,
    turnTimeoutMs: 600_000,
    inactivityTimeoutMs: 600_000,
    inactivityCheckIntervalMs: 30_000,
  },

  // ── 熔断 ──
  circuitBreaker: {
    failureThreshold: 5,
    resetTimeoutMs: 60_000,
    halfOpenMaxAttempts: 3,
    rollingWindowMs: 60_000,
    rollingBuckets: 10,
    volumeThreshold: 5,
  },

  // ── 循环检测 ──
  loopDetector: {
    exactDuplicateThreshold: 3,
    semanticSimilarityThreshold: 0.85,
    semanticWindowSize: 10,
    progressStallRounds: 5,
    progressGainThreshold: 0.1,
    maxHistorySize: 50,
  },

  // ── 预算 ──
  budget: {
    maxTokens: 100_000,
    maxToolCalls: 30,
    maxWallTimeMs: 600_000,
    maxCostDollars: 5.0,
    warningThreshold: 0.8,
    hardLimitThreshold: 0.95,
  },

  // ── 重试 ──
  retry: {
    ai_provider: { ...DEFAULT_RETRY_STRATEGY, maxRetries: 3, baseDelayMs: 1_000 },
    feishu: { ...DEFAULT_RETRY_STRATEGY, maxRetries: 2, baseDelayMs: 500 },
    mcp_tool: { ...DEFAULT_RETRY_STRATEGY, maxRetries: 2, baseDelayMs: 2_000 },
    local_tool: { ...DEFAULT_RETRY_STRATEGY, maxRetries: 1, baseDelayMs: 100 },
    rate_limit: { ...DEFAULT_RETRY_STRATEGY, maxRetries: 5, baseDelayMs: 5_000, maxDelayMs: 60_000 },
  },

  // ── 并行执行 ──
  executor: {
    maxConcurrency: 5,
    defaultToolTimeoutMs: 300_000,
    gracefulShutdownMs: 5_000,
    toolTimeoutPatterns: [
      { pattern: 'browser_*',        timeoutMs: 120_000, description: 'Browser tools — moderate' },
      { pattern: 'code_interpreter*', timeoutMs: 300_000, description: 'Code execution — long' },
      { pattern: 'file_*',           timeoutMs: 60_000,  description: 'File operations — short' },
      { pattern: 'search_*',         timeoutMs: 45_000,  description: 'Search tools — short' },
      { pattern: 'mcp_*',            timeoutMs: 180_000, description: 'MCP remote tools — moderate' },
      { pattern: 'feishu_*',         timeoutMs: 90_000,  description: 'Feishu API tools — moderate' },
      { pattern: 'image_gen*',       timeoutMs: 180_000, description: 'Image generation — long' },
      { pattern: 'llm_*',            timeoutMs: 180_000, description: 'LLM sub-calls — long' },
      { pattern: '*',                timeoutMs: 300_000, description: 'Catch-all default' },
    ],
  },

  // ── 进度监控 ──
  monitor: {
    healthWindowSize: 10,
    weights: {
      informationGain: 0.35,
      toolSuccess: 0.25,
      responseLatency: 0.20,
      errorRate: 0.20,
    },
    healthAlertThreshold: 40,
    adaptiveTimeoutMinMultiplier: 0.5,
    adaptiveTimeoutMaxMultiplier: 3.0,
  },

  // ── 检查点 ──
  checkpoint: {
    enabled: true,
    intervalSteps: 5,
    maxSnapshots: 10,
    compressionThresholdBytes: 50_000,
    restoreStrategyOrder: ['replay', 'snapshot', 'reset'],
  },
};

// ────────────────────────────────────────────
// § 3  Preset Overrides (Diff from DEFAULT)
// ────────────────────────────────────────────

const PRESET_OVERRIDES: Record<PresetName, DeepPartial<ResilienceConfig>> = {
  /** 快速任务 — 低容忍度、小预算 */
  quick_task: {
    timeout: {
      llmStepTimeoutMs: 60_000,
      toolStepTimeoutMs: 60_000,
      turnTimeoutMs: 120_000,
      inactivityTimeoutMs: 120_000,
    },
    circuitBreaker: {
      failureThreshold: 3,
      resetTimeoutMs: 30_000,
    },
    budget: {
      maxTokens: 20_000,
      maxToolCalls: 5,
      maxWallTimeMs: 120_000,
      maxCostDollars: 0.5,
    },
    loopDetector: {
      exactDuplicateThreshold: 2,
      progressStallRounds: 3,
    },
    executor: { maxConcurrency: 3 },
    checkpoint: { enabled: false },
  },

  /** 标准 — 使用全部默认值 */
  standard: {},

  /** 复杂研究 — 高容忍度、大预算 */
  complex_research: {
    timeout: {
      llmStepTimeoutMs: 300_000,
      toolStepTimeoutMs: 600_000,
      turnTimeoutMs: 1_800_000,
      inactivityTimeoutMs: 900_000,
    },
    circuitBreaker: {
      failureThreshold: 8,
      resetTimeoutMs: 120_000,
    },
    budget: {
      maxTokens: 500_000,
      maxToolCalls: 100,
      maxWallTimeMs: 1_800_000,
      maxCostDollars: 25.0,
    },
    loopDetector: {
      exactDuplicateThreshold: 5,
      progressStallRounds: 8,
      maxHistorySize: 100,
    },
    executor: { maxConcurrency: 8 },
    checkpoint: { intervalSteps: 3, maxSnapshots: 20 },
  },

  /** 长时运行 — 最大容忍、最大预算 */
  long_running: {
    timeout: {
      llmStepTimeoutMs: 600_000,
      toolStepTimeoutMs: 900_000,
      turnTimeoutMs: 3_600_000,
      inactivityTimeoutMs: 1_800_000,
    },
    circuitBreaker: {
      failureThreshold: 10,
      resetTimeoutMs: 300_000,
      halfOpenMaxAttempts: 5,
    },
    budget: {
      maxTokens: 1_000_000,
      maxToolCalls: 300,
      maxWallTimeMs: 3_600_000,
      maxCostDollars: 50.0,
    },
    loopDetector: {
      exactDuplicateThreshold: 5,
      progressStallRounds: 10,
      semanticWindowSize: 20,
      maxHistorySize: 200,
    },
    executor: { maxConcurrency: 10 },
    checkpoint: { intervalSteps: 2, maxSnapshots: 50 },
    monitor: {
      healthAlertThreshold: 30,
      adaptiveTimeoutMaxMultiplier: 5.0,
    },
  },
};
// ────────────────────────────────────────────
// § 5  Environment Variable Overrides
// ────────────────────────────────────────────

/**
 * 从环境变量注入覆写。命名规则：
 *   BEECLAW_RESILIENCE_{SECTION}_{KEY}
 * 
 * 示例：
 *   BEECLAW_RESILIENCE_TIMEOUT_TURN_TIMEOUT_MS=900000
 *   BEECLAW_RESILIENCE_BUDGET_MAX_TOOL_CALLS=50
 *   BEECLAW_RESILIENCE_CIRCUIT_BREAKER_FAILURE_THRESHOLD=8
 */

/** camelCase → UPPER_SNAKE_CASE */
function toEnvKey(camel: string): string {
  return camel.replace(/([A-Z])/g, '_$1').toUpperCase();
}

/** 安全读取环境变量并转数字，非数字则忽略 */
function readEnvNumber(envName: string): number | undefined {
  const raw = typeof process !== 'undefined' ? process.env[envName] : undefined;
  if (raw === undefined || raw === '') return undefined;
  const num = Number(raw);
  return Number.isFinite(num) ? num : undefined;
}

/** 将一层 flat object 的 number 字段用环境变量覆写 */
function applyEnvToSection<T extends Record<string, unknown>>(
  section: T,
  sectionEnvPrefix: string,
): T {
  const result = { ...section };
  for (const key of Object.keys(section)) {
    const val = section[key];
    if (typeof val === 'number') {
      const envName = `${sectionEnvPrefix}_${toEnvKey(key)}`;
      const envVal = readEnvNumber(envName);
      if (envVal !== undefined) {
        (result as Record<string, unknown>)[key] = envVal;
      }
    }
    // 嵌套 object（如 retry.ai_provider）递归
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      (result as Record<string, unknown>)[key] = applyEnvToSection(
        val as Record<string, unknown>,
        `${sectionEnvPrefix}_${toEnvKey(key)}`,
      );
    }
  }
  return result;
}

function applyEnvOverrides(config: ResilienceConfig): ResilienceConfig {
  const PREFIX = 'BEECLAW_RESILIENCE';
  return {
    timeout: applyEnvToSection(config.timeout, `${PREFIX}_TIMEOUT`),
    circuitBreaker: applyEnvToSection(config.circuitBreaker, `${PREFIX}_CIRCUIT_BREAKER`),
    loopDetector: applyEnvToSection(config.loopDetector, `${PREFIX}_LOOP_DETECTOR`),
    budget: applyEnvToSection(config.budget, `${PREFIX}_BUDGET`),
    retry: applyEnvToSection(config.retry, `${PREFIX}_RETRY`) as RetryConfig,
    executor: {
      ...config.executor,
      ...applyEnvToSection(
        { maxConcurrency: config.executor.maxConcurrency, defaultToolTimeoutMs: config.executor.defaultToolTimeoutMs, gracefulShutdownMs: config.executor.gracefulShutdownMs },
        `${PREFIX}_EXECUTOR`,
      ),
      toolTimeoutPatterns: config.executor.toolTimeoutPatterns,  // patterns 不从 env 覆写
    },
    monitor: applyEnvToSection(config.monitor, `${PREFIX}_MONITOR`) as MonitorConfig,
    checkpoint: applyEnvToSection(config.checkpoint, `${PREFIX}_CHECKPOINT`) as CheckpointConfig,
  };
}

// ────────────────────────────────────────────
// § 6  Validation
// ────────────────────────────────────────────

export class ConfigValidationError extends Error {
  constructor(public readonly violations: string[]) {
    super(`ResilienceConfig validation failed:\n  - ${violations.join('\n  - ')}`);
    this.name = 'ConfigValidationError';
  }
}

function validateConfig(config: ResilienceConfig): void {
  const violations: string[] = [];
  const { timeout: t, budget: b, circuitBreaker: cb, loopDetector: ld, monitor: m } = config;

  // ── 超时层级约束: L1 < L2 < L3 ──
  if (t.requestTimeoutMs >= t.llmStepTimeoutMs) {
    violations.push(`L1 requestTimeoutMs (${t.requestTimeoutMs}) must < L2 llmStepTimeoutMs (${t.llmStepTimeoutMs})`);
  }
  if (t.llmStepTimeoutMs >= t.turnTimeoutMs) {
    violations.push(`L2 llmStepTimeoutMs (${t.llmStepTimeoutMs}) must < L3 turnTimeoutMs (${t.turnTimeoutMs})`);
  }
  if (t.toolStepTimeoutMs >= t.turnTimeoutMs) {
    violations.push(`L2 toolStepTimeoutMs (${t.toolStepTimeoutMs}) must < L3 turnTimeoutMs (${t.turnTimeoutMs})`);
  }

  // ── 正值检查 ──
  const positiveChecks: [string, number][] = [
    ['requestTimeoutMs', t.requestTimeoutMs],
    ['streamingRequestTimeoutMs', t.streamingRequestTimeoutMs],
    ['turnTimeoutMs', t.turnTimeoutMs],
    ['inactivityTimeoutMs', t.inactivityTimeoutMs],
    ['inactivityCheckIntervalMs', t.inactivityCheckIntervalMs],
    ['failureThreshold', cb.failureThreshold],
    ['resetTimeoutMs', cb.resetTimeoutMs],
    ['maxTokens', b.maxTokens],
    ['maxToolCalls', b.maxToolCalls],
    ['maxWallTimeMs', b.maxWallTimeMs],
  ];
  for (const [name, val] of positiveChecks) {
    if (val <= 0) violations.push(`${name} must be positive, got ${val}`);
  }

  // ── 范围检查 ──
  if (b.warningThreshold <= 0 || b.warningThreshold >= 1) {
    violations.push(`warningThreshold must be in (0, 1), got ${b.warningThreshold}`);
  }
  if (b.hardLimitThreshold <= b.warningThreshold || b.hardLimitThreshold > 1) {
    violations.push(`hardLimitThreshold must be in (warningThreshold, 1], got ${b.hardLimitThreshold}`);
  }
  if (ld.semanticSimilarityThreshold <= 0 || ld.semanticSimilarityThreshold >= 1) {
    violations.push(`semanticSimilarityThreshold must be in (0, 1), got ${ld.semanticSimilarityThreshold}`);
  }

  // ── 监控权重归一化检查 ──
  const wSum = m.weights.informationGain + m.weights.toolSuccess + m.weights.responseLatency + m.weights.errorRate;
  if (Math.abs(wSum - 1.0) > 0.01) {
    violations.push(`Monitor weights must sum to 1.0, got ${wSum.toFixed(4)}`);
  }

  if (violations.length > 0) {
    throw new ConfigValidationError(violations);
  }
}

// ────────────────────────────────────────────
// § 7  Public API
// ────────────────────────────────────────────

/**
 * 解析最终配置。优先级：环境变量 > userOverrides > preset > DEFAULT
 * 
 * @example
 * ```ts
 * // 使用预设
 * const cfg = resolveConfig('complex_research');
 * 
 * // 预设 + 自定义覆写
 * const cfg = resolveConfig('standard', {
 *   timeout: { turnTimeoutMs: 900_000 },
 *   budget: { maxToolCalls: 50 },
 * });
 * 
 * // 纯默认
 * const cfg = resolveConfig();
 * ```
 */
export function resolveConfig(
  preset: PresetName = 'standard',
  userOverrides?: DeepPartial<ResilienceConfig>,
): ResilienceConfig {
  // Step 1: DEFAULT + preset diff
  const presetDiff = PRESET_OVERRIDES[preset] ?? {};
  let config = deepMerge(
    DEFAULT_CONFIG as unknown as Record<string, unknown>,
    presetDiff as unknown as DeepPartial<Record<string, unknown>>,
  ) as unknown as ResilienceConfig;

  // Step 2: + user overrides
  if (userOverrides) {
    config = deepMerge(
      config as unknown as Record<string, unknown>,
      userOverrides as unknown as DeepPartial<Record<string, unknown>>,
    ) as unknown as ResilienceConfig;
  }

  // Step 3: + env overrides (highest priority)
  config = applyEnvOverrides(config);

  // Step 4: validate
  validateConfig(config);

  return config;
}

/**
 * 将 toolTimeoutPatterns 中的 glob 字符串编译为 RegExp。
 * 在模块初始化时调用一次，运行时用编译后的 RegExp 匹配工具名。
 * 
 * @example
 * ```ts
 * const compiled = compileToolTimeoutPatterns(config.executor.toolTimeoutPatterns);
 * function getToolTimeout(toolName: string): number {
 *   for (const { regex, timeoutMs } of compiled) {
 *     if (regex.test(toolName)) return timeoutMs;
 *   }
 *   return config.executor.defaultToolTimeoutMs;
 * }
 * ```
 */
export function compileToolTimeoutPatterns(
  patterns: ToolTimeoutPattern[],
): Array<{ regex: RegExp; timeoutMs: number; description: string }> {
  return patterns.map(({ pattern, timeoutMs, description }) => {
    // 简单 glob → RegExp: * → .*, ? → .
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')   // escape regex specials (except * and ?)
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return {
      regex: new RegExp(`^${escaped}$`),
      timeoutMs,
      description,
    };
  });
}

// ────────────────────────────────────────────
// § 8  Pre-resolved Presets (Convenience)
// ────────────────────────────────────────────

/**
 * 预解析的四套配置，可直接使用。
 * 
 * @example
 * ```ts
 * import { RESILIENCE_PRESETS } from './resilience-config';
 * const cfg = RESILIENCE_PRESETS.complex_research;
 * ```
 */
export const RESILIENCE_PRESETS: Readonly<Record<PresetName, ResilienceConfig>> = {
  quick_task: resolveConfig('quick_task'),
  standard: resolveConfig('standard'),
  complex_research: resolveConfig('complex_research'),
  long_running: resolveConfig('long_running'),
};

// ────────────────────────────────────────────
// § 9  Zod Schema (Optional Integration)
// ────────────────────────────────────────────

/**
 * 若要与 BeeClaw 的 config/schema.ts 集成，在该文件中添加：
 * 
 * ```ts
 * import { z } from 'zod';
 * 
 * const RetryStrategySchema = z.object({
 *   maxRetries: z.number().int().min(0).default(3),
 *   baseDelayMs: z.number().positive().default(1000),
 *   maxDelayMs: z.number().positive().default(30000),
 *   backoffMultiplier: z.number().min(1).default(2),
 *   jitterFactor: z.number().min(0).max(1).default(0.2),
 * });
 * 
 * const ToolTimeoutPatternSchema = z.object({
 *   pattern: z.string().min(1),
 *   timeoutMs: z.number().positive(),
 *   description: z.string().optional(),
 * });
 * 
 * export const ResilienceConfigSchema = z.object({
 *   timeout: z.object({
 *     requestTimeoutMs: z.number().positive().default(30000),
 *     streamingRequestTimeoutMs: z.number().positive().default(120000),
 *     llmStepTimeoutMs: z.number().positive().default(180000),
 *     toolStepTimeoutMs: z.number().positive().default(300000),
 *     turnTimeoutMs: z.number().positive().default(600000),
 *     inactivityTimeoutMs: z.number().positive().default(600000),
 *     inactivityCheckIntervalMs: z.number().positive().default(30000),
 *   }),
 *   circuitBreaker: z.object({
 *     failureThreshold: z.number().int().min(1).default(5),
 *     resetTimeoutMs: z.number().positive().default(60000),
 *     halfOpenMaxAttempts: z.number().int().min(1).default(3),
 *     rollingWindowMs: z.number().positive().default(60000),
 *     rollingBuckets: z.number().int().min(1).default(10),
 *     volumeThreshold: z.number().int().min(1).default(5),
 *   }),
 *   loopDetector: z.object({
 *     exactDuplicateThreshold: z.number().int().min(1).default(3),
 *     semanticSimilarityThreshold: z.number().min(0).max(1).default(0.85),
 *     semanticWindowSize: z.number().int().min(2).default(10),
 *     progressStallRounds: z.number().int().min(1).default(5),
 *     progressGainThreshold: z.number().min(0).default(0.1),
 *     maxHistorySize: z.number().int().min(1).default(50),
 *   }),
 *   budget: z.object({
 *     maxTokens: z.number().int().positive().default(100000),
 *     maxToolCalls: z.number().int().positive().default(30),
 *     maxWallTimeMs: z.number().positive().default(600000),
 *     maxCostDollars: z.number().positive().default(5.0),
 *     warningThreshold: z.number().min(0).max(1).default(0.8),
 *     hardLimitThreshold: z.number().min(0).max(1).default(0.95),
 *   }),
 *   retry: z.object({
 *     ai_provider: RetryStrategySchema,
 *     feishu: RetryStrategySchema,
 *     mcp_tool: RetryStrategySchema,
 *     local_tool: RetryStrategySchema,
 *     rate_limit: RetryStrategySchema,
 *   }),
 *   executor: z.object({
 *     maxConcurrency: z.number().int().min(1).default(5),
 *     defaultToolTimeoutMs: z.number().positive().default(300000),
 *     gracefulShutdownMs: z.number().positive().default(5000),
 *     toolTimeoutPatterns: z.array(ToolTimeoutPatternSchema).default([]),
 *   }),
 *   monitor: z.object({
 *     healthWindowSize: z.number().int().min(1).default(10),
 *     weights: z.object({
 *       informationGain: z.number().default(0.35),
 *       toolSuccess: z.number().default(0.25),
 *       responseLatency: z.number().default(0.20),
 *       errorRate: z.number().default(0.20),
 *     }),
 *     healthAlertThreshold: z.number().min(0).max(100).default(40),
 *     adaptiveTimeoutMinMultiplier: z.number().positive().default(0.5),
 *     adaptiveTimeoutMaxMultiplier: z.number().positive().default(3.0),
 *   }),
 *   checkpoint: z.object({
 *     enabled: z.boolean().default(true),
 *     intervalSteps: z.number().int().min(1).default(5),
 *     maxSnapshots: z.number().int().min(1).default(10),
 *     compressionThresholdBytes: z.number().int().default(50000),
 *     restoreStrategyOrder: z.array(z.enum(['replay', 'snapshot', 'reset'])).default(['replay', 'snapshot', 'reset']),
 *   }),
 * }).describe('BeeClaw Resilience Configuration');
 * ```
 */
