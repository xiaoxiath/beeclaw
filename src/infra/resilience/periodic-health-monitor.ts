/**
 * Periodic Health Monitor
 *
 * Runs background health probes at configurable intervals and
 * injects health context into agent conversations when issues are detected.
 *
 * This complements the on-demand `datasource_health_check` tool by providing
 * continuous monitoring without requiring the agent to manually trigger checks.
 */
import type { Logger } from '../observability/logger';

// ---------------------------------------------------------------------------
// Interfaces — Dependency Inversion
//
// The monitor depends on *interfaces* rather than the concrete
// DataSourceHealthChecker class so the infra layer never imports from domain.
// The app layer (bootstrap-health.ts) injects the concrete instance.
// ---------------------------------------------------------------------------

/** Minimal shape of a single source health entry. */
export interface HealthSource {
  name: string;
  type: string;
  healthy: boolean;
  error?: string;
}

/** Result of a health check run. */
export interface HealthCheckResult {
  overallHealthy: boolean;
  sources: HealthSource[];
  recommendations: string[];
}

/** Interface the monitor requires from its health-checker dependency. */
export interface IHealthChecker {
  runHealthCheck(options?: Record<string, unknown>): Promise<HealthCheckResult>;
  getLastResult(): HealthCheckResult | undefined;
}

export interface PeriodicHealthMonitorConfig {
  /** Check interval in milliseconds (default: 5 minutes) */
  intervalMs: number;
  /** Whether to start automatically on construction (default: false) */
  autoStart: boolean;
  /** Minimum interval between full probes to avoid overloading (default: 60s) */
  minProbeIntervalMs: number;
  /** Callback when health status changes */
  onHealthChange?: (prev: HealthCheckResult | undefined, current: HealthCheckResult) => void;
}

const DEFAULT_CONFIG: PeriodicHealthMonitorConfig = {
  intervalMs: 5 * 60 * 1000,     // 5 minutes
  autoStart: false,
  minProbeIntervalMs: 60 * 1000, // 1 minute minimum between probes
};

export class PeriodicHealthMonitor {
  private config: PeriodicHealthMonitorConfig;
  private healthChecker: IHealthChecker;
  private logger?: Logger;
  private intervalId?: NodeJS.Timeout;
  private isRunning = false;
  private lastProbeTime = 0;
  private previousResult?: HealthCheckResult;

  constructor(
    healthChecker: IHealthChecker,
    config?: Partial<PeriodicHealthMonitorConfig>,
    logger?: Logger,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.healthChecker = healthChecker;
    this.logger = logger;

    if (this.config.autoStart) {
      this.start();
    }
  }

  /**
   * Start periodic health monitoring.
   */
  start(): void {
    if (this.isRunning) {
      this.logger?.info?.('[PeriodicHealthMonitor] Already running');
      return;
    }

    this.isRunning = true;
    const runTick = () => {
      this.tick().catch((err) => {
        this.logger?.error?.('[PeriodicHealthMonitor] Tick failed', err);
      });
    };
    this.intervalId = setInterval(runTick, this.config.intervalMs);

    // Run an initial check (fire-and-forget; tick() has its own try/catch)
    runTick();

    this.logger?.info?.(
      `[PeriodicHealthMonitor] Started with interval ${this.config.intervalMs}ms`,
    );
  }

  /**
   * Stop periodic health monitoring.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.isRunning = false;
    this.logger?.info?.('[PeriodicHealthMonitor] Stopped');
  }

  /**
   * Get whether any data source is currently unhealthy.
   * Useful for injecting health warnings into agent context.
   */
  hasIssues(): boolean {
    const result = this.healthChecker.getLastResult();
    return result ? !result.overallHealthy : false;
  }

  /**
   * Build a health context string suitable for injection into system prompt
   * or conversation context. Returns empty string if everything is healthy.
   */
  buildHealthContext(): string {
    const result = this.healthChecker.getLastResult();
    if (!result || result.overallHealthy) return '';

    const unhealthySources = result.sources.filter(s => !s.healthy);
    if (unhealthySources.length === 0) return '';

    let context = '<data-source-warning>\n';
    context += 'The following data sources are currently experiencing issues:\n';

    for (const source of unhealthySources) {
      context += `- ${source.name} (${source.type}): ${source.error || 'unhealthy'}\n`;
    }

    if (result.recommendations.length > 0) {
      context += '\nRecommended actions:\n';
      for (const rec of result.recommendations) {
        context += `- ${rec}\n`;
      }
    }

    context += '\nIMPORTANT: Before attempting to use any unhealthy data source, inform the user about the limitation. ';
    context += 'Use the datasource_health_check tool to get an updated status if needed.\n';
    context += '</data-source-warning>';

    return context;
  }

  /**
   * Get monitoring status.
   */
  getStatus(): {
    isRunning: boolean;
    lastProbeTime: Date | null;
    currentHealthy: boolean;
    unhealthySources: string[];
  } {
    const result = this.healthChecker.getLastResult();
    return {
      isRunning: this.isRunning,
      lastProbeTime: this.lastProbeTime > 0 ? new Date(this.lastProbeTime) : null,
      currentHealthy: result ? result.overallHealthy : true,
      unhealthySources: result
        ? result.sources.filter(s => !s.healthy).map(s => s.name)
        : [],
    };
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    const now = Date.now();
    if (now - this.lastProbeTime < this.config.minProbeIntervalMs) {
      return; // Too soon since last probe
    }

    this.lastProbeTime = now;

    try {
      const result = await this.healthChecker.runHealthCheck();

      // Detect state changes
      if (this.config.onHealthChange) {
        const prevHealthy = this.previousResult?.overallHealthy ?? true;
        const currHealthy = result.overallHealthy;

        if (prevHealthy !== currHealthy) {
          this.config.onHealthChange(this.previousResult, result);
        }
      }

      this.previousResult = result;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger?.error?.(`[PeriodicHealthMonitor] Health check failed: ${errMsg}`);
    }
  }
}
