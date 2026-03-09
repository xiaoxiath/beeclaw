/**
 * research-config.ts — 研究配置 Profile 管理
 * 
 * 为 Deep Research 流水线提供统一的配置中心，支持：
 * - 预设 Profile (quick / standard / comprehensive / custom)
 * - 每个维度独立配置
 * - 环境变量覆盖
 * - 配置验证
 * - 运行时动态调整
 * 
 * 与 resilience-config.ts 设计保持一致：
 *   env vars > user overrides > preset defaults > global defaults
 * 
 * @module research-config
 */

// ============================================================
// 类型定义
// ============================================================

export type ResearchPreset = 'quick' | 'standard' | 'comprehensive' | 'custom';

/** DeepPartial 递归可选 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/** 查询生成配置 */
export interface QueryConfig {
  /** 查询生成模型 */
  model: string;
  /** 模型温度 */
  temperature: number;
  /** 最大查询数 */
  maxQueries: number;
  /** 是否生成双语查询 */
  bilingual: boolean;

  /** 策略分配权重 */
  strategyWeights: {
    breadth: number;
    depth: number;
    data: number;
    recency: number;
    crossDomain: number;
    contrarian: number;
  };
}

/** 搜索配置 */
export interface SearchConfig {
  /** 并发搜索批大小 */
  batchSize: number;
  /** 单次搜索最大结果数 */
  maxResultsPerQuery: number;
  /** 单次搜索超时 (ms) */
  timeout: number;
  /** 优先使用的搜索提供者 */
  preferredProviders: string[];
  /** 去重时 URL 归一化规则 */
  deduplication: {
    /** 是否移除 tracking 参数 */
    removeTracking: boolean;
    /** 是否忽略 URL fragment */
    ignoreFragment: boolean;
    /** 是否归一化大小写 */
    normalizeCase: boolean;
  };
}

/** 抓取配置 */
export interface FetchConfig {
  /** 最大抓取源数 */
  maxSources: number;
  /** 并发抓取数 */
  concurrency: number;
  /** 单次抓取超时 (ms) */
  timeout: number;
  /** 每源最大内容字符数 */
  maxContentPerSource: number;
  /** 最小有效内容长度（低于此阈值的页面被丢弃） */
  minContentLength: number;
  /** 需要排除的域名模式 */
  excludeDomains: string[];
}

/** 综合配置 */
export interface SynthesisConfig {
  /** 综合模型 */
  model: string;
  /** 模型温度 */
  temperature: number;
  /** 是否启用可信度评估 */
  enableCredibility: boolean;
  /** 是否启用矛盾检测 */
  enableContradictions: boolean;
  /** 单批最大源数（超过则分批综合） */
  maxSourcesPerBatch: number;
  /** 上下文窗口估算阈值（tokens） */
  contextWindowLimit: number;
  /** 输出语言 */
  language: 'zh' | 'en' | 'auto';
}

/** 精炼配置 */
export interface RefinementConfig {
  /** 是否启用迭代精炼 */
  enabled: boolean;
  /** 最大精炼轮次 */
  maxRounds: number;
  /** 覆盖率阈值 (0-100) */
  coverageThreshold: number;
  /** 每轮最大补充查询数 */
  maxQueriesPerRound: number;
  /** 每轮最大新源数 */
  maxNewSourcesPerRound: number;
  /** 评估模型 */
  evaluationModel: string;
  /** 连续无改善停止阈值 */
  noImprovementLimit: number;
}

/** 进度配置 */
export interface ProgressConfig {
  /** 是否启用进度事件 */
  enabled: boolean;
  /** 进度事件最小间隔 (ms) */
  minEmitInterval: number;
  /** 是否输出 SSE 格式 */
  sseFormat: boolean;
  /** 阶段权重（用于 overall progress 计算） */
  phaseWeights: {
    planning: number;
    searching: number;
    fetching: number;
    synthesizing: number;
    refining: number;
    finalizing: number;
  };
}

/** 超时与资源配置 */
export interface ResourceConfig {
  /** 总超时 (ms) */
  totalTimeout: number;
  /** 最大 LLM 调用次数 */
  maxLLMCalls: number;
  /** 最大总源内容大小 (bytes) */
  maxTotalContentBytes: number;
  /** 是否启用 abort signal */
  enableAbort: boolean;
}

