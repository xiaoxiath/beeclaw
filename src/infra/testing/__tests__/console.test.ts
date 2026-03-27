import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setupMockConsole,
  restoreConsole,
  getConsoleCalls,
  getConsoleCallsFor,
  clearConsoleCalls,
  consoleCalledWith,
  getConsoleMessages,
  interceptConsole,
} from '../mocks/console';

describe('testing/mocks/console', () => {
  afterEach(() => {
    restoreConsole();
  });

  describe('setupMockConsole / restoreConsole', () => {
    it('should mock console methods', () => {
      setupMockConsole(['log', 'warn', 'error']);
      console.log('test');
      console.warn('warning');
      console.error('error');

      const calls = getConsoleCalls();
      expect(calls).toHaveLength(3);
    });

    it('should restore original console', () => {
      const originalLog = console.log;
      setupMockConsole();
      expect(console.log).not.toBe(originalLog);
      restoreConsole();
      // After restore, console.log should be the original
    });

    it('should mute output by default', () => {
      setupMockConsole(['log'], true);
      console.log('muted message');
      const calls = getConsoleCalls();
      expect(calls).toHaveLength(1);
    });
  });

  describe('getConsoleCalls', () => {
    it('should return empty array initially', () => {
      setupMockConsole();
      expect(getConsoleCalls()).toEqual([]);
    });

    it('should record calls in order', () => {
      setupMockConsole();
      console.log('first');
      console.warn('second');
      console.error('third');

      const calls = getConsoleCalls();
      expect(calls).toHaveLength(3);
      expect(calls[0].method).toBe('log');
      expect(calls[0].args[0]).toBe('first');
      expect(calls[1].method).toBe('warn');
      expect(calls[2].method).toBe('error');
    });
  });

  describe('getConsoleCallsFor', () => {
    it('should filter by method', () => {
      setupMockConsole();
      console.log('a');
      console.warn('b');
      console.log('c');

      const logCalls = getConsoleCallsFor('log');
      expect(logCalls).toHaveLength(2);

      const warnCalls = getConsoleCallsFor('warn');
      expect(warnCalls).toHaveLength(1);
    });
  });

  describe('clearConsoleCalls', () => {
    it('should clear all recorded calls', () => {
      setupMockConsole();
      console.log('test');
      expect(getConsoleCalls()).toHaveLength(1);

      clearConsoleCalls();
      expect(getConsoleCalls()).toHaveLength(0);
    });
  });

  describe('consoleCalledWith', () => {
    it('should return true when message was logged', () => {
      setupMockConsole();
      console.log('hello world');
      expect(consoleCalledWith('log', 'hello')).toBe(true);
    });

    it('should return false when message was not logged', () => {
      setupMockConsole();
      console.log('hello');
      expect(consoleCalledWith('log', 'goodbye')).toBe(false);
    });

    it('should match exact non-string args', () => {
      setupMockConsole();
      console.log(42);
      expect(consoleCalledWith('log', 42)).toBe(true);
    });
  });

  describe('getConsoleMessages', () => {
    it('should return messages as strings', () => {
      setupMockConsole();
      console.log('hello', 'world');
      console.warn('warning');

      const messages = getConsoleMessages();
      expect(messages).toHaveLength(2);
      expect(messages[0]).toContain('hello');
      expect(messages[0]).toContain('world');
    });

    it('should filter by method', () => {
      setupMockConsole();
      console.log('log msg');
      console.warn('warn msg');

      const logMessages = getConsoleMessages('log');
      expect(logMessages).toHaveLength(1);
      expect(logMessages[0]).toContain('log msg');
    });

    it('should stringify objects', () => {
      setupMockConsole();
      console.log({ key: 'value' });
      const messages = getConsoleMessages();
      expect(messages[0]).toContain('key');
    });
  });

  describe('interceptConsole', () => {
    it('should call the interceptor on console calls', () => {
      const intercepted: any[] = [];
      interceptConsole((call) => intercepted.push(call));

      console.log('intercepted message');

      expect(intercepted).toHaveLength(1);
      expect(intercepted[0].method).toBe('log');

      restoreConsole();
    });
  });
});
