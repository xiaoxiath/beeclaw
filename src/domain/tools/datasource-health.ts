/**
 * Data Source Health Check Module
 *
 * Provides a self-check mode for verifying data source availability
 * before executing queries. Covers:
 * - Web search engine connectivity
 * - MCP server health (ping + tool listing)
 * - Circuit breaker status aggregation
 * - Optional periodic background probing
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Logger } from '../../infra/observability/logger';
import type { CircuitBreaker, CircuitState } from '../../infra/resilience/circuit-breaker';

// Re-export for convenience
export type ToolDefinition = Anthropic.Messages.Tool;

// ─── Types ───────────────────────────────────────────────────────────────────

export type DataSourceType = 'web_search' | 'fetch_url' | 'mcp' | 'builtin';

export interface DataSourceStatus {
  name: string;
  type: DataSourceType;
  healthy: boolean;
  latencyMs: number | null;
  circuitState: CircuitState | 'UNKNOWN';
  lastChecked: Date;
  error?: string;
  details?: Record<string, unknown>;
}

export interface HealthCheckResult {
  timestamp: Date;
  overallHealthy: boolean;
  sources: DataSourceStatus[];
  summary: string;
  recommendations: string[];
}

export interface HealthProbeConfig {
  /** Timeout per probe in ms (default: 5000) */
  probeTimeoutMs: number;
  /** Whether to run a real web search probe (default: true) */
  probeWebSearch: boolean;
  /** Whether to run MCP ping probes (default: true) */
  probeMCPServers: boolean;
  /** Optional test query for web search probe */
  webSearchTestQuery: string;
}

const DEFAULT_PROBE_CONFIG: HealthProbeConfig = {
  probeTimeoutMs: 5000,
  probeWebSearch: true,
  probeMCPServers: true,
  webSearchTestQuery: 'test connectivity check',
};

// ─── Health Check Registry ───────────────────────────────────────────────────

/**
 * DataSourceHealthChecker - central registry for health checking all data sources.
 *
 * Integrates with:
 * - CircuitBreaker instances to read current state
 * - MCPClientManager for MCP server ping/status
 * - Built-in tool executors for web_search / fetch_url probes
 */
export class DataSourceHealthChecker {
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private probeConfig: HealthProbeConfig;
  private logger?: Logger;
  private lastResult?: HealthCheckResult;

  // Callback hooks for performing actual probes
  private webSearchProbe?: (query: string, timeout: number) => Promise<{ ok: boolean; latencyMs: number; error?: string }>;
  private mcpPingProbe?: (serverId: string, timeout: number) => Promise<{ ok: boolean; latencyMs: number; toolCount: number; error?: string }>;
  private fetchUrlProbe?: (url: string, timeout: number) => Promise<{ ok: boolean; latencyMs: number; error?: string }>;

  constructor(config?: Partial<HealthProbeConfig>, logger?: Logger) {
    this.probeConfig = { ...DEFAULT_PROBE_CONFIG, ...config };
    this.logger = logger;
  }

  // ─── Registration ────────────────────────────────────────────────────────

  registerCircuitBreaker(name: string, breaker: CircuitBreaker): void {
    this.circuitBreakers.set(name, breaker);
  }

  setWebSearchProbe(probe: typeof this.webSearchProbe): void {
    this.webSearchProbe = probe;
  }

  setMCPPingProbe(probe: typeof this.mcpPingProbe): void {
    this.mcpPingProbe = probe;
  }

  setFetchUrlProbe(probe: typeof this.fetchUrlProbe): void {
    this.fetchUrlProbe = probe;
  }

  // ─── Core Health Check ───────────────────────────────────────────────────

  /**
   * Run a comprehensive health check across all registered data sources.
   * Returns a structured result with per-source status and recommendations.
   */
  async runHealthCheck(options?: Partial<HealthProbeConfig>): Promise<HealthCheckResult> {
    const config = { ...this.probeConfig, ...options };
    const sources: DataSourceStatus[] = [];
    const recommendations: string[] = [];

    // 1. Check circuit breaker states (fast, no I/O)
    for (const [name, breaker] of this.circuitBreakers) {
      const state = breaker.getState();
      const sourceType = this.inferSourceType(name);

      const status: DataSourceStatus = {
        name,
        type: sourceType,
        healthy: state === 'closed',
        latencyMs: null,
        circuitState: state,
        lastChecked: new Date(),
      };

      if (state === 'open') {
        status.error = `Circuit breaker is OPEN — recent failures exceeded threshold`;
        recommendations.push(
          `[${name}] Circuit breaker is OPEN. The ${sourceType} data source has experienced repeated failures. ` +
          `It will automatically retry after the cooldown period. Consider checking the upstream service.`
        );
      } else if (state === 'half_open') {
        status.error = `Circuit breaker is HALF_OPEN — recovery in progress`;
        recommendations.push(
          `[${name}] Circuit breaker is in recovery mode (HALF_OPEN). Next request will be a test probe.`
        );
      }

      sources.push(status);
    }

    // 2. Active probes (with I/O, respect timeouts)
    const probePromises: Promise<void>[] = [];

    if (config.probeWebSearch && this.webSearchProbe) {
      probePromises.push(
        this.probeWebSearchSource(config, sources, recommendations)
      );
    }

    if (config.probeMCPServers && this.mcpPingProbe) {
      probePromises.push(
        this.probeMCPSources(config, sources, recommendations)
      );
    }

    // Run all probes concurrently
    await Promise.allSettled(probePromises);

    // 3. Build result
    const overallHealthy = sources.every(s => s.healthy);
    const unhealthyCount = sources.filter(s => !s.healthy).length;
    const totalCount = sources.length;

    let summary: string;
    if (overallHealthy) {
      summary = `All ${totalCount} data sources are healthy and operational.`;
    } else {
      summary = `${unhealthyCount} of ${totalCount} data source(s) have issues. See details below.`;
    }

    const result: HealthCheckResult = {
      timestamp: new Date(),
      overallHealthy,
      sources,
      summary,
      recommendations,
    };

    this.lastResult = result;
    this.logger?.info?.(`[HealthCheck] Completed: ${summary}`);

    return result;
  }

