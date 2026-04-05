/**
 * bee — Circuit Breaker.
 *
 * Per-tool circuit breaker with state machine: CLOSED -> OPEN -> HALF_OPEN -> CLOSED.
 * Extracted from beeclaw's src/infra/resilience/circuit-breaker.ts.
 */

import { getLogger } from '../core/logger';

const logger = getLogger();

// ============================================================================
// Types
// ============================================================================

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerConfig {
  /** Failures needed to trigger OPEN (default 3) */
  failureThreshold: number;
  /** OPEN state cooldown (ms, default 60_000) */
  cooldownMs: number;
  /** Max probe calls in HALF_OPEN (default 1) */
  halfOpenMaxProbes: number;
  /** Consecutive successes to reset from HALF_OPEN (default 1) */
  successThreshold: number;
  /** Whether timeouts count as failures (default true) */
  countTimeoutAsFailure: boolean;
  /** Sliding window size in seconds (default 300 = 5min) */
  windowSizeSeconds: number;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  totalCalls: number;
  totalFailures: number;
  totalSuccesses: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  lastStateChange: number;
  openCount: number;
}

export interface CircuitBreakerEvent {
  type: 'state_change' | 'call_rejected' | 'probe_allowed' | 'reset';
  circuitName: string;
  previousState?: CircuitState;
  currentState: CircuitState;
  details?: string;
  timestamp: number;
}

export type CircuitBreakerListener = (event: CircuitBreakerEvent) => void;

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  cooldownMs: 60_000,
  halfOpenMaxProbes: 1,
  successThreshold: 1,
  countTimeoutAsFailure: true,
  windowSizeSeconds: 300,
};

/** Preset configurations for different tool categories */
export const CIRCUIT_BREAKER_PRESETS: Record<string, Partial<CircuitBreakerConfig>> = {
  /** AI Provider -- more tolerant, longer cooldown (likely global issue) */
  ai_provider: {
    failureThreshold: 5,
    cooldownMs: 120_000,
    successThreshold: 2,
  },
  /** Feishu API -- moderate tolerance */
  feishu: {
    failureThreshold: 3,
    cooldownMs: 60_000,
  },
  /** MCP remote tools -- stricter, fast trip on unstable services */
  mcp_tool: {
    failureThreshold: 2,
    cooldownMs: 90_000,
  },
  /** Local tools -- most tolerant, local failures usually parameter issues */
  local_tool: {
    failureThreshold: 5,
    cooldownMs: 30_000,
  },
};

// ============================================================================
// CircuitBreaker -- single breaker instance
// ============================================================================

export class CircuitBreaker {
  readonly name: string;
  private readonly config: CircuitBreakerConfig;
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private totalCalls = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private lastStateChange = Date.now();
  private openCount = 0;
  private halfOpenProbes = 0;

  /** Failure timestamps within the sliding window */
  private failureTimestamps: number[] = [];

  private readonly listeners: CircuitBreakerListener[] = [];

  constructor(name: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.name = name;
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  }

  /**
   * Check whether a call is allowed.
   *
   * @returns true if the call may proceed, false if rejected by the breaker
   */
  canExecute(): boolean {
    switch (this.state) {
      case 'closed':
        return true;

      case 'open': {
        // Check if cooldown has elapsed
        const elapsed = Date.now() - this.lastStateChange;
        if (elapsed >= this.config.cooldownMs) {
          this.transitionTo('half_open', 'Cooldown period elapsed');
          this.halfOpenProbes = 0;
          return true;
        }
        // Still cooling down -- reject
        this.emitEvent({
          type: 'call_rejected',
          circuitName: this.name,
          currentState: this.state,
          details: `Cooling down, ${Math.round((this.config.cooldownMs - elapsed) / 1000)}s remaining`,
          timestamp: Date.now(),
        });
        return false;
      }

      case 'half_open': {
        // Allow limited probe calls
        if (this.halfOpenProbes < this.config.halfOpenMaxProbes) {
          this.halfOpenProbes++;
          this.emitEvent({
            type: 'probe_allowed',
            circuitName: this.name,
            currentState: this.state,
            details: `Probe ${this.halfOpenProbes}/${this.config.halfOpenMaxProbes}`,
            timestamp: Date.now(),
          });
          return true;
        }
        return false;
      }

      default:
        return true;
    }
  }

