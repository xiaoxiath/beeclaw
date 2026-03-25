/**
 * P3-#5: Agent 运行可观测性框架
 * 
 * 原始问题：index.ts 中大量使用 console.log/warn/error 打印非结构化日志，
 * 没有统一的 traceId、sessionId、userId 传递。hook 机制虽然提供了扩展点，
 * 但缺乏配套的指标采集和分布式 tracing。
 * 
 * 优化方案：
 * 1. 结构化日志（Structured Logger）— 统一格式输出 JSON 日志
 * 2. 指标采集（Metrics Collector）— 工具调用延迟/成功率/Token 使用量等
 * 3. Trace 上下文（Trace Context）— 请求级 traceId + spanId 传递
 * 4. 可观测性 Hook — 与现有 hookRunner 机制无缝集成
 * 5. 可插拔后端 — 支持自定义 exporter（stdout/file/OpenTelemetry/Prometheus）
 * 
 * 使用方式：
 *   import { Observability, createSpan, metrics } from './observability';
 *   
 *   // 初始化
 *   Observability.configure({ level: 'info', structured: true });
 *   
 *   // 在 Agent.chat() 中
 *   const span = createSpan('agent.chat', { userId, sessionId });
 *   span.event('context_compression', { tokensBefore, tokensAfter });
 *   span.end();
 *   
 *   // 指标
 *   metrics.increment('tool_calls_total', { tool: 'web_search' });
 *   metrics.histogram('tool_latency_ms', elapsed, { tool: 'web_search' });
 */

// ─── 类型定义 ─────────────────────────────────────────────

/** 日志级别 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/** 结构化日志条目 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  /** 请求追踪 ID */
  traceId?: string;
  /** Span ID */
  spanId?: string;
  /** 父 Span ID */
  parentSpanId?: string;
  /** 会话 ID */
  sessionId?: string;
  /** 用户 ID */
  userId?: string;
  /** 模块来源 */
  module?: string;
  /** 附加字段 */
  fields?: Record<string, unknown>;
  /** 错误信息 */
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/** Span（追踪片段） */
export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'ok' | 'error' | 'timeout';
  attributes: Record<string, unknown>;
  events: Array<{
    name: string;
    timestamp: number;
    attributes?: Record<string, unknown>;
  }>;
}

/** 指标类型 */
export type MetricType = 'counter' | 'histogram' | 'gauge';

/** 指标记录 */
export interface MetricRecord {
  name: string;
  type: MetricType;
  value: number;
  labels: Record<string, string>;
  timestamp: number;
}

/** 可观测性配置 */
export interface ObservabilityConfig {
  /** 日志级别 */
  level: LogLevel;
  /** 是否输出结构化 JSON */
  structured: boolean;
  /** 是否启用 tracing */
  tracingEnabled: boolean;
  /** 是否启用 metrics */
  metricsEnabled: boolean;
  /** 日志输出器 */
  logExporter?: LogExporter;
  /** Trace 输出器 */
  traceExporter?: TraceExporter;
  /** Metric 输出器 */
  metricExporter?: MetricExporter;
  /** 默认附加字段 */
  defaultFields?: Record<string, unknown>;
}

/** 日志输出器接口（可插拔） */
export interface LogExporter {
  write(entry: LogEntry): void;
  flush?(): Promise<void>;
}

/** Trace 输出器接口（可插拔） */
export interface TraceExporter {
  export(span: Span): void;
  flush?(): Promise<void>;
}

/** Metric 输出器接口（可插拔） */
export interface MetricExporter {
  export(record: MetricRecord): void;
  flush?(): Promise<void>;
}

// ─── 默认 Exporter ──────────────────────────────────────

/** 标准输出日志 Exporter */
class StdoutLogExporter implements LogExporter {
  private structured: boolean;

  constructor(structured: boolean) {
    this.structured = structured;
  }

