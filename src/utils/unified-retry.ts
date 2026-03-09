/**
 * BeeClaw Resilience Patch — 统一重试引擎
 * 
 * 解决问题:
 *   - 两套重试系统共存 (retry.ts + errors.ts), 语义重叠 (#5)
 *   - Rate Limit 固定 60s 退避不够智能, 未解析 Retry-After header (#11)
 *   - 重试系统与断路器未联动
 * 
 * 核心设计:
 *   - 统一错误分类: 合并 ErrorType 和 ErrorCategory 为单一分类
 *   - Retry-After 解析: 自动从 HTTP 响应头提取并优先使用
 *   - 断路器集成: 重试前检查断路器状态, 失败后更新断路器
 *   - 重试上下文: 记录完整的重试历史, 便于调试和统计
 * 
 * 集成方式: 替换现有 retry.ts 和 errors.ts 中的重试逻辑
 */

import { CircuitBreakerRegistry, CircuitOpenError } from './circuit-breaker';

// ============================================================================
// Types
// ============================================================================

/** 统一错误分类 — 合并原有 ErrorType 和 ErrorCategory */
export type UnifiedErrorType =
  // 可重试
  | 'NETWORK_ERROR'
  | 'TIMEOUT_ERROR'
  | 'RATE_LIMIT'
  | 'SERVER_ERROR'
  | 'SERVICE_UNAVAILABLE'
  // 不可重试
  | 'AUTH_ERROR'
  | 'VALIDATION_ERROR'
  | 'BUSINESS_ERROR'
  | 'INSUFFICIENT_BALANCE'
  | 'NOT_FOUND'
  | 'CANCELLED'
  | 'CIRCUIT_OPEN'
  | 'UNKNOWN';

export interface ClassifiedError {
  type: UnifiedErrorType;
  retryable: boolean;
  message: string;
  originalError: Error;
  httpStatus?: number;
  retryAfterMs?: number; // 从 HTTP header 解析
}

export interface RetryStrategy {
  /** 最大重试次数 */
  maxRetries: number;
  /** 初始延迟 (ms) */
  initialDelayMs: number;
  /** 最大延迟 (ms) */
  maxDelayMs: number;
  /** 退避乘数 */
  backoffMultiplier: number;
  /** 抖动系数 (0-1) */
  jitter: number;
  /** 退避模式 */
  backoffMode: 'exponential' | 'linear' | 'fixed';
  /** 自定义重试判断 */
  shouldRetry?: (error: ClassifiedError, attempt: number) => boolean;
}

export interface RetryContext {
  /** 操作名称 */
  operationName: string;
  /** 当前尝试次数 (0 = 首次) */
  attempt: number;
  /** 已消耗的总等待时间 */
  totalWaitMs: number;
  /** 历史错误 */
  errors: ClassifiedError[];
  /** 开始时间 */
  startTime: number;
}

export interface RetryResult<T> {
  /** 是否成功 */
  success: boolean;
  /** 返回值 (成功时) */
  value?: T;
  /** 最终错误 (失败时) */
  error?: ClassifiedError;
  /** 重试上下文 */
  context: RetryContext;
}

export type RetryEventListener = (event: RetryEvent) => void;

export interface RetryEvent {
  type: 'retry' | 'success' | 'failure' | 'circuit_open';
  operationName: string;
  attempt: number;
  error?: ClassifiedError;
  delayMs?: number;
  totalElapsedMs: number;
}

// ============================================================================
// 预置重试策略
// ============================================================================

