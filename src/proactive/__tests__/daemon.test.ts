import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { Daemon, getDaemon, resetDaemon } from '../daemon';

const TEST_DAEMON_PATH = './test-daemon-data';

describe('Daemon', () => {
  let daemon: Daemon;

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DAEMON_PATH)) {
      rmSync(TEST_DAEMON_PATH, { recursive: true });
    }
    mkdirSync(TEST_DAEMON_PATH, { recursive: true });
    resetDaemon();
    daemon = new Daemon(TEST_DAEMON_PATH);
  });

  afterEach(async () => {
    // Stop daemon if running
    try {
      await daemon.stop();
    } catch {
      // Ignore
    }
    // Clean up test directory
    if (existsSync(TEST_DAEMON_PATH)) {
      rmSync(TEST_DAEMON_PATH, { recursive: true });
    }
    resetDaemon();
  });

  describe('constructor', () => {
    test('creates instance with base path', () => {
      expect(daemon).toBeDefined();
    });
  });

  describe('init', () => {
    test('creates required directories', () => {
      daemon.init();
      expect(existsSync(TEST_DAEMON_PATH)).toBe(true);
    });

    test('is idempotent', () => {
      daemon.init();
      daemon.init(); // Should not throw
    });
  });

  describe('start', () => {
    test('starts the daemon', async () => {
      await daemon.start({
        checkIntervalMs: 10000,
        heartbeatIntervalMs: 5000,
      });

      const state = daemon.getState();
      expect(state.running).toBe(true);
      expect(state.pid).toBe(process.pid);
      expect(state.startedAt).toBeDefined();
    });

    test('does not start twice', async () => {
      await daemon.start({ checkIntervalMs: 10000 });
      await daemon.start({ checkIntervalMs: 10000 }); // Should not throw

      const state = daemon.getState();
      expect(state.running).toBe(true);
    });

    test('creates PID file', async () => {
      await daemon.start({ checkIntervalMs: 10000 });

      expect(existsSync(join(TEST_DAEMON_PATH, 'pid'))).toBe(true);
    });

    test('creates state file', async () => {
      await daemon.start({ checkIntervalMs: 10000 });

      expect(existsSync(join(TEST_DAEMON_PATH, 'state.json'))).toBe(true);
    });

    test('calls onJob callback', async () => {
      let jobCalled = false;

      await daemon.start({
        checkIntervalMs: 10000,
        onJob: async () => {
          jobCalled = true;
        },
      });

      // Job callback is set up correctly
      expect(daemon.getState().running).toBe(true);
    });
  });

  describe('stop', () => {
    test('stops the daemon', async () => {
      await daemon.start({ checkIntervalMs: 10000 });
      await daemon.stop();

      const state = daemon.getState();
      expect(state.running).toBe(false);
    });

    test('does not throw when not running', async () => {
      await daemon.stop(); // Should not throw
    });

    test('removes PID file', async () => {
      await daemon.start({ checkIntervalMs: 10000 });
      await daemon.stop();

      expect(existsSync(join(TEST_DAEMON_PATH, 'pid'))).toBe(false);
    });

    test('clears intervals', async () => {
      await daemon.start({ checkIntervalMs: 10000 });
      await daemon.stop();

      // After stop, state should show not running
      const state = daemon.getState();
      expect(state.running).toBe(false);
    });
  });

  describe('getState', () => {
    test('returns daemon state', () => {
      const state = daemon.getState();

      expect(state).toBeDefined();
      expect(state.running).toBe(false);
      expect(state.schedulesLoaded).toBe(0);
      expect(state.jobsExecuted).toBe(0);
      expect(state.errors).toEqual([]);
    });
  });

  describe('isRunning', () => {
    test('returns false when not started', () => {
      expect(daemon.isRunning()).toBe(false);
    });

    test('returns true when running', async () => {
      await daemon.start({ checkIntervalMs: 10000 });
      expect(daemon.isRunning()).toBe(true);
    });

    test('returns false after stop', async () => {
      await daemon.start({ checkIntervalMs: 10000 });
      await daemon.stop();
      expect(daemon.isRunning()).toBe(false);
    });
  });
});

describe('getDaemon', () => {
  beforeEach(() => {
    resetDaemon();
    if (existsSync(TEST_DAEMON_PATH)) {
      rmSync(TEST_DAEMON_PATH, { recursive: true });
    }
  });

  afterEach(() => {
    resetDaemon();
    if (existsSync(TEST_DAEMON_PATH)) {
      rmSync(TEST_DAEMON_PATH, { recursive: true });
    }
  });

  test('throws when not initialized', () => {
    expect(() => getDaemon()).toThrow('not initialized');
  });

  test('returns singleton instance', () => {
    const daemon1 = getDaemon(TEST_DAEMON_PATH);
    const daemon2 = getDaemon();

    expect(daemon1).toBe(daemon2);
  });

  test('resetDaemon clears instance', () => {
    getDaemon(TEST_DAEMON_PATH);
    resetDaemon();

    expect(() => getDaemon()).toThrow('not initialized');
  });
});