/** 完整研究配置 */
export interface ResearchConfig {
  query: QueryConfig;
  search: SearchConfig;
  fetch: FetchConfig;
  synthesis: SynthesisConfig;
  refinement: RefinementConfig;
  progress: ProgressConfig;
  resource: ResourceConfig;
}

// ============================================================
// 默认配置
// ============================================================

export const DEFAULT_RESEARCH_CONFIG: ResearchConfig = {
  query: {
    model: 'gpt-4o-mini',
    temperature: 0.7,
    maxQueries: 12,
    bilingual: true,
    strategyWeights: {
      breadth: 3,
      depth: 3,
      data: 2,
      recency: 2,
      crossDomain: 1,
      contrarian: 1,
    },
  },

  search: {
    batchSize: 3,
    maxResultsPerQuery: 10,
    timeout: 15_000,
    preferredProviders: ['bocha', 'tavily', 'google'],
    deduplication: {
      removeTracking: true,
      ignoreFragment: true,
      normalizeCase: true,
    },
  },

  fetch: {
    maxSources: 20,
    concurrency: 5,
    timeout: 10_000,
    maxContentPerSource: 15_000,
    minContentLength: 100,
    excludeDomains: [
      'pinterest.com',
      'instagram.com',
      'facebook.com',
      'twitter.com',
      'x.com',
      'tiktok.com',
    ],
  },

  synthesis: {
    model: 'gpt-4o',
    temperature: 0.3,
    enableCredibility: true,
    enableContradictions: true,
    maxSourcesPerBatch: 15,
    contextWindowLimit: 100_000,
    language: 'auto',
  },

  refinement: {
    enabled: true,
    maxRounds: 2,
    coverageThreshold: 75,
    maxQueriesPerRound: 5,
    maxNewSourcesPerRound: 8,
    evaluationModel: 'gpt-4o-mini',
    noImprovementLimit: 2,
  },

  progress: {
    enabled: true,
    minEmitInterval: 500,
    sseFormat: false,
    phaseWeights: {
      planning: 0.08,
      searching: 0.17,
      fetching: 0.20,
      synthesizing: 0.25,
      refining: 0.22,
      finalizing: 0.08,
    },
  },

  resource: {
    totalTimeout: 180_000,
    maxLLMCalls: 30,
    maxTotalContentBytes: 10_000_000, // 10MB
    enableAbort: true,
  },
};

// ============================================================
// 预设覆盖（差异化配置）
// ============================================================

/**
 * 预设只定义与 DEFAULT 的差异部分
 */
const PRESET_OVERRIDES: Record<ResearchPreset, DeepPartial<ResearchConfig>> = {
  quick: {
    query: {
      maxQueries: 5,
      bilingual: false,
      strategyWeights: {
        breadth: 3,
        depth: 1,
        data: 1,
        recency: 0,
        crossDomain: 0,
        contrarian: 0,
      },
    },
    search: {
      batchSize: 5, // 全部并发
      maxResultsPerQuery: 5,
      timeout: 10_000,
    },
    fetch: {
      maxSources: 8,
      concurrency: 4,
      timeout: 8_000,
      maxContentPerSource: 5_000,
    },
    synthesis: {
      model: 'gpt-4o-mini',
      enableCredibility: false,
      enableContradictions: false,
    },
    refinement: {
      enabled: false,
      maxRounds: 0,
    },
    resource: {
      totalTimeout: 60_000,
      maxLLMCalls: 10,
    },
  },

  standard: {
    // standard 即 DEFAULT，无需覆盖
  },

  comprehensive: {
    query: {
      maxQueries: 21,
      strategyWeights: {
        breadth: 4,
        depth: 5,
        data: 4,
        recency: 3,
        crossDomain: 3,
        contrarian: 2,
      },
    },
    search: {
      maxResultsPerQuery: 15,
    },
    fetch: {
      maxSources: 40,
      concurrency: 6,
      timeout: 12_000,
      maxContentPerSource: 30_000,
    },
    synthesis: {
      maxSourcesPerBatch: 20,
    },
    refinement: {
      maxRounds: 3,
      coverageThreshold: 85,
      maxQueriesPerRound: 8,
      maxNewSourcesPerRound: 12,
    },
    resource: {
      totalTimeout: 300_000,
      maxLLMCalls: 50,
      maxTotalContentBytes: 20_000_000,
    },
  },

  custom: {
    // custom 完全由用户定义，此处为空占位
  },
};

