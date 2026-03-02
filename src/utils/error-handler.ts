/**
 * Error Handler - Error Classification and Handling
 *
 * Classifies errors into types and determines if they are retryable.
 * This is the foundation of the error handling and recovery system.
 */

/**
 * Error types classification
 */
export enum ErrorType {
  // Retryable errors (temporary failures)
  NETWORK_ERROR = 'NETWORK_ERROR',              // Network connection failures
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',              // Request timeout
  RATE_LIMIT = 'RATE_LIMIT',                    // API rate limit
  SERVER_ERROR = 'SERVER_ERROR',                // Server errors (5xx)
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',  // Service temporarily unavailable

  // Non-retryable errors (permanent failures)
  AUTH_ERROR = 'AUTH_ERROR',                    // Authentication/authorization errors
  VALIDATION_ERROR = 'VALIDATION_ERROR',        // Invalid parameters
  BUSINESS_ERROR = 'BUSINESS_ERROR',            // Business logic errors
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE', // Insufficient API balance
  NOT_FOUND = 'NOT_FOUND',                      // Resource not found
  CANCELLED = 'CANCELLED',                      // Operation cancelled

  // Unknown errors
  UNKNOWN = 'UNKNOWN',
}

/**
 * Classified error with context
 */
export interface ClassifiedError {
  type: ErrorType;
  retryable: boolean;
  message: string;
  userMessage: string;  // User-friendly message
  originalError: Error;
  context?: Record<string, any>;
  timestamp: Date;
}

/**
 * Check if error is a network error
 */
function isNetworkError(error: Error): boolean {
  const message = error.message.toLowerCase();

  return (
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('enotfound') ||
    message.includes('econnrefused') ||
    message.includes('econnaborted') ||
    message.includes('network') ||
    message.includes('socket connection') ||
    message.includes('connection was closed') ||
    message.includes('socket') ||
    message.includes('aborted') ||
    message.includes('dns') ||
    message.includes('getaddrinfo')
  );
}

/**
 * Check if error is a timeout error
 */
function isTimeoutError(error: Error): boolean {
  const message = error.message.toLowerCase();

  return (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('etimeout') ||
    message.includes('response timeout') ||
    message.includes('agent response timeout') ||
    message.includes('subagent timeout')
  );
}

/**
 * Check if error is a rate limit error
 */
function isRateLimitError(error: Error): boolean {
  const message = error.message.toLowerCase();

  return (
    message.includes('rate limit') ||
    message.includes('429') ||
    message.includes('too many requests') ||
    message.includes('quota') ||
    message.includes('limit exceeded')
  );
}

/**
 * Check if error is a server error (5xx)
 */
function isServerError(error: Error): boolean {
  const message = error.message;

  // Check for HTTP 5xx status codes
  if (/http\s+5\d{2}/i.test(message)) {
    return true;
  }

  if (/5\d{2}/.test(message)) {
    // Extract status code
    const match = message.match(/5\d{2}/);
    if (match) {
      const code = parseInt(match[0]);
      return code >= 500 && code < 600;
    }
  }

  return (
    message.includes('internal server error') ||
    message.includes('bad gateway') ||
    message.includes('service unavailable') ||
    message.includes('gateway timeout')
  );
}

/**
 * Check if error is an authentication error
 */
function isAuthError(error: Error): boolean {
  const message = error.message.toLowerCase();

  return (
    message.includes('401') ||
    message.includes('403') ||
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('authentication') ||
    message.includes('invalid api key') ||
    message.includes('invalid token')
  );
}

/**
 * Check if error is a balance/quota error
 */
function isBalanceError(error: Error): boolean {
  const message = error.message.toLowerCase();

  return (
    message.includes('insufficient_balance') ||
    message.includes('insufficient balance') ||
    message.includes('out of credits') ||
    message.includes('billing') ||
    message.includes('payment required') ||
    message.includes('quota exceeded') ||
    message.includes('balance exceeded')
  );
}

/**
 * Check if error is a validation error
 */
function isValidationError(error: Error): boolean {
  const message = error.message.toLowerCase();

  return (
    message.includes('400') ||
    message.includes('invalid') ||
    message.includes('validation') ||
    message.includes('bad request') ||
    message.includes('parameter')
  );
}

/**
 * Check if error is a not found error
 */
function isNotFoundError(error: Error): boolean {
  const message = error.message.toLowerCase();

  return (
    message.includes('404') ||
    message.includes('not found') ||
    message.includes('does not exist')
  );
}

/**
 * Check if error is a cancellation error
 */
function isCancellationError(error: Error): boolean {
  const message = error.message.toLowerCase();

  return (
    message.includes('cancel') ||
    message.includes('abort') ||
    message.includes('user cancelled')
  );
}

/**
 * Get user-friendly error message
 */
function getUserMessage(type: ErrorType, originalMessage: string): string {
  switch (type) {
    case ErrorType.NETWORK_ERROR:
      return '网络连接失败，请检查网络后重试';

    case ErrorType.TIMEOUT_ERROR:
      return '请求超时，正在重试...';

    case ErrorType.RATE_LIMIT:
      return '请求过于频繁，稍后自动重试';

    case ErrorType.SERVER_ERROR:
      return '服务器暂时不可用，正在重试...';

    case ErrorType.SERVICE_UNAVAILABLE:
      return '服务暂时不可用，请稍后再试';

    case ErrorType.AUTH_ERROR:
      return '认证失败，请检查 API Key';

    case ErrorType.INSUFFICIENT_BALANCE:
      return 'API 余额不足，请充值后继续使用';

    case ErrorType.VALIDATION_ERROR:
      return `参数错误: ${originalMessage}`;

    case ErrorType.NOT_FOUND:
      return '请求的资源不存在';

    case ErrorType.CANCELLED:
      return '操作已取消';

    case ErrorType.BUSINESS_ERROR:
      return originalMessage;

    default:
      return `发生错误: ${originalMessage}`;
  }
}

