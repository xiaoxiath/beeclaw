import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock logger
vi.mock('../../observability/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock activity monitor
vi.mock('../../utils/activity-monitor', () => {
  class MockActivityMonitor {
    private lastTime = Date.now();
    record = vi.fn((_type: string, _details?: string) => {
      this.lastTime = Date.now();
    });
    isInactive = vi.fn((_timeout: number) => false);
    getInactiveTimeMs = vi.fn(() => Date.now() - this.lastTime);
    getStats = vi.fn(() => ({
      totalEvents: 0,
      lastActivity: new Date(),
      inactiveTimeMs: 0,
      eventsByType: {},
    }));
    reset = vi.fn(() => {
      this.lastTime = Date.now();
    });
    formatReport = vi.fn(() => '');
    getRecentEvents = vi.fn(() => []);
  }
  return { ActivityMonitor: MockActivityMonitor };
});

import { SmartTimeout, createSmartTimeout, type SmartTimeoutConfig } from '../smart-timeout';

describe('SmartTimeout', () => {
  let timeout: SmartTimeout;

  afterEach(() => {
    if (timeout) timeout.stop();
  });

  describe('constructor', () => {
    it('should create with valid config', () => {
      const onTimeout = vi.fn();
      timeout = new SmartTimeout({
        inactivityTimeoutMs: 60000,
        checkIntervalMs: 5000,
        onTimeout,
      });
      expect(timeout.isActive()).toBe(false);
    });

    it('should use default timeout if value is too small', () => {
      const onTimeout = vi.fn();
      timeout = new SmartTimeout({
        inactivityTimeoutMs: 100, // too small, < 1000
        checkIntervalMs: 5000,
        onTimeout,
      });
      // Should not crash, defaults are applied internally
      expect(timeout).toBeTruthy();
    });

    it('should use default check interval if value is too small', () => {
      const onTimeout = vi.fn();
      timeout = new SmartTimeout({
        inactivityTimeoutMs: 60000,
        checkIntervalMs: 100, // too small, < 1000
        onTimeout,
      });
      expect(timeout).toBeTruthy();
    });
  });

  describe('start / stop', () => {
    it('should start and become active', () => {
      const onTimeout = vi.fn();
      timeout = new SmartTimeout({
        inactivityTimeoutMs: 60000,
        checkIntervalMs: 60000, // long interval to avoid actual checks
        onTimeout,
      });
      timeout.start();
      expect(timeout.isActive()).toBe(true);
    });

    it('should stop and become inactive', () => {
      const onTimeout = vi.fn();
      timeout = new SmartTimeout({
        inactivityTimeoutMs: 60000,
        checkIntervalMs: 60000,
        onTimeout,
      });
      timeout.start();
      timeout.stop();
      expect(timeout.isActive()).toBe(false);
    });

    it('should not throw when starting twice', () => {
      const onTimeout = vi.fn();
      timeout = new SmartTimeout({
        inactivityTimeoutMs: 60000,
        checkIntervalMs: 60000,
        onTimeout,
      });
      timeout.start();
      expect(() => timeout.start()).not.toThrow();
    });

    it('should not throw when stopping without starting', () => {
      const onTimeout = vi.fn();
      timeout = new SmartTimeout({
        inactivityTimeoutMs: 60000,
        checkIntervalMs: 60000,
        onTimeout,
      });
      expect(() => timeout.stop()).not.toThrow();
    });
  });

  describe('recordActivity', () => {
    it('should record activity without error', () => {
      const onTimeout = vi.fn();
      timeout = new SmartTimeout({
        inactivityTimeoutMs: 60000,
        checkIntervalMs: 60000,
        onTimeout,
      });
      timeout.start();
      expect(() => timeout.recordActivity('llm_chunk')).not.toThrow();
      expect(() => timeout.recordActivity('tool_call', 'web_fetch')).not.toThrow();
    });

    it('should call onActivity callback if provided', () => {
      const onTimeout = vi.fn();
      const onActivity = vi.fn();
      timeout = new SmartTimeout({
        inactivityTimeoutMs: 60000,
        checkIntervalMs: 60000,
        onTimeout,
        onActivity,
      });
      timeout.recordActivity('progress', 'test');
      expect(onActivity).toHaveBeenCalledWith('progress', 'test');
    });
  });

  describe('getRuntimeMs', () => {
    it('should return elapsed time since construction', () => {
      const onTimeout = vi.fn();
      timeout = new SmartTimeout({
        inactivityTimeoutMs: 60000,
        checkIntervalMs: 60000,
        onTimeout,
      });
      const runtime = timeout.getRuntimeMs();
      expect(runtime).toBeGreaterThanOrEqual(0);
      expect(runtime).toBeLessThan(1000); // should be near zero
    });
  });

  describe('getMonitor', () => {
    it('should return the internal activity monitor', () => {
      const onTimeout = vi.fn();
      timeout = new SmartTimeout({
        inactivityTimeoutMs: 60000,
        checkIntervalMs: 60000,
        onTimeout,
      });
      const monitor = timeout.getMonitor();
      expect(monitor).toBeDefined();
      expect(typeof monitor.record).toBe('function');
    });
  });

  describe('getInactiveTimeMs', () => {
    it('should return current inactive time', () => {
      const onTimeout = vi.fn();
      timeout = new SmartTimeout({
        inactivityTimeoutMs: 60000,
        checkIntervalMs: 60000,
        onTimeout,
      });
      const inactiveMs = timeout.getInactiveTimeMs();
      expect(typeof inactiveMs).toBe('number');
    });
  });
});

describe('createSmartTimeout', () => {
  it('should create a SmartTimeout instance', () => {
    const onTimeout = vi.fn();
    const st = createSmartTimeout(onTimeout);
    expect(st).toBeInstanceOf(SmartTimeout);
    st.stop();
  });

  it('should create with custom options', () => {
    const onTimeout = vi.fn();
    const st = createSmartTimeout(onTimeout, {
      inactivityTimeoutMs: 120000,
      checkIntervalMs: 10000,
    });
    expect(st).toBeInstanceOf(SmartTimeout);
    st.stop();
  });
});