export const RETRY_STRATEGIES: Record<string, RetryStrategy> = {
  /** Agent 级别 — 核心 LLM 调用 */
  agent: {
    maxRetries: 3,
    initialDelayMs: 2_000,
    maxDelayMs: 30_000,
    backoffMultiplier: 2,
    jitter: 0.2,
    backoffMode: 'exponential',
  },

  /** 子 Agent 调用 */
  subagent: {
    maxRetries: 2,
    initialDelayMs: 1_000,
    maxDelayMs: 10_000,
    backoffMultiplier: 2,
    jitter: 0.15,
    backoffMode: 'exponential',
  },

  /** 工具调用 — 只重试网络/超时 */
  tool: {
    maxRetries: 2,
    initialDelayMs: 500,
    maxDelayMs: 5_000,
    backoffMultiplier: 2,
    jitter: 0.1,
    backoffMode: 'exponential',
    shouldRetry: (error, _attempt) => {
      return error.retryable && (
        error.type === 'NETWORK_ERROR' || error.type === 'TIMEOUT_ERROR'
      );
    },
  },

  /** API 调用 (通用) */
  api: {
    maxRetries: 3,
    initialDelayMs: 1_000,
    maxDelayMs: 20_000,
    backoffMultiplier: 2,
    jitter: 0.2,
    backoffMode: 'exponential',
  },

  /** Rate Limit — 优先使用 Retry-After, 否则较长固定等待 */
  rate_limit: {
    maxRetries: 5,
    initialDelayMs: 10_000,
    maxDelayMs: 120_000,
    backoffMultiplier: 2,
    jitter: 0.3,
    backoffMode: 'exponential',
    shouldRetry: (error) => error.type === 'RATE_LIMIT',
  },

  /** 不重试 */
  none: {
    maxRetries: 0,
    initialDelayMs: 0,
    maxDelayMs: 0,
    backoffMultiplier: 1,
    jitter: 0,
    backoffMode: 'fixed',
  },
};

// ============================================================================
// 错误分类器
// ============================================================================

/** 可重试的错误类型集合 */
const RETRYABLE_TYPES = new Set<UnifiedErrorType>([
  'NETWORK_ERROR',
  'TIMEOUT_ERROR',
  'RATE_LIMIT',
  'SERVER_ERROR',
  'SERVICE_UNAVAILABLE',
]);

/** 可重试的 HTTP 状态码 */
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

/**
 * 统一错误分类器
 * 
 * 合并原有 error-handler.ts 的 classifyError 和 errors.ts 的 detectErrorCategory
 */
export function classifyError(error: unknown): ClassifiedError {
  const err = error instanceof Error ? error : new Error(String(error));
  const message = err.message.toLowerCase();

  // 从 HTTP 响应中提取信息
  const httpStatus = extractHttpStatus(err);
  const retryAfterMs = extractRetryAfter(err);

  let type: UnifiedErrorType;

  // 按优先级分类 (顺序很重要)

  // 1. 余额不足 — 永远不重试
  if (message.includes('insufficient') && (message.includes('balance') || message.includes('quota')) ||
      message.includes('余额不足') || message.includes('配额') ||
      httpStatus === 402) {
    type = 'INSUFFICIENT_BALANCE';
  }
  // 2. 认证错误 — 永远不重试
  else if (message.includes('unauthorized') || message.includes('forbidden') ||
           message.includes('auth') || message.includes('api key') ||
           message.includes('认证') || message.includes('权限') ||
           httpStatus === 401 || httpStatus === 403) {
    type = 'AUTH_ERROR';
  }
  // 3. 断路器打开
  else if (error instanceof CircuitOpenError) {
    type = 'CIRCUIT_OPEN';
  }
  // 4. 网络错误 — 可重试 (放在取消之前, 因为 ECONNABORTED 既是网络也是取消)
  else if (message.includes('econnrefused') || message.includes('enotfound') ||
           message.includes('econnreset') || message.includes('econnaborted') ||
           message.includes('epipe') || message.includes('network') ||
           message.includes('fetch failed') || message.includes('dns')) {
    type = 'NETWORK_ERROR';
  }
  // 5. 取消 — 不重试
  else if (message.includes('cancel') || message.includes('abort') ||
           err.name === 'AbortError') {
    type = 'CANCELLED';
  }
  // 6. 未找到 — 不重试
  else if (message.includes('not found') || message.includes('404') ||
           httpStatus === 404) {
    type = 'NOT_FOUND';
  }
  // 7. 验证错误 — 不重试
  else if (message.includes('invalid') || message.includes('validation') ||
           message.includes('参数错误') || message.includes('格式错误') ||
           httpStatus === 400 || httpStatus === 422) {
    type = 'VALIDATION_ERROR';
  }
  // 8. Rate Limit — 可重试
  else if (message.includes('rate limit') || message.includes('too many requests') ||
           message.includes('throttl') || message.includes('限流') ||
           httpStatus === 429) {
    type = 'RATE_LIMIT';
  }
  // 9. 超时 — 可重试
  else if (message.includes('timeout') || message.includes('timed out') ||
           message.includes('etimeout') || message.includes('response timeout') ||
           err.name === 'TimeoutError' || httpStatus === 408 || httpStatus === 504) {
    type = 'TIMEOUT_ERROR';
  }
  // 10. 服务器错误 — 可重试
  else if (httpStatus !== undefined && httpStatus >= 500) {
    type = httpStatus === 503 ? 'SERVICE_UNAVAILABLE' : 'SERVER_ERROR';
  }
  // 11. 未知
  else {
    type = 'UNKNOWN';
  }

  return {
    type,
    retryable: RETRYABLE_TYPES.has(type),
    message: err.message,
    originalError: err,
    httpStatus,
    retryAfterMs,
  };
}