  write(entry: LogEntry): void {
    if (this.structured) {
      const output: Record<string, unknown> = {
        ts: entry.timestamp,
        level: entry.level,
        msg: entry.message,
      };
      if (entry.traceId) output.traceId = entry.traceId;
      if (entry.spanId) output.spanId = entry.spanId;
      if (entry.sessionId) output.sessionId = entry.sessionId;
      if (entry.userId) output.userId = entry.userId;
      if (entry.module) output.module = entry.module;
      if (entry.fields) Object.assign(output, entry.fields);
      if (entry.error) output.error = entry.error;

      const writer = entry.level === 'error' ? console.error : console.log;
      writer(JSON.stringify(output));
    } else {
      const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}]`;
      const moduleTag = entry.module ? ` [${entry.module}]` : '';
      const traceTag = entry.traceId ? ` (trace=${entry.traceId.substring(0, 8)})` : '';
      const msg = `${prefix}${moduleTag}${traceTag} ${entry.message}`;

      switch (entry.level) {
        case 'error': logger.error(msg); break;
        case 'warn': logger.warn(msg); break;
        case 'debug': console.debug(msg); break;
        default: logger.debug(msg);
      }

      if (entry.error?.stack) {
        logger.error(entry.error.stack);
      }
    }
  }
}

/** 标准输出 Trace Exporter */
class StdoutTraceExporter implements TraceExporter {
  export(span: Span): void {
    logger.debug(JSON.stringify({
      type: 'span',
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      name: span.name,
      duration: span.duration,
      status: span.status,
      attributes: span.attributes,
      eventCount: span.events.length,
    }));
  }
}

/** 内存 Metric Exporter（供查询/导出） */
class InMemoryMetricExporter implements MetricExporter {
  private records: MetricRecord[] = [];
  private maxRecords: number;

  constructor(maxRecords = 10000) {
    this.maxRecords = maxRecords;
  }

  export(record: MetricRecord): void {
    this.records.push(record);
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }
  }

  getRecords(filter?: { name?: string; since?: number }): MetricRecord[] {
    let results = this.records;
    if (filter?.name) results = results.filter(r => r.name === filter.name);
    if (filter?.since) results = results.filter(r => r.timestamp >= filter.since);
    return results;
  }

  getSnapshot(): Record<string, { count: number; sum: number; avg: number; max: number; min: number }> {
    const groups: Record<string, number[]> = {};
    for (const r of this.records) {
      const key = `${r.name}{${Object.entries(r.labels).map(([k, v]) => `${k}=${v}`).join(',')}}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r.value);
    }

    const snapshot: Record<string, { count: number; sum: number; avg: number; max: number; min: number }> = {};
    for (const [key, values] of Object.entries(groups)) {
      const sum = values.reduce((a, b) => a + b, 0);
      snapshot[key] = {
        count: values.length,
        sum,
        avg: sum / values.length,
        max: Math.max(...values),
        min: Math.min(...values),
      };
    }
    return snapshot;
  }

  clear(): void {
    this.records = [];
  }
}

// ─── ID 生成 ──────────────────────────────────────────────

function generateId(length = 16): string {
  const chars = 'abcdef0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

// ─── 日志级别优先级 ──────────────────────────────────────────

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 99,
};

// ─── 核心实现 ─────────────────────────────────────────────

/**
 * 结构化 Logger
 */
class StructuredLogger {
  private config: ObservabilityConfig;
  private logExporter: LogExporter;
  private traceContext: { traceId?: string; spanId?: string; sessionId?: string; userId?: string } = {};

  constructor(config: ObservabilityConfig) {
    this.config = config;
    this.logExporter = config.logExporter || new StdoutLogExporter(config.structured);
  }

  /** 绑定请求级上下文 */
  withContext(ctx: { traceId?: string; spanId?: string; sessionId?: string; userId?: string }): StructuredLogger {
    const child = new StructuredLogger(this.config);
    child.traceContext = { ...this.traceContext, ...ctx };
    return child;
  }

  /** 创建模块子 logger */
  child(module: string): ModuleLogger {
    return new ModuleLogger(this, module);
  }

  debug(message: string, fields?: Record<string, unknown>): void {
    this.log('debug', message, fields);
  }

  info(message: string, fields?: Record<string, unknown>): void {
    this.log('info', message, fields);
  }

  warn(message: string, fields?: Record<string, unknown>): void {
    this.log('warn', message, fields);
  }

  error(message: string, error?: Error | unknown, fields?: Record<string, unknown>): void {
    const errorInfo = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : error
        ? { name: 'UnknownError', message: String(error) }
        : undefined;

    this.log('error', message, fields, errorInfo);
  }

  private log(
    level: LogLevel,
    message: string,
    fields?: Record<string, unknown>,
    errorInfo?: { name: string; message: string; stack?: string }
  ): void {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.config.level]) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      traceId: this.traceContext.traceId,
      spanId: this.traceContext.spanId,
      sessionId: this.traceContext.sessionId,
      userId: this.traceContext.userId,
      fields: { ...this.config.defaultFields, ...fields },
      error: errorInfo,
    };

    this.logExporter.write(entry);
  }

  updateConfig(config: Partial<ObservabilityConfig>): void {
    Object.assign(this.config, config);
    if (config.logExporter) {
      this.logExporter = config.logExporter;
    } else if (config.structured !== undefined) {
      this.logExporter = new StdoutLogExporter(config.structured);
    }
  }
}

