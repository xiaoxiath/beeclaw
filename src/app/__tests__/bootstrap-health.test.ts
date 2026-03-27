import { describe, it, expect, afterEach, mock } from 'bun:test';

// Mock all domain dependencies
mock.module('../../domain/tools/datasource-health', () => ({
  DataSourceHealthChecker: class {
    constructor() {}
    registerCircuitBreaker = mock();
    setWebSearchProbe = mock();
    setMCPPingProbe = mock();
  },
}));

mock.module('../../infra/resilience/periodic-health-monitor', () => ({
  PeriodicHealthMonitor: class {
    constructor() {}
    stop = mock();
  },
}));

mock.module('../../infra/resilience/circuit-breaker', () => ({
  getCircuitBreakerRegistry: mock(() => ({
    getAllStats: mock(() => ({})),
    getBreaker: mock(() => ({})),
  })),
}));

mock.module('../../adapter/mcp', () => ({
  getMCPManager: mock(() => ({
    getStatus: mock(() => []),
  })),
}));

mock.module('../../domain/tools', () => ({
  setupHealthChecker: mock(),
}));

mock.module('../../domain/search', () => ({
  getSearchOrchestrator: mock(() => ({
    search: mock(() => Promise.resolve([])),
  })),
}));

mock.module('../../infra/observability/logger', () => ({
  logger: {
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  },
}));

mock.module('../../domain/ports', () => ({
  registerHealthMonitorPort: mock(),
}));

mock.module('../../domain/agent/compression', () => ({
  getCompressionStats: mock(() => ({
    totalCompressions: 10,
    avgRatio: 0.5,
    totalTokensSaved: 5000,
  })),
}));

mock.module('../../domain/agent/context/health-dashboard', () => ({
  getContextHealthDashboard: mock(() => ({
    getHistory: mock(() => []),
    checkAlerts: mock(() => []),
    trend: mock(() => 0),
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
