/**
 * Data Source Health Check Bootstrap
 *
 * This module initializes and wires together the health check subsystem.
 * Call `bootstrapHealthCheck()` during application startup, after MCP
 * servers are connected and circuit breakers are initialized.
 *
 * New file: src/app/bootstrap-health.ts
 */
import { DataSourceHealthChecker } from '../domain/tools/datasource-health';
import { PeriodicHealthMonitor } from '../infra/resilience/periodic-health-monitor';
import { getCircuitBreakerRegistry } from '../infra/resilience/circuit-breaker';
import { getMCPManager } from '../adapter/mcp';
import { setupHealthChecker } from '../domain/tools';
import { getSearchOrchestrator } from '../domain/search';
import { logger } from '../infra/observability/logger';
import { registerHealthMonitorPort } from '../domain/ports';
import { getCompressionStats } from '../domain/agent/compression';
import { getContextHealthDashboard } from '../domain/agent/context/health-dashboard';

let _healthChecker: DataSourceHealthChecker | null = null;
let _healthMonitor: PeriodicHealthMonitor | null = null;

/**
 * Initialize the health check subsystem.
 *
 * Should be called once during app startup, after:
 * 1. Circuit breakers are registered
 * 2. MCP servers are connected
 * 3. Search orchestrator is initialized
 */
export function bootstrapHealthCheck(): {
  healthChecker: DataSourceHealthChecker;
  healthMonitor: PeriodicHealthMonitor;
} {
  logger.info('[Bootstrap] Initializing data source health check...');

  // Create the health checker
  const healthChecker = new DataSourceHealthChecker(
    {
      probeTimeoutMs: 5000,
      probeWebSearch: true,
      probeMCPServers: true,
      webSearchTestQuery: 'test connectivity check',
    },
    logger,
  );

  // Register all circuit breakers from the registry
  try {
    const cbRegistry = getCircuitBreakerRegistry();
    const allStats = cbRegistry.getAllStats();
    for (const name of Object.keys(allStats)) {
      const breaker = cbRegistry.getBreaker(name);
      healthChecker.registerCircuitBreaker(name, breaker);
    }
    logger.info(`[Bootstrap] Registered ${Object.keys(allStats).length} circuit breakers for health monitoring`);
  } catch (err) {
    logger.warn('[Bootstrap] Could not register circuit breakers:', err);
  }

  // Set up web search probe
  try {
    healthChecker.setWebSearchProbe(async (query: string, timeout: number) => {
      const startTime = Date.now();
      try {
        const orchestrator = getSearchOrchestrator();
        // Minimal search to test connectivity
        const results = await Promise.race([
          orchestrator.search({ query, numResults: 1 }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Web search probe timeout')), timeout)
          ),
        ]);

        const latencyMs = Date.now() - startTime;
        const hasResults = Array.isArray(results) ? results.length > 0 : !!results;
        return { ok: hasResults, latencyMs };
      } catch (err) {
        const latencyMs = Date.now() - startTime;
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, latencyMs, error: msg };
      }
    });
  } catch (err) {
    logger.warn('[Bootstrap] Could not set up web search probe:', err);
  }

  // Set up MCP ping probe
  try {
    const mcpManager = getMCPManager();
    healthChecker.setMCPPingProbe(async (serverId: string, timeout: number) => {
      // Use the pingServer method from the health extension
      if (typeof (mcpManager as any).pingServer === 'function') {
        return (mcpManager as any).pingServer(serverId, timeout);
      }

      // Fallback: check status only (no active ping)
      const status = mcpManager.getStatus();
      const serverStatus = status[serverId];
      if (!serverStatus) {
        return { ok: false, latencyMs: 0, toolCount: 0, error: `Server "${serverId}" not found` };
      }
      return {
        ok: serverStatus.connected,
        latencyMs: 0,
        toolCount: serverStatus.toolCount,
        error: serverStatus.connected ? undefined : 'Server not connected',
      };
    });
  } catch (err) {
    logger.warn('[Bootstrap] Could not set up MCP ping probe:', err);
  }

  // Register with builtin tools so the agent can use datasource_health_check
  setupHealthChecker(healthChecker);

  // Create periodic health monitor
  const healthMonitor = new PeriodicHealthMonitor(
    healthChecker,
    {
      intervalMs: 60 * 60 * 1000, // Check every 15 minutes (reduced from 5 minutes)
      autoStart: true,
      onHealthChange: (prev, current) => {
        if (!current.overallHealthy) {
          logger.warn(
            `[HealthMonitor] Data source health degraded! ` +
            `Unhealthy sources: ${current.sources.filter(s => !s.healthy).map(s => s.name).join(', ')}`
          );
        } else if (prev && !prev.overallHealthy) {
          logger.info('[HealthMonitor] All data sources recovered to healthy state');
        }
      },
    },
    logger,
  );

  _healthChecker = healthChecker;
  _healthMonitor = healthMonitor;
  
  // Register port so domain layer can access health monitor via ports
  registerHealthMonitorPort(() => _healthMonitor);

  logger.info('[Bootstrap] Health check subsystem initialized successfully');

  return { healthChecker, healthMonitor };
}

