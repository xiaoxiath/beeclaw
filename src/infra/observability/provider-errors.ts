/**
 * Provider Error Handling & Retry Enhancement  (P2-#3)
 *
 * @deprecated This module is superseded by the unified error and resilience system.
 * - Error classification → `src/infra/resilience/unified-retry.ts` (`classifyError`)
 * - Circuit breaker → `src/infra/resilience/circuit-breaker.ts` (`CircuitBreakerRegistry`)
 * - Retry logic → `src/infra/resilience/unified-retry.ts` (`UnifiedRetry`)
 *
 * New code should use those modules directly. This file is retained for reference
 * only and is not imported anywhere in the codebase.
 *
 * Original description:
 *  - 统一错误分类（ProviderErrorType）+ 结构化错误对象
 *  - Provider 级别的 Circuit Breaker（熔断器）
 *  - 自适应重试策略（根据错误类型和 Provider 特性决定延迟）
 *  - Rate Limit 响应头解析（Retry-After / X-RateLimit-*）
 *  - 可选 fallback Provider 链
 */

import type { AIProvider } from '../config/schema';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// 1. 结构化错误体系
// ---------------------------------------------------------------------------

/** Provider 错误类型分类 */
export enum ProviderErrorType {
  /** 认证失败（401/403）— 不可重试 */
  AUTH_ERROR = 'AUTH_ERROR',
  /** 余额不足 — 不可重试 */
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  /** 请求参数错误（400）— 不可重试 */
  INVALID_REQUEST = 'INVALID_REQUEST',
  /** 模型不存在 — 不可重试 */
  MODEL_NOT_FOUND = 'MODEL_NOT_FOUND',
  /** 请求过大（413）— 不可重试 */
  CONTEXT_LENGTH_EXCEEDED = 'CONTEXT_LENGTH_EXCEEDED',
  /** 内容安全过滤 — 不可重试 */
  CONTENT_FILTERED = 'CONTENT_FILTERED',
  /** 速率限制（429）— 可重试，需等待 */
  RATE_LIMITED = 'RATE_LIMITED',
  /** 服务器错误（500/502/503）— 可重试 */
  SERVER_ERROR = 'SERVER_ERROR',
  /** 超时（504 / ETIMEDOUT）— 可重试 */
  TIMEOUT = 'TIMEOUT',
  /** 网络错误 — 可重试 */
  NETWORK_ERROR = 'NETWORK_ERROR',
  /** 未知错误 */
  UNKNOWN = 'UNKNOWN',
}

/** 结构化 Provider 错误 */
export class ProviderError extends Error {
  readonly type: ProviderErrorType;
  readonly provider: string;
  readonly model: string;
  readonly statusCode?: number;
  readonly retryable: boolean;
  /** 建议的重试等待时间 (ms)，来自 Retry-After header */
  readonly retryAfterMs?: number;
  /** 原始错误体（JSON 或 string） */
  readonly rawBody?: string;
  readonly timestamp: Date;

  constructor(opts: {
    type: ProviderErrorType;
    message: string;
    provider: string;
    model: string;
    statusCode?: number;
    retryAfterMs?: number;
    rawBody?: string;
    cause?: Error;
  }) {
    super(opts.message);
    this.name = 'ProviderError';
    this.type = opts.type;
    this.provider = opts.provider;
    this.model = opts.model;
    this.statusCode = opts.statusCode;
    this.retryAfterMs = opts.retryAfterMs;
    this.rawBody = opts.rawBody;
    this.timestamp = new Date();
    if (opts.cause) {
      this.cause = opts.cause;
    }

    // 根据类型判断是否可重试
    this.retryable = [
      ProviderErrorType.RATE_LIMITED,
      ProviderErrorType.SERVER_ERROR,
      ProviderErrorType.TIMEOUT,
      ProviderErrorType.NETWORK_ERROR,
    ].includes(this.type);
  }