// ============================================================================
// HTTP 响应头解析
// ============================================================================

/**
 * 从错误中提取 HTTP 状态码
 */
function extractHttpStatus(error: Error): number | undefined {
  // 检查常见的错误属性
  const anyError = error as any;
  if (anyError.status) return anyError.status;
  if (anyError.statusCode) return anyError.statusCode;
  if (anyError.response?.status) return anyError.response.status;

  // 从错误消息中提取
  const match = error.message.match(/\b(\d{3})\b/);
  if (match) {
    const code = parseInt(match[1], 10);
    if (code >= 400 && code < 600) return code;
  }

  return undefined;
}

/**
 * 从错误中提取 Retry-After 值
 * 
 * 支持两种格式:
 *   Retry-After: 120          (秒数)
 *   Retry-After: Wed, 21 Oct 2025 07:28:00 GMT (HTTP-date)
 */
function extractRetryAfter(error: Error): number | undefined {
  const anyError = error as any;

  // 从 response headers 中提取
  const headers = anyError.response?.headers ?? anyError.headers;
  if (!headers) return undefined;

  let retryAfterValue: string | null = null;

  if (typeof headers.get === 'function') {
    retryAfterValue = headers.get('retry-after');
  } else if (typeof headers === 'object') {
    retryAfterValue = headers['retry-after'] ?? headers['Retry-After'];
  }

  if (!retryAfterValue) return undefined;

  // 尝试解析为秒数
  const seconds = parseInt(retryAfterValue, 10);
  if (!isNaN(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  // 尝试解析为 HTTP-date
  const date = new Date(retryAfterValue);
  if (!isNaN(date.getTime())) {
    const delayMs = date.getTime() - Date.now();
    return delayMs > 0 ? delayMs : undefined;
  }

  return undefined;
}

// ============================================================================
// 延迟计算
// ============================================================================

/**
 * 计算重试延迟
 * 
 * 优先级: Retry-After header > 策略计算值
 */
export function computeDelay(
  attempt: number,
  strategy: RetryStrategy,
  retryAfterMs?: number
): number {
  // 如果有 Retry-After header, 优先使用 (但不超过 maxDelay)
  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    return Math.min(retryAfterMs, strategy.maxDelayMs);
  }

  let baseDelay: number;

  switch (strategy.backoffMode) {
    case 'exponential':
      baseDelay = strategy.initialDelayMs * Math.pow(strategy.backoffMultiplier, attempt);
      break;
    case 'linear':
      baseDelay = strategy.initialDelayMs * (attempt + 1);
      break;
    case 'fixed':
      baseDelay = strategy.initialDelayMs;
      break;
    default:
      baseDelay = strategy.initialDelayMs;
  }

  // 添加 jitter
  const jitterFactor = 1 + (Math.random() * 2 - 1) * strategy.jitter;
  const finalDelay = baseDelay * jitterFactor;

  return Math.min(Math.max(finalDelay, 0), strategy.maxDelayMs);
}

// ============================================================================
// UnifiedRetryEngine
// ============================================================================

export class UnifiedRetryEngine {
  private circuitBreakers: CircuitBreakerRegistry | null = null;
  private readonly listeners: RetryEventListener[] = [];

  /**
   * 关联断路器注册表 — 重试前检查断路器, 失败后更新断路器
   */
  setCircuitBreakers(registry: CircuitBreakerRegistry): void {
    this.circuitBreakers = registry;
  }

  /**
   * 注册重试事件监听器
   */
  onRetryEvent(listener: RetryEventListener): void {
    this.listeners.push(listener);
  }

  /**
   * 核心重试执行方法
   * 
   * @param operationName - 操作名称 (用于日志和断路器)
   * @param fn - 要执行的异步函数
   * @param strategy - 重试策略
   * @returns RetryResult
   */
  async execute<T>(
    operationName: string,
    fn: () => Promise<T>,
    strategy: RetryStrategy = RETRY_STRATEGIES.api
  ): Promise<RetryResult<T>> {
    const context: RetryContext = {
      operationName,
      attempt: 0,
      totalWaitMs: 0,
      errors: [],
      startTime: Date.now(),
    };

    // 检查断路器
    if (this.circuitBreakers) {
      const breaker = this.circuitBreakers.getBreaker(operationName);
      if (!breaker.canExecute()) {
        const classified: ClassifiedError = {
          type: 'CIRCUIT_OPEN',
          retryable: false,
          message: `Circuit breaker for "${operationName}" is open`,
          originalError: new CircuitOpenError(operationName, breaker.cooldownRemainingMs()),
        };
        context.errors.push(classified);

        this.emitEvent({
          type: 'circuit_open',
          operationName,
          attempt: 0,
          error: classified,
          totalElapsedMs: Date.now() - context.startTime,
        });

        return { success: false, error: classified, context };
      }
    }

    for (let attempt = 0; attempt <= strategy.maxRetries; attempt++) {
      context.attempt = attempt;

      try {
        const value = await fn();

        // 成功 — 更新断路器
        if (this.circuitBreakers) {
          this.circuitBreakers.getBreaker(operationName).recordSuccess();
        }

        this.emitEvent({
          type: 'success',
          operationName,
          attempt,
          totalElapsedMs: Date.now() - context.startTime,
        });

        return { success: true, value, context };
      } catch (error) {
        const classified = classifyError(error);
        context.errors.push(classified);

        // 更新断路器
        if (this.circuitBreakers) {
          this.circuitBreakers.getBreaker(operationName).recordFailure(
            classified.message,
            classified.type === 'TIMEOUT_ERROR'
          );
        }

        const isLastAttempt = attempt === strategy.maxRetries;

        // 检查是否应重试
        const shouldRetry = strategy.shouldRetry
          ? strategy.shouldRetry(classified, attempt)
          : classified.retryable;

        if (isLastAttempt || !shouldRetry) {
          this.emitEvent({
            type: 'failure',
            operationName,
            attempt,
            error: classified,
            totalElapsedMs: Date.now() - context.startTime,
          });

          return { success: false, error: classified, context };
        }

        // 计算延迟
        const delayMs = computeDelay(attempt, strategy, classified.retryAfterMs);
        context.totalWaitMs += delayMs;

        this.emitEvent({
          type: 'retry',
          operationName,
          attempt,
          error: classified,
          delayMs,
          totalElapsedMs: Date.now() - context.startTime,
        });

        // 等待
        await sleep(delayMs);
      }
    }

    // 理论上不会到达这里, 但防御性返回
    return {
      success: false,
      error: context.errors[context.errors.length - 1],
      context,
    };
  }

  /**
   * 便捷方法: 执行并直接返回值 (失败时抛出异常)
   */
  async executeOrThrow<T>(
    operationName: string,
    fn: () => Promise<T>,
    strategy?: RetryStrategy
  ): Promise<T> {
    const result = await this.execute(operationName, fn, strategy);
    if (!result.success) {
      throw result.error?.originalError ?? new Error(`Operation "${operationName}" failed`);
    }
    return result.value!;
  }

  /**
   * 便捷方法: AI API 调用重试
   */
  async retryAICall<T>(fn: () => Promise<T>, label?: string): Promise<T> {
    return this.executeOrThrow(label ?? 'ai_call', fn, RETRY_STRATEGIES.agent);
  }

  /**
   * 便捷方法: 工具调用重试
   */
  async retryToolCall<T>(toolName: string, fn: () => Promise<T>): Promise<T> {
    return this.executeOrThrow(`tool:${toolName}`, fn, RETRY_STRATEGIES.tool);
  }

  private emitEvent(event: RetryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 不影响主流程
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// 便捷工厂函数
// ============================================================================

let defaultEngine: UnifiedRetryEngine | null = null;

/**
 * 获取全局 UnifiedRetryEngine 单例
 * 
 * 用法:
 *   const retry = getRetryEngine();
 *   retry.setCircuitBreakers(getCircuitBreakerRegistry());
 *   
 *   // AI 调用
 *   const response = await retry.retryAICall(() => callAI(params));
 *   
 *   // 工具调用
 *   const result = await retry.retryToolCall('search', () => executor('search', params));
 *   
 *   // 自定义策略
 *   const r = await retry.execute('custom_op', fn, {
 *     ...RETRY_STRATEGIES.api,
 *     maxRetries: 5,
 *   });
 */
export function getRetryEngine(): UnifiedRetryEngine {
  if (!defaultEngine) {
    defaultEngine = new UnifiedRetryEngine();
  }
  return defaultEngine;
}