  /**
   * Get the last cached health check result (without running new probes).
   */
  getLastResult(): HealthCheckResult | undefined {
    return this.lastResult;
  }

  /**
   * Quick status check — only reads circuit breaker states, no I/O.
   */
  getQuickStatus(): Record<string, { state: CircuitState; healthy: boolean }> {
    const status: Record<string, { state: CircuitState; healthy: boolean }> = {};
    for (const [name, breaker] of this.circuitBreakers) {
      const state = breaker.getState();
      status[name] = { state, healthy: state === 'closed' };
    }
    return status;
  }

  // ─── Probe Implementations ──────────────────────────────────────────────

  private async probeWebSearchSource(
    config: HealthProbeConfig,
    sources: DataSourceStatus[],
    recommendations: string[],
  ): Promise<void> {
    if (!this.webSearchProbe) return;

    try {
      const result = await this.webSearchProbe(
        config.webSearchTestQuery,
        config.probeTimeoutMs,
      );

      // Find or create the web_search source entry
      const existing = sources.find(s => s.name === 'web_search');
      if (existing) {
        existing.latencyMs = result.latencyMs;
        existing.healthy = existing.healthy && result.ok;
        if (!result.ok) {
          existing.error = result.error || 'Web search probe failed';
        }
        existing.details = { probeLatencyMs: result.latencyMs };
      } else {
        sources.push({
          name: 'web_search',
          type: 'web_search',
          healthy: result.ok,
          latencyMs: result.latencyMs,
          circuitState: 'UNKNOWN',
          lastChecked: new Date(),
          error: result.ok ? undefined : (result.error || 'Web search probe failed'),
          details: { probeLatencyMs: result.latencyMs },
        });
      }

      if (!result.ok) {
        recommendations.push(
          `[web_search] Active probe failed: ${result.error || 'unknown error'}. ` +
          `Real-time data (news, financial data, weather) may be unavailable. ` +
          `Consider informing the user and relying on cached/known information.`
        );
      } else if (result.latencyMs > 3000) {
        recommendations.push(
          `[web_search] Probe succeeded but latency is high (${result.latencyMs}ms). ` +
          `Search results may be slow. Consider reducing the number of search queries.`
        );
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger?.error?.(`[HealthCheck] Web search probe error: ${errMsg}`);
      sources.push({
        name: 'web_search',
        type: 'web_search',
        healthy: false,
        latencyMs: null,
        circuitState: 'UNKNOWN',
        lastChecked: new Date(),
        error: `Probe threw exception: ${errMsg}`,
      });
      recommendations.push(
        `[web_search] Health probe threw an exception. Web search may be completely unavailable.`
      );
    }
  }

  private async probeMCPSources(
    config: HealthProbeConfig,
    sources: DataSourceStatus[],
    recommendations: string[],
  ): Promise<void> {
    if (!this.mcpPingProbe) return;

    // Identify MCP servers from circuit breaker names (prefixed with "mcp-")
    const mcpServerIds = Array.from(this.circuitBreakers.keys())
      .filter(name => name.startsWith('mcp-'))
      .map(name => name.replace(/^mcp-/, ''));

    const probes = mcpServerIds.map(async (serverId) => {
      try {
        const result = await this.mcpPingProbe!(serverId, config.probeTimeoutMs);

        const existing = sources.find(s => s.name === `mcp-${serverId}`);
        if (existing) {
          existing.latencyMs = result.latencyMs;
          existing.healthy = existing.healthy && result.ok;
          if (!result.ok) {
            existing.error = result.error || `MCP server "${serverId}" ping failed`;
          }
          existing.details = {
            ...existing.details,
            probeLatencyMs: result.latencyMs,
            toolCount: result.toolCount,
          };
        } else {
          sources.push({
            name: `mcp-${serverId}`,
            type: 'mcp',
            healthy: result.ok,
            latencyMs: result.latencyMs,
            circuitState: 'UNKNOWN',
            lastChecked: new Date(),
            error: result.ok ? undefined : (result.error || 'MCP ping failed'),
            details: { probeLatencyMs: result.latencyMs, toolCount: result.toolCount },
          });
        }

        if (!result.ok) {
          recommendations.push(
            `[mcp-${serverId}] MCP server is unreachable or unhealthy. ` +
            `Tools provided by this server will not work. ` +
            `Consider using alternative built-in tools or informing the user.`
          );
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.logger?.error?.(`[HealthCheck] MCP ping error for "${serverId}": ${errMsg}`);
      }
    });

    await Promise.allSettled(probes);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private inferSourceType(name: string): DataSourceType {
    if (name.startsWith('mcp-')) return 'mcp';
    if (name === 'web_search' || name.includes('search')) return 'web_search';
    if (name === 'fetch_url' || name.includes('fetch')) return 'fetch_url';
    return 'builtin';
  }
}

// ─── Tool Definition ─────────────────────────────────────────────────────────

/**
 * Built-in tool definition for the health check.
 * This allows the agent (or user) to trigger a data source self-check.
 */
export const datasourceHealthCheckTool: ToolDefinition = {
  name: 'datasource_health_check',
  description: `Check the health and availability of all data sources (web search, MCP servers, external APIs).

Use this tool PROACTIVELY when:
- The user asks about real-time data (financial quotes, breaking news, weather, live scores)
- A previous tool call failed or returned empty/stale results
- The user reports that data seems outdated or missing
- Before executing a complex multi-source research task

Returns a structured health report with per-source status, latency, circuit breaker state, and actionable recommendations.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      probe_web_search: {
        type: 'boolean',
        description: 'Whether to actively test web search connectivity (default: true)',
      },
      probe_mcp_servers: {
        type: 'boolean',
        description: 'Whether to ping MCP servers (default: true)',
      },
      quick_mode: {
        type: 'boolean',
        description: 'If true, only check circuit breaker states without active probing (faster but less thorough)',
      },
    },
  },
};

/**
 * Process the datasource_health_check tool call.
 */
export async function processDatasourceHealthCheck(
  input: Record<string, unknown>,
  healthChecker: DataSourceHealthChecker,
  logger?: Logger,
): Promise<string> {
  logger?.info?.(`[HealthCheck] Tool called with input: ${JSON.stringify(input)}`);

  const quickMode = input.quick_mode as boolean | undefined;

  if (quickMode) {
    const status = healthChecker.getQuickStatus();
    const entries = Object.entries(status);
    if (entries.length === 0) {
      return 'No data sources registered for health monitoring.';
    }

    let output = '## Quick Data Source Status\n\n';
    output += '| Source | State | Healthy |\n|--------|-------|--------|\n';
    for (const [name, info] of entries) {
      output += `| ${name} | ${info.state} | ${info.healthy ? '✅' : '❌'} |\n`;
    }

    const allHealthy = entries.every(([, info]) => info.healthy);
    output += `\n**Overall:** ${allHealthy ? '✅ All sources healthy' : '⚠️ Some sources have issues'}`;

    return output;
  }

  // Full health check
  const result = await healthChecker.runHealthCheck({
    probeWebSearch: input.probe_web_search as boolean ?? true,
    probeMCPServers: input.probe_mcp_servers as boolean ?? true,
  });

  return formatHealthCheckResult(result);
}

/**
 * Format the health check result as a readable string for the LLM.
 */
function formatHealthCheckResult(result: HealthCheckResult): string {
  let output = `## Data Source Health Report\n\n`;
  output += `**Timestamp:** ${result.timestamp.toISOString()}\n`;
  output += `**Overall Status:** ${result.overallHealthy ? '✅ All Healthy' : '⚠️ Issues Detected'}\n`;
  output += `**Summary:** ${result.summary}\n\n`;

  if (result.sources.length > 0) {
    output += `### Source Details\n\n`;
    output += `| Source | Type | Healthy | Latency | Circuit State | Error |\n`;
    output += `|--------|------|---------|---------|---------------|-------|\n`;

    for (const source of result.sources) {
      output += `| ${source.name} | ${source.type} | ${source.healthy ? '✅' : '❌'} | `;
      output += `${source.latencyMs !== null ? source.latencyMs + 'ms' : 'N/A'} | `;
      output += `${source.circuitState} | `;
      output += `${source.error || 'None'} |\n`;
    }
    output += '\n';
  }

  if (result.recommendations.length > 0) {
    output += `### Recommendations\n\n`;
    for (const rec of result.recommendations) {
      output += `- ${rec}\n`;
    }
    output += '\n';
  }

  output += `### Action Guide\n\n`;
  if (result.overallHealthy) {
    output += `All data sources are operational. You can proceed with real-time data queries.\n`;
  } else {
    output += `Some data sources are unavailable. Consider:\n`;
    output += `1. **Inform the user** about data source limitations before proceeding\n`;
    output += `2. **Use alternative sources** — if web search is down, try fetch_url directly\n`;
    output += `3. **Rely on knowledge** — use your training data for non-time-sensitive queries\n`;
    output += `4. **Retry later** — circuit breakers will auto-recover after cooldown\n`;
  }

  return output;
}
