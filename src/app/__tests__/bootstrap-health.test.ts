import { describe, it, expect, afterEach, vi } from 'vitest';

// Mock all domain dependencies
vi.mock('../../domain/tools/datasource-health', () => ({
  DataSourceHealthChecker: class {
    constructor() {}
    registerCircuitBreaker = vi.fn();
    setWebSearchProbe = vi.fn();
    setMCPPingProbe = vi.fn();
  },
}));

vi.mock('../../infra/resilience/periodic-health-monitor', () => ({
  PeriodicHealthMonitor: class {
    constructor() {}
    stop = vi.fn();
  },
}));

vi.mock('../../infra/resilience/circuit-breaker', () => ({
  getCircuitBreakerRegistry: vi.fn(() => ({
    getAllStats: vi.fn(() => ({})),
    getBreaker: vi.fn(() => ({})),
  })),
}));

vi.mock('../../adapter/mcp', () => ({
  getMCPManager: vi.fn(() => ({
    getStatus: vi.fn(() => []),
  })),
}));

vi.mock('../../domain/tools', () => ({
  setupHealthChecker: vi.fn(),
}));

vi.mock('../../domain/search', () => ({
  getSearchOrchestrator: vi.fn(() => ({
    search: vi.fn(() => Promise.resolve([])),
  })),
}));

vi.mock('../../infra/observability/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../domain/ports', () => ({
  registerHealthMonitorPort: vi.fn(),
}));

vi.mock('../../domain/agent/compression', () => ({
  getCompressionStats: vi.fn(() => ({
    totalCompressions: 10,
    avgRatio: 0.5,
    totalTokensSaved: 5000,
  })),
}));

vi.mock('../../domain/agent/context/health-dashboard', () => ({
  getContextHealthDashboard: vi.fn(() => ({
    getHistory: vi.fn(() => []),
    checkAlerts: vi.fn(() => []),
    trend: vi.fn(() => 0),
  })),
}));

import {
  bootstrapHealthCheck,
  getHealthCheckerInstance,
  getHealthMonitorInstance,
  shutdownHealthCheck,
  checkCompressionHealth,
  checkContextHealth,
} from '../bootstrap-health';

describe('bootstrap-health', () => {
  afterEach(() => {
    shutdownHealthCheck();
  });

  describe('bootstrapHealthCheck', () => {
    it('should initialize and return checker and monitor', () => {
      const result = bootstrapHealthCheck();
      expect(result.healthChecker).toBeDefined();
      expect(result.healthMonitor).toBeDefined();
    });
  });

  describe('getHealthCheckerInstance', () => {
    it('should return null before bootstrap', () => {
      expect(getHealthCheckerInstance()).toBeNull();
    });

    it('should return instance after bootstrap', () => {
      bootstrapHealthCheck();
      expect(getHealthCheckerInstance()).not.toBeNull();
    });
  });

  describe('getHealthMonitorInstance', () => {
    it('should return null before bootstrap', () => {
      expect(getHealthMonitorInstance()).toBeNull();
    });

    it('should return instance after bootstrap', () => {
      bootstrapHealthCheck();
      expect(getHealthMonitorInstance()).not.toBeNull();
    });
  });

  describe('shutdownHealthCheck', () => {
    it('should clear instances', () => {
      bootstrapHealthCheck();
      shutdownHealthCheck();
      expect(getHealthCheckerInstance()).toBeNull();
      expect(getHealthMonitorInstance()).toBeNull();
    });

    it('should not throw when called without bootstrap', () => {
      expect(() => shutdownHealthCheck()).not.toThrow();
    });
  });

  describe('checkCompressionHealth', () => {
    it('should return healthy status when ratio > 0.3', () => {
      const result = checkCompressionHealth();
      expect(result.status).toBe('healthy');
      expect(result.metrics.totalCompressions).toBe(10);
      expect(result.metrics.avgRatio).toBe(0.5);
      expect(result.metrics.tokensSaved).toBe(5000);
    });
  });

  describe('checkContextHealth', () => {
    it('should return no_data when no history', () => {
      const result = checkContextHealth();
      expect(result.status).toBe('no_data');
      expect(result.message).toBeDefined();
    });
  });
});
