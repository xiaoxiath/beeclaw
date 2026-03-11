/**
 * Smart Timeout - Inactivity-based timeout management
 *
 * Instead of fixed timeout, detect when agent is truly stuck
 * by monitoring inactivity (no LLM output, tool calls, etc.)
 */

import { ActivityMonitor, type ActivityType } from './activity-monitor';

/**
 * Smart timeout configuration
 */
export interface SmartTimeoutConfig {
  /** Inactivity timeout in milliseconds (default: 180000 = 3 minutes) */
  inactivityTimeoutMs: number;

  /** Check interval in milliseconds (default: 10000 = 10 seconds) */
  checkIntervalMs: number;

  /** Callback when timeout occurs */
  onTimeout: (inactiveMs: number, stats: ReturnType<ActivityMonitor['getStats']>) => void;

  /** Callback on activity (optional, for debugging) */
  onActivity?: (type: ActivityType, details?: string) => void;
}

/**
 * Default configuration
 *
 * Why 10 minutes?
 * - Deep research: 5-10 minutes between activities
 * - Long document processing: 3-5 minutes
 * - Complex reasoning: 5-10 minutes thinking time
 * - Multi-step workflows: Steps can take 2-5 minutes each
 * - Network issues: Give plenty of buffer time
 *
 * For truly autonomous agents, timeout should be very generous.
 * Real "stuck" situations are rare - agent usually either:
 * 1. Completes successfully (even if slow)
 * 2. Fails with an error (handled by retry)
 * 3. User manually cancels (Ctrl+C)
 */
const DEFAULT_INACTIVITY_TIMEOUT_MS = 600000;  // 10 minutes
const DEFAULT_CHECK_INTERVAL_MS = 30000;  // 30 seconds

/**
 * Smart Timeout Manager
 *
 * Monitors agent activity and triggers timeout only when
 * the agent has been inactive for the specified duration.
 *
 * @example
 * ```typescript
 * const timeout = new SmartTimeout({
 *   inactivityTimeoutMs: 60000,  // 1 minute
 *   onTimeout: (inactiveMs) => {
 *     console.log(`Agent inactive for ${inactiveMs}ms`);
 *   },
 * });
 *
 * timeout.start();
 *
 * // In your agent loop:
 * timeout.recordActivity('llm_chunk');
 * timeout.recordActivity('tool_call', 'web_fetch');
 *
 * // Later...
 * timeout.stop();
 * ```
 */
export class SmartTimeout {
  private monitor: ActivityMonitor;
  private checkTimer?: Timer;
  private startTime: number;
  private isRunning: boolean = false;

  constructor(private config: SmartTimeoutConfig) {
    this.monitor = new ActivityMonitor();
    this.startTime = Date.now();

    // Set defaults with validation
    if (!config.inactivityTimeoutMs || config.inactivityTimeoutMs < 1000) {
      config.inactivityTimeoutMs = DEFAULT_INACTIVITY_TIMEOUT_MS;
    }
    if (!config.checkIntervalMs || config.checkIntervalMs < 1000) {
      config.checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS;
    }

    // Warn if timeout is too short
    if (config.inactivityTimeoutMs < 60000) {
      console.warn(
        `[SmartTimeout] Warning: inactivityTimeoutMs is ${config.inactivityTimeoutMs}ms ` +
        `(< 1 minute). This may be too aggressive for complex tasks. ` +
        `Recommended: 180000ms (3 minutes)`
      );
    }
  }

  /**
   * Start monitoring for inactivity timeout
   */
  start(): void {
    if (this.isRunning) {
      console.warn('[SmartTimeout] Already running');
      return;
    }

    this.isRunning = true;
    this.startTime = Date.now();
    this.monitor.reset();

    this.checkTimer = setInterval(() => {
      const inactiveMs = this.monitor.getInactiveTimeMs();

      if (inactiveMs > this.config.inactivityTimeoutMs) {
        const stats = this.monitor.getStats();

        console.error(
          `[SmartTimeout] Agent inactive for ${Math.round(inactiveMs / 1000)}s, ` +
          `triggering timeout`
        );

        this.stop();
        this.config.onTimeout(inactiveMs, stats);
      }
    }, this.config.checkIntervalMs);

    // Record initial activity
    this.recordActivity('progress', 'timeout monitoring started');
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
    }

    this.isRunning = false;
  }

  /**
   * Record an activity event
   */
  recordActivity(type: ActivityType, details?: string): void {
    this.monitor.record(type, details);

    if (this.config.onActivity) {
      this.config.onActivity(type, details);
    }
  }

  /**
   * Get total runtime in milliseconds
   */
  getRuntimeMs(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get activity monitor (for detailed reports)
   */
  getMonitor(): ActivityMonitor {
    return this.monitor;
  }

  /**
   * Check if currently running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Get current inactive time
   */
  getInactiveTimeMs(): number {
    return this.monitor.getInactiveTimeMs();
  }
}

/**
 * Create a smart timeout with default configuration
 *
 * Default: 3 minutes inactivity timeout
 * Configurable via AGENT_INACTIVITY_TIMEOUT_MS environment variable
 */
export function createSmartTimeout(
  onTimeout: (inactiveMs: number) => void,
  options?: Partial<SmartTimeoutConfig>
): SmartTimeout {
  // Get from environment or use default
  const defaultTimeout = parseInt(
    process.env.AGENT_INACTIVITY_TIMEOUT_MS || String(DEFAULT_INACTIVITY_TIMEOUT_MS),
    10
  );

  return new SmartTimeout({
    inactivityTimeoutMs: defaultTimeout,
    checkIntervalMs: DEFAULT_CHECK_INTERVAL_MS,
    onTimeout,
    ...options,
  });
}
