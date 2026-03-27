import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';

// Mock logger
mock.module('../../observability/logger', () => ({
  logger: {
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  },
}));

// Mock SessionMessageQueue
mock.module('../../resilience/session-lock', () => {
  const mockQueue = {
    drainAll: mock(() => Promise.resolve()),
  };
  return {
    SessionMessageQueue: {
      getInstance: mock(() => mockQueue),
    },
  };
});

import { GracefulShutdown } from '../graceful-shutdown';

describe('GracefulShutdown', () => {
  afterEach(() => {
    GracefulShutdown.resetInstance();
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      const gs = new GracefulShutdown({ installSignalHandlers: false });
      expect(gs.shuttingDown).toBe(false);
    });

    it('should accept custom grace period', () => {
      const gs = new GracefulShutdown({
        gracePeriodMs: 5000,
        installSignalHandlers: false,
      });
      expect(gs.shuttingDown).toBe(false);
    });
  });

  describe('getInstance', () => {
    it('should return singleton', () => {
      const a = GracefulShutdown.getInstance({ installSignalHandlers: false });
      const b = GracefulShutdown.getInstance({ installSignalHandlers: false });
      expect(a).toBe(b);
    });

    it('should return new instance after resetInstance', () => {
      const a = GracefulShutdown.getInstance({ installSignalHandlers: false });
      GracefulShutdown.resetInstance();
      const b = GracefulShutdown.getInstance({ installSignalHandlers: false });
      expect(a).not.toBe(b);
    });
  });

  describe('register', () => {
    it('should accept cleanup functions', () => {
      const gs = new GracefulShutdown({ installSignalHandlers: false });
      expect(() => {
        gs.register({
          name: 'test-cleanup',
          fn: () => {},
        });
      }).not.toThrow();
    });

    it('should accept cleanup with priority', () => {
      const gs = new GracefulShutdown({ installSignalHandlers: false });
      gs.register({
        name: 'high-priority',
        priority: 1,
        fn: () => {},
      });
      gs.register({
        name: 'low-priority',
        priority: 200,
        fn: () => {},
      });
    });
  });

  describe('shutdown', () => {
    it('should run cleanup functions in priority order', async () => {
      const gs = new GracefulShutdown({
        gracePeriodMs: 10000,
        installSignalHandlers: false,
      });

      const order: string[] = [];

      gs.register({
        name: 'second',
        priority: 50,
        fn: () => { order.push('second'); },
      });
      gs.register({
        name: 'first',
        priority: 10,
        fn: () => { order.push('first'); },
      });
      gs.register({
        name: 'third',
        priority: 100,
        fn: () => { order.push('third'); },
      });

      await gs.shutdown();

      expect(order).toEqual(['first', 'second', 'third']);
      expect(gs.shuttingDown).toBe(true);
    });

    it('should not run twice', async () => {
      const gs = new GracefulShutdown({
        gracePeriodMs: 10000,
        installSignalHandlers: false,
      });

      let count = 0;
      gs.register({
        name: 'counter',
        fn: () => { count++; },
      });

      await gs.shutdown();
      await gs.shutdown(); // second call should be ignored

      expect(count).toBe(1);
    });

    it('should handle cleanup function errors gracefully', async () => {
      const gs = new GracefulShutdown({
        gracePeriodMs: 10000,
        installSignalHandlers: false,
      });

      const afterError = mock();

      gs.register({
        name: 'failing',
        priority: 1,
        fn: () => { throw new Error('cleanup failed'); },
      });
      gs.register({
        name: 'after-fail',
        priority: 2,
        fn: afterError,
      });

      await gs.shutdown();

      // Should continue to next cleanup even if one fails
      expect(afterError).toHaveBeenCalled();
    });

    it('should handle async cleanup functions', async () => {
      const gs = new GracefulShutdown({
        gracePeriodMs: 10000,
        installSignalHandlers: false,
      });

      const done = mock();
      gs.register({
        name: 'async-cleanup',
        fn: async () => {
          await new Promise(r => setTimeout(r, 10));
          done();
        },
      });

      await gs.shutdown();
      expect(done).toHaveBeenCalled();
    });
  });

  describe('shuttingDown property', () => {
    it('should be false initially', () => {
      const gs = new GracefulShutdown({ installSignalHandlers: false });
      expect(gs.shuttingDown).toBe(false);
    });

    it('should be true after shutdown', async () => {
      const gs = new GracefulShutdown({ installSignalHandlers: false });
      await gs.shutdown();
      expect(gs.shuttingDown).toBe(true);
    });
  });
});
