/**
 * P3-#18: 统一配置中心
 * 
 * 原始问题：配置参数散落在各个模块中：
 *   - tools.ts: SYSTEM_PROMPTS 常量、locale 硬编码
 *   - compression.ts: DEFAULT_COMPRESSION_CONFIG（阈值、cron 表达式）
 *   - scoring.ts: SCORING_WEIGHTS、THRESHOLDS、goalKeywords
 *   - indexer.ts: 中文分词正则和词表
 *   - store.ts: categories 数组、默认文件名、中文标题映射
 *   - types.ts: retention 配置
 * 
 * 优化方案：
 * 1. 集中化配置 — 所有模块配置统一管理
 * 2. 环境感知 — 支持 dev/staging/prod 多环境
 * 3. 配置验证 — 运行时类型检查和默认值填充
 * 4. 热更新 — 支持运行时动态修改配置
 * 5. 配置文件加载 — 从 JSON/YAML/环境变量加载
 * 6. 配置快照 — 版本化配置变更历史
 */

// ─── 类型定义 ─────────────────────────────────────────────

/** Agent 配置 */
export interface AgentConfig {
  /** 默认 AI 提供者 */
  defaultProvider: string;
  /** 默认模型 */
  defaultModel: string;
  /** 最大迭代次数 */
  maxIterations: number;
  /** 上下文窗口大小 */
  contextWindowTokens: number;
  /** 系统提示词 tier */
  promptTier: 'concise' | 'default' | 'verbose';
  /** 默认语言 */
  locale: string;
  /** 时区 */
  timezone?: string;
  /** 流式输出 */
  streamEnabled: boolean;
}

/** 记忆配置 */
export interface MemoryConfig {
  /** 存储类型 */
  storageType: 'filesystem';
  /** 基础路径 */
  basePath: string;
  /** 索引文件名 */
  indexFileName: string;
  /** 启用的记忆类别 */
  categories: string[];
  /** 默认事实文件 */
  defaultFactFiles: string[];
  /** 类别标题映射 */
  categoryTitles: Record<string, string>;
}

/** 记忆保留配置 */
export interface RetentionConfig {
  /** 各类别保留时间 */
  conversations: string;
  facts: string;
  decisions: string;
  skills: string;
  summaries: string;
}

/** 压缩配置 */
export interface CompressionConfig {
  /** 是否自动压缩 */
  autoCompress: boolean;
  /** 压缩延迟天数 */
  compressAfterDays: number;
  /** 定时任务 cron */
  runSchedule: string;
  /** 保留原始天数 */
  keepOriginalDays: number;
  /** 归档天数 */
  archiveAfterDays: number;
}

/** 评分配置 */
export interface ScoringConfig {
  /** 评分权重 */
  weights: {
    recency: number;
    frequency: number;
    relevance: number;
    uniqueness: number;
    userMarked: number;
  };
  /** 分级阈值 */
  thresholds: {
    keep: number;
    summarize: number;
    archive: number;
  };
  /** 目标关键词 */
  goalKeywords: string[];
  /** 去重相似度阈值 */
  deduplicationThreshold: number;
}

/** 索引配置 */
export interface IndexerConfig {
  /** 中文分词正则模式 */
  chinesePatterns: string[];
  /** 自定义词典 */
  customDictionary: Record<string, string>;
  /** 英文停用词 */
  englishStopWords: string[];
  /** 最大关键词数 */
  maxKeywords: number;
}

/** 搜索配置 */
export interface SearchConfig {
  /** 关键词搜索权重 */
  keywordWeight: number;
  /** 向量搜索权重 */
  vectorWeight: number;
  /** 时间衰减权重 */
  recencyWeight: number;
  /** 最大结果数 */
  maxResults: number;
  /** 最低相关度 */
  minRelevanceScore: number;
}

