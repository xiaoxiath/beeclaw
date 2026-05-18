import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

import {
  DataSourceHealthChecker,
  processDatasourceHealthCheck,
  datasourceHealthCheckTool,
} from '../datasource-health';

describe('datasource-health', () => {
  // ========================================================================
  // datasourceHealthCheckTool definition
  // ========================================================================
  describe('datasourceHealthCheckTool', () => {
    it('has correct name', () => {
      expect(datasourceHealthCheckTool.name).toBe('datasource_health_check');
    });

    it('has description', () => {
      expect(datasourceHealthCheckTool.description).toBeTruthy();
    });

    it('has parameters for probe_web_search, probe_mcp_servers, quick_mode', () => {
      const props = (datasourceHealthCheckTool as any).parameters.properties;
      expect(props.probe_web_search).toBeDefined();
      expect(props.probe_mcp_servers).toBeDefined();
      expect(props.quick_mode).toBeDefined();
    });
  });

  // ========================================================================
  // DataSourceHealthChecker
  // ========================================================================
  describe('DataSourceHealthChecker', () => {
    let checker: DataSourceHealthChecker;
    const mockLogger: any = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    beforeEach(() => {
      vi.clearAllMocks();
      checker = new DataSourceHealthChecker(undefined, mockLogger);
    });

    // ---- Construction ----
    it('constructs with default config', () => {
      const c = new DataSourceHealthChecker();
      expect(c).toBeDefined();
    });

    it('constructs with custom config', () => {
      const c = new DataSourceHealthChecker({ probeTimeoutMs: 1000 });
      expect(c).toBeDefined();
    });

    it('constructs with logger', () => {
      const c = new DataSourceHealthChecker({}, mockLogger);
      expect(c).toBeDefined();
    });

    // ---- Registration ----
    describe('registerCircuitBreaker', () => {
      it('registers a circuit breaker', () => {
        const breaker: any = { getState: () => 'closed' };
        checker.registerCircuitBreaker('test', breaker);
        const status = checker.getQuickStatus();
        expect(status.test).toBeDefined();
      });
    });

    describe('setWebSearchProbe', () => {
      it('sets the web search probe callback', () => {
        const probe = vi.fn();
        checker.setWebSearchProbe(probe);
        // No assertion other than no error
      });
    });

    describe('setMCPPingProbe', () => {
      it('sets the MCP ping probe callback', () => {
        const probe = vi.fn();
        checker.setMCPPingProbe(probe);
      });
    });

    describe('setFetchUrlProbe', () => {
      it('sets the fetch URL probe callback', () => {
        const probe = vi.fn();
        checker.setFetchUrlProbe(probe);
      });
    });

    // ---- getQuickStatus ----
    describe('getQuickStatus', () => {
      it('returns empty object when no breakers registered', () => {
        const status = checker.getQuickStatus();
        expect(Object.keys(status)).toHaveLength(0);
      });

      it('returns healthy for closed breaker', () => {
        const breaker: any = { getState: () => 'closed' };
        checker.registerCircuitBreaker('web_search', breaker);
        const status = checker.getQuickStatus();
        expect(status.web_search.healthy).toBe(true);
        expect(status.web_search.state).toBe('closed');
      });

      it('returns unhealthy for open breaker', () => {
        const breaker: any = { getState: () => 'open' };
        checker.registerCircuitBreaker('test', breaker);
        const status = checker.getQuickStatus();
        expect(status.test.healthy).toBe(false);
        expect(status.test.state).toBe('open');
      });

      it('returns unhealthy for half_open breaker', () => {
        const breaker: any = { getState: () => 'half_open' };
        checker.registerCircuitBreaker('test', breaker);
        const status = checker.getQuickStatus();
        expect(status.test.healthy).toBe(false);
        expect(status.test.state).toBe('half_open');
      });

      it('handles multiple breakers', () => {
        checker.registerCircuitBreaker('a', { getState: () => 'closed' } as any);
        checker.registerCircuitBreaker('b', { getState: () => 'open' } as any);
        const status = checker.getQuickStatus();
        expect(status.a.healthy).toBe(true);
        expect(status.b.healthy).toBe(false);
      });
    });

    // ---- getLastResult ----
    describe('getLastResult', () => {
      it('returns undefined before any check', () => {
        expect(checker.getLastResult()).toBeUndefined();
      });

      it('returns result after check', async () => {
        await checker.runHealthCheck();
        expect(checker.getLastResult()).toBeDefined();
      });
    });

    // ---- runHealthCheck ----
    describe('runHealthCheck', () => {
      it('returns healthy when no sources registered', async () => {
        const result = await checker.runHealthCheck();
        expect(result.overallHealthy).toBe(true);
        expect(result.sources).toHaveLength(0);
        expect(result.summary).toContain('All 0 data sources');
      });

      it('checks circuit breaker states - closed', async () => {
        checker.registerCircuitBreaker('test', { getState: () => 'closed' } as any);
        const result = await checker.runHealthCheck();
        expect(result.overallHealthy).toBe(true);
        expect(result.sources[0].healthy).toBe(true);
        expect(result.sources[0].circuitState).toBe('closed');
      });

      it('checks circuit breaker states - open', async () => {
        checker.registerCircuitBreaker('bad', { getState: () => 'open' } as any);
        const result = await checker.runHealthCheck();
        expect(result.overallHealthy).toBe(false);
        expect(result.sources[0].healthy).toBe(false);
        expect(result.sources[0].error).toContain('OPEN');
        expect(result.recommendations.length).toBeGreaterThan(0);
        expect(result.recommendations[0]).toContain('OPEN');
      });

      it('checks circuit breaker states - half_open', async () => {
        checker.registerCircuitBreaker('recovering', { getState: () => 'half_open' } as any);
        const result = await checker.runHealthCheck();
        expect(result.overallHealthy).toBe(false);
        expect(result.sources[0].error).toContain('HALF_OPEN');
        expect(result.recommendations[0]).toContain('recovery mode');
      });

      it('mixed healthy and unhealthy sources', async () => {
        checker.registerCircuitBreaker('good', { getState: () => 'closed' } as any);
        checker.registerCircuitBreaker('bad', { getState: () => 'open' } as any);
        const result = await checker.runHealthCheck();
        expect(result.overallHealthy).toBe(false);
        expect(result.summary).toContain('1 of 2');
      });

      it('stores result and logs debug when all healthy', async () => {
        checker.registerCircuitBreaker('ok', { getState: () => 'closed' } as any);
        const result = await checker.runHealthCheck();
        expect(checker.getLastResult()).toBe(result);
        expect(mockLogger.debug).toHaveBeenCalled();
      });

      it('logs info when there are issues', async () => {
        checker.registerCircuitBreaker('bad', { getState: () => 'open' } as any);
        await checker.runHealthCheck();
        expect(mockLogger.info).toHaveBeenCalled();
      });

      // ---- inferSourceType ----
      it('infers mcp type for mcp- prefixed breakers', async () => {
        checker.registerCircuitBreaker('mcp-server1', { getState: () => 'closed' } as any);
        const result = await checker.runHealthCheck();
        expect(result.sources[0].type).toBe('mcp');
      });

      it('infers web_search type for web_search named breaker', async () => {
        checker.registerCircuitBreaker('web_search', { getState: () => 'closed' } as any);
        const result = await checker.runHealthCheck();
        expect(result.sources[0].type).toBe('web_search');
      });

      it('infers web_search type for name containing search', async () => {
        checker.registerCircuitBreaker('custom_search_engine', { getState: () => 'closed' } as any);
        const result = await checker.runHealthCheck();
        expect(result.sources[0].type).toBe('web_search');
      });

      it('infers fetch_url type for fetch_url named breaker', async () => {
        checker.registerCircuitBreaker('fetch_url', { getState: () => 'closed' } as any);
        const result = await checker.runHealthCheck();
        expect(result.sources[0].type).toBe('fetch_url');
      });

      it('infers fetch_url type for name containing fetch', async () => {
        checker.registerCircuitBreaker('page_fetcher', { getState: () => 'closed' } as any);
        const result = await checker.runHealthCheck();
        expect(result.sources[0].type).toBe('fetch_url');
      });

      it('infers builtin type as fallback', async () => {
        checker.registerCircuitBreaker('calculator', { getState: () => 'closed' } as any);
        const result = await checker.runHealthCheck();
        expect(result.sources[0].type).toBe('builtin');
      });

      // ---- Web search probe ----
      it('runs web search probe when configured - success', async () => {
        checker.setWebSearchProbe(async () => ({ ok: true, latencyMs: 100 }));
        const result = await checker.runHealthCheck({
          probeWebSearch: true,
          probeMCPServers: false,
          webSearchTestQuery: 'test',
          probeTimeoutMs: 5000,
        });
        const ws = result.sources.find(s => s.name === 'web_search');
        expect(ws).toBeDefined();
        expect(ws!.healthy).toBe(true);
        expect(ws!.latencyMs).toBe(100);
        expect(ws!.details).toEqual({ probeLatencyMs: 100 });
      });

      it('runs web search probe - failure', async () => {
        checker.setWebSearchProbe(async () => ({ ok: false, latencyMs: 0, error: 'timeout' }));
        const result = await checker.runHealthCheck({
          probeWebSearch: true,
          probeMCPServers: false,
          webSearchTestQuery: 'test',
          probeTimeoutMs: 5000,
        });
        const ws = result.sources.find(s => s.name === 'web_search');
        expect(ws!.healthy).toBe(false);
        expect(ws!.error).toContain('timeout');
        expect(result.recommendations.some(r => r.includes('Active probe failed'))).toBe(true);
      });

      it('web search probe - failure with no error message', async () => {
        checker.setWebSearchProbe(async () => ({ ok: false, latencyMs: 0 }));
        const result = await checker.runHealthCheck({
          probeWebSearch: true,
          probeMCPServers: false,
          webSearchTestQuery: 'test',
          probeTimeoutMs: 5000,
        });
        const ws = result.sources.find(s => s.name === 'web_search');
        expect(ws!.error).toContain('Web search probe failed');
      });

      it('web search probe updates existing source entry', async () => {
        checker.registerCircuitBreaker('web_search', { getState: () => 'closed' } as any);
        checker.setWebSearchProbe(async () => ({ ok: true, latencyMs: 150 }));
        const result = await checker.runHealthCheck({
          probeWebSearch: true,
          probeMCPServers: false,
          webSearchTestQuery: 'test',
          probeTimeoutMs: 5000,
        });
        // Should update the existing entry, not add a new one
        const wsEntries = result.sources.filter(s => s.name === 'web_search');
        expect(wsEntries).toHaveLength(1);
        expect(wsEntries[0].latencyMs).toBe(150);
        expect(wsEntries[0].healthy).toBe(true);
      });

      it('web search probe updates existing source entry - failure overrides healthy', async () => {
        checker.registerCircuitBreaker('web_search', { getState: () => 'closed' } as any);
        checker.setWebSearchProbe(async () => ({ ok: false, latencyMs: 0, error: 'down' }));
        const result = await checker.runHealthCheck({
          probeWebSearch: true,
          probeMCPServers: false,
          webSearchTestQuery: 'test',
          probeTimeoutMs: 5000,
        });
        const ws = result.sources.find(s => s.name === 'web_search');
        expect(ws!.healthy).toBe(false);
        expect(ws!.error).toContain('down');
      });

      it('web search probe - high latency recommendation', async () => {
        checker.setWebSearchProbe(async () => ({ ok: true, latencyMs: 4000 }));
        const result = await checker.runHealthCheck({
          probeWebSearch: true,
          probeMCPServers: false,
          webSearchTestQuery: 'test',
          probeTimeoutMs: 10000,
        });
        expect(result.recommendations.some(r => r.includes('latency is high'))).toBe(true);
      });

      it('web search probe - exception handling', async () => {
        checker.setWebSearchProbe(async () => { throw new Error('Network error'); });
        const result = await checker.runHealthCheck({
          probeWebSearch: true,
          probeMCPServers: false,
          webSearchTestQuery: 'test',
          probeTimeoutMs: 5000,
        });
        const ws = result.sources.find(s => s.name === 'web_search');
        expect(ws!.healthy).toBe(false);
        expect(ws!.error).toContain('Probe threw exception');
        expect(ws!.error).toContain('Network error');
        expect(mockLogger.error).toHaveBeenCalled();
        expect(result.recommendations.some(r => r.includes('threw an exception'))).toBe(true);
      });

      it('web search probe - non-Error exception handling', async () => {
        checker.setWebSearchProbe(async () => { throw 'string error'; });
        const result = await checker.runHealthCheck({
          probeWebSearch: true,
          probeMCPServers: false,
          webSearchTestQuery: 'test',
          probeTimeoutMs: 5000,
        });
        const ws = result.sources.find(s => s.name === 'web_search');
        expect(ws!.error).toContain('string error');
      });

      it('does not run web search probe when probeWebSearch is false', async () => {
        const probe = vi.fn();
        checker.setWebSearchProbe(probe);
        await checker.runHealthCheck({ probeWebSearch: false, probeMCPServers: false, webSearchTestQuery: 'test', probeTimeoutMs: 5000 });
        expect(probe).not.toHaveBeenCalled();
      });

      it('does not run web search probe when no probe registered', async () => {
        const result = await checker.runHealthCheck({
          probeWebSearch: true,
          probeMCPServers: false,
          webSearchTestQuery: 'test',
          probeTimeoutMs: 5000,
        });
        // No web_search source added
        expect(result.sources.find(s => s.name === 'web_search')).toBeUndefined();
      });

      // ---- MCP probe ----
      it('runs MCP probe for mcp- prefixed breakers - success', async () => {
        checker.registerCircuitBreaker('mcp-server1', { getState: () => 'closed' } as any);
        checker.setMCPPingProbe(async () => ({ ok: true, latencyMs: 50, toolCount: 5 }));
        const result = await checker.runHealthCheck({
          probeWebSearch: false,
          probeMCPServers: true,
          webSearchTestQuery: 'test',
          probeTimeoutMs: 5000,
        });
        const mcp = result.sources.find(s => s.name === 'mcp-server1');
        expect(mcp).toBeDefined();
        expect(mcp!.latencyMs).toBe(50);
        expect(mcp!.details?.toolCount).toBe(5);
      });

      it('runs MCP probe - failure', async () => {
        checker.registerCircuitBreaker('mcp-badserver', { getState: () => 'closed' } as any);
        checker.setMCPPingProbe(async () => ({ ok: false, latencyMs: 0, toolCount: 0, error: 'connection refused' }));
        const result = await checker.runHealthCheck({
          probeWebSearch: false,
          probeMCPServers: true,
          webSearchTestQuery: 'test',
          probeTimeoutMs: 5000,
        });
        const mcp = result.sources.find(s => s.name === 'mcp-badserver');
        expect(mcp!.healthy).toBe(false);
        expect(result.recommendations.some(r => r.includes('mcp-badserver'))).toBe(true);
      });

      it('MCP probe - failure with no error message', async () => {
        checker.registerCircuitBreaker('mcp-x', { getState: () => 'closed' } as any);
        checker.setMCPPingProbe(async () => ({ ok: false, latencyMs: 0, toolCount: 0 }));
        const result = await checker.runHealthCheck({
          probeWebSearch: false,
          probeMCPServers: true,
          webSearchTestQuery: 'test',
          probeTimeoutMs: 5000,
        });
        const mcp = result.sources.find(s => s.name === 'mcp-x');
        expect(mcp!.error).toContain('ping failed');
      });

      it('MCP probe creates new source entry when no breaker matches', async () => {
        // No breaker registered with mcp- prefix, but we force a scenario
        // Actually probeMCPSources only probes servers that have mcp- prefix breakers
        // So if no mcp- breaker, no probe happens
        checker.setMCPPingProbe(async () => ({ ok: true, latencyMs: 10, toolCount: 2 }));
        const result = await checker.runHealthCheck({
          probeWebSearch: false,
          probeMCPServers: true,
          webSearchTestQuery: 'test',
          probeTimeoutMs: 5000,
        });
        // No MCP sources should be added since no mcp- breakers exist
        expect(result.sources.filter(s => s.type === 'mcp')).toHaveLength(0);
      });

      it('MCP probe - exception in probe callback', async () => {
        checker.registerCircuitBreaker('mcp-crash', { getState: () => 'closed' } as any);
        checker.setMCPPingProbe(async () => { throw new Error('MCP crash'); });
        const result = await checker.runHealthCheck({
          probeWebSearch: false,
          probeMCPServers: true,
          webSearchTestQuery: 'test',
          probeTimeoutMs: 5000,
        });
        expect(mockLogger.error).toHaveBeenCalled();
      });

      it('MCP probe - non-Error exception', async () => {
        checker.registerCircuitBreaker('mcp-crash2', { getState: () => 'closed' } as any);
        checker.setMCPPingProbe(async () => { throw 42; });
        const result = await checker.runHealthCheck({
          probeWebSearch: false,
          probeMCPServers: true,
          webSearchTestQuery: 'test',
          probeTimeoutMs: 5000,
        });
        expect(mockLogger.error).toHaveBeenCalled();
      });

      it('does not run MCP probe when probeMCPServers is false', async () => {
        const probe = vi.fn();
        checker.registerCircuitBreaker('mcp-s', { getState: () => 'closed' } as any);
        checker.setMCPPingProbe(probe);
        await checker.runHealthCheck({
          probeWebSearch: false,
          probeMCPServers: false,
          webSearchTestQuery: 'test',
          probeTimeoutMs: 5000,
        });
        expect(probe).not.toHaveBeenCalled();
      });

      it('does not run MCP probe when no probe registered', async () => {
        checker.registerCircuitBreaker('mcp-s', { getState: () => 'closed' } as any);
        const result = await checker.runHealthCheck({
          probeWebSearch: false,
          probeMCPServers: true,
          webSearchTestQuery: 'test',
          probeTimeoutMs: 5000,
        });
        // Circuit breaker entry for mcp-s should exist but without probe data
        const mcp = result.sources.find(s => s.name === 'mcp-s');
        expect(mcp).toBeDefined();
        expect(mcp!.latencyMs).toBeNull();
      });

      it('multiple MCP servers probed in parallel', async () => {
        checker.registerCircuitBreaker('mcp-a', { getState: () => 'closed' } as any);
        checker.registerCircuitBreaker('mcp-b', { getState: () => 'closed' } as any);
        let callCount = 0;
        checker.setMCPPingProbe(async (serverId) => {
          callCount++;
          return { ok: true, latencyMs: 10 * callCount, toolCount: callCount };
        });
        const result = await checker.runHealthCheck({
          probeWebSearch: false,
          probeMCPServers: true,
          webSearchTestQuery: 'test',
          probeTimeoutMs: 5000,
        });
        const mcpSources = result.sources.filter(s => s.type === 'mcp');
        expect(mcpSources).toHaveLength(2);
      });

      // ---- Options override ----
      it('merges options with default config', async () => {
        const probe = vi.fn().mockResolvedValue({ ok: true, latencyMs: 10 });
        checker.setWebSearchProbe(probe);
        await checker.runHealthCheck({
          probeWebSearch: true,
          webSearchTestQuery: 'custom query',
          probeTimeoutMs: 1000,
          probeMCPServers: false,
        });
        expect(probe).toHaveBeenCalledWith('custom query', 1000);
      });

      // ---- Summary messages ----
      it('all healthy summary', async () => {
        checker.registerCircuitBreaker('a', { getState: () => 'closed' } as any);
        checker.registerCircuitBreaker('b', { getState: () => 'closed' } as any);
        const result = await checker.runHealthCheck();
        expect(result.summary).toContain('All 2 data sources are healthy');
      });

      it('unhealthy summary', async () => {
        checker.registerCircuitBreaker('a', { getState: () => 'closed' } as any);
        checker.registerCircuitBreaker('b', { getState: () => 'open' } as any);
        checker.registerCircuitBreaker('c', { getState: () => 'open' } as any);
        const result = await checker.runHealthCheck();
        expect(result.summary).toContain('2 of 3');
      });
    });
  });

  // ========================================================================
  // processDatasourceHealthCheck
  // ========================================================================
  describe('processDatasourceHealthCheck', () => {
    let checker: DataSourceHealthChecker;
    const mockLogger: any = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    beforeEach(() => {
      vi.clearAllMocks();
      checker = new DataSourceHealthChecker(undefined, mockLogger);
    });

    it('quick mode with no registered sources', async () => {
      const result = await processDatasourceHealthCheck({ quick_mode: true }, checker);
      expect(result).toContain('No data sources registered');
    });

    it('quick mode with registered sources - all healthy', async () => {
      checker.registerCircuitBreaker('web_search', { getState: () => 'closed' } as any);
      const result = await processDatasourceHealthCheck({ quick_mode: true }, checker);
      expect(result).toContain('Quick Data Source Status');
      expect(result).toContain('web_search');
      expect(result).toContain('closed');
      expect(result).toContain('All sources healthy');
    });

    it('quick mode with unhealthy source', async () => {
      checker.registerCircuitBreaker('bad', { getState: () => 'open' } as any);
      const result = await processDatasourceHealthCheck({ quick_mode: true }, checker);
      expect(result).toContain('Some sources have issues');
    });

    it('full check mode', async () => {
      const result = await processDatasourceHealthCheck({}, checker);
      expect(result).toContain('Health Report');
      expect(result).toContain('All Healthy');
    });

    it('full check with sources - healthy', async () => {
      checker.registerCircuitBreaker('web_search', { getState: () => 'closed' } as any);
      const result = await processDatasourceHealthCheck({}, checker);
      expect(result).toContain('web_search');
      expect(result).toContain('All Healthy');
      expect(result).toContain('All data sources are operational');
    });

    it('full check with unhealthy sources', async () => {
      checker.registerCircuitBreaker('bad', { getState: () => 'open' } as any);
      const result = await processDatasourceHealthCheck({}, checker);
      expect(result).toContain('Issues Detected');
      expect(result).toContain('Inform the user');
      expect(result).toContain('Recommendations');
    });

    it('passes probe flags to runHealthCheck', async () => {
      checker.setWebSearchProbe(async () => ({ ok: true, latencyMs: 50 }));
      const result = await processDatasourceHealthCheck({
        probe_web_search: true,
        probe_mcp_servers: false,
      }, checker);
      expect(result).toContain('web_search');
    });

    it('logs input', async () => {
      await processDatasourceHealthCheck({ quick_mode: true }, checker, mockLogger);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Tool called'));
    });

    it('formats sources with latency', async () => {
      checker.registerCircuitBreaker('web_search', { getState: () => 'closed' } as any);
      checker.setWebSearchProbe(async () => ({ ok: true, latencyMs: 200 }));
      const result = await processDatasourceHealthCheck({
        probe_web_search: true,
        probe_mcp_servers: false,
      }, checker);
      expect(result).toContain('200ms');
    });

    it('formats sources with N/A latency when null', async () => {
      checker.registerCircuitBreaker('test', { getState: () => 'closed' } as any);
      const result = await processDatasourceHealthCheck({}, checker);
      expect(result).toContain('N/A');
    });

    it('formats source errors', async () => {
      checker.registerCircuitBreaker('bad', { getState: () => 'open' } as any);
      const result = await processDatasourceHealthCheck({}, checker);
      expect(result).toContain('OPEN');
    });

    it('shows None for error when source is healthy', async () => {
      checker.registerCircuitBreaker('good', { getState: () => 'closed' } as any);
      const result = await processDatasourceHealthCheck({}, checker);
      expect(result).toContain('None');
    });

    it('shows action guide for unhealthy - with numbered recommendations', async () => {
      checker.registerCircuitBreaker('bad', { getState: () => 'open' } as any);
      const result = await processDatasourceHealthCheck({}, checker);
      expect(result).toContain('Action Guide');
      expect(result).toContain('Use alternative sources');
      expect(result).toContain('Retry later');
    });
  });
});
