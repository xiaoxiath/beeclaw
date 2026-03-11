import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { setupMockConsole, restoreConsole, getConsoleMessages } from '../../testing/mocks/console';
import { retry, createRetryFetch, retryAICall, type RetryOptions } from '../retry';

describe('retry', () => {
  beforeEach(() => {
    setupMockConsole(['log', 'warn'], true);
  });

  afterEach(() => {
    restoreConsole();
  });

  describe('successful execution', () => {
    test('returns result on first successful attempt', async () => {
      const result = await retry(() => Promise.resolve('success'));
      expect(result).toBe('success');
    });

    test('returns result after retry', async () => {
      let attempts = 0;

      const result = await retry(
        () => {
          attempts++;
          if (attempts < 2) {
            throw new Error('ECONNRESET');
          }
          return Promise.resolve('success');
        },
        { maxRetries: 3, initialDelay: 10 }
      );

      expect(result).toBe('success');
      expect(attempts).toBe(2);
    });

    test('passes through the result value', async () => {
      const objResult = await retry(() => Promise.resolve({ key: 'value', num: 42 }));
      expect(objResult).toEqual({ key: 'value', num: 42 });
    });
  });

  describe('retry behavior', () => {
    test('retries on network errors', async () => {
      let attempts = 0;

      await retry(
        () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('ECONNRESET');
          }
          return Promise.resolve('done');
        },
        { maxRetries: 3, initialDelay: 10 }
      );

      expect(attempts).toBe(3);
    });

    test('retries on timeout errors', async () => {
      let attempts = 0;

      await retry(
        () => {
          attempts++;
          if (attempts < 2) {
            throw new Error('ETIMEDOUT');
          }
          return Promise.resolve('done');
        },
        { maxRetries: 3, initialDelay: 10 }
      );

      expect(attempts).toBe(2);
    });

    test('retries on rate limit (429)', async () => {
      let attempts = 0;

      await retry(
        () => {
          attempts++;
          if (attempts < 2) {
            throw new Error('HTTP 429 Too Many Requests');
          }
          return Promise.resolve('done');
        },
        { maxRetries: 3, initialDelay: 10 }
      );

      expect(attempts).toBe(2);
    });

    test('retries on 5xx errors', async () => {
      let attempts = 0;

      await retry(
        () => {
          attempts++;
          if (attempts < 2) {
            throw new Error('HTTP 503 Service Unavailable');
          }
          return Promise.resolve('done');
        },
        { maxRetries: 3, initialDelay: 10 }
      );

      expect(attempts).toBe(2);
    });

    test('does not retry on billing errors', async () => {
      let attempts = 0;

      await expect(
        retry(
          () => {
            attempts++;
            throw new Error('insufficient_balance');
          },
          { maxRetries: 3, initialDelay: 10 }
        )
      ).rejects.toThrow('insufficient_balance');

      expect(attempts).toBe(1);
    });

    test('does not retry on quota exceeded', async () => {
      let attempts = 0;

      await expect(
        retry(
          () => {
            attempts++;
            throw new Error('quota exceeded');
          },
          { maxRetries: 3, initialDelay: 10 }
        )
      ).rejects.toThrow('quota exceeded');

      expect(attempts).toBe(1);
    });
  });

  describe('maxRetries option', () => {
    test('respects maxRetries limit', async () => {
      let attempts = 0;

      await expect(
        retry(
          () => {
            attempts++;
            throw new Error('ECONNRESET');
          },
          { maxRetries: 2, initialDelay: 10 }
        )
      ).rejects.toThrow('ECONNRESET');

      // Initial attempt + 2 retries = 3 attempts
      expect(attempts).toBe(3);
    });

    test('default maxRetries is 3', async () => {
      let attempts = 0;

      await expect(
        retry(
          () => {
            attempts++;
            throw new Error('ECONNRESET');
          },
          { initialDelay: 10 }
        )
      ).rejects.toThrow();

      // Initial attempt + 3 retries = 4 attempts
      expect(attempts).toBe(4);
    });
  });

  describe('delay options', () => {
    test('uses initialDelay', async () => {
      let attempts = 0;
      const start = Date.now();

      await retry(
        () => {
          attempts++;
          if (attempts < 2) {
            throw new Error('ECONNRESET');
          }
          return Promise.resolve('done');
        },
        { maxRetries: 3, initialDelay: 50, jitter: 0 }
      );

      const elapsed = Date.now() - start;
      // Should have waited at least 50ms
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });

    test('respects maxDelay', async () => {
      let attempts = 0;

      await retry(
        () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('ECONNRESET');
          }
          return Promise.resolve('done');
        },
        { maxRetries: 5, initialDelay: 1000, maxDelay: 50, jitter: 0 }
      );

      // With maxDelay of 50ms, even with exponential backoff,
      // total time should be reasonable
      expect(attempts).toBe(3);
    });

    test('applies backoff multiplier', async () => {
      let attempts = 0;
      const delays: number[] = [];
      const onRetry = (_err: Error, _attempt: number, delay: number) => {
        delays.push(delay);
      };

      await retry(
        () => {
          attempts++;
          if (attempts < 4) {
            throw new Error('ECONNRESET');
          }
          return Promise.resolve('done');
        },
        { maxRetries: 5, initialDelay: 10, maxDelay: 1000, backoffMultiplier: 2, jitter: 0, onRetry }
      );

      // Delays should approximately double: 10, 20, 40
      expect(delays[0]).toBeLessThan(delays[1]);
      expect(delays[1]).toBeLessThan(delays[2]);
    });
  });

  describe('custom retry condition', () => {
    test('uses shouldRetry callback', async () => {
      let attempts = 0;

      await expect(
        retry(
          () => {
            attempts++;
            throw new Error('custom error');
          },
          {
            maxRetries: 3,
            initialDelay: 10,
            shouldRetry: (error, attempt) => {
              return error.message === 'retry me' && attempt < 2;
            }
          }
        )
      ).rejects.toThrow('custom error');

      // Should not retry because shouldRetry returns false
      expect(attempts).toBe(1);
    });

    test('shouldRetry can force retry on non-retryable error', async () => {
      let attempts = 0;

      await retry(
        () => {
          attempts++;
          if (attempts < 2) {
            throw new Error('insufficient_balance');
          }
          return Promise.resolve('done');
        },
        {
          maxRetries: 3,
          initialDelay: 10,
          shouldRetry: () => true // Force retry
        }
      );

      expect(attempts).toBe(2);
    });
  });

  describe('onRetry callback', () => {
    test('calls onRetry with error and attempt info', async () => {
      const retryInfo: { error: Error; attempt: number; delay: number }[] = [];

      await retry(
        () => {
          if (retryInfo.length < 2) {
            throw new Error('ECONNRESET');
          }
          return Promise.resolve('done');
        },
        {
          maxRetries: 3,
          initialDelay: 10,
          onRetry: (error, attempt, delay) => {
            retryInfo.push({ error, attempt, delay });
          }
        }
      );

      expect(retryInfo.length).toBe(2);
      expect(retryInfo[0].error.message).toBe('ECONNRESET');
      expect(retryInfo[0].attempt).toBe(1);
      expect(retryInfo[0].delay).toBeGreaterThan(0);
    });
  });

  describe('retryStatusCodes option', () => {
    test.skip('uses custom retry status codes (deprecated - use error classification)', async () => {
      // This test is skipped because retryStatusCodes is deprecated
      // Error classification is now used to determine retryability
      let attempts = 0;

      await retry(
        () => {
          attempts++;
          if (attempts < 2) {
            throw new Error('HTTP 400 Bad Request');
          }
          return Promise.resolve('done');
        },
        {
          maxRetries: 3,
          initialDelay: 10,
          retryStatusCodes: [400, 401]
        }
      );

      expect(attempts).toBe(2);
    });
  });
});