/** 可观测性配置 */
export interface ObservabilitySettingsConfig {
  /** 日志级别 */
  logLevel: 'debug' | 'info' | 'warn' | 'error' | 'silent';
  /** 结构化日志 */
  structuredLogging: boolean;
  /** 启用 tracing */
  tracingEnabled: boolean;
  /** 启用 metrics */
  metricsEnabled: boolean;
}

/** 完整配置 */
export interface BeeclawConfig {
  /** 环境 */
  env: 'development' | 'staging' | 'production';
  /** Agent 配置 */
  agent: AgentConfig;
  /** 记忆配置 */
  memory: MemoryConfig;
  /** 保留配置 */
  retention: RetentionConfig;
  /** 压缩配置 */
  compression: CompressionConfig;
  /** 评分配置 */
  scoring: ScoringConfig;
  /** 索引配置 */
  indexer: IndexerConfig;
  /** 搜索配置 */
  search: SearchConfig;
  /** 可观测性配置 */
  observability: ObservabilitySettingsConfig;
}

/** 配置变更事件 */
export interface ConfigChangeEvent {
  path: string;
  oldValue: unknown;
  newValue: unknown;
  timestamp: number;
  source: 'code' | 'file' | 'env' | 'runtime';
}

/** 配置变更监听器 */
export type ConfigChangeListener = (event: ConfigChangeEvent) => void;

// ─── 默认配置 ──────────────────────────────────────────────

const DEFAULT_CONFIG: BeeclawConfig = {
  env: 'development',

  agent: {
    defaultProvider: 'openai',
    defaultModel: 'gpt-4',
    maxIterations: 25,
    contextWindowTokens: 128000,
    promptTier: 'default',
    locale: 'zh-CN',
    timezone: undefined,
    streamEnabled: true,
  },

  memory: {
    storageType: 'filesystem',
    basePath: './data/memory',
    indexFileName: 'index.json',
    categories: ['conversations', 'facts', 'decisions', 'skills'],
    defaultFactFiles: ['preferences.md'],
    categoryTitles: {
      user: '用户画像',
      preferences: '偏好设置',
      events: '重要事件',
      investments: '投资持仓',
      lessons: '经验教训',
    },
  },

  retention: {
    conversations: '90d',
    facts: 'forever',
    decisions: 'forever',
    skills: 'forever',
    summaries: '365d',
  },

  compression: {
    autoCompress: true,
    compressAfterDays: 7,
    runSchedule: '0 3 * * *',
    keepOriginalDays: 7,
    archiveAfterDays: 90,
  },

  scoring: {
    weights: {
      recency: 0.25,
      frequency: 0.20,
      relevance: 0.25,
      uniqueness: 0.20,
      userMarked: 0.10,
    },
    thresholds: {
      keep: 60,
      summarize: 40,
      archive: 20,
    },
    goalKeywords: ['goal', 'objective', 'target', 'milestone', 'progress', 'complete'],
    deduplicationThreshold: 0.7,
  },

  indexer: {
    chinesePatterns: [
      '[\\u4e00-\\u9fff]{2,8}',
    ],
    customDictionary: {},
    englishStopWords: [
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
      'should', 'may', 'might', 'must', 'can', 'could', 'of', 'at', 'by',
      'for', 'with', 'about', 'against', 'between', 'through', 'during',
      'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down',
      'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further',
      'then', 'once', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet',
    ],
    maxKeywords: 30,
  },

  search: {
    keywordWeight: 0.4,
    vectorWeight: 0.4,
    recencyWeight: 0.2,
    maxResults: 10,
    minRelevanceScore: 0.1,
  },

  observability: {
    logLevel: 'info',
    structuredLogging: false,
    tracingEnabled: true,
    metricsEnabled: true,
  },
};

// ─── 配置验证 ──────────────────────────────────────────────

interface ValidationError {
  path: string;
  message: string;
}