/**
 * 模块级 Logger
 */
class ModuleLogger {
  constructor(
    private parent: StructuredLogger,
    private module: string
  ) {}

  debug(message: string, fields?: Record<string, unknown>): void {
    this.parent.debug(`[${this.module}] ${message}`, fields);
  }

  info(message: string, fields?: Record<string, unknown>): void {
    this.parent.info(`[${this.module}] ${message}`, fields);
  }

  warn(message: string, fields?: Record<string, unknown>): void {
    this.parent.warn(`[${this.module}] ${message}`, fields);
  }

  error(message: string, error?: Error | unknown, fields?: Record<string, unknown>): void {
    this.parent.error(`[${this.module}] ${message}`, error, fields);
  }
}

/**
 * Span 实现（追踪片段）
 */
class SpanImpl {
  private span: Span;
  private logger: StructuredLogger;
  private traceExporter: TraceExporter | null;
  private children: SpanImpl[] = [];

  constructor(
    name: string,
    traceId: string,
    parentSpanId: string | undefined,
    attributes: Record<string, unknown>,
    logger: StructuredLogger,
    traceExporter: TraceExporter | null
  ) {
    this.span = {
      traceId,
      spanId: generateId(8),
      parentSpanId,
      name,
      startTime: Date.now(),
      status: 'ok',
      attributes,
      events: [],
    };
    this.logger = logger.withContext({
      traceId: this.span.traceId,
      spanId: this.span.spanId,
    });
    this.traceExporter = traceExporter;
  }

  get traceId(): string { return this.span.traceId; }
  get spanId(): string { return this.span.spanId; }

  /** 记录事件 */
  event(name: string, attributes?: Record<string, unknown>): void {
    this.span.events.push({
      name,
      timestamp: Date.now(),
      attributes,
    });
    this.logger.debug(`Span event: ${name}`, attributes);
  }

  /** 设置属性 */
  setAttribute(key: string, value: unknown): void {
    this.span.attributes[key] = value;
  }

  /** 创建子 Span */
  createChild(name: string, attributes: Record<string, unknown> = {}): SpanImpl {
    const child = new SpanImpl(
      name,
      this.span.traceId,
      this.span.spanId,
      attributes,
      this.logger,
      this.traceExporter
    );
    this.children.push(child);
    return child;
  }

  /** 标记错误 */
  setError(error: Error | string): void {
    this.span.status = 'error';
    const errMsg = error instanceof Error ? error.message : error;
    this.span.attributes['error.message'] = errMsg;
    if (error instanceof Error && error.stack) {
      this.span.attributes['error.stack'] = error.stack;
    }
  }

  /** 结束 Span */
  end(): void {
    this.span.endTime = Date.now();
    this.span.duration = this.span.endTime - this.span.startTime;

    // 自动结束未结束的子 span
    for (const child of this.children) {
      if (!child.span.endTime) {
        child.end();
      }
    }

    // 导出
    if (this.traceExporter) {
      this.traceExporter.export(this.span);
    }

    this.logger.debug(`Span completed: ${this.span.name}`, {
      duration: this.span.duration,
      status: this.span.status,
      eventCount: this.span.events.length,
    });
  }

  /** 获取 Span 快照 */
  toJSON(): Span {
    return { ...this.span };
  }
}

/**
 * 指标采集器
 */
class MetricsCollector {
  private exporter: MetricExporter;
  private enabled: boolean;

  constructor(exporter?: MetricExporter, enabled = true) {
    this.exporter = exporter || new InMemoryMetricExporter();
    this.enabled = enabled;
  }

  /** 计数器递增 */
  increment(name: string, labels: Record<string, string> = {}, delta = 1): void {
    if (!this.enabled) return;
    this.exporter.export({
      name,
      type: 'counter',
      value: delta,
      labels,
      timestamp: Date.now(),
    });
  }

  /** 直方图（记录数值分布，如延迟） */
  histogram(name: string, value: number, labels: Record<string, string> = {}): void {
    if (!this.enabled) return;
    this.exporter.export({
      name,
      type: 'histogram',
      value,
      labels,
      timestamp: Date.now(),
    });
  }

  /** 量规（设置当前值） */
  gauge(name: string, value: number, labels: Record<string, string> = {}): void {
    if (!this.enabled) return;
    this.exporter.export({
      name,
      type: 'gauge',
      value,
      labels,
      timestamp: Date.now(),
    });
  }