  /** 用户友好消息 */
  toUserMessage(): string {
    switch (this.type) {
      case ProviderErrorType.AUTH_ERROR:
        return `${this.provider} 认证失败，请检查 API Key 配置。`;
      case ProviderErrorType.QUOTA_EXCEEDED:
        return `${this.provider} 额度已用完，请充值或更换 Provider。`;
      case ProviderErrorType.INVALID_REQUEST:
        return `请求参数错误：${this.message}`;
      case ProviderErrorType.MODEL_NOT_FOUND:
        return `模型 ${this.model} 在 ${this.provider} 中不存在或未开通。`;
      case ProviderErrorType.CONTEXT_LENGTH_EXCEEDED:
        return `上下文长度超出模型限制，请缩短对话或清除历史。`;
      case ProviderErrorType.CONTENT_FILTERED:
        return `内容被安全策略过滤，请修改后重试。`;
      case ProviderErrorType.RATE_LIMITED:
        return `${this.provider} 请求过于频繁，将自动重试。`;
      case ProviderErrorType.SERVER_ERROR:
        return `${this.provider} 服务异常，正在重试...`;
      case ProviderErrorType.TIMEOUT:
        return `${this.provider} 响应超时，正在重试...`;
      case ProviderErrorType.NETWORK_ERROR:
        return `网络连接异常，正在重试...`;
      default:
        return `${this.provider} 调用失败：${this.message}`;
    }
  }
}

// ---------------------------------------------------------------------------
// 2. 错误分类器
// ---------------------------------------------------------------------------

/** 从 HTTP 响应和 body 中解析 Provider 错误 */
export function classifyProviderError(
  statusCode: number,
  responseBody: string,
  provider: AIProvider,
  model: string,
  headers?: Headers,
): ProviderError {
  const providerName = provider.type || 'unknown';

  // 解析 Retry-After header
  let retryAfterMs: number | undefined;
  if (headers) {
    const retryAfter = headers.get('retry-after');
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) {
        retryAfterMs = seconds * 1000;
      }
    }
    // X-RateLimit-Reset (epoch seconds)
    const resetAt = headers.get('x-ratelimit-reset');
    if (resetAt && !retryAfterMs) {
      const resetTime = parseInt(resetAt, 10) * 1000;
      const now = Date.now();
      if (resetTime > now) {
        retryAfterMs = resetTime - now;
      }
    }
  }

  // 尝试解析 JSON body
  let bodyObj: any;
  try {
    bodyObj = JSON.parse(responseBody);
  } catch {
    bodyObj = null;
  }

  // 从 body 中提取错误消息
  const errorMessage = bodyObj?.error?.message
    || bodyObj?.error?.msg
    || bodyObj?.message
    || bodyObj?.msg
    || responseBody.slice(0, 300);

  // 错误代码
  const errorCode = bodyObj?.error?.code || bodyObj?.error?.type || bodyObj?.code || '';

  // 按 status code + error code 综合分类
  const opts = {
    provider: providerName,
    model,
    statusCode,
    retryAfterMs,
    rawBody: responseBody.length > 1000 ? responseBody.slice(0, 1000) : responseBody,
  };

  // 401 / 403
  if (statusCode === 401 || statusCode === 403) {
    return new ProviderError({
      ...opts,
      type: ProviderErrorType.AUTH_ERROR,
      message: `Authentication failed: ${errorMessage}`,
    });
  }

  // 429 Rate Limit
  if (statusCode === 429) {
    return new ProviderError({
      ...opts,
      type: ProviderErrorType.RATE_LIMITED,
      message: `Rate limited: ${errorMessage}`,
    });
  }

  // 400 系列
  if (statusCode === 400) {
    // 上下文长度超限
    if (
      /context.?length|token.?limit|max.?tokens|too.?long/i.test(errorMessage) ||
      errorCode === 'context_length_exceeded'
    ) {
      return new ProviderError({
        ...opts,
        type: ProviderErrorType.CONTEXT_LENGTH_EXCEEDED,
        message: `Context length exceeded: ${errorMessage}`,
      });
    }
    // 内容安全过滤
    if (/content.?filter|safety|moderation|sensitive/i.test(errorMessage)) {
      return new ProviderError({
        ...opts,
        type: ProviderErrorType.CONTENT_FILTERED,
        message: `Content filtered: ${errorMessage}`,
      });
    }
    // 模型不存在
    if (/model.?not.?found|model.?not.?exist|invalid.?model/i.test(errorMessage)) {
      return new ProviderError({
        ...opts,
        type: ProviderErrorType.MODEL_NOT_FOUND,
        message: `Model not found: ${errorMessage}`,
      });
    }
    return new ProviderError({
      ...opts,
      type: ProviderErrorType.INVALID_REQUEST,
      message: `Invalid request: ${errorMessage}`,
    });
  }

  // 402 / 余额不足
  if (statusCode === 402 || /quota|balance|insufficient.?fund/i.test(errorMessage)) {
    return new ProviderError({
      ...opts,
      type: ProviderErrorType.QUOTA_EXCEEDED,
      message: `Quota exceeded: ${errorMessage}`,
    });
  }

  // 413 请求过大
  if (statusCode === 413) {
    return new ProviderError({
      ...opts,
      type: ProviderErrorType.CONTEXT_LENGTH_EXCEEDED,
      message: `Request too large: ${errorMessage}`,
    });
  }

  // 404 模型不存在
  if (statusCode === 404) {
    return new ProviderError({
      ...opts,
      type: ProviderErrorType.MODEL_NOT_FOUND,
      message: `Model or endpoint not found: ${errorMessage}`,
    });
  }

  // 504 / 408 超时
  if (statusCode === 504 || statusCode === 408) {
    return new ProviderError({
      ...opts,
      type: ProviderErrorType.TIMEOUT,
      message: `Timeout: ${errorMessage}`,
    });
  }

  // 500 / 502 / 503 服务端错误
  if (statusCode >= 500) {
    return new ProviderError({
      ...opts,
      type: ProviderErrorType.SERVER_ERROR,
      message: `Server error: ${errorMessage}`,
    });
  }

  return new ProviderError({
    ...opts,
    type: ProviderErrorType.UNKNOWN,
    message: `Unknown error (${statusCode}): ${errorMessage}`,
  });
}