  /**
   * Record a successful call.
   */
  recordSuccess(): void {
    this.totalCalls++;
    this.totalSuccesses++;
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;
    this.lastSuccessTime = Date.now();

    switch (this.state) {
      case 'half_open':
        if (this.consecutiveSuccesses >= this.config.successThreshold) {
          this.transitionTo('closed', `${this.consecutiveSuccesses} consecutive successes`);
        }
        break;

      case 'closed':
        // Normal state, no transition needed
        break;

      case 'open':
        // Should not happen (canExecute returns false), but handle defensively
        this.transitionTo('closed', 'Unexpected success in open state');
        break;
    }
  }

  /**
   * Record a failed call.
   */
  recordFailure(error?: string, isTimeout = false): void {
    // Skip if configured to ignore timeouts
    if (isTimeout && !this.config.countTimeoutAsFailure) {
      return;
    }

    this.totalCalls++;
    this.totalFailures++;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = Date.now();
    this.failureTimestamps.push(Date.now());

    // Prune entries outside the sliding window
    this.pruneFailureWindow();

    switch (this.state) {
      case 'closed': {
        const windowFailures = this.failureTimestamps.length;
        if (windowFailures >= this.config.failureThreshold) {
          this.transitionTo(
            'open',
            `${windowFailures} failures in ${this.config.windowSizeSeconds}s window (threshold: ${this.config.failureThreshold})` +
              (error ? `, last error: ${error}` : ''),
          );
          this.openCount++;
        }
        break;
      }

      case 'half_open':
        // Probe failed -- back to OPEN
        this.transitionTo('open', `Probe failed${error ? `: ${error}` : ''}`);
        this.openCount++;
        break;

      case 'open':
        // Already open, no change
        break;
    }
  }

  /**
   * Manually reset the breaker to CLOSED.
   */
  reset(): void {
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.failureTimestamps = [];
    this.halfOpenProbes = 0;
    this.transitionTo('closed', 'Manual reset');
    this.emitEvent({
      type: 'reset',
      circuitName: this.name,
      currentState: 'closed',
      timestamp: Date.now(),
    });
  }

  /**
   * Get the current state (with lazy cooldown check).
   */
  getState(): CircuitState {
    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastStateChange;
      if (elapsed >= this.config.cooldownMs) {
        this.transitionTo('half_open', 'Cooldown elapsed (lazy check)');
        this.halfOpenProbes = 0;
      }
    }
    return this.state;
  }

  /**
   * Get a snapshot of statistics.
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.getState(),
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      lastStateChange: this.lastStateChange,
      openCount: this.openCount,
    };
  }

  /**
   * Register an event listener.
   */
  onEvent(listener: CircuitBreakerListener): void {
    this.listeners.push(listener);
  }

  /**
   * Remaining cooldown time in ms (meaningful in OPEN state).
   */
  cooldownRemainingMs(): number {
    if (this.state !== 'open') return 0;
    const elapsed = Date.now() - this.lastStateChange;
    return Math.max(0, this.config.cooldownMs - elapsed);
  }

  // --- Internal ---

  private transitionTo(newState: CircuitState, reason: string): void {
    const previousState = this.state;
    if (previousState === newState) return;

    this.state = newState;
    this.lastStateChange = Date.now();

    this.emitEvent({
      type: 'state_change',
      circuitName: this.name,
      previousState,
      currentState: newState,
      details: reason,
      timestamp: Date.now(),
    });
  }

  private pruneFailureWindow(): void {
    const cutoff = Date.now() - this.config.windowSizeSeconds * 1000;
    this.failureTimestamps = this.failureTimestamps.filter(ts => ts >= cutoff);
  }

  private emitEvent(event: CircuitBreakerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Don't disrupt main flow
      }
    }
  }
}

// ============================================================================
// CircuitBreakerRegistry -- manages multiple tool breakers
// ============================================================================