  /** 计时器（返回一个 stop 函数） */
  startTimer(name: string, labels: Record<string, string> = {}): () => number {
    const start = Date.now();
    return () => {
      const elapsed = Date.now() - start;
      this.histogram(name, elapsed, labels);
      return elapsed;
    };
  }

  /** 获取快照（仅 InMemoryMetricExporter） */
  getSnapshot(): Record<string, unknown> | null {
    if (this.exporter instanceof InMemoryMetricExporter) {
      return this.exporter.getSnapshot();
    }
    return null;
  }

  updateExporter(exporter: MetricExporter): void {
    this.exporter = exporter;
  }
}

// ─── 全局单例 ─────────────────────────────────────────────

const DEFAULT_CONFIG: ObservabilityConfig = {
  level: 'info',
  structured: false,
  tracingEnabled: true,
  metricsEnabled: true,
};

const globalLogger = new StructuredLogger(DEFAULT_CONFIG);
const globalMetrics = new MetricsCollector(undefined, DEFAULT_CONFIG.metricsEnabled);
let globalConfig = { ...DEFAULT_CONFIG };

/**
 * 可观测性管理器（全局入口）
 */
export const Observability = {
  /**
   * 配置可观测性系统
   */
  configure(config: Partial<ObservabilityConfig>): void {
    globalConfig = { ...globalConfig, ...config };
    globalLogger.updateConfig(globalConfig);

    if (config.metricExporter) {
      globalMetrics.updateExporter(config.metricExporter);
    }
  },

  /**
   * 获取 Logger
   */
  getLogger(): StructuredLogger {
    return globalLogger;
  },

  /**
   * 获取 Metrics
   */
  getMetrics(): MetricsCollector {
    return globalMetrics;
  },

  /**
   * 刷新所有 exporter
   */
  async flush(): Promise<void> {
    await globalConfig.logExporter?.flush?.();
    await globalConfig.traceExporter?.flush?.();
    await globalConfig.metricExporter?.flush?.();
  },
};

// ─── 便捷导出 ──────────────────────────────────────────────

/** 全局 Logger 实例 */
export const logger = globalLogger;

/** 全局 Metrics 实例 */
export const metrics = globalMetrics;

/**
 * 创建 Span（追踪片段）
 */
export function createSpan(
  name: string,
  attributes: Record<string, unknown> = {},
  parentSpan?: SpanImpl
): SpanImpl {
  if (!globalConfig.tracingEnabled) {
    // 返回 no-op span
    return new SpanImpl(name, 'noop', undefined, attributes, globalLogger, null);
  }

  const traceId = parentSpan?.traceId || generateId(16);
  const parentSpanId = parentSpan?.spanId;

  return new SpanImpl(
    name,
    traceId,
    parentSpanId,
    attributes,
    globalLogger,
    globalConfig.traceExporter || new StdoutTraceExporter()
  );
}

/**
 * 创建请求级 Logger（绑定 traceId/sessionId/userId）
 */
export function createRequestLogger(ctx: {
  traceId?: string;
  sessionId?: string;
  userId?: string;
}): StructuredLogger {
  return globalLogger.withContext(ctx);
}

// ─── Agent 可观测性 Hook ─────────────────────────────────────

/**
 * 预定义的 Agent 可观测性指标名称
 */
export const AGENT_METRICS = {
  /** 对话请求总数 */
  CHAT_REQUESTS_TOTAL: 'agent.chat_requests_total',
  /** 对话延迟（毫秒） */
  CHAT_LATENCY_MS: 'agent.chat_latency_ms',
  /** LLM 调用总数 */
  LLM_CALLS_TOTAL: 'agent.llm_calls_total',
  /** LLM 调用延迟 */
  LLM_LATENCY_MS: 'agent.llm_latency_ms',
  /** Token 使用量 */
  TOKENS_USED: 'agent.tokens_used',
  /** 工具调用总数 */
  TOOL_CALLS_TOTAL: 'agent.tool_calls_total',
  /** 工具调用延迟 */
  TOOL_LATENCY_MS: 'agent.tool_latency_ms',
  /** 工具调用错误数 */
  TOOL_ERRORS_TOTAL: 'agent.tool_errors_total',
  /** 上下文压缩次数 */
  CONTEXT_COMPRESSIONS: 'agent.context_compressions_total',
  /** 上下文压缩释放 Token 数 */
  CONTEXT_TOKENS_FREED: 'agent.context_tokens_freed',
  /** 记忆查询次数 */
  MEMORY_QUERIES_TOTAL: 'memory.queries_total',
  /** 记忆查询延迟 */
  MEMORY_QUERY_LATENCY_MS: 'memory.query_latency_ms',
  /** 记忆写入次数 */
  MEMORY_WRITES_TOTAL: 'memory.writes_total',
  /** 当前上下文 Token 数 */
  CONTEXT_TOKENS_CURRENT: 'agent.context_tokens_current',
  /** 迭代次数 */
  ITERATIONS_TOTAL: 'agent.iterations_total',
} as const;

