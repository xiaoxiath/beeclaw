/**
 * Unified Error Handling
 *
 * [E-P2-04] Extended with a structured error class hierarchy:
 *   BeeclawError (base)
 *   ├── NetworkError       — transient connectivity failures
 *   ├── TimeoutError       — operation exceeded time limit
 *   ├── RateLimitError     — provider throttling (includes retryAfter)
 *   ├── AuthError          — credentials / permissions
 *   ├── ValidationError    — bad input / schema mismatch
 *   ├── NotFoundError      — resource does not exist
 *   ├── ToolExecutionError — tool dispatch failures
 *   └── ConfigError        — invalid configuration
 *
 * All subclasses set `category` and `retryable` automatically.
 */

// ============================================================================
// 错误类型
// ============================================================================

export enum ErrorCategory {
  NETWORK = 'network',
  RATE_LIMIT = 'rate_limit',
  VALIDATION = 'validation',
  AUTH = 'auth',
  INTERNAL = 'internal',
  TIMEOUT = 'timeout',
  NOT_FOUND = 'not_found',
  PERMISSION = 'permission',
  CANCELLED = 'cancelled',
  TOOL_EXECUTION = 'tool_execution',
  CONFIG = 'config',
}

/** @deprecated Use `unifiedRetry` from `infra/resilience/unified-retry.ts` instead. */
export interface RetryPolicy {
  maxRetries: number;
  backoff: 'fixed' | 'linear' | 'exponential';
  baseDelay: number; // ms
  maxDelay: number; // ms
  retryableErrors: ErrorCategory[];
}

// ============================================================================
// BeeclawError — base class
// ============================================================================

export class BeeclawError extends Error {
  category: ErrorCategory;
  code?: string;
  retryable: boolean;
  retryAfter?: number;
  context?: Record<string, unknown>;

  constructor(
    message: string,
    options?: {
      category?: ErrorCategory;
      code?: string;
      retryable?: boolean;
      retryAfter?: number;
      context?: Record<string, unknown>;
      cause?: Error;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'BeeclawError';
    this.category = options?.category || ErrorCategory.INTERNAL;
    this.code = options?.code;
    this.retryable = options?.retryable ?? false;
    this.retryAfter = options?.retryAfter;
    this.context = options?.context;
  }

  static fromError(error: unknown, category?: ErrorCategory): BeeclawError {
    if (error instanceof BeeclawError) {
      return error;
    }

    const message = error instanceof Error ? error.message : String(error);
    const detectedCategory = category || ErrorCategory.INTERNAL;

    return new BeeclawError(message, {
      category: detectedCategory,
      cause: error instanceof Error ? error : undefined,
      retryable: isRetryableCategory(detectedCategory),
    });
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      category: this.category,
      code: this.code,
      retryable: this.retryable,
      retryAfter: this.retryAfter,
      context: this.context,
    };
  }
}

// ============================================================================
// [E-P2-04] Typed error subclasses
// ============================================================================

/** Transient network connectivity failure (retryable). */
export class NetworkError extends BeeclawError {
  constructor(message: string, options?: { cause?: Error; context?: Record<string, unknown> }) {
    super(message, {
      category: ErrorCategory.NETWORK,
      retryable: true,
      cause: options?.cause,
      context: options?.context,
    });
    this.name = 'NetworkError';
  }
}

/** Operation exceeded its time budget (retryable). */
export class TimeoutError extends BeeclawError {
  constructor(message: string, options?: { cause?: Error; timeoutMs?: number }) {
    super(message, {
      category: ErrorCategory.TIMEOUT,
      retryable: true,
      cause: options?.cause,
      context: options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : undefined,
    });
    this.name = 'TimeoutError';
  }
}

/** Provider-level throttling (retryable, respects retryAfter). */
export class RateLimitError extends BeeclawError {
  constructor(message: string, options?: { retryAfter?: number; cause?: Error }) {
    super(message, {
      category: ErrorCategory.RATE_LIMIT,
      retryable: true,
      retryAfter: options?.retryAfter,
      cause: options?.cause,
    });
    this.name = 'RateLimitError';
  }
}

/** Authentication or authorization failure (NOT retryable). */
export class AuthError extends BeeclawError {
  constructor(message: string, options?: { cause?: Error; code?: string }) {
    super(message, {
      category: ErrorCategory.AUTH,
      retryable: false,
      cause: options?.cause,
      code: options?.code,
    });
    this.name = 'AuthError';
  }
}

