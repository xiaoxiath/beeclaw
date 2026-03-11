/**
 * Error Handling Tests
 */

import { describe, test, expect } from 'bun:test';
import {
  BeeclawError,
  ErrorCategory,
  detectErrorCategory,
  isRetryableCategory,
  withRetry,
  tryCatch,
  Ok,
  Err,
  formatErrorMessage,
  formatErrorForUser,
} from '../../errors';

describe('BeeclawError', () => {
  test('should create error with all options', () => {
    const error = new BeeclawError('Test error', {
      category: ErrorCategory.NETWORK,
      code: 'NET001',
      retryable: true,
      retryAfter: 5000,
      context: { url: 'https://example.com' },
    });

    expect(error.message).toBe('Test error');
    expect(error.category).toBe(ErrorCategory.NETWORK);
    expect(error.code).toBe('NET001');
    expect(error.retryable).toBe(true);
    expect(error.retryAfter).toBe(5000);
    expect(error.context).toEqual({ url: 'https://example.com' });
  });

  test('should convert to JSON', () => {
    const error = new BeeclawError('Test error', {
      category: ErrorCategory.AUTH,
      code: 'AUTH001',
    });

    const json = error.toJSON();

    expect(json.message).toBe('Test error');
    expect(json.category).toBe(ErrorCategory.AUTH);
    expect(json.code).toBe('AUTH001');
  });

  test('should create from standard error', () => {
    const originalError = new Error('Network timeout');
    const beeclawError = BeeclawError.fromError(originalError);

    expect(beeclawError.message).toBe('Network timeout');
    // "Network timeout" contains "Network" so it's detected as NETWORK category
    expect(beeclawError.category).toBe(ErrorCategory.NETWORK);
    expect(beeclawError.retryable).toBe(true);
  });
});

describe('detectErrorCategory', () => {
  test('should detect network errors', () => {
    expect(detectErrorCategory(new Error('ECONNRESET'))).toBe(ErrorCategory.NETWORK);
    expect(detectErrorCategory(new Error('ETIMEDOUT'))).toBe(ErrorCategory.NETWORK);
    expect(detectErrorCategory(new Error('fetch failed'))).toBe(ErrorCategory.NETWORK);
  });

  test('should detect rate limit errors', () => {
    expect(detectErrorCategory(new Error('rate limit exceeded'))).toBe(ErrorCategory.RATE_LIMIT);
    expect(detectErrorCategory(new Error('429 Too Many Requests'))).toBe(ErrorCategory.RATE_LIMIT);
  });

  test('should detect timeout errors', () => {
    expect(detectErrorCategory(new Error('timeout'))).toBe(ErrorCategory.TIMEOUT);
    expect(detectErrorCategory(new Error('request timed out'))).toBe(ErrorCategory.TIMEOUT);
  });

  test('should detect auth errors', () => {
    expect(detectErrorCategory(new Error('401 Unauthorized'))).toBe(ErrorCategory.AUTH);
    expect(detectErrorCategory(new Error('invalid api key'))).toBe(ErrorCategory.AUTH);
    expect(detectErrorCategory(new Error('403 Forbidden'))).toBe(ErrorCategory.AUTH);
  });

  test('should detect validation errors', () => {
    expect(detectErrorCategory(new Error('400 Bad Request'))).toBe(ErrorCategory.VALIDATION);
    expect(detectErrorCategory(new Error('invalid parameter'))).toBe(ErrorCategory.VALIDATION);
  });

  test('should default to internal', () => {
    expect(detectErrorCategory(new Error('unknown error'))).toBe(ErrorCategory.INTERNAL);
  });
});

describe('isRetryableCategory', () => {
  test('should return true for retryable categories', () => {
    expect(isRetryableCategory(ErrorCategory.NETWORK)).toBe(true);
    expect(isRetryableCategory(ErrorCategory.RATE_LIMIT)).toBe(true);
    expect(isRetryableCategory(ErrorCategory.TIMEOUT)).toBe(true);
  });

  test('should return false for non-retryable categories', () => {
    expect(isRetryableCategory(ErrorCategory.AUTH)).toBe(false);
    expect(isRetryableCategory(ErrorCategory.VALIDATION)).toBe(false);
    expect(isRetryableCategory(ErrorCategory.INTERNAL)).toBe(false);
  });
});

describe('withRetry', () => {
  test('should succeed on first try', async () => {
    let attempts = 0;

    const result = await withRetry(async () => {
      attempts++;
      return 'success';
    });

    expect(result).toBe('success');
    expect(attempts).toBe(1);
  });

  test('should retry on retryable errors', async () => {
    let attempts = 0;

    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('ETIMEDOUT');
        }
        return 'success';
      },
      { maxRetries: 3, baseDelay: 10 },
    );

    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  test('should not retry on non-retryable errors', async () => {
    let attempts = 0;

    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error('401 Unauthorized');
        },
        { maxRetries: 3 },
      ),
    ).rejects.toThrow('401 Unauthorized');

    expect(attempts).toBe(1);
  });

  test('should throw after max retries', async () => {
    let attempts = 0;

    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error('ECONNRESET');
        },
        { maxRetries: 2, baseDelay: 10 },
      ),
    ).rejects.toThrow('ECONNRESET');

    expect(attempts).toBe(3); // Initial + 2 retries
  });
});

describe('Result type', () => {
  test('Ok should return success result', () => {
    const result = Ok(42);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
  });

  test('Err should return error result', () => {
    const error = new BeeclawError('Test error', { category: ErrorCategory.INTERNAL });
    const result = Err(error);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Test error');
    }
  });
});

describe('tryCatch', () => {
  test('should return Ok on success', async () => {
    const result = await tryCatch(() => Promise.resolve('success'));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('success');
    }
  });

  test('should return Err on failure', async () => {
    const result = await tryCatch(() => Promise.reject(new Error('test error')));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('test error');
    }
  });
});

describe('formatErrorMessage', () => {
  test('should format BeeclawError', () => {
    const error = new BeeclawError('Test error', {
      category: ErrorCategory.NETWORK,
      code: 'NET001',
      retryable: true,
    });

    expect(formatErrorMessage(error)).toBe('[NET001] [network] Test error (retryable)');
  });

  test('should format standard Error', () => {
    const error = new Error('Standard error');
    expect(formatErrorMessage(error)).toBe('Standard error');
  });
});

describe('formatErrorForUser', () => {
  test('should format network error', () => {
    const error = new BeeclawError('', { category: ErrorCategory.NETWORK });
    expect(formatErrorForUser(error)).toBe('网络连接失败，请稍后重试');
  });

  test('should format rate limit error', () => {
    const error = new BeeclawError('', { category: ErrorCategory.RATE_LIMIT });
    expect(formatErrorForUser(error)).toBe('请求过于频繁，请稍后重试');
  });

  test('should format timeout error', () => {
    const error = new BeeclawError('', { category: ErrorCategory.TIMEOUT });
    expect(formatErrorForUser(error)).toBe('请求超时，请稍后重试');
  });

  test('should format auth error', () => {
    const error = new BeeclawError('', { category: ErrorCategory.AUTH });
    expect(formatErrorForUser(error)).toBe('认证失败，请检查配置');
  });
});