function validateConfig(config: Partial<BeeclawConfig>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (config.agent) {
    if (config.agent.maxIterations !== undefined && config.agent.maxIterations < 1) {
      errors.push({ path: 'agent.maxIterations', message: 'Must be >= 1' });
    }
    if (config.agent.contextWindowTokens !== undefined && config.agent.contextWindowTokens < 1000) {
      errors.push({ path: 'agent.contextWindowTokens', message: 'Must be >= 1000' });
    }
  }

  if (config.scoring?.weights) {
    const w = config.scoring.weights;
    const sum = (w.recency || 0) + (w.frequency || 0) + (w.relevance || 0) +
                (w.uniqueness || 0) + (w.userMarked || 0);
    if (Math.abs(sum - 1.0) > 0.01) {
      errors.push({ path: 'scoring.weights', message: `Weights must sum to 1.0, got ${sum.toFixed(2)}` });
    }
  }

  if (config.compression) {
    if (config.compression.compressAfterDays !== undefined && config.compression.compressAfterDays < 1) {
      errors.push({ path: 'compression.compressAfterDays', message: 'Must be >= 1' });
    }
    if (config.compression.archiveAfterDays !== undefined &&
        config.compression.compressAfterDays !== undefined &&
        config.compression.archiveAfterDays < config.compression.compressAfterDays) {
      errors.push({ path: 'compression.archiveAfterDays', message: 'Must be >= compressAfterDays' });
    }
  }

  if (config.search) {
    const s = config.search;
    const sum = (s.keywordWeight || 0) + (s.vectorWeight || 0) + (s.recencyWeight || 0);
    if (Math.abs(sum - 1.0) > 0.01) {
      errors.push({ path: 'search weights', message: `Search weights must sum to 1.0, got ${sum.toFixed(2)}` });
    }
  }

  return errors;
}

// ─── 核心实现 ─────────────────────────────────────────────

/**
 * 统一配置中心
 */
class ConfigCenter {
  private config: BeeclawConfig;
  private listeners: ConfigChangeListener[] = [];
  private history: ConfigChangeEvent[] = [];
  private maxHistorySize = 100;

  constructor() {
    this.config = this.deepClone(DEFAULT_CONFIG);
  }

  /**
   * 获取完整配置
   */
  getAll(): Readonly<BeeclawConfig> {
    return this.config;
  }

  /**
   * 获取指定路径的配置值
   * 
   * @example
   * config.get('agent.maxIterations') // 25
   * config.get('scoring.weights.recency') // 0.25
   */
  get<T = unknown>(path: string): T | undefined {
    const parts = path.split('.');
    let current: unknown = this.config;

    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current as T;
  }

  /**
   * 设置指定路径的配置值
   */
  set(path: string, value: unknown, source: 'code' | 'file' | 'env' | 'runtime' = 'code'): void {
    const parts = path.split('.');
    let current: Record<string, unknown> = this.config as unknown as Record<string, unknown>;
    const oldValue = this.get(path);

    for (let i = 0; i < parts.length - 1; i++) {
      if (current[parts[i]] === undefined || typeof current[parts[i]] !== 'object') {
        current[parts[i]] = {};
      }
      current = current[parts[i]] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;

    // 记录变更
    const event: ConfigChangeEvent = {
      path,
      oldValue,
      newValue: value,
      timestamp: Date.now(),
      source,
    };

    this.history.push(event);
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-this.maxHistorySize);
    }

