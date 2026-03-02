import { describe, test, expect } from 'bun:test';
import {
  ErrorType,
  classifyError,
  createError,
  formatErrorForLog,
  formatErrorForUser,
} from '../error-handler';

describe('Error Handler', () => {
  describe('classifyError', () => {
    describe('network errors', () => {
      test('classifies ECONNRESET as network error', () => {
        const error = new Error('ECONNRESET connection reset');
        const classified = classifyError(error);

        expect(classified.type).toBe(ErrorType.NETWORK_ERROR);
        expect(classified.retryable).toBe(true);
      });

      test('classifies ETIMEDOUT as network error', () => {
        const error = new Error('ETIMEDOUT connection timed out');
        const classified = classifyError(error);

        expect(classified.type).toBe(ErrorType.NETWORK_ERROR);
        expect(classified.retryable).toBe(true);
      });

      test('classifies ENOTFOUND as network error', () => {
        const error = new Error('ENOTFOUND dns lookup failed');
        const classified = classifyError(error);

        expect(classified.type).toBe(ErrorType.NETWORK_ERROR);
        expect(classified.retryable).toBe(true);
      });

      test('classifies ECONNREFUSED as network error', () => {
        const error = new Error('ECONNREFUSED connection refused');
        const classified = classifyError(error);

        expect(classified.type).toBe(ErrorType.NETWORK_ERROR);
        expect(classified.retryable).toBe(true);
      });

      test('classifies socket connection error as network error', () => {
        const error = new Error('Socket connection failed');
        const classified = classifyError(error);

        expect(classified.type).toBe(ErrorType.NETWORK_ERROR);
        expect(classified.retryable).toBe(true);
      });
    });

    describe('timeout errors', () => {
      test('classifies timeout error', () => {
        const error = new Error('Request timeout');
        const classified = classifyError(error);

        expect(classified.type).toBe(ErrorType.TIMEOUT_ERROR);
        expect(classified.retryable).toBe(true);
      });

      test('classifies ETIMEDOUT as network error (checked before timeout)', () => {
        const error = new Error('ETIMEDOUT operation timed out');
        const classified = classifyError(error);

        // ETIMEDOUT is matched by isNetworkError first
        expect(classified.type).toBe(ErrorType.NETWORK_ERROR);
        expect(classified.retryable).toBe(true);
      });

      test('classifies agent response timeout', () => {
        const error = new Error('Agent response timeout');
        const classified = classifyError(error);

        expect(classified.type).toBe(ErrorType.TIMEOUT_ERROR);
        expect(classified.retryable).toBe(true);
      });
    });

    describe('rate limit errors', () => {
      test('classifies rate limit error', () => {
        const error = new Error('Rate limit exceeded');
        const classified = classifyError(error);

        expect(classified.type).toBe(ErrorType.RATE_LIMIT);
        expect(classified.retryable).toBe(true);
      });

      test('classifies 429 as rate limit', () => {
        const error = new Error('HTTP 429 Too Many Requests');
        const classified = classifyError(error);

        expect(classified.type).toBe(ErrorType.RATE_LIMIT);
        expect(classified.retryable).toBe(true);
      });

      test('classifies quota exceeded as balance error', () => {
        const error = new Error('Quota exceeded for API');
        const classified = classifyError(error);

        // "quota exceeded" is matched by isBalanceError
        expect(classified.type).toBe(ErrorType.INSUFFICIENT_BALANCE);
        expect(classified.retryable).toBe(false);
      });
    });

    describe('server errors', () => {
      test('classifies 500 as server error', () => {
        const error = new Error('HTTP 500 Internal Server Error');
        const classified = classifyError(error);

        expect(classified.type).toBe(ErrorType.SERVER_ERROR);
        expect(classified.retryable).toBe(true);
      });

      test('classifies 502 as server error', () => {
        const error = new Error('HTTP 502 Bad Gateway');
        const classified = classifyError(error);

        expect(classified.type).toBe(ErrorType.SERVER_ERROR);
        expect(classified.retryable).toBe(true);
      });

      test('classifies 503 as server error', () => {
        const error = new Error('HTTP 503 Service Unavailable');
        const classified = classifyError(error);

        expect(classified.type).toBe(ErrorType.SERVER_ERROR);
        expect(classified.retryable).toBe(true);
      });
    });

    describe('auth errors', () => {
      test('classifies 401 as auth error', () => {
        const error = new Error('HTTP 401 Unauthorized');
        const classified = classifyError(error);

        expect(classified.type).toBe(ErrorType.AUTH_ERROR);
        expect(classified.retryable).toBe(false);
      });

      test('classifies 403 as auth error', () => {
        const error = new Error('HTTP 403 Forbidden');
        const classified = classifyError(error);

        expect(classified.type).toBe(ErrorType.AUTH_ERROR);
        expect(classified.retryable).toBe(false);
      });

      test('classifies invalid api key as auth error', () => {
        const error = new Error('Invalid API key provided');
        const classified = classifyError(error);

        expect(classified.type).toBe(ErrorType.AUTH_ERROR);
        expect(classified.retryable).toBe(false);
      });
    });

    describe('balance errors', () => {
      test('classifies insufficient balance error', () => {
        const error = new Error('insufficient_balance');
        const classified = classifyError(error);

        expect(classified.type).toBe(ErrorType.INSUFFICIENT_BALANCE);
        expect(classified.retryable).toBe(false);
      });

      test('classifies out of credits error', () => {
        const error = new Error('Out of credits');
        const classified = classifyError(error);

        expect(classified.type).toBe(ErrorType.INSUFFICIENT_BALANCE);
        expect(classified.retryable).toBe(false);
      });

      test('classifies payment required error', () => {
        const error = new Error('Payment required');
        const classified = classifyError(error);

        expect(classified.type).toBe(ErrorType.INSUFFICIENT_BALANCE);
        expect(classified.retryable).toBe(false);
      });
    });

    describe('validation errors', () => {
      test('classifies 400 as validation error', () => {
        const error = new Error('HTTP 400 Bad Request');
        const classified = classifyError(error);

        expect(classified.type).toBe(ErrorType.VALIDATION_ERROR);
        expect(classified.retryable).toBe(false);
      });

      test('classifies invalid parameter error', () => {
        const error = new Error('Invalid parameter provided');
        const classified = classifyError(error);

        expect(classified.type).toBe(ErrorType.VALIDATION_ERROR);
        expect(classified.retryable).toBe(false);
      });
    });

    describe('not found errors', () => {
      test('classifies 404 as not found error', () => {
        const error = new Error('HTTP 404 Not Found');
        const classified = classifyError(error);

        expect(classified.type).toBe(ErrorType.NOT_FOUND);
        expect(classified.retryable).toBe(false);
      });

      test('classifies resource not found error', () => {
        const error = new Error('Resource does not exist');
        const classified = classifyError(error);

        expect(classified.type).toBe(ErrorType.NOT_FOUND);
        expect(classified.retryable).toBe(false);
      });
    });

    describe('cancellation errors', () => {
      test('classifies cancelled error', () => {
        const error = new Error('Operation cancelled');
        const classified = classifyError(error);

        expect(classified.type).toBe(ErrorType.CANCELLED);
        expect(classified.retryable).toBe(false);
      });

      test('classifies aborted error as network error (checked before cancellation)', () => {
        const error = new Error('Request aborted');
        const classified = classifyError(error);

        // "aborted" is matched by isNetworkError first
        expect(classified.type).toBe(ErrorType.NETWORK_ERROR);
        expect(classified.retryable).toBe(true);
      });
    });

    describe('unknown errors', () => {
      test('classifies unknown error', () => {
        const error = new Error('Some random error');
        const classified = classifyError(error);

        expect(classified.type).toBe(ErrorType.UNKNOWN);
        expect(classified.retryable).toBe(false);
      });
    });

    describe('context preservation', () => {
      test('preserves context in classified error', () => {
        const error = new Error('Test error');
        const context = { requestId: '123', userId: 'user1' };
        const classified = classifyError(error, context);

        expect(classified.context).toEqual(context);
      });

      test('includes timestamp', () => {
        const error = new Error('Test error');
        const classified = classifyError(error);

        expect(classified.timestamp).toBeDefined();
        expect(classified.timestamp instanceof Date).toBe(true);
      });

      test('preserves original error', () => {
        const error = new Error('Test error');
        const classified = classifyError(error);

        expect(classified.originalError).toBe(error);
      });
    });
  });

  describe('createError', () => {
    test('creates network error', () => {
      const classified = createError(ErrorType.NETWORK_ERROR, 'Network failed');

      expect(classified.type).toBe(ErrorType.NETWORK_ERROR);
      expect(classified.retryable).toBe(true);
      expect(classified.message).toBe('Network failed');
    });

    test('creates timeout error', () => {
      const classified = createError(ErrorType.TIMEOUT_ERROR, 'Timed out');

      expect(classified.type).toBe(ErrorType.TIMEOUT_ERROR);
      expect(classified.retryable).toBe(true);
    });

    test('creates auth error (non-retryable)', () => {
      const classified = createError(ErrorType.AUTH_ERROR, 'Auth failed');

      expect(classified.type).toBe(ErrorType.AUTH_ERROR);
      expect(classified.retryable).toBe(false);
    });

    test('creates validation error (non-retryable)', () => {
      const classified = createError(ErrorType.VALIDATION_ERROR, 'Invalid input');

      expect(classified.type).toBe(ErrorType.VALIDATION_ERROR);
      expect(classified.retryable).toBe(false);
    });

    test('includes context', () => {
      const context = { field: 'email' };
      const classified = createError(ErrorType.VALIDATION_ERROR, 'Invalid email', context);

      expect(classified.context).toEqual(context);
    });

    test('includes user message', () => {
      const classified = createError(ErrorType.NETWORK_ERROR, 'Network failed');

      expect(classified.userMessage).toBeDefined();
      expect(typeof classified.userMessage).toBe('string');
    });
  });

  describe('formatErrorForLog', () => {
    test('formats error for logging', () => {
      const classified = createError(ErrorType.NETWORK_ERROR, 'Connection failed');

      const formatted = formatErrorForLog(classified);

      expect(formatted).toContain('NETWORK_ERROR');
      expect(formatted).toContain('Connection failed');
      expect(formatted).toContain('retryable');
    });

    test('includes context in log', () => {
      const classified = createError(ErrorType.NETWORK_ERROR, 'Failed', { url: 'https://example.com' });

      const formatted = formatErrorForLog(classified);

      expect(formatted).toContain('url');
      expect(formatted).toContain('example.com');
    });
  });

  describe('formatErrorForUser', () => {
    test('formats error for user display', () => {
      const classified = createError(ErrorType.NETWORK_ERROR, 'Connection failed');

      const formatted = formatErrorForUser(classified);

      expect(formatted).toContain('❌');
      expect(formatted).toContain(classified.userMessage);
    });
  });

  describe('user messages', () => {
    test('provides Chinese user message for network error', () => {
      const classified = classifyError(new Error('ECONNRESET'));

      expect(classified.userMessage).toContain('网络');
    });

    test('provides Chinese user message for timeout error', () => {
      const classified = classifyError(new Error('Request timeout'));

      expect(classified.userMessage).toContain('超时');
    });

    test('provides Chinese user message for auth error', () => {
      const classified = classifyError(new Error('401 Unauthorized'));

      expect(classified.userMessage).toContain('认证');
    });

    test('provides Chinese user message for balance error', () => {
      const classified = classifyError(new Error('insufficient_balance'));

      expect(classified.userMessage).toContain('余额');
    });
  });
});