/**
 * 为 Agent 的 hookRunner 创建可观测性 hook 处理器
 * 
 * 用法：将返回的 hooks 注册到 Agent 的 hookRunner 中，
 * 自动采集结构化日志和指标。
 * 
 * @example
 * ```typescript
 * import { createObservabilityHooks } from './observability';
 * 
 * const hooks = createObservabilityHooks();
 * // 注册到 hookRunner
 * for (const [name, handler] of Object.entries(hooks)) {
 *   hookRegistry.register(name, handler);
 * }
 * ```
 */
export function createObservabilityHooks(): Record<string, (...args: unknown[]) => void> {
  const log = globalLogger.child('agent');

  return {
    beforeAgentStart: (ctx: unknown) => {
      log.info('Agent started', ctx as Record<string, unknown>);
      metrics.increment(AGENT_METRICS.CHAT_REQUESTS_TOTAL);
    },

    agentEnd: (ctx: unknown) => {
      const c = ctx as Record<string, unknown>;
      log.info('Agent ended', {
        iterations: c.iterations,
        totalTokens: c.totalTokens,
      });
    },

    llmInput: (ctx: unknown) => {
      const c = ctx as Record<string, unknown>;
      log.debug('LLM input', {
        model: c.model,
        messageCount: c.messageCount,
        estimatedTokens: c.estimatedTokens,
      });
      metrics.increment(AGENT_METRICS.LLM_CALLS_TOTAL, {
        model: String(c.model || 'unknown'),
      });
    },

    llmOutput: (ctx: unknown) => {
      const c = ctx as Record<string, unknown>;
      log.debug('LLM output', {
        model: c.model,
        tokensUsed: c.tokensUsed,
        latencyMs: c.latencyMs,
      });
      if (typeof c.tokensUsed === 'number') {
        metrics.histogram(AGENT_METRICS.TOKENS_USED, c.tokensUsed, {
          model: String(c.model || 'unknown'),
        });
      }
      if (typeof c.latencyMs === 'number') {
        metrics.histogram(AGENT_METRICS.LLM_LATENCY_MS, c.latencyMs, {
          model: String(c.model || 'unknown'),
        });
      }
    },

    beforeToolCall: (ctx: unknown) => {
      const c = ctx as Record<string, unknown>;
      log.info('Tool call started', { tool: c.toolName, params: c.params });
      metrics.increment(AGENT_METRICS.TOOL_CALLS_TOTAL, {
        tool: String(c.toolName || 'unknown'),
      });
    },

    afterToolCall: (ctx: unknown) => {
      const c = ctx as Record<string, unknown>;
      const labels = { tool: String(c.toolName || 'unknown') };

      log.info('Tool call completed', {
        tool: c.toolName,
        latencyMs: c.latencyMs,
        success: c.success,
      });

      if (typeof c.latencyMs === 'number') {
        metrics.histogram(AGENT_METRICS.TOOL_LATENCY_MS, c.latencyMs, labels);
      }

      if (c.success === false) {
        metrics.increment(AGENT_METRICS.TOOL_ERRORS_TOTAL, labels);
      }
    },

    beforeCompaction: (ctx: unknown) => {
      const c = ctx as Record<string, unknown>;
      log.info('Context compression triggered', {
        currentTokens: c.currentTokens,
        threshold: c.threshold,
      });
      metrics.increment(AGENT_METRICS.CONTEXT_COMPRESSIONS);
    },

    afterCompaction: (ctx: unknown) => {
      const c = ctx as Record<string, unknown>;
      log.info('Context compression completed', {
        tokensBefore: c.tokensBefore,
        tokensAfter: c.tokensAfter,
        tokensFreed: c.tokensFreed,
      });
      if (typeof c.tokensFreed === 'number') {
        metrics.histogram(AGENT_METRICS.CONTEXT_TOKENS_FREED, c.tokensFreed);
      }
    },
  };
}