    // 通知监听器
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[ConfigCenter] Listener error:', error);
      }
    }
  }

  /**
   * 批量更新配置
   */
  update(partial: DeepPartial<BeeclawConfig>, source: 'code' | 'file' | 'env' | 'runtime' = 'code'): ValidationError[] {
    // 验证
    const errors = validateConfig(partial as Partial<BeeclawConfig>);
    if (errors.length > 0) return errors;

    // 递归合并
    this.deepMerge(this.config, partial, '', source);
    return [];
  }

  /**
   * 从 JSON 文件加载配置
   */
  loadFromFile(filePath: string): ValidationError[] {
    const fs = require('fs');
    if (!fs.existsSync(filePath)) {
      return [{ path: filePath, message: 'Config file not found' }];
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return this.update(parsed, 'file');
    } catch (error) {
      return [{ path: filePath, message: `Failed to parse: ${error}` }];
    }
  }

  /**
   * 从环境变量加载配置
   * 
   * 环境变量命名规则：BEECLAW_<SECTION>_<KEY>
   * 例如：BEECLAW_AGENT_MAX_ITERATIONS=30
   */
  loadFromEnv(prefix = 'BEECLAW'): number {
    let loaded = 0;

    const envMapping: Record<string, { path: string; type: 'string' | 'number' | 'boolean' }> = {
      [`${prefix}_ENV`]: { path: 'env', type: 'string' },
      [`${prefix}_AGENT_PROVIDER`]: { path: 'agent.defaultProvider', type: 'string' },
      [`${prefix}_AGENT_MODEL`]: { path: 'agent.defaultModel', type: 'string' },
      [`${prefix}_AGENT_MAX_ITERATIONS`]: { path: 'agent.maxIterations', type: 'number' },
      [`${prefix}_AGENT_CONTEXT_WINDOW`]: { path: 'agent.contextWindowTokens', type: 'number' },
      [`${prefix}_AGENT_LOCALE`]: { path: 'agent.locale', type: 'string' },
      [`${prefix}_AGENT_STREAM`]: { path: 'agent.streamEnabled', type: 'boolean' },
      [`${prefix}_MEMORY_BASE_PATH`]: { path: 'memory.basePath', type: 'string' },
      [`${prefix}_COMPRESSION_AUTO`]: { path: 'compression.autoCompress', type: 'boolean' },
      [`${prefix}_COMPRESSION_AFTER_DAYS`]: { path: 'compression.compressAfterDays', type: 'number' },
      [`${prefix}_COMPRESSION_ARCHIVE_DAYS`]: { path: 'compression.archiveAfterDays', type: 'number' },
      [`${prefix}_LOG_LEVEL`]: { path: 'observability.logLevel', type: 'string' },
      [`${prefix}_STRUCTURED_LOG`]: { path: 'observability.structuredLogging', type: 'boolean' },
      [`${prefix}_TRACING`]: { path: 'observability.tracingEnabled', type: 'boolean' },
      [`${prefix}_METRICS`]: { path: 'observability.metricsEnabled', type: 'boolean' },
      [`${prefix}_SCORING_DEDUP_THRESHOLD`]: { path: 'scoring.deduplicationThreshold', type: 'number' },
      [`${prefix}_SEARCH_MAX_RESULTS`]: { path: 'search.maxResults', type: 'number' },
    };

    for (const [envKey, mapping] of Object.entries(envMapping)) {
      const envValue = process.env[envKey];
      if (envValue !== undefined) {
        let parsed: unknown;
        switch (mapping.type) {
          case 'number':
            parsed = parseFloat(envValue);
            if (isNaN(parsed as number)) continue;
            break;
          case 'boolean':
            parsed = envValue.toLowerCase() === 'true' || envValue === '1';
            break;
          default:
            parsed = envValue;
        }
        this.set(mapping.path, parsed, 'env');
        loaded++;
      }
    }

    return loaded;
  }

  /**
   * 保存当前配置到文件
   */
  saveToFile(filePath: string): void {
    const fs = require('fs');
    const path = require('path');
    const dirPath = path.dirname(filePath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  /**
   * 重置为默认配置
   */
  reset(): void {
    this.config = this.deepClone(DEFAULT_CONFIG);
    this.history = [];
  }

  /**
   * 获取指定环境的预设配置
   */
  applyEnvironmentPreset(env: 'development' | 'staging' | 'production'): void {
    const presets: Record<string, DeepPartial<BeeclawConfig>> = {
      development: {
        observability: { logLevel: 'debug', structuredLogging: false },
        compression: { autoCompress: false },
      },
      staging: {
        observability: { logLevel: 'info', structuredLogging: true },
        compression: { autoCompress: true },
      },
      production: {
        observability: { logLevel: 'warn', structuredLogging: true },
        compression: { autoCompress: true, compressAfterDays: 3 },
        agent: { maxIterations: 20 },
      },
    };

    if (presets[env]) {
      this.update({ env, ...presets[env] } as DeepPartial<BeeclawConfig>, 'code');
    }
  }

  /**
   * 注册配置变更监听器
   */
  onChange(listener: ConfigChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /**
   * 获取配置变更历史
   */
  getHistory(limit?: number): ConfigChangeEvent[] {
    const events = [...this.history].reverse();
    return limit ? events.slice(0, limit) : events;
  }

  /**
   * 获取配置快照（用于调试）
   */
  snapshot(): string {
    return JSON.stringify(this.config, null, 2);
  }

  // ─── 内部方法 ──────────────────────────────────────────

  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  private deepMerge(
    target: Record<string, unknown>,
    source: Record<string, unknown>,
    prefix: string,
    changeSource: 'code' | 'file' | 'env' | 'runtime'
  ): void {
    for (const [key, value] of Object.entries(source)) {
      const path = prefix ? `${prefix}.${key}` : key;

      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        if (typeof target[key] !== 'object' || target[key] === null) {
          target[key] = {};
        }
        this.deepMerge(
          target[key] as Record<string, unknown>,
          value as Record<string, unknown>,
          path,
          changeSource
        );
      } else {
        const oldValue = target[key];
        if (oldValue !== value) {
          target[key] = value;
          const event: ConfigChangeEvent = {
            path,
            oldValue,
            newValue: value,
            timestamp: Date.now(),
            source: changeSource,
          };
          this.history.push(event);
          for (const listener of this.listeners) {
            try { listener(event); } catch { /* ignore */ }
          }
        }
      }
    }
  }
}

/** DeepPartial 工具类型 */
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? U[]
    : T[P] extends object
      ? DeepPartial<T[P]>
      : T[P];
};