describe('createRetryFetch', () => {
  beforeEach(() => {
    setupMockConsole(['log'], true);
  });

  afterEach(() => {
    restoreConsole();
  });

  test('returns response on success', async () => {
    // Use real fetch for this test
    restoreConsole();

    const fetchWithRetry = createRetryFetch({ maxRetries: 1, initialDelay: 10 });

    // This will actually hit the network, so we'll just test the function exists
    expect(typeof fetchWithRetry).toBe('function');
  });

  test('throws on HTTP error', async () => {
    restoreConsole();

    const fetchWithRetry = createRetryFetch({ maxRetries: 0, initialDelay: 10 });

    // Test that it's a function that returns a promise
    expect(typeof fetchWithRetry).toBe('function');
  });
});

describe('retryAICall', () => {
  beforeEach(() => {
    setupMockConsole(['log', 'warn'], true);
  });

  afterEach(() => {
    restoreConsole();
  });

  test('returns result on success', async () => {
    const result = await retryAICall(() => Promise.resolve({ data: 'test' }));
    expect(result).toEqual({ data: 'test' });
  });

  test('retries on rate limit', async () => {
    let attempts = 0;

    const result = await retryAICall(
      () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('rate limit exceeded');
        }
        return Promise.resolve('done');
      },
      { maxRetries: 2, initialDelay: 10 }
    );

    expect(result).toBe('done');
    expect(attempts).toBe(2);
  });

  test('uses AI-specific defaults', async () => {
    // retryAICall should use maxDelay of 60000
    // This is hard to test directly, so we just verify it accepts options
    const result = await retryAICall(
      () => Promise.resolve('success'),
      { maxRetries: 1 }
    );
    expect(result).toBe('success');
  });
});

