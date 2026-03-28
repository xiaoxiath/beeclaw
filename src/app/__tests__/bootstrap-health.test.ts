import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Hoisted mocks – available inside vi.mock() factories              */
/* ------------------------------------------------------------------ */
const mocks = vi.hoisted(() => {
  const mockRegisterCB = vi.fn();
  const mockSetWebSearchProbe = vi.fn();
  const mockSetMCPPingProbe = vi.fn();
  const mockMonitorStop = vi.fn();

  // Capture the onHealthChange callback so we can invoke it in tests
  let capturedOnHealthChange: ((prev: any, current: any) => void) | null = null;

  return {
    mockRegisterCB,
    mockSetWebSearchProbe,
    mockSetMCPPingProbe,
    mockMonitorStop,
    setCapturedOnHealthChange(fn: any) {
      capturedOnHealthChange = fn;
    },
    getCapturedOnHealthChange() {
      return capturedOnHealthChange;
    },

    // circuit-breaker mocks
    mockGetAllStats: vi.fn(() => ({ web_search: {}, mcp_server: {} })),
    mockGetBreaker: vi.fn((name: string) => ({ name })),
    mockGetCircuitBreakerRegistry: vi.fn(),

    // MCP manager
    mockGetStatus: vi.fn(() => ({})),
    mockPingServer: vi.fn(),
    mockGetMCPManager: vi.fn(),

    // search orchestrator
    mockSearch: vi.fn(() => Promise.resolve([])),
    mockGetSearchOrchestrator: vi.fn(),

    // domain tools
    mockSetupHealthChecker: vi.fn(),

    // ports
    mockRegisterHealthMonitorPort: vi.fn(),

    // compression
    mockGetCompressionStats: vi.fn(() => ({
      totalCompressions: 10,
      avgRatio: 0.5,
      totalTokensSaved: 5000,
    })),

    // context health dashboard
    mockGetHistory: vi.fn(() => []),
    mockCheckAlerts: vi.fn(() => []),
    mockTrend: vi.fn(() => 0),
    mockGetContextHealthDashboard: vi.fn(),

    // logger
    mockLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
});

/* ------------------------------------------------------------------ */
/*  vi.mock() declarations                                             */
/* ------------------------------------------------------------------ */
vi.mock('../../domain/tools/datasource-health', () => {
  return {
    DataSourceHealthChecker: class MockDataSourceHealthChecker {
      registerCircuitBreaker = mocks.mockRegisterCB;
      setWebSearchProbe = mocks.mockSetWebSearchProbe;
      setMCPPingProbe = mocks.mockSetMCPPingProbe;
    },
  };
});

vi.mock('../../infra/resilience/periodic-health-monitor', () => {
  return {
    PeriodicHealthMonitor: class MockPeriodicHealthMonitor {
      stop = mocks.mockMonitorStop;
      constructor(_checker: any, opts: any, _logger: any) {
        if (opts?.onHealthChange) {
          mocks.setCapturedOnHealthChange(opts.onHealthChange);
        }
      }
    },
  };
});

vi.mock('../../infra/resilience/circuit-breaker', () => ({
  getCircuitBreakerRegistry: (...args: any[]) => mocks.mockGetCircuitBreakerRegistry(...args),
}));

vi.mock('../../adapter/mcp', () => ({
  getMCPManager: (...args: any[]) => mocks.mockGetMCPManager(...args),
}));

vi.mock('../../domain/tools', () => ({
  setupHealthChecker: (...args: any[]) => mocks.mockSetupHealthChecker(...args),
}));

vi.mock('../../domain/search', () => ({
  getSearchOrchestrator: (...args: any[]) => mocks.mockGetSearchOrchestrator(...args),
}));

vi.mock('../../infra/observability/logger', () => ({
  logger: mocks.mockLogger,
}));

vi.mock('../../domain/ports', () => ({
  registerHealthMonitorPort: (...args: any[]) => mocks.mockRegisterHealthMonitorPort(...args),
}));

vi.mock('../../domain/agent/compression', () => ({
  getCompressionStats: (...args: any[]) => mocks.mockGetCompressionStats(...args),
}));

vi.mock('../../domain/agent/context/health-dashboard', () => ({
  getContextHealthDashboard: (...args: any[]) => mocks.mockGetContextHealthDashboard(...args),
}));

/* ------------------------------------------------------------------ */
/*  Import the module under test                                       */
/* ------------------------------------------------------------------ */
import {
  bootstrapHealthCheck,
  getHealthCheckerInstance,
  getHealthMonitorInstance,
  shutdownHealthCheck,
  checkCompressionHealth,
  checkContextHealth,
} from '../bootstrap-health';

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */
describe('bootstrap-health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset captured callback
    mocks.setCapturedOnHealthChange(null);

    // Default mock implementations
    mocks.mockGetCircuitBreakerRegistry.mockReturnValue({
      getAllStats: mocks.mockGetAllStats,
      getBreaker: mocks.mockGetBreaker,
    });

    mocks.mockGetMCPManager.mockReturnValue({
      getStatus: mocks.mockGetStatus,
      pingServer: mocks.mockPingServer,
    });

    mocks.mockGetSearchOrchestrator.mockReturnValue({
      search: mocks.mockSearch,
    });

    mocks.mockGetContextHealthDashboard.mockReturnValue({
      getHistory: mocks.mockGetHistory,
      checkAlerts: mocks.mockCheckAlerts,
      trend: mocks.mockTrend,
    });

    mocks.mockGetCompressionStats.mockReturnValue({
      totalCompressions: 10,
      avgRatio: 0.5,
      totalTokensSaved: 5000,
    });

    mocks.mockGetHistory.mockReturnValue([]);
    mocks.mockCheckAlerts.mockReturnValue([]);
    mocks.mockTrend.mockReturnValue(0);
    mocks.mockGetAllStats.mockReturnValue({ web_search: {}, mcp_server: {} });
    mocks.mockGetStatus.mockReturnValue({});
  });

  afterEach(() => {
    // Use try/catch in case state is weird between tests
    try { shutdownHealthCheck(); } catch (_) {}
  });

  /* ================================================================ */
  /*  bootstrapHealthCheck                                             */
  /* ================================================================ */
  describe('bootstrapHealthCheck', () => {
    it('should initialize and return checker and monitor', () => {
      const result = bootstrapHealthCheck();
      expect(result.healthChecker).toBeDefined();
      expect(result.healthMonitor).toBeDefined();
    });

    it('should log initialization messages', () => {
      bootstrapHealthCheck();
      expect(mocks.mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Initializing data source health check'),
      );
      expect(mocks.mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Health check subsystem initialized successfully'),
      );
    });

    it('should register circuit breakers from the registry', () => {
      mocks.mockGetAllStats.mockReturnValue({ web_search: {}, mcp_alpha: {}, mcp_beta: {} });
      mocks.mockGetBreaker.mockImplementation((name: string) => ({ name, state: 'closed' }));

      bootstrapHealthCheck();

      expect(mocks.mockRegisterCB).toHaveBeenCalledTimes(3);
      expect(mocks.mockRegisterCB).toHaveBeenCalledWith('web_search', { name: 'web_search', state: 'closed' });
      expect(mocks.mockRegisterCB).toHaveBeenCalledWith('mcp_alpha', { name: 'mcp_alpha', state: 'closed' });
      expect(mocks.mockRegisterCB).toHaveBeenCalledWith('mcp_beta', { name: 'mcp_beta', state: 'closed' });

      expect(mocks.mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Registered 3 circuit breakers'),
      );
    });

    it('should handle zero circuit breakers gracefully', () => {
      mocks.mockGetAllStats.mockReturnValue({});

      bootstrapHealthCheck();

      expect(mocks.mockRegisterCB).not.toHaveBeenCalled();
      expect(mocks.mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Registered 0 circuit breakers'),
      );
    });

    it('should handle circuit breaker registry error gracefully', () => {
      mocks.mockGetCircuitBreakerRegistry.mockImplementation(() => {
        throw new Error('Registry not available');
      });

      expect(() => bootstrapHealthCheck()).not.toThrow();
      expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not register circuit breakers'),
        expect.any(Error),
      );
    });

    it('should set up web search probe', () => {
      bootstrapHealthCheck();
      expect(mocks.mockSetWebSearchProbe).toHaveBeenCalledTimes(1);
      expect(mocks.mockSetWebSearchProbe).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should handle web search probe setup error gracefully', () => {
      mocks.mockSetWebSearchProbe.mockImplementation(() => {
        throw new Error('Probe setup failed');
      });

      expect(() => bootstrapHealthCheck()).not.toThrow();
      expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not set up web search probe'),
        expect.any(Error),
      );
    });

    it('should set up MCP ping probe', () => {
      bootstrapHealthCheck();
      expect(mocks.mockSetMCPPingProbe).toHaveBeenCalledTimes(1);
      expect(mocks.mockSetMCPPingProbe).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should handle MCP ping probe setup error gracefully', () => {
      mocks.mockSetMCPPingProbe.mockImplementation(() => {
        throw new Error('MCP probe setup failed');
      });

      expect(() => bootstrapHealthCheck()).not.toThrow();
      expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not set up MCP ping probe'),
        expect.any(Error),
      );
    });

    it('should call setupHealthChecker with the created checker', () => {
      bootstrapHealthCheck();
      expect(mocks.mockSetupHealthChecker).toHaveBeenCalledTimes(1);
    });

    it('should register health monitor port', () => {
      bootstrapHealthCheck();
      expect(mocks.mockRegisterHealthMonitorPort).toHaveBeenCalledTimes(1);
      expect(mocks.mockRegisterHealthMonitorPort).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should pass port getter that returns the monitor instance', () => {
      bootstrapHealthCheck();
      const portGetter = mocks.mockRegisterHealthMonitorPort.mock.calls[0][0];
      const monitor = portGetter();
      expect(monitor).toBeDefined();
      expect(typeof monitor.stop).toBe('function');
    });
  });

  /* ================================================================ */
  /*  Web search probe execution                                       */
  /* ================================================================ */
  describe('web search probe', () => {
    let webSearchProbe: (query: string, timeout: number) => Promise<any>;

    beforeEach(() => {
      bootstrapHealthCheck();
      webSearchProbe = mocks.mockSetWebSearchProbe.mock.calls[0][0];
    });

    it('should return ok:true with latency when search succeeds with results', async () => {
      mocks.mockSearch.mockResolvedValue([{ title: 'Test', url: 'https://test.com' }]);

      const result = await webSearchProbe('test', 5000);
      expect(result.ok).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it('should return ok:false when search returns empty array', async () => {
      mocks.mockSearch.mockResolvedValue([]);

      const result = await webSearchProbe('test', 5000);
      expect(result.ok).toBe(false);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should return ok:true when search returns truthy non-array result', async () => {
      mocks.mockSearch.mockResolvedValue({ results: [] });

      const result = await webSearchProbe('test', 5000);
      expect(result.ok).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should return ok:false with error when search throws', async () => {
      mocks.mockSearch.mockRejectedValue(new Error('Network error'));

      const result = await webSearchProbe('test', 5000);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Network error');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should return ok:false with error message for non-Error throws', async () => {
      mocks.mockSearch.mockRejectedValue('string error');

      const result = await webSearchProbe('test', 5000);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('string error');
    });

    it('should handle timeout via Promise.race', async () => {
      vi.useFakeTimers();

      // Search that never resolves
      mocks.mockSearch.mockReturnValue(new Promise(() => {}));

      const probePromise = webSearchProbe('test', 100);

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(200);

      const result = await probePromise;
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Web search probe timeout');

      vi.useRealTimers();
    });
  });

  /* ================================================================ */
  /*  MCP ping probe execution                                         */
  /* ================================================================ */
  describe('MCP ping probe', () => {
    let mcpPingProbe: (serverId: string, timeout: number) => Promise<any>;

    describe('with pingServer method available', () => {
      beforeEach(() => {
        mocks.mockPingServer.mockResolvedValue({ ok: true, latencyMs: 42, toolCount: 5 });
        mocks.mockGetMCPManager.mockReturnValue({
          getStatus: mocks.mockGetStatus,
          pingServer: mocks.mockPingServer,
        });
        bootstrapHealthCheck();
        mcpPingProbe = mocks.mockSetMCPPingProbe.mock.calls[0][0];
      });

      it('should use pingServer when available', async () => {
        const result = await mcpPingProbe('test-server', 5000);
        expect(mocks.mockPingServer).toHaveBeenCalledWith('test-server', 5000);
        expect(result).toEqual({ ok: true, latencyMs: 42, toolCount: 5 });
      });
    });

    describe('fallback without pingServer method', () => {
      beforeEach(() => {
        // MCP manager without pingServer
        mocks.mockGetMCPManager.mockReturnValue({
          getStatus: mocks.mockGetStatus,
        });
        bootstrapHealthCheck();
        mcpPingProbe = mocks.mockSetMCPPingProbe.mock.calls[0][0];
      });

      it('should return ok:true for connected server', async () => {
        mocks.mockGetStatus.mockReturnValue({
          'server-a': { connected: true, toolCount: 3 },
        });

        const result = await mcpPingProbe('server-a', 5000);
        expect(result.ok).toBe(true);
        expect(result.toolCount).toBe(3);
        expect(result.latencyMs).toBe(0);
        expect(result.error).toBeUndefined();
      });

      it('should return ok:false for disconnected server', async () => {
        mocks.mockGetStatus.mockReturnValue({
          'server-b': { connected: false, toolCount: 0 },
        });

        const result = await mcpPingProbe('server-b', 5000);
        expect(result.ok).toBe(false);
        expect(result.error).toBe('Server not connected');
      });

      it('should return ok:false for unknown server', async () => {
        mocks.mockGetStatus.mockReturnValue({});

        const result = await mcpPingProbe('nonexistent', 5000);
        expect(result.ok).toBe(false);
        expect(result.error).toContain('not found');
        expect(result.toolCount).toBe(0);
      });
    });
  });

  /* ================================================================ */
  /*  Health change callback (onHealthChange)                          */
  /* ================================================================ */
  describe('health change callback', () => {
    it('should log warning when health degrades', () => {
      bootstrapHealthCheck();
      const onHealthChange = mocks.getCapturedOnHealthChange();
      expect(onHealthChange).not.toBeNull();

      const prev = { overallHealthy: true, sources: [] };
      const current = {
        overallHealthy: false,
        sources: [
          { name: 'web_search', healthy: false },
          { name: 'mcp_a', healthy: true },
        ],
      };

      onHealthChange!(prev, current);

      expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Data source health degraded'),
      );
      expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('web_search'),
      );
    });

    it('should log info when health recovers', () => {
      bootstrapHealthCheck();
      const onHealthChange = mocks.getCapturedOnHealthChange();

      const prev = { overallHealthy: false, sources: [] };
      const current = { overallHealthy: true, sources: [] };

      onHealthChange!(prev, current);

      expect(mocks.mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('recovered to healthy'),
      );
    });

    it('should not log recovery info when prev was healthy and current is healthy', () => {
      bootstrapHealthCheck();
      const onHealthChange = mocks.getCapturedOnHealthChange();

      // Reset the info mock to clear bootstrap log calls
      mocks.mockLogger.info.mockClear();

      const prev = { overallHealthy: true, sources: [] };
      const current = { overallHealthy: true, sources: [] };

      onHealthChange!(prev, current);

      // No recovery message since prev was already healthy
      const infoArgs = mocks.mockLogger.info.mock.calls.map((c: any) => c[0]);
      expect(infoArgs.some((msg: string) => msg.includes('recovered'))).toBe(false);
    });

    it('should not log recovery when prev is null (first check) and current is healthy', () => {
      bootstrapHealthCheck();
      const onHealthChange = mocks.getCapturedOnHealthChange();
      mocks.mockLogger.info.mockClear();

      const current = { overallHealthy: true, sources: [] };
      onHealthChange!(null, current);

      const infoArgs = mocks.mockLogger.info.mock.calls.map((c: any) => c[0]);
      expect(infoArgs.some((msg: string) => msg.includes('recovered'))).toBe(false);
    });

    it('should list multiple unhealthy sources in warning', () => {
      bootstrapHealthCheck();
      const onHealthChange = mocks.getCapturedOnHealthChange();

      const current = {
        overallHealthy: false,
        sources: [
          { name: 'web_search', healthy: false },
          { name: 'mcp_a', healthy: false },
          { name: 'mcp_b', healthy: true },
        ],
      };

      onHealthChange!({ overallHealthy: true, sources: [] }, current);

      const warnCall = mocks.mockLogger.warn.mock.calls.find(
        (c: any) => typeof c[0] === 'string' && c[0].includes('Unhealthy sources'),
      );
      expect(warnCall).toBeDefined();
      expect(warnCall![0]).toContain('web_search');
      expect(warnCall![0]).toContain('mcp_a');
      expect(warnCall![0]).not.toContain('mcp_b');
    });
  });

  /* ================================================================ */
  /*  getHealthCheckerInstance / getHealthMonitorInstance               */
  /* ================================================================ */
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

  /* ================================================================ */
  /*  shutdownHealthCheck                                              */
  /* ================================================================ */
  describe('shutdownHealthCheck', () => {
    it('should clear instances and stop monitor', () => {
      bootstrapHealthCheck();
      shutdownHealthCheck();
      expect(getHealthCheckerInstance()).toBeNull();
      expect(getHealthMonitorInstance()).toBeNull();
      expect(mocks.mockMonitorStop).toHaveBeenCalledTimes(1);
    });

    it('should not throw when called without bootstrap', () => {
      expect(() => shutdownHealthCheck()).not.toThrow();
    });

    it('should log shutdown message', () => {
      shutdownHealthCheck();
      expect(mocks.mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Health check subsystem shut down'),
      );
    });
  });

  /* ================================================================ */
  /*  checkCompressionHealth                                           */
  /* ================================================================ */
  describe('checkCompressionHealth', () => {
    it('should return healthy status when avgRatio > 0.3', () => {
      mocks.mockGetCompressionStats.mockReturnValue({
        totalCompressions: 10,
        avgRatio: 0.5,
        totalTokensSaved: 5000,
      });

      const result = checkCompressionHealth();
      expect(result.status).toBe('healthy');
      expect(result.metrics).toEqual({
        totalCompressions: 10,
        avgRatio: 0.5,
        tokensSaved: 5000,
      });
    });

    it('should return warning status when avgRatio <= 0.3', () => {
      mocks.mockGetCompressionStats.mockReturnValue({
        totalCompressions: 5,
        avgRatio: 0.2,
        totalTokensSaved: 200,
      });

      const result = checkCompressionHealth();
      expect(result.status).toBe('warning');
      expect(result.metrics).toEqual({
        totalCompressions: 5,
        avgRatio: 0.2,
        tokensSaved: 200,
      });
    });

    it('should return warning status when avgRatio is exactly 0.3', () => {
      mocks.mockGetCompressionStats.mockReturnValue({
        totalCompressions: 3,
        avgRatio: 0.3,
        totalTokensSaved: 100,
      });

      const result = checkCompressionHealth();
      expect(result.status).toBe('warning');
    });

    it('should return warning status when avgRatio is 0', () => {
      mocks.mockGetCompressionStats.mockReturnValue({
        totalCompressions: 0,
        avgRatio: 0,
        totalTokensSaved: 0,
      });

      const result = checkCompressionHealth();
      expect(result.status).toBe('warning');
      expect(result.metrics.totalCompressions).toBe(0);
    });

    it('should return healthy when avgRatio is just above 0.3', () => {
      mocks.mockGetCompressionStats.mockReturnValue({
        totalCompressions: 8,
        avgRatio: 0.31,
        totalTokensSaved: 1000,
      });

      const result = checkCompressionHealth();
      expect(result.status).toBe('healthy');
    });
  });

  /* ================================================================ */
  /*  checkContextHealth                                               */
  /* ================================================================ */
  describe('checkContextHealth', () => {
    it('should return no_data when history is empty', () => {
      mocks.mockGetHistory.mockReturnValue([]);

      const result = checkContextHealth();
      expect(result.status).toBe('no_data');
      expect(result.message).toContain('No context data yet');
      expect(result.metrics).toBeUndefined();
      expect(result.alerts).toBeUndefined();
      expect(result.trends).toBeUndefined();
    });

    it('should return healthy when there are no alerts', () => {
      const latestMetrics = {
        tokenUtilization: 0.7,
        redundancyRate: 0.1,
        freshnessScore: 0.9,
        coherenceScore: 0.85,
        informationDensity: 0.6,
      };
      mocks.mockGetHistory.mockReturnValue([latestMetrics]);
      mocks.mockCheckAlerts.mockReturnValue([]);
      mocks.mockTrend.mockReturnValue(0.01);

      const result = checkContextHealth();
      expect(result.status).toBe('healthy');
      expect(result.metrics).toEqual(latestMetrics);
      expect(result.alerts).toEqual([]);
      expect(result.trends).toEqual({
        tokenUtilization: 0.01,
        redundancyRate: 0.01,
        freshnessScore: 0.01,
        coherenceScore: 0.01,
        informationDensity: 0.01,
      });
    });

    it('should return degraded when there are warning alerts', () => {
      const latestMetrics = {
        tokenUtilization: 0.95,
        redundancyRate: 0.4,
        freshnessScore: 0.5,
        coherenceScore: 0.6,
        informationDensity: 0.3,
      };
      mocks.mockGetHistory.mockReturnValue([latestMetrics]);
      mocks.mockCheckAlerts.mockReturnValue([
        {
          metric: 'redundancyRate',
          severity: 'warning',
          value: 0.4,
          threshold: 0.3,
          message: 'High redundancy',
        },
      ]);

      const result = checkContextHealth();
      expect(result.status).toBe('degraded');
      expect(result.alerts).toHaveLength(1);
      expect(result.alerts![0].severity).toBe('warning');
    });

    it('should return degraded when there are critical alerts', () => {
      const latestMetrics = {
        tokenUtilization: 0.99,
        redundancyRate: 0.8,
        freshnessScore: 0.2,
        coherenceScore: 0.3,
        informationDensity: 0.1,
      };
      mocks.mockGetHistory.mockReturnValue([latestMetrics]);
      mocks.mockCheckAlerts.mockReturnValue([
        {
          metric: 'tokenUtilization',
          severity: 'critical',
          value: 0.99,
          threshold: 0.95,
          message: 'Token budget nearly exhausted',
        },
        {
          metric: 'redundancyRate',
          severity: 'warning',
          value: 0.8,
          threshold: 0.3,
          message: 'Very high redundancy',
        },
      ]);

      const result = checkContextHealth();
      expect(result.status).toBe('degraded');
      expect(result.alerts).toHaveLength(2);
    });

    it('should use the latest entry from history (last element)', () => {
      const entry1 = {
        tokenUtilization: 0.3,
        redundancyRate: 0.05,
        freshnessScore: 0.99,
        coherenceScore: 0.99,
        informationDensity: 0.9,
      };
      const entry2 = {
        tokenUtilization: 0.9,
        redundancyRate: 0.5,
        freshnessScore: 0.4,
        coherenceScore: 0.5,
        informationDensity: 0.2,
      };
      mocks.mockGetHistory.mockReturnValue([entry1, entry2]);
      mocks.mockCheckAlerts.mockReturnValue([]);

      const result = checkContextHealth();
      expect(result.metrics).toEqual(entry2);
      expect(mocks.mockCheckAlerts).toHaveBeenCalledWith(entry2);
    });

    it('should call trend with window size 10 for each metric', () => {
      mocks.mockGetHistory.mockReturnValue([{
        tokenUtilization: 0.5,
        redundancyRate: 0.1,
        freshnessScore: 0.8,
        coherenceScore: 0.7,
        informationDensity: 0.5,
      }]);
      mocks.mockCheckAlerts.mockReturnValue([]);

      checkContextHealth();

      expect(mocks.mockTrend).toHaveBeenCalledWith('tokenUtilization', 10);
      expect(mocks.mockTrend).toHaveBeenCalledWith('redundancyRate', 10);
      expect(mocks.mockTrend).toHaveBeenCalledWith('freshnessScore', 10);
      expect(mocks.mockTrend).toHaveBeenCalledWith('coherenceScore', 10);
      expect(mocks.mockTrend).toHaveBeenCalledWith('informationDensity', 10);
      expect(mocks.mockTrend).toHaveBeenCalledTimes(5);
    });

    it('should populate different trend values per metric', () => {
      mocks.mockGetHistory.mockReturnValue([{
        tokenUtilization: 0.5,
        redundancyRate: 0.1,
        freshnessScore: 0.8,
        coherenceScore: 0.7,
        informationDensity: 0.5,
      }]);
      mocks.mockCheckAlerts.mockReturnValue([]);

      mocks.mockTrend
        .mockReturnValueOnce(0.05)
        .mockReturnValueOnce(-0.02)
        .mockReturnValueOnce(0.1)
        .mockReturnValueOnce(0.0)
        .mockReturnValueOnce(-0.03);

      const result = checkContextHealth();
      expect(result.trends).toEqual({
        tokenUtilization: 0.05,
        redundancyRate: -0.02,
        freshnessScore: 0.1,
        coherenceScore: 0.0,
        informationDensity: -0.03,
      });
    });
  });
});