/**
 * Get the global health checker instance.
 */
export function getHealthCheckerInstance(): DataSourceHealthChecker | null {
  return _healthChecker;
}

/**
 * Get the global health monitor instance.
 */
export function getHealthMonitorInstance(): PeriodicHealthMonitor | null {
  return _healthMonitor;
}

/**
 * Shutdown the health check subsystem.
 */
export function shutdownHealthCheck(): void {
  if (_healthMonitor) {
    _healthMonitor.stop();
    _healthMonitor = null;
  }
  _healthChecker = null;
  logger.info('[Bootstrap] Health check subsystem shut down');
}

/**
 * Check compression system health.
 *
 * Returns compression statistics and health status.
 * - healthy: Average compression ratio > 30%
 * - warning: Average compression ratio <= 30% (ineffective compression)
 */
export function checkCompressionHealth(): {
  status: 'healthy' | 'warning';
  metrics: {
    totalCompressions: number;
    avgRatio: number;
    tokensSaved: number;
  };
} {
  const stats = getCompressionStats();

  return {
    status: stats.avgRatio > 0.3 ? 'healthy' : 'warning',
    metrics: {
      totalCompressions: stats.totalCompressions,
      avgRatio: stats.avgRatio,
      tokensSaved: stats.totalTokensSaved,
    },
  };
}

/**
 * Check context health.
 *
 * Returns context health metrics, alerts, and trends.
 * This function provides real-time monitoring of context quality.
 *
 * @returns Context health status with metrics and alerts
 */
export function checkContextHealth(): {
  status: 'healthy' | 'degraded' | 'no_data';
  metrics?: {
    tokenUtilization: number;
    redundancyRate: number;
    freshnessScore: number;
    coherenceScore: number;
    informationDensity: number;
  };
  alerts?: Array<{
    metric: string;
    severity: 'warning' | 'critical';
    value: number;
    threshold: number;
    message: string;
  }>;
  trends?: {
    tokenUtilization: number;
    redundancyRate: number;
    freshnessScore: number;
    coherenceScore: number;
    informationDensity: number;
  };
  message?: string;
} {
  const dashboard = getContextHealthDashboard();
  const history = dashboard.getHistory();

  if (history.length === 0) {
    return {
      status: 'no_data',
      message: 'No context data yet. Context health monitoring will start after first conversation turn.',
    };
  }

  const latest = history[history.length - 1];
  const alerts = dashboard.checkAlerts(latest);

  // Calculate trends for all metrics
  const trends = {
    tokenUtilization: dashboard.trend('tokenUtilization', 10),
    redundancyRate: dashboard.trend('redundancyRate', 10),
    freshnessScore: dashboard.trend('freshnessScore', 10),
    coherenceScore: dashboard.trend('coherenceScore', 10),
    informationDensity: dashboard.trend('informationDensity', 10),
  };

  return {
    status: alerts.some(a => a.severity === 'critical')
      ? 'degraded'
      : alerts.length > 0
        ? 'degraded'
        : 'healthy',
    metrics: latest,
    alerts,
    trends,
  };
}