/** Input validation / schema mismatch (NOT retryable). */
export class ValidationError extends BeeclawError {
  constructor(message: string, options?: { cause?: Error; context?: Record<string, unknown> }) {
    super(message, {
      category: ErrorCategory.VALIDATION,
      retryable: false,
      cause: options?.cause,
      context: options?.context,
    });
    this.name = 'ValidationError';
  }
}

/** Resource does not exist (NOT retryable). */
export class NotFoundError extends BeeclawError {
  constructor(message: string, options?: { cause?: Error; resource?: string }) {
    super(message, {
      category: ErrorCategory.NOT_FOUND,
      retryable: false,
      cause: options?.cause,
      context: options?.resource ? { resource: options.resource } : undefined,
    });
    this.name = 'NotFoundError';
  }
}

/** Tool dispatch or execution failure (may be retryable depending on inner cause). */
export class ToolExecutionError extends BeeclawError {
  readonly toolName: string;

  constructor(toolName: string, message: string, options?: { cause?: Error; retryable?: boolean }) {
    super(message, {
      category: ErrorCategory.TOOL_EXECUTION,
      retryable: options?.retryable ?? false,
      cause: options?.cause,
      context: { toolName },
    });
    this.name = 'ToolExecutionError';
    this.toolName = toolName;
  }
}

/** Invalid configuration (NOT retryable). */
export class ConfigError extends BeeclawError {
  constructor(message: string, options?: { cause?: Error; key?: string }) {
    super(message, {
      category: ErrorCategory.CONFIG,
      retryable: false,
      cause: options?.cause,
      context: options?.key ? { configKey: options.key } : undefined,
    });
    this.name = 'ConfigError';
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** @deprecated Use `unifiedRetry` from `infra/resilience/unified-retry.ts` instead. */
export function isRetryableCategory(category: ErrorCategory): boolean {
  return [
    ErrorCategory.NETWORK,
    ErrorCategory.RATE_LIMIT,
    ErrorCategory.TIMEOUT,
  ].includes(category);
}

// ============================================================================
// 重试策略
// ============================================================================

/** @deprecated Use `unifiedRetry` from `infra/resilience/unified-retry.ts` instead. */
export const DEFAULT_RETRY_POLICIES: Record<string, RetryPolicy> = {
  network: {
    maxRetries: 3,
    backoff: 'exponential',
    baseDelay: 1000,
    maxDelay: 30000,
    retryableErrors: [ErrorCategory.NETWORK, ErrorCategory.TIMEOUT],
  },
  rate_limit: {
    maxRetries: 5,
    backoff: 'fixed',
    baseDelay: 60000,
    maxDelay: 300000,
    retryableErrors: [ErrorCategory.RATE_LIMIT],
  },
  default: {
    maxRetries: 2,
    backoff: 'exponential',
    baseDelay: 1000,
    maxDelay: 10000,
    retryableErrors: [ErrorCategory.NETWORK, ErrorCategory.TIMEOUT, ErrorCategory.RATE_LIMIT],
  },
};
// ============================================================================
// 结果类型
// ============================================================================

export type Result<T, E = BeeclawError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function Ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function Err<E = BeeclawError>(error: E): Result<never, E> {
  return { ok: false, error };
}

export async function tryCatch<T>(
  fn: () => Promise<T>,
): Promise<Result<T, BeeclawError>> {
  try {
    return Ok(await fn());
  } catch (error) {
    return Err(BeeclawError.fromError(error));
  }
}

// ============================================================================
// 错误格式化
// ============================================================================

export function formatErrorMessage(error: unknown): string {
  if (error instanceof BeeclawError) {
    let message = `[${error.category}] ${error.message}`;
    if (error.code) {
      message = `[${error.code}] ${message}`;
    }
    if (error.retryable) {
      message += ' (retryable)';
    }
    return message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function formatErrorForUser(error: unknown): string {
  if (error instanceof BeeclawError) {
    // 友好的错误消息
    switch (error.category) {
      case ErrorCategory.NETWORK:
        return '网络连接失败，请稍后重试';
      case ErrorCategory.RATE_LIMIT:
        return '请求过于频繁，请稍后重试';
      case ErrorCategory.TIMEOUT:
        return '请求超时，请稍后重试';
      case ErrorCategory.AUTH:
        return '认证失败，请检查配置';
      case ErrorCategory.VALIDATION:
        return error.message;
      case ErrorCategory.TOOL_EXECUTION:
        return `工具执行失败: ${error.message}`;
      case ErrorCategory.CONFIG:
        return `配置错误: ${error.message}`;
      default:
        return error.message || '发生未知错误';
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return '发生未知错误';
}