// ============================================================
// 配置解析
// ============================================================

/**
 * 深合并两个对象
 */
function deepMerge<T extends Record<string, any>>(target: T, source: DeepPartial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceVal = source[key];
    if (sourceVal === undefined) continue;

    if (
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key] as any, sourceVal as any);
    } else {
      result[key] = sourceVal as T[keyof T];
    }
  }
  return result;
}

/**
 * 从环境变量读取覆盖
 * 
 * 格式: BEECLAW_RESEARCH_{SECTION}_{KEY}
 * 示例:
 *   BEECLAW_RESEARCH_QUERY_MAXQUERIES=8
 *   BEECLAW_RESEARCH_FETCH_CONCURRENCY=3
 *   BEECLAW_RESEARCH_RESOURCE_TOTALTIMEOUT=120000
 *   BEECLAW_RESEARCH_REFINEMENT_ENABLED=false
 */
function applyEnvOverrides(config: ResearchConfig): ResearchConfig {
  const prefix = 'BEECLAW_RESEARCH_';
  const result = structuredClone(config);

  for (const [envKey, envValue] of Object.entries(process.env)) {
    if (!envKey.startsWith(prefix) || envValue === undefined) continue;

    const path = envKey.slice(prefix.length).toLowerCase();
    const parts = path.split('_');
    if (parts.length < 2) continue;

    const section = parts[0] as keyof ResearchConfig;
    const key = parts.slice(1).join('');

    if (!(section in result)) continue;

    const sectionObj = result[section] as Record<string, any>;
    // 匹配 key（大小写不敏感）
    const actualKey = Object.keys(sectionObj).find(
      k => k.toLowerCase() === key
    );

    if (!actualKey) continue;

    const currentValue = sectionObj[actualKey];
    sectionObj[actualKey] = coerceValue(envValue, typeof currentValue);
  }

  return result;
}

function coerceValue(value: string, targetType: string): any {
  switch (targetType) {
    case 'number': {
      const n = Number(value);
      return isNaN(n) ? undefined : n;
    }
    case 'boolean':
      return value === 'true' || value === '1';
    case 'string':
      return value;
    default:
      // 尝试 JSON 解析（用于数组、对象）
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
  }
}

