import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { setupMockConsole, restoreConsole, getConsoleCalls, getConsoleCallsFor, consoleCalledWith } from '../../testing/mocks/console';

// Re-import logger to get a fresh instance for testing
// Since logger is a singleton, we need to work with it directly
import { logger, type LoggerConfig, type LogLevel } from '../logger';

describe('Logger', () => {
  beforeEach(() => {
    setupMockConsole(['debug', 'info', 'warn', 'error'], true);
    // Reset logger to default state
    logger.configure({ level: 'info', format: 'pretty' });
  });

  afterEach(() => {
    restoreConsole();
  });

  describe('configure', () => {
    test('sets log level', () => {
      logger.configure({ level: 'debug' });
      logger.debug('test debug message');
      expect(consoleCalledWith('debug', 'test debug message')).toBe(true);
    });

    test('sets format to json', () => {
      logger.configure({ level: 'info', format: 'json' });
      logger.info('test json message');

      const calls = getConsoleCallsFor('info');
      expect(calls.length).toBeGreaterThan(0);

      // Parse the JSON output
      const logOutput = calls[0].args[0] as string;
      const parsed = JSON.parse(logOutput);
      expect(parsed.level).toBe('info');
      expect(parsed.message).toBe('test json message');
      expect(parsed.timestamp).toBeDefined();
    });

    test('sets format to pretty', () => {
      logger.configure({ level: 'info', format: 'pretty' });
      logger.info('test pretty message');

      const calls = getConsoleCallsFor('info');
      expect(calls.length).toBeGreaterThan(0);

      const logOutput = calls[0].args[0] as string;
      expect(logOutput).toContain('test pretty message');
      // INFO is colorized, so check for INFO text (may have ANSI codes)
      expect(logOutput).toContain('INFO');
    });

    test('partial configuration updates only specified fields', () => {
      logger.configure({ level: 'debug', format: 'json' });
      logger.configure({ level: 'warn' }); // Only change level, keep json format

      logger.info('should not appear');
      logger.warn('should appear');

      const warnCalls = getConsoleCallsFor('warn');
      const infoCalls = getConsoleCallsFor('info');

      expect(warnCalls.length).toBeGreaterThan(0);
      expect(infoCalls.length).toBe(0);
    });
  });

  describe('log levels', () => {
    test('debug level logs all messages', () => {
      logger.configure({ level: 'debug' });

      logger.debug('debug msg');
      logger.info('info msg');
      logger.warn('warn msg');
      logger.error('error msg');

      expect(getConsoleCallsFor('debug').length).toBeGreaterThan(0);
      expect(getConsoleCallsFor('info').length).toBeGreaterThan(0);
      expect(getConsoleCallsFor('warn').length).toBeGreaterThan(0);
      expect(getConsoleCallsFor('error').length).toBeGreaterThan(0);
    });

    test('info level filters out debug', () => {
      logger.configure({ level: 'info' });

      logger.debug('debug msg');
      logger.info('info msg');

      expect(getConsoleCallsFor('debug').length).toBe(0);
      expect(getConsoleCallsFor('info').length).toBeGreaterThan(0);
    });

    test('warn level filters out debug and info', () => {
      logger.configure({ level: 'warn' });

      logger.debug('debug msg');
      logger.info('info msg');
      logger.warn('warn msg');

      expect(getConsoleCallsFor('debug').length).toBe(0);
      expect(getConsoleCallsFor('info').length).toBe(0);
      expect(getConsoleCallsFor('warn').length).toBeGreaterThan(0);
    });

    test('error level only logs errors', () => {
      logger.configure({ level: 'error' });

      logger.debug('debug msg');
      logger.info('info msg');
      logger.warn('warn msg');
      logger.error('error msg');

      expect(getConsoleCallsFor('debug').length).toBe(0);
      expect(getConsoleCallsFor('info').length).toBe(0);
      expect(getConsoleCallsFor('warn').length).toBe(0);
      expect(getConsoleCallsFor('error').length).toBeGreaterThan(0);
    });
  });

  describe('log methods', () => {
    test('debug logs with correct method', () => {
      logger.configure({ level: 'debug' });
      logger.debug('test message');
      expect(consoleCalledWith('debug', 'test message')).toBe(true);
    });

    test('info logs with correct method', () => {
      logger.configure({ level: 'info' });
      logger.info('test message');
      expect(consoleCalledWith('info', 'test message')).toBe(true);
    });

    test('warn logs with correct method', () => {
      logger.configure({ level: 'warn' });
      logger.warn('test message');
      expect(consoleCalledWith('warn', 'test message')).toBe(true);
    });

    test('error logs with correct method', () => {
      logger.configure({ level: 'error' });
      logger.error('test message');
      expect(consoleCalledWith('error', 'test message')).toBe(true);
    });
  });

  describe('formatMessage', () => {
    test('includes timestamp in pretty format', () => {
      logger.configure({ level: 'info', format: 'pretty' });
      logger.info('test');

      const output = getConsoleCallsFor('info')[0].args[0] as string;
      expect(output).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test('includes level in output', () => {
      logger.configure({ level: 'info', format: 'pretty' });
      logger.info('test');

      const output = getConsoleCallsFor('info')[0].args[0] as string;
      expect(output).toContain('INFO');
    });

    test('includes additional args in output', () => {
      logger.configure({ level: 'info', format: 'pretty' });
      logger.info('test', { key: 'value' }, 'extra');

      const output = getConsoleCallsFor('info')[0].args[0] as string;
      expect(output).toContain('test');
      expect(output).toContain('key');
      expect(output).toContain('extra');
    });

    test('json format includes args array', () => {
      logger.configure({ level: 'info', format: 'json' });
      logger.info('test', { key: 'value' });

      const output = getConsoleCallsFor('info')[0].args[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.args).toBeDefined();
      expect(parsed.args[0]).toEqual({ key: 'value' });
    });

    test('json format omits args when empty', () => {
      logger.configure({ level: 'info', format: 'json' });
      logger.info('test');

      const output = getConsoleCallsFor('info')[0].args[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.args).toBeUndefined();
    });
  });

  describe('colorize', () => {
    test('applies cyan color to debug level', () => {
      logger.configure({ level: 'debug', format: 'pretty' });
      logger.debug('test');

      const output = getConsoleCallsFor('debug')[0].args[0] as string;
      expect(output).toContain('\x1b[36m'); // cyan
    });

    test('applies green color to info level', () => {
      logger.configure({ level: 'info', format: 'pretty' });
      logger.info('test');

      const output = getConsoleCallsFor('info')[0].args[0] as string;
      expect(output).toContain('\x1b[32m'); // green
    });

    test('applies yellow color to warn level', () => {
      logger.configure({ level: 'warn', format: 'pretty' });
      logger.warn('test');

      const output = getConsoleCallsFor('warn')[0].args[0] as string;
      expect(output).toContain('\x1b[33m'); // yellow
    });

    test('applies red color to error level', () => {
      logger.configure({ level: 'error', format: 'pretty' });
      logger.error('test');

      const output = getConsoleCallsFor('error')[0].args[0] as string;
      expect(output).toContain('\x1b[31m'); // red
    });
  });

  describe('child logger', () => {
    test('creates child logger with context', () => {
      logger.configure({ level: 'info', format: 'json' });
      const childLogger = logger.child({ module: 'test-module' });

      childLogger.info('child message');

      const output = getConsoleCallsFor('info')[0].args[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.args[0]).toEqual({ module: 'test-module' });
    });

    test('child logger inherits parent level', () => {
      logger.configure({ level: 'warn' });
      const childLogger = logger.child({ module: 'test' });

      childLogger.debug('should not appear');
      childLogger.warn('should appear');

      expect(getConsoleCallsFor('debug').length).toBe(0);
      expect(getConsoleCallsFor('warn').length).toBeGreaterThan(0);
    });

    test('child logger all methods work', () => {
      logger.configure({ level: 'debug' });
      const childLogger = logger.child({ module: 'test' });

      childLogger.debug('debug');
      childLogger.info('info');
      childLogger.warn('warn');
      childLogger.error('error');

      expect(getConsoleCalls().length).toBe(4);
    });
  });
});