export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly defaultConfig: CircuitBreakerConfig;
  private readonly toolConfigMapping: Map<string, Partial<CircuitBreakerConfig>> = new Map();
  private readonly globalListeners: CircuitBreakerListener[] = [];

  constructor(defaultConfig: Partial<CircuitBreakerConfig> = {}) {
    this.defaultConfig = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...defaultConfig };
  }

  /**
   * Register a custom breaker config for a tool name or prefix.
   */
  registerToolConfig(toolNameOrPrefix: string, config: Partial<CircuitBreakerConfig>): void {
    this.toolConfigMapping.set(toolNameOrPrefix, config);
  }

  /**
   * Get (or create) the breaker for a tool.
   */
  getBreaker(toolName: string): CircuitBreaker {
    let breaker = this.breakers.get(toolName);
    if (!breaker) {
      const config = this.resolveConfig(toolName);
      breaker = new CircuitBreaker(toolName, config);

      // Wire global listeners
      for (const listener of this.globalListeners) {
        breaker.onEvent(listener);
      }

      this.breakers.set(toolName, breaker);
    }
    return breaker;
  }

  /**
   * Execute a function with circuit-breaker protection.
   *
   * @throws CircuitOpenError when the breaker is open
   */
  async execute<T>(
    toolName: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const breaker = this.getBreaker(toolName);

    if (!breaker.canExecute()) {
      const stats = breaker.getStats();
      throw new CircuitOpenError(
        toolName,
        breaker.cooldownRemainingMs(),
        `Circuit breaker for "${toolName}" is ${stats.state}. ` +
          `${stats.consecutiveFailures} consecutive failures, ` +
          `cooldown: ${Math.round(breaker.cooldownRemainingMs() / 1000)}s remaining`,
      );
    }

    try {
      const result = await fn();
      breaker.recordSuccess();
      return result;
    } catch (error) {
      const isTimeout =
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.message.toLowerCase().includes('timeout'));
      breaker.recordFailure(
        error instanceof Error ? error.message : String(error),
        isTimeout,
      );
      throw error;
    }
  }

  /**
   * Register a global event listener (fires for all breakers).
   */
  onEvent(listener: CircuitBreakerListener): void {
    this.globalListeners.push(listener);
    for (const breaker of this.breakers.values()) {
      breaker.onEvent(listener);
    }
  }

  /**
   * Get all breakers as a Map (for ToolDispatcher / TimeoutEnforcer).
   */
  getAllBreakers(): Map<string, CircuitBreaker> {
    return new Map(this.breakers);
  }

  /**
   * Get a stats snapshot for every breaker.
   */
  getAllStats(): Record<string, CircuitBreakerStats> {
    const result: Record<string, CircuitBreakerStats> = {};
    for (const [name, breaker] of this.breakers) {
      result[name] = breaker.getStats();
    }
    return result;
  }

  /**
   * List breakers currently in OPEN state.
   */
  getOpenCircuits(): string[] {
    const open: string[] = [];
    for (const [name, breaker] of this.breakers) {
      if (breaker.getState() === 'open') {
        open.push(name);
      }
    }
    return open;
  }

  /**
   * Reset all breakers.
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  /**
   * Get a health summary across all breakers.
   */
  getHealthSummary(): {
    total: number;
    closed: number;
    open: number;
    halfOpen: number;
    healthy: boolean;
  } {
    let closed = 0,
      open = 0,
      halfOpen = 0;
    for (const breaker of this.breakers.values()) {
      switch (breaker.getState()) {
        case 'closed':
          closed++;
          break;
        case 'open':
          open++;
          break;
        case 'half_open':
          halfOpen++;
          break;
      }
    }
    return {
      total: this.breakers.size,
      closed,
      open,
      halfOpen,
      healthy: open === 0,
    };
  }

  // --- Internal ---

  private resolveConfig(toolName: string): Partial<CircuitBreakerConfig> {
    // 1. Exact match
    const exact = this.toolConfigMapping.get(toolName);
    if (exact) return { ...this.defaultConfig, ...exact };

    // 2. Prefix match (e.g. feishu_ -> feishu preset)
    for (const [prefix, config] of this.toolConfigMapping) {
      if (toolName.startsWith(prefix)) {
        return { ...this.defaultConfig, ...config };
      }
    }

    // 3. Built-in prefix presets
    if (toolName.startsWith('feishu_')) {
      return { ...this.defaultConfig, ...CIRCUIT_BREAKER_PRESETS.feishu };
    }
    if (toolName.startsWith('mcp_')) {
      return { ...this.defaultConfig, ...CIRCUIT_BREAKER_PRESETS.mcp_tool };
    }

    return this.defaultConfig;
  }
}

// ============================================================================
// CircuitOpenError
// ============================================================================

export class CircuitOpenError extends Error {
  readonly toolName: string;
  readonly cooldownRemainingMs: number;

  constructor(toolName: string, cooldownRemainingMs: number, message?: string) {
    super(message ?? `Circuit breaker for "${toolName}" is open`);
    this.name = 'CircuitOpenError';
    this.toolName = toolName;
    this.cooldownRemainingMs = cooldownRemainingMs;
  }

  /** Circuit-rejected calls should not be retried -- wait for cooldown instead */
  get retryable(): boolean {
    return false;
  }
}