// ============================================================
// 配置验证
// ============================================================

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateResearchConfig(config: ResearchConfig): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 查询
  if (config.query.maxQueries < 1 || config.query.maxQueries > 50) {
    errors.push(`query.maxQueries must be 1-50, got ${config.query.maxQueries}`);
  }
  if (config.query.temperature < 0 || config.query.temperature > 2) {
    errors.push(`query.temperature must be 0-2, got ${config.query.temperature}`);
  }

  // 搜索
  if (config.search.batchSize < 1 || config.search.batchSize > 10) {
    errors.push(`search.batchSize must be 1-10, got ${config.search.batchSize}`);
  }
  if (config.search.timeout < 1000) {
    warnings.push(`search.timeout is very low (${config.search.timeout}ms), may cause frequent failures`);
  }

  // 抓取
  if (config.fetch.maxSources < 1 || config.fetch.maxSources > 100) {
    errors.push(`fetch.maxSources must be 1-100, got ${config.fetch.maxSources}`);
  }
  if (config.fetch.concurrency < 1 || config.fetch.concurrency > 20) {
    errors.push(`fetch.concurrency must be 1-20, got ${config.fetch.concurrency}`);
  }
  if (config.fetch.maxContentPerSource < 500) {
    warnings.push(`fetch.maxContentPerSource (${config.fetch.maxContentPerSource}) may truncate important content`);
  }

  // 综合
  if (config.synthesis.temperature < 0 || config.synthesis.temperature > 1) {
    errors.push(`synthesis.temperature must be 0-1, got ${config.synthesis.temperature}`);
  }
  if (config.synthesis.maxSourcesPerBatch < 1) {
    errors.push(`synthesis.maxSourcesPerBatch must be >= 1`);
  }

  // 精炼
  if (config.refinement.enabled) {
    if (config.refinement.maxRounds < 1 || config.refinement.maxRounds > 10) {
      errors.push(`refinement.maxRounds must be 1-10 when enabled, got ${config.refinement.maxRounds}`);
    }
    if (config.refinement.coverageThreshold < 0 || config.refinement.coverageThreshold > 100) {
      errors.push(`refinement.coverageThreshold must be 0-100, got ${config.refinement.coverageThreshold}`);
    }
  }

  // 进度
  const weightSum = Object.values(config.progress.phaseWeights).reduce((s, w) => s + w, 0);
  if (Math.abs(weightSum - 1.0) > 0.01) {
    warnings.push(`progress.phaseWeights sum is ${weightSum.toFixed(3)}, expected ~1.0`);
  }

  // 资源
  if (config.resource.totalTimeout < 10_000) {
    warnings.push(`resource.totalTimeout (${config.resource.totalTimeout}ms) may be too short for meaningful research`);
  }
  if (config.resource.maxLLMCalls < 3) {
    errors.push(`resource.maxLLMCalls must be >= 3 (minimum for query + synthesis + format)`);
  }

  // 交叉验证
  if (config.fetch.timeout >= config.resource.totalTimeout) {
    errors.push(`fetch.timeout (${config.fetch.timeout}) must be < resource.totalTimeout (${config.resource.totalTimeout})`);
  }
  if (config.search.timeout >= config.resource.totalTimeout) {
    errors.push(`search.timeout (${config.search.timeout}) must be < resource.totalTimeout (${config.resource.totalTimeout})`);
  }

  const estimatedMinTime =
    config.search.timeout * Math.ceil(config.query.maxQueries / config.search.batchSize) +
    config.fetch.timeout * Math.ceil(config.fetch.maxSources / config.fetch.concurrency);
  if (estimatedMinTime > config.resource.totalTimeout * 0.8) {
    warnings.push(
      `Estimated minimum I/O time (${(estimatedMinTime / 1000).toFixed(1)}s) is close to totalTimeout (${(config.resource.totalTimeout / 1000).toFixed(1)}s). Consider increasing totalTimeout or reducing maxQueries/maxSources.`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================
// 公共 API
// ============================================================

/**
 * 解析研究配置
 * 
 * 优先级: env vars > userOverrides > preset > DEFAULT
 * 
 * @example
 * ```ts
 * // 使用预设
 * const config = resolveResearchConfig('comprehensive');
 * 
 * // 使用预设 + 自定义覆盖
 * const config = resolveResearchConfig('standard', {
 *   fetch: { maxSources: 30 },
 *   refinement: { maxRounds: 3 },
 * });
 * 
 * // 纯自定义
 * const config = resolveResearchConfig('custom', myFullConfig);
 * ```
 */
export function resolveResearchConfig(
  preset: ResearchPreset = 'standard',
  userOverrides?: DeepPartial<ResearchConfig>
): ResearchConfig {
  // Layer 1: Start with defaults
  let config = structuredClone(DEFAULT_RESEARCH_CONFIG);

  // Layer 2: Apply preset overrides
  const presetOverride = PRESET_OVERRIDES[preset];
  if (presetOverride && Object.keys(presetOverride).length > 0) {
    config = deepMerge(config, presetOverride);
  }

  // Layer 3: Apply user overrides
  if (userOverrides && Object.keys(userOverrides).length > 0) {
    config = deepMerge(config, userOverrides);
  }

  // Layer 4: Apply environment variable overrides
  config = applyEnvOverrides(config);

  // Validate
  const validation = validateResearchConfig(config);
  if (!validation.valid) {
    const errorMsg = `Invalid research config: ${validation.errors.join('; ')}`;
    throw new Error(errorMsg);
  }

  if (validation.warnings.length > 0) {
    console.warn(`[ResearchConfig] Warnings: ${validation.warnings.join('; ')}`);
  }

  return config;
}

/**
 * 预解析常用预设（启动时计算，避免运行时开销）
 */
export const RESEARCH_PRESETS: Record<Exclude<ResearchPreset, 'custom'>, ResearchConfig> = {
  quick: resolveResearchConfig('quick'),
  standard: resolveResearchConfig('standard'),
  comprehensive: resolveResearchConfig('comprehensive'),
};

/**
 * 从 DeepResearchV2Config 转换为完整 ResearchConfig
 * 
 * 用于向后兼容 deep-research-v2.ts 的简化配置接口
 */
export function fromSimpleConfig(simple: {
  depth?: 'quick' | 'standard' | 'comprehensive';
  maxQueries?: number;
  maxSources?: number;
  maxContentPerSource?: number;
  maxRefinementRounds?: number;
  coverageThreshold?: number;
  fetchConcurrency?: number;
  synthesisModel?: string;
  queryModel?: string;
  language?: 'zh' | 'en' | 'auto';
  enableCredibility?: boolean;
  enableContradictions?: boolean;
  enableRefinement?: boolean;
  totalTimeout?: number;
  searchTimeout?: number;
  fetchTimeout?: number;
}): ResearchConfig {
  const preset = simple.depth ?? 'standard';

  const overrides: DeepPartial<ResearchConfig> = {};

  if (simple.maxQueries != null) {
    overrides.query = { ...overrides.query, maxQueries: simple.maxQueries };
  }
  if (simple.queryModel != null) {
    overrides.query = { ...overrides.query, model: simple.queryModel };
  }
  if (simple.maxSources != null) {
    overrides.fetch = { ...overrides.fetch, maxSources: simple.maxSources };
  }
  if (simple.fetchConcurrency != null) {
    overrides.fetch = { ...overrides.fetch, concurrency: simple.fetchConcurrency };
  }
  if (simple.maxContentPerSource != null) {
    overrides.fetch = { ...overrides.fetch, maxContentPerSource: simple.maxContentPerSource };
  }
  if (simple.fetchTimeout != null) {
    overrides.fetch = { ...overrides.fetch, timeout: simple.fetchTimeout };
  }
  if (simple.synthesisModel != null) {
    overrides.synthesis = { ...overrides.synthesis, model: simple.synthesisModel };
  }
  if (simple.language != null) {
    overrides.synthesis = { ...overrides.synthesis, language: simple.language };
  }
  if (simple.enableCredibility != null) {
    overrides.synthesis = { ...overrides.synthesis, enableCredibility: simple.enableCredibility };
  }
  if (simple.enableContradictions != null) {
    overrides.synthesis = { ...overrides.synthesis, enableContradictions: simple.enableContradictions };
  }
  if (simple.enableRefinement != null) {
    overrides.refinement = { ...overrides.refinement, enabled: simple.enableRefinement };
  }
  if (simple.maxRefinementRounds != null) {
    overrides.refinement = { ...overrides.refinement, maxRounds: simple.maxRefinementRounds };
  }
  if (simple.coverageThreshold != null) {
    overrides.refinement = { ...overrides.refinement, coverageThreshold: simple.coverageThreshold };
  }
  if (simple.searchTimeout != null) {
    overrides.search = { ...overrides.search, timeout: simple.searchTimeout };
  }
  if (simple.totalTimeout != null) {
    overrides.resource = { ...overrides.resource, totalTimeout: simple.totalTimeout };
  }

  return resolveResearchConfig(preset, overrides);
}

// ============================================================
// 运行时动态调整
// ============================================================

/**
 * 基于运行时反馈动态调整配置
 * 
 * 用于在研究执行过程中根据实际性能表现自适应调参。
 * 
 * @example
 * ```ts
 * // 搜索阶段完成后，根据实际耗时调整抓取并发
 * const adjusted = adjustConfigAtRuntime(config, {
 *   searchPhaseAvgLatencyMs: 2500,
 *   fetchSuccessRate: 0.6,
 *   currentSourceCount: 5,
 *   remainingTimeMs: 120000,
 * });
 * ```
 */
export function adjustConfigAtRuntime(
  config: ResearchConfig,
  feedback: {
    searchPhaseAvgLatencyMs?: number;
    fetchSuccessRate?: number;
    currentSourceCount?: number;
    remainingTimeMs?: number;
    llmCallsUsed?: number;
  }
): ResearchConfig {
  const adjusted = structuredClone(config);

  // 如果搜索延迟高，降低后续搜索并发
  if (feedback.searchPhaseAvgLatencyMs && feedback.searchPhaseAvgLatencyMs > 5000) {
    adjusted.search.batchSize = Math.max(1, adjusted.search.batchSize - 1);
  }

  // 如果抓取成功率低，增加目标源数以补偿
  if (feedback.fetchSuccessRate != null && feedback.fetchSuccessRate < 0.5) {
    adjusted.fetch.maxSources = Math.min(
      adjusted.fetch.maxSources * 1.5,
      100
    );
  }

  // 如果剩余时间紧张，缩减精炼轮次
  if (feedback.remainingTimeMs != null && feedback.remainingTimeMs < adjusted.resource.totalTimeout * 0.3) {
    adjusted.refinement.maxRounds = Math.max(0, adjusted.refinement.maxRounds - 1);
    if (adjusted.refinement.maxRounds === 0) {
      adjusted.refinement.enabled = false;
    }
  }

  // 如果 LLM 调用接近上限，禁用可信度和矛盾检测以节省调用
  if (
    feedback.llmCallsUsed != null &&
    feedback.llmCallsUsed > adjusted.resource.maxLLMCalls * 0.7
  ) {
    adjusted.synthesis.enableCredibility = false;
    adjusted.synthesis.enableContradictions = false;
  }

  return adjusted;
}

// ============================================================
// 预设对比表（文档用途）
// ============================================================

/**
 * 获取所有预设的对比数据，适合生成文档或 UI 展示
 */
export function getPresetComparison(): Array<{
  preset: string;
  queries: number;
  sources: number;
  contentPerSource: string;
  refinement: string;
  timeout: string;
  synthesisModel: string;
  estimatedDuration: string;
}> {
  return [
    {
      preset: 'quick',
      queries: RESEARCH_PRESETS.quick.query.maxQueries,
      sources: RESEARCH_PRESETS.quick.fetch.maxSources,
      contentPerSource: `${(RESEARCH_PRESETS.quick.fetch.maxContentPerSource / 1000).toFixed(0)}K`,
      refinement: 'Off',
      timeout: `${RESEARCH_PRESETS.quick.resource.totalTimeout / 1000}s`,
      synthesisModel: RESEARCH_PRESETS.quick.synthesis.model,
      estimatedDuration: '30-60s',
    },
    {
      preset: 'standard',
      queries: RESEARCH_PRESETS.standard.query.maxQueries,
      sources: RESEARCH_PRESETS.standard.fetch.maxSources,
      contentPerSource: `${(RESEARCH_PRESETS.standard.fetch.maxContentPerSource / 1000).toFixed(0)}K`,
      refinement: `${RESEARCH_PRESETS.standard.refinement.maxRounds} rounds`,
      timeout: `${RESEARCH_PRESETS.standard.resource.totalTimeout / 1000}s`,
      synthesisModel: RESEARCH_PRESETS.standard.synthesis.model,
      estimatedDuration: '1-3min',
    },
    {
      preset: 'comprehensive',
      queries: RESEARCH_PRESETS.comprehensive.query.maxQueries,
      sources: RESEARCH_PRESETS.comprehensive.fetch.maxSources,
      contentPerSource: `${(RESEARCH_PRESETS.comprehensive.fetch.maxContentPerSource / 1000).toFixed(0)}K`,
      refinement: `${RESEARCH_PRESETS.comprehensive.refinement.maxRounds} rounds`,
      timeout: `${RESEARCH_PRESETS.comprehensive.resource.totalTimeout / 1000}s`,
      synthesisModel: RESEARCH_PRESETS.comprehensive.synthesis.model,
      estimatedDuration: '3-5min',
    },
  ];
}
