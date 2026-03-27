import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { PeriodicHealthMonitor, type IHealthChecker, type HealthCheckResult } from '../periodic-health-monitor';

function createMockHealthChecker(overrides: Partial<IHealthChecker> = {}): IHealthChecker {
  const defaultResult: HealthCheckResult = {
    overallHealthy: true,
    sources: [
      { name: 'db', type: 'database', healthy: true },
    ],
    recommendations: [],
  };

  return {
    runHealthCheck: mock(() => Promise.resolve(defaultResult)),
    getLastResult: mock(() => defaultResult),
    ...overrides,
  };
}

describe('PeriodicHealthMonitor', () => {
  let monitor: PeriodicHealthMonitor;

  afterEach(() => {
    if (monitor) monitor.stop();
  });

  describe('construction', () => {
    it('should create with default config', () => {
      const checker = createMockHealthChecker();
      monitor = new PeriodicHealthMonitor(checker);
      const status = monitor.getStatus();
      expect(status.isRunning).toBe(false);
      expect(status.lastProbeTime).toBeNull();
      expect(status.currentHealthy).toBe(true);
    });

    it('should auto-start when configured', () => {
      const checker = createMockHealthChecker();
      monitor = new PeriodicHealthMonitor(checker, {
        autoStart: true,
        intervalMs: 60000,
        minProbeIntervalMs: 0,
      });
      expect(monitor.getStatus().isRunning).toBe(true);
    });

    it('should use custom config values', () => {
      const checker = createMockHealthChecker();
      monitor = new PeriodicHealthMonitor(checker, {
        intervalMs: 10000,
        minProbeIntervalMs: 5000,
      });
      // Just confirm it doesn't throw
      expect(monitor.getStatus().isRunning).toBe(false);
    });
  });

  describe('start / stop', () => {
    it('should start and stop monitoring', () => {
      const checker = createMockHealthChecker();
      monitor = new PeriodicHealthMonitor(checker, {
        intervalMs: 60000,
        minProbeIntervalMs: 0,
      });

      monitor.start();
      expect(monitor.getStatus().isRunning).toBe(true);

      monitor.stop();
      expect(monitor.getStatus().isRunning).toBe(false);
    });

    it('should not throw when starting twice', () => {
      const checker = createMockHealthChecker();
      monitor = new PeriodicHealthMonitor(checker, {
        intervalMs: 60000,
        minProbeIntervalMs: 0,
      });

      monitor.start();
      expect(() => monitor.start()).not.toThrow(); // idempotent
    });

    it('should not throw when stopping without starting', () => {
      const checker = createMockHealthChecker();
      monitor = new PeriodicHealthMonitor(checker);
      expect(() => monitor.stop()).not.toThrow();
    });
  });

  describe('hasIssues', () => {
    it('should return false when all sources are healthy', () => {
      const checker = createMockHealthChecker();
      monitor = new PeriodicHealthMonitor(checker);
      expect(monitor.hasIssues()).toBe(false);
    });

    it('should return true when overall health is false', () => {
      const unhealthyResult: HealthCheckResult = {
        overallHealthy: false,
        sources: [
          { name: 'db', type: 'database', healthy: false, error: 'connection refused' },
        ],
        recommendations: ['Check database connection'],
      };
      const checker = createMockHealthChecker({
        getLastResult: mock(() => unhealthyResult),
      });
      monitor = new PeriodicHealthMonitor(checker);
      expect(monitor.hasIssues()).toBe(true);
    });

    it('should return false when no result is available', () => {
      const checker = createMockHealthChecker({
        getLastResult: mock(() => undefined),
      });
      monitor = new PeriodicHealthMonitor(checker);
      expect(monitor.hasIssues()).toBe(false);
    });
  });

  describe('buildHealthContext', () => {
    it('should return empty string when healthy', () => {
      const checker = createMockHealthChecker();
      monitor = new PeriodicHealthMonitor(checker);
      expect(monitor.buildHealthContext()).toBe('');
    });

    it('should return empty string when no result', () => {
      const checker = createMockHealthChecker({
        getLastResult: mock(() => undefined),
      });
      monitor = new PeriodicHealthMonitor(checker);
      expect(monitor.buildHealthContext()).toBe('');
    });

    it('should build context string with unhealthy sources', () => {
      const unhealthyResult: HealthCheckResult = {
        overallHealthy: false,
        sources: [
          { name: 'db', type: 'database', healthy: false, error: 'connection refused' },
          { name: 'redis', type: 'cache', healthy: true },
        ],
        recommendations: ['Check database connection'],
      };
      const checker = createMockHealthChecker({
        getLastResult: mock(() => unhealthyResult),
      });
      monitor = new PeriodicHealthMonitor(checker);
      const context = monitor.buildHealthContext();

      expect(context).toContain('<data-source-warning>');
      expect(context).toContain('db');
      expect(context).toContain('connection refused');
      expect(context).toContain('Check database connection');
      expect(context).toContain('</data-source-warning>');
      expect(context).not.toContain('redis'); // healthy source excluded
    });

    it('should handle unhealthy sources without error message', () => {
      const result: HealthCheckResult = {
        overallHealthy: false,
        sources: [
          { name: 'api', type: 'external', healthy: false },
        ],
        recommendations: [],
      };
      const checker = createMockHealthChecker({
        getLastResult: mock(() => result),
      });
      monitor = new PeriodicHealthMonitor(checker);
      const context = monitor.buildHealthContext();
      expect(context).toContain('unhealthy');
    });

    it('should return empty string when overallHealthy=false but all sources healthy', () => {
      const result: HealthCheckResult = {
        overallHealthy: false,
        sources: [
          { name: 'db', type: 'database', healthy: true },
        ],
        recommendations: [],
      };
      const checker = createMockHealthChecker({
        getLastResult: mock(() => result),
      });
      monitor = new PeriodicHealthMonitor(checker);
      expect(monitor.buildHealthContext()).toBe('');
    });
  });

  describe('getStatus', () => {
    it('should return initial status', () => {
      const checker = createMockHealthChecker();
      monitor = new PeriodicHealthMonitor(checker);
      const status = monitor.getStatus();

      expect(status.isRunning).toBe(false);
      expect(status.lastProbeTime).toBeNull();
      expect(status.currentHealthy).toBe(true);
      expect(status.unhealthySources).toEqual([]);
    });

    it('should list unhealthy source names', () => {
      const unhealthyResult: HealthCheckResult = {
        overallHealthy: false,
        sources: [
          { name: 'db', type: 'database', healthy: false },
          { name: 'redis', type: 'cache', healthy: false },
          { name: 'api', type: 'external', healthy: true },
        ],
        recommendations: [],
      };
      const checker = createMockHealthChecker({
        getLastResult: mock(() => unhealthyResult),
      });
      monitor = new PeriodicHealthMonitor(checker);
      const status = monitor.getStatus();
      expect(status.unhealthySources).toEqual(['db', 'redis']);
    });
  });
});
