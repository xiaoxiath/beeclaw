/**
 * Unified Error Handling
 *
 * 统一的错误处理和重试机制
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
// BeeclawError
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
      default:
        return error.message || '发生未知错误';
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return '发生未知错误';
}