// ─── 全局单例 ─────────────────────────────────────────────

/** 全局配置中心实例 */
export const config = new ConfigCenter();

/**
 * 初始化配置（项目启动时调用）
 * 
 * 加载优先级：默认值 → 配置文件 → 环境变量 → 运行时覆盖
 */
export function initializeConfig(options?: {
  configFile?: string;
  envPrefix?: string;
  overrides?: DeepPartial<BeeclawConfig>;
}): { errors: ValidationError[]; envLoaded: number } {
  const errors: ValidationError[] = [];

  // 1. 从文件加载
  if (options?.configFile) {
    errors.push(...config.loadFromFile(options.configFile));
  }

  // 2. 从环境变量加载
  const envLoaded = config.loadFromEnv(options?.envPrefix);

  // 3. 运行时覆盖
  if (options?.overrides) {
    errors.push(...config.update(options.overrides, 'runtime'));
  }

  return { errors, envLoaded };
}

// ─── 便捷 getter ──────────────────────────────────────────

export function getAgentConfig(): Readonly<AgentConfig> { return config.get<AgentConfig>('agent')!; }
export function getMemoryConfig(): Readonly<MemoryConfig> { return config.get<MemoryConfig>('memory')!; }
export function getRetentionConfig(): Readonly<RetentionConfig> { return config.get<RetentionConfig>('retention')!; }
export function getCompressionConfig(): Readonly<CompressionConfig> { return config.get<CompressionConfig>('compression')!; }
export function getScoringConfig(): Readonly<ScoringConfig> { return config.get<ScoringConfig>('scoring')!; }
export function getIndexerConfig(): Readonly<IndexerConfig> { return config.get<IndexerConfig>('indexer')!; }
export function getSearchConfig(): Readonly<SearchConfig> { return config.get<SearchConfig>('search')!; }
export function getObservabilityConfig(): Readonly<ObservabilitySettingsConfig> { return config.get<ObservabilitySettingsConfig>('observability')!; }
