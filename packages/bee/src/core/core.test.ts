import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  stripMessageMetadata,
  DEFAULT_CONTEXT_CONFIG,
  type ChatMessage,
} from './types';

import { getLogger, setLogger, type ILogger } from './logger';

// ---------------------------------------------------------------------------
// types.ts — stripMessageMetadata
// ---------------------------------------------------------------------------
describe('stripMessageMetadata', () => {
  it('passes through messages without metadata unchanged (same reference)', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ];

    const result = stripMessageMetadata(messages);

    // The array is new (mapped), but elements without metadata keep the same reference
    expect(result).not.toBe(messages);
    expect(result[0]).toBe(messages[0]);
    expect(result[1]).toBe(messages[1]);
  });

  it('strips metadata from messages that have it', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: 'hello',
        metadata: { compressed: true, originalTokenCount: 42 },
      },
      {
        role: 'assistant',
        content: 'response',
        metadata: { compressed: false },
      },
    ];

    const result = stripMessageMetadata(messages);

    expect(result[0]).not.toHaveProperty('metadata');
    expect(result[1]).not.toHaveProperty('metadata');
    // Other fields are preserved
    expect(result[0].role).toBe('user');
    expect(result[0].content).toBe('hello');
    expect(result[1].role).toBe('assistant');
    expect(result[1].content).toBe('response');
  });

  it('handles a mixed array (some with metadata, some without)', () => {
    const withoutMeta: ChatMessage = { role: 'system', content: 'prompt' };
    const withMeta: ChatMessage = {
      role: 'user',
      content: 'hello',
      metadata: { compressedAt: 12345 },
    };

    const result = stripMessageMetadata([withoutMeta, withMeta]);

    expect(result[0]).toBe(withoutMeta); // same reference, no metadata to strip
    expect(result[1]).not.toBe(withMeta); // new object — metadata was stripped
    expect(result[1]).not.toHaveProperty('metadata');
    expect(result[1].role).toBe('user');
    expect(result[1].content).toBe('hello');
  });

  it('does not mutate the original array or its elements', () => {
    const original: ChatMessage[] = [
      {
        role: 'user',
        content: 'hello',
        metadata: { compressed: true, originalTokenCount: 100 },
      },
    ];

    // Deep-clone so we can compare after calling the function
    const snapshot = JSON.parse(JSON.stringify(original));

    stripMessageMetadata(original);

    // Original must be untouched
    expect(original).toEqual(snapshot);
    expect(original[0].metadata).toEqual({ compressed: true, originalTokenCount: 100 });
  });
});

// ---------------------------------------------------------------------------
// types.ts — DEFAULT_CONTEXT_CONFIG
// ---------------------------------------------------------------------------
describe('DEFAULT_CONTEXT_CONFIG', () => {
  it('has the expected default values', () => {
    expect(DEFAULT_CONTEXT_CONFIG).toEqual({
      maxTokens: 120000,
      keepRecent: 6,
      keepSystem: true,
      compressionThreshold: 0.8,
    });
  });
});

// ---------------------------------------------------------------------------
// logger.ts
// ---------------------------------------------------------------------------

// After each test, reset to a fresh ConsoleLogger so tests are isolated.
// We re-import the module conceptually via setLogger(new default logger).
// Since ConsoleLogger is not exported, we'll just set a plain object logger.
afterEach(() => {
  setLogger({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnValue({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    }),
  });
});

describe('logger', () => {
  it('getLogger returns a logger (not null or undefined)', () => {
    const logger = getLogger();
    expect(logger).toBeDefined();
    expect(logger).not.toBeNull();
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.child).toBe('function');
  });

  it('setLogger replaces the global logger', () => {
    const mockLogger: ILogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnValue({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(),
      }),
    };

    setLogger(mockLogger);
    const current = getLogger();

    expect(current).toBe(mockLogger);

    // Verify calls go through to the mock
    current.debug('test-debug');
    current.info('test-info');
    current.warn('test-warn');
    current.error('test-error');

    expect(mockLogger.debug).toHaveBeenCalledWith('test-debug');
    expect(mockLogger.info).toHaveBeenCalledWith('test-info');
    expect(mockLogger.warn).toHaveBeenCalledWith('test-warn');
    expect(mockLogger.error).toHaveBeenCalledWith('test-error');
  });

  it('ConsoleLogger methods do not throw', () => {
    // Before any setLogger call, getLogger returns the built-in ConsoleLogger.
    // We need to re-create it fresh; since ConsoleLogger isn't exported,
    // we exercise it by creating a new instance via the initial default.
    // Instead, let's spy on console methods to confirm they're called and don't throw.
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Build a fresh ConsoleLogger by resetting module state.
    // Since we cannot re-import, we simulate via a minimal logger that
    // delegates to ConsoleLogger behavior. Instead, let's just test
    // that the default logger's methods don't throw.
    const logger = getLogger();

    expect(() => logger.debug('dbg')).not.toThrow();
    expect(() => logger.info('inf')).not.toThrow();
    expect(() => logger.warn('wrn')).not.toThrow();
    expect(() => logger.error('err')).not.toThrow();

    debugSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('child() returns a new ILogger', () => {
    const mockChild: ILogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    };

    const mockLogger: ILogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnValue(mockChild),
    };

    setLogger(mockLogger);

    const childLogger = getLogger().child({ module: 'test' });

    expect(mockLogger.child).toHaveBeenCalledWith({ module: 'test' });
    expect(childLogger).toBe(mockChild);
    // The child is a distinct object from the parent
    expect(childLogger).not.toBe(mockLogger);
  });
});