/**
 * 从网络异常（fetch 抛出的 Error）分类。
 */
export function classifyNetworkError(
  error: Error,
  provider: AIProvider,
  model: string,
): ProviderError {
  const msg = error.message.toLowerCase();
  const providerName = provider.type || 'unknown';

  if (/timeout|etimedout|socket.?hang.?up/i.test(msg)) {
    return new ProviderError({
      type: ProviderErrorType.TIMEOUT,
      message: `Network timeout: ${error.message}`,
      provider: providerName,
      model,
      cause: error,
    });
  }

  if (/econnrefused|econnreset|enotfound|dns/i.test(msg)) {
    return new ProviderError({
      type: ProviderErrorType.NETWORK_ERROR,
      message: `Network error: ${error.message}`,
      provider: providerName,
      model,
      cause: error,
    });
  }

  return new ProviderError({
    type: ProviderErrorType.UNKNOWN,
    message: `Unexpected error: ${error.message}`,
    provider: providerName,
    model,
    cause: error,
  });
}

// ---------------------------------------------------------------------------
// 3. Circuit Breaker（熔断器）— delegates to canonical implementation
// ---------------------------------------------------------------------------

import {
  CircuitBreakerRegistry,
  CIRCUIT_BREAKER_PRESETS,
} from '../resilience/circuit-breaker';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenRequests: number;
}

const _providerRegistry = new CircuitBreakerRegistry({
  ...CIRCUIT_BREAKER_PRESETS.ai_provider,
});

/** @deprecated Configure via CircuitBreakerRegistry directly. */
export function configureCircuitBreaker(_config: Partial<CircuitBreakerConfig>): void {}

export function isCircuitOpen(providerKey: string): boolean {
  return _providerRegistry.get(providerKey).getState() === 'open';
}

export function recordSuccess(providerKey: string): void {
  _providerRegistry.get(providerKey).recordSuccess();
}

