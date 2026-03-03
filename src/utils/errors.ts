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
    const detectedCategory = category || detectErrorCategory(error);

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
// 错误分类
// ============================================================================

export function detectErrorCategory(error: unknown): ErrorCategory {
  if (error instanceof BeeclawError) {
    return error.category;
  }

  if (!(error instanceof Error)) {
    return ErrorCategory.INTERNAL;
  }

  const message = error.message.toLowerCase();

  // 网络错误
  if (
    message.includes('network') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('enotfound') ||
    message.includes('econnrefused') ||
    message.includes('fetch failed')
  ) {
    return ErrorCategory.NETWORK;
  }

  // 速率限制
  if (
    message.includes('rate limit') ||
    message.includes('429') ||
    message.includes('too many requests')
  ) {
    return ErrorCategory.RATE_LIMIT;
  }

  // 超时
  if (message.includes('timeout') || message.includes('timed out')) {
    return ErrorCategory.TIMEOUT;
  }

  // 认证
  if (
    message.includes('unauthorized') ||
    message.includes('401') ||
    message.includes('403') ||
    message.includes('forbidden') ||
    message.includes('invalid api key') ||
    message.includes('authentication')
  ) {
    return ErrorCategory.AUTH;
  }

  // 验证
  if (
    message.includes('validation') ||
    message.includes('invalid') ||
    message.includes('required') ||
    message.includes('400')
  ) {
    return ErrorCategory.VALIDATION;
  }

  // 未找到
  if (message.includes('not found') || message.includes('404')) {
    return ErrorCategory.NOT_FOUND;
  }

  // 权限
  if (message.includes('permission') || message.includes('access denied')) {
    return ErrorCategory.PERMISSION;
  }

  // 取消
  if (message.includes('cancel') || message.includes('abort')) {
    return ErrorCategory.CANCELLED;
  }

  return ErrorCategory.INTERNAL;
}

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
// 重试执行器
// ============================================================================

export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: Partial<RetryPolicy> = {},
): Promise<T> {
  const fullPolicy: RetryPolicy = {
    ...DEFAULT_RETRY_POLICIES.default,
    ...policy,
  };

  let lastError: BeeclawError | null = null;

  for (let attempt = 0; attempt <= fullPolicy.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const beeclawError = BeeclawError.fromError(error);

      // 检查是否可重试
      if (!beeclawError.retryable && !fullPolicy.retryableErrors.includes(beeclawError.category)) {
        throw beeclawError;
      }

      // 检查是否是最后一次尝试
      if (attempt === fullPolicy.maxRetries) {
        throw beeclawError;
      }

      lastError = beeclawError;

      // 计算延迟
      const delay = calculateDelay(attempt, fullPolicy, beeclawError.retryAfter);

      console.warn(
        `[Retry] Attempt ${attempt + 1}/${fullPolicy.maxRetries + 1} failed: ${beeclawError.message}\n` +
          `  Retrying in ${Math.round(delay / 1000)}s...`,
      );

      await sleep(delay);
    }
  }

  throw lastError || new BeeclawError('Unknown error');
}

function calculateDelay(
  attempt: number,
  policy: RetryPolicy,
  retryAfter?: number,
): number {
  // 如果服务器指定了 retry-after，使用它
  if (retryAfter) {
    return Math.min(retryAfter * 1000, policy.maxDelay);
  }

  let delay: number;

  switch (policy.backoff) {
    case 'fixed':
      delay = policy.baseDelay;
      break;

    case 'linear':
      delay = policy.baseDelay * (attempt + 1);
      break;

    case 'exponential':
    default:
      delay = policy.baseDelay * Math.pow(2, attempt);
      break;
  }

  return Math.min(delay, policy.maxDelay);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