/**
 * Classify an error into a specific type with context
 *
 * @param error - The original error
 * @param context - Additional context (optional)
 * @returns Classified error with type and retryability
 *
 * @example
 * ```typescript
 * try {
 *   await agent.chat(message);
 * } catch (error) {
 *   const classified = classifyError(error as Error);
 *
 *   if (classified.retryable) {
 *     console.log('Will retry:', classified.message);
 *   } else {
 *     console.error('Permanent failure:', classified.userMessage);
 *   }
 * }
 * ```
 */
export function classifyError(
  error: Error,
  context?: Record<string, any>
): ClassifiedError {
  // Check error types in order of specificity

  // 1. Insufficient balance (highest priority, never retry)
  if (isBalanceError(error)) {
    return {
      type: ErrorType.INSUFFICIENT_BALANCE,
      retryable: false,
      message: error.message,
      userMessage: getUserMessage(ErrorType.INSUFFICIENT_BALANCE, error.message),
      originalError: error,
      context,
      timestamp: new Date(),
    };
  }

  // 2. Authentication errors (never retry)
  if (isAuthError(error)) {
    return {
      type: ErrorType.AUTH_ERROR,
      retryable: false,
      message: error.message,
      userMessage: getUserMessage(ErrorType.AUTH_ERROR, error.message),
      originalError: error,
      context,
      timestamp: new Date(),
    };
  }

  // 3. Network errors (retryable) - check before cancellation to catch ECONNABORTED
  if (isNetworkError(error)) {
    return {
      type: ErrorType.NETWORK_ERROR,
      retryable: true,
      message: error.message,
      userMessage: getUserMessage(ErrorType.NETWORK_ERROR, error.message),
      originalError: error,
      context,
      timestamp: new Date(),
    };
  }

  // 4. Cancellation (never retry)
  if (isCancellationError(error)) {
    return {
      type: ErrorType.CANCELLED,
      retryable: false,
      message: error.message,
      userMessage: getUserMessage(ErrorType.CANCELLED, error.message),
      originalError: error,
      context,
      timestamp: new Date(),
    };
  }

  // 5. Not found (never retry)
  if (isNotFoundError(error)) {
    return {
      type: ErrorType.NOT_FOUND,
      retryable: false,
      message: error.message,
      userMessage: getUserMessage(ErrorType.NOT_FOUND, error.message),
      originalError: error,
      context,
      timestamp: new Date(),
    };
  }

  // 6. Validation errors (never retry)
  if (isValidationError(error)) {
    return {
      type: ErrorType.VALIDATION_ERROR,
      retryable: false,
      message: error.message,
      userMessage: getUserMessage(ErrorType.VALIDATION_ERROR, error.message),
      originalError: error,
      context,
      timestamp: new Date(),
    };
  }

  // 7. Rate limit (retryable)
  if (isRateLimitError(error)) {
    return {
      type: ErrorType.RATE_LIMIT,
      retryable: true,
      message: error.message,
      userMessage: getUserMessage(ErrorType.RATE_LIMIT, error.message),
      originalError: error,
      context,
      timestamp: new Date(),
    };
  }

  // 8. Timeout (retryable)
  if (isTimeoutError(error)) {
    return {
      type: ErrorType.TIMEOUT_ERROR,
      retryable: true,
      message: error.message,
      userMessage: getUserMessage(ErrorType.TIMEOUT_ERROR, error.message),
      originalError: error,
      context,
      timestamp: new Date(),
    };
  }

  // 9. Server errors (retryable)
  if (isServerError(error)) {
    return {
      type: ErrorType.SERVER_ERROR,
      retryable: true,
      message: error.message,
      userMessage: getUserMessage(ErrorType.SERVER_ERROR, error.message),
      originalError: error,
      context,
      timestamp: new Date(),
    };
  }

  // 10. Unknown errors (default to non-retryable for safety)
  return {
    type: ErrorType.UNKNOWN,
    retryable: false,
    message: error.message,
    userMessage: getUserMessage(ErrorType.UNKNOWN, error.message),
    originalError: error,
    context,
    timestamp: new Date(),
  };
}

/**
 * Create a classified error from scratch
 */
export function createError(
  type: ErrorType,
  message: string,
  context?: Record<string, any>
): ClassifiedError {
  const error = new Error(message);

  return {
    type,
    retryable: [
      ErrorType.NETWORK_ERROR,
      ErrorType.TIMEOUT_ERROR,
      ErrorType.RATE_LIMIT,
      ErrorType.SERVER_ERROR,
      ErrorType.SERVICE_UNAVAILABLE,
    ].includes(type),
    message,
    userMessage: getUserMessage(type, message),
    originalError: error,
    context,
    timestamp: new Date(),
  };
}

/**
 * Format error for logging
 */
export function formatErrorForLog(error: ClassifiedError): string {
  const parts = [
    `[${error.type}]`,
    error.message,
    error.retryable ? '(retryable)' : '(non-retryable)',
  ];

  if (error.context) {
    parts.push(`Context: ${JSON.stringify(error.context)}`);
  }

  return parts.join(' ');
}

/**
 * Format error for user display
 */
export function formatErrorForUser(error: ClassifiedError): string {
  return `❌ ${error.userMessage}`;
}