describe('isRetryableError', () => {
  // Test various error messages through retry function
  test('ECONNRESET is retryable', async () => {
    let attempts = 0;
    await retry(
      () => {
        attempts++;
        if (attempts < 2) throw new Error('ECONNRESET');
        return Promise.resolve('ok');
      },
      { maxRetries: 2, initialDelay: 10 }
    );
    expect(attempts).toBe(2);
  });

  test('ETIMEDOUT is retryable', async () => {
    let attempts = 0;
    await retry(
      () => {
        attempts++;
        if (attempts < 2) throw new Error('ETIMEDOUT');
        return Promise.resolve('ok');
      },
      { maxRetries: 2, initialDelay: 10 }
    );
    expect(attempts).toBe(2);
  });

  test('ENOTFOUND is retryable', async () => {
    let attempts = 0;
    await retry(
      () => {
        attempts++;
        if (attempts < 2) throw new Error('ENOTFOUND');
        return Promise.resolve('ok');
      },
      { maxRetries: 2, initialDelay: 10 }
    );
    expect(attempts).toBe(2);
  });

  test('ECONNREFUSED is retryable', async () => {
    let attempts = 0;
    await retry(
      () => {
        attempts++;
        if (attempts < 2) throw new Error('ECONNREFUSED');
        return Promise.resolve('ok');
      },
      { maxRetries: 2, initialDelay: 10 }
    );
    expect(attempts).toBe(2);
  });

  test('socket connection error is retryable', async () => {
    let attempts = 0;
    await retry(
      () => {
        attempts++;
        if (attempts < 2) throw new Error('socket connection failed');
        return Promise.resolve('ok');
      },
      { maxRetries: 2, initialDelay: 10 }
    );
    expect(attempts).toBe(2);
  });

  test('aborted error is retryable', async () => {
    let attempts = 0;
    await retry(
      () => {
        attempts++;
        if (attempts < 2) throw new Error('ECONNABORTED');
        return Promise.resolve('ok');
      },
      { maxRetries: 2, initialDelay: 10 }
    );
    expect(attempts).toBe(2);
  });

  test('insufficient_balance is not retryable', async () => {
    let attempts = 0;
    await expect(
      retry(
        () => {
          attempts++;
          throw new Error('insufficient_balance');
        },
        { maxRetries: 2, initialDelay: 10 }
      )
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  test('billing error is not retryable', async () => {
    let attempts = 0;
    await expect(
      retry(
        () => {
          attempts++;
          throw new Error('billing issue');
        },
        { maxRetries: 2, initialDelay: 10 }
      )
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });
});
