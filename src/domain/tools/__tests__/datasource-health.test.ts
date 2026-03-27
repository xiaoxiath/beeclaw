import { describe, it, expect, beforeEach, mock } from 'bun:test';

import { DataSourceHealthChecker, processDatasourceHealthCheck } from '../datasource-health';

describe('DataSourceHealthChecker', () => {
  let checker: DataSourceHealthChecker;

  beforeEach(() => {
    checker = new DataSourceHealthChecker();
  });

  it('should construct with default config', () => {
    expect(checker).toBeDefined();
  });

  describe('getQuickStatus', () => {
    it('should return empty object when no breakers registered', () => {
      const status = checker.getQuickStatus();
      expect(Object.keys(status)).toHaveLength(0);
    });

    it('should return status for registered breakers', () => {
      const mockBreaker: any = { getState: () => 'closed' };
      checker.registerCircuitBreaker('web_search', mockBreaker);
      const status = checker.getQuickStatus();
      expect(status.web_search).toBeDefined();
      expect(status.web_search.healthy).toBe(true);
      expect(status.web_search.state).toBe('closed');
    });

    it('should report unhealthy for open breaker', () => {
      const mockBreaker: any = { getState: () => 'open' };
      checker.registerCircuitBreaker('test', mockBreaker);
      const status = checker.getQuickStatus();
      expect(status.test.healthy).toBe(false);
    });
  });

  describe('runHealthCheck', () => {
    it('should return healthy when no sources registered', async () => {
      const result = await checker.runHealthCheck();
      expect(result.overallHealthy).toBe(true);
      expect(result.sources).toHaveLength(0);
    });

    it('should check circuit breaker states', async () => {
      const closed: any = { getState: () => 'closed' };
      const open: any = { getState: () => 'open' };
      checker.registerCircuitBreaker('good', closed);
      checker.registerCircuitBreaker('bad', open);

      const result = await checker.runHealthCheck();
      expect(result.overallHealthy).toBe(false);
      expect(result.sources).toHaveLength(2);
      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    it('should run web search probe when configured', async () => {
      checker.setWebSearchProbe(async () => ({ ok: true, latencyMs: 100 }));
      const result = await checker.runHealthCheck({ probeWebSearch: true, probeMCPServers: false, webSearchTestQuery: 'test', probeTimeoutMs: 5000 });
      const wsSource = result.sources.find(s => s.name === 'web_search');
      expect(wsSource).toBeDefined();
      expect(wsSource!.healthy).toBe(true);
    });

    it('should handle failed web search probe', async () => {
      checker.setWebSearchProbe(async () => ({ ok: false, latencyMs: 0, error: 'timeout' }));
      const result = await checker.runHealthCheck({ probeWebSearch: true, probeMCPServers: false, webSearchTestQuery: 'test', probeTimeoutMs: 5000 });
      const wsSource = result.sources.find(s => s.name === 'web_search');
      expect(wsSource).toBeDefined();
      expect(wsSource!.healthy).toBe(false);
    });
  });

  describe('getLastResult', () => {
    it('should return undefined before any check', () => {
      expect(checker.getLastResult()).toBeUndefined();
    });

    it('should return result after check', async () => {
      await checker.runHealthCheck();
      expect(checker.getLastResult()).toBeDefined();
    });
  });
});

describe('processDatasourceHealthCheck', () => {
  it('should handle quick mode', async () => {
    const checker = new DataSourceHealthChecker();
    const result = await processDatasourceHealthCheck({ quick_mode: true }, checker);
    expect(typeof result).toBe('string');
  });

  it('should handle full check', async () => {
    const checker = new DataSourceHealthChecker();
    const result = await processDatasourceHealthCheck({}, checker);
    expect(result).toContain('Health Report');
  });
});