export function recordFailure(providerKey: string): void {
  _providerRegistry.get(providerKey).recordFailure(new Error(`Provider ${providerKey} call failed`));
}

export function getAllCircuitStates(): Record<string, { state: string; failureCount: number }> {
  return _providerRegistry.getStats();
}

export function resetCircuitBreaker(providerKey: string): void {
  _providerRegistry.get(providerKey).reset();
}

export function resetAllCircuitBreakers(): void {
  _providerRegistry.resetAll();
}


// ---------------------------------------------------------------------------
// 4. Fallback Provider 链
// ---------------------------------------------------------------------------

export interface FallbackProviderConfig {
  /** 主 Provider */
  primary: AIProvider;
  /** 备选 Provider 列表（按优先级排序） */
  fallbacks: AIProvider[];
  /** 触发 fallback 的错误类型 */
  fallbackOnErrors?: ProviderErrorType[];
}

const DEFAULT_FALLBACK_ERRORS: ProviderErrorType[] = [
  ProviderErrorType.RATE_LIMITED,
  ProviderErrorType.SERVER_ERROR,
  ProviderErrorType.TIMEOUT,
  ProviderErrorType.QUOTA_EXCEEDED,
];

/**
 * 创建带 Fallback 的 Provider 执行器。
 *
 * @returns 一个函数，接受使用 Provider 执行的回调，自动尝试 fallback 链。
 */
export function createFallbackExecutor(config: FallbackProviderConfig) {
  const fallbackErrors = config.fallbackOnErrors || DEFAULT_FALLBACK_ERRORS;
  const providers = [config.primary, ...config.fallbacks];

  return async function execute<T>(
    fn: (provider: AIProvider) => Promise<T>,
  ): Promise<{ result: T; usedProvider: AIProvider; attempts: number }> {
    let lastError: ProviderError | Error | undefined;

    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i];
      const key = `${provider.type}:${provider.baseUrl || 'default'}`;

      // 检查熔断
      if (isCircuitOpen(key)) {
        logger.debug(`[FallbackExecutor] Skipping ${provider.type} (circuit open)`);
        continue;
      }

      try {
        const result = await fn(provider);
        recordSuccess(key);
        return { result, usedProvider: provider, attempts: i + 1 };
      } catch (error) {
        recordFailure(key);
        lastError = error instanceof Error ? error : new Error(String(error));

        // 判断是否应该 fallback
        const shouldFallback = error instanceof ProviderError
          ? fallbackErrors.includes(error.type)
          : true; // 非 ProviderError 默认 fallback

        if (!shouldFallback) {
          throw error; // 不可恢复错误，直接抛出
        }

        logger.warn(
          `[FallbackExecutor] ${provider.type} failed: ${lastError.message}. ` +
          `${i < providers.length - 1 ? 'Trying next provider...' : 'No more providers.'}`
        );
      }
    }

    throw lastError || new Error('All providers failed');
  };
}

// ---------------------------------------------------------------------------
// 5. 自适应重试策略
// ---------------------------------------------------------------------------

/**
 * 根据 ProviderError 类型计算推荐的重试延迟。
 */
export function calculateAdaptiveDelay(
  error: ProviderError,
  attempt: number,
  baseDelay = 1000,
  maxDelay = 60000,
): number {
  // 如果有 Retry-After，优先使用
  if (error.retryAfterMs) {
    return Math.min(error.retryAfterMs, maxDelay);
  }

  // 根据错误类型调整基础延迟
  let multiplier: number;
  switch (error.type) {
    case ProviderErrorType.RATE_LIMITED:
      multiplier = 3; // Rate limit 等更久
      break;
    case ProviderErrorType.SERVER_ERROR:
      multiplier = 2;
      break;
    case ProviderErrorType.TIMEOUT:
      multiplier = 1.5;
      break;
    default:
      multiplier = 2;
  }

  // 指数退避 + 类型加权 + jitter
  const exponentialDelay = baseDelay * Math.pow(multiplier, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay;
  return Math.min(exponentialDelay + jitter, maxDelay);
}
