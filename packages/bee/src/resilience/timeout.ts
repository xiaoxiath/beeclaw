/**
 * bee -- Timeout Enforcer.
 *
 * L1-L3 timeout enforcement layer:
 *   - Per-tool timeouts via regex pattern matching (L1)
 *   - Per-turn deadline tracking (L2)
 *   - Constructor-based configuration (no external config dependency)
 *
 * All timeouts use AbortController so downstream code can react to cancellation
 * cooperatively rather than relying on unstructured promise races.
 *
 * Extracted from beeclaw's src/infra/resilience/timeout-enforcer.ts.
 */

import { getLogger } from '../core/logger';

const logger = getLogger();

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

export interface TimeoutConfig {
  /** Default per-tool-step timeout in milliseconds */
  toolStepTimeoutMs: number;
  /** Per-turn deadline in milliseconds */
  turnTimeoutMs: number;
}

export interface ToolTimeoutPattern {
  /** Regex pattern to match tool names */
  pattern: string;
  /** Timeout in milliseconds for matching tools */
  timeoutMs: number;
  /** Human-readable description */
  description: string;
}

// ---------------------------------------------------------------------------
// Compiled pattern
// ---------------------------------------------------------------------------

interface CompiledToolPattern {
  regex: RegExp;
  timeoutMs: number;
  description: string;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class ToolTimeoutError extends Error {
  public readonly toolName: string;
  public readonly timeoutMs: number;

  constructor(toolName: string, timeoutMs: number) {
    super(`Tool "${toolName}" timed out after ${timeoutMs}ms`);
    this.name = 'ToolTimeoutError';
    this.toolName = toolName;
    this.timeoutMs = timeoutMs;
  }
}

// ---------------------------------------------------------------------------
// TimeoutEnforcer
// ---------------------------------------------------------------------------

export class TimeoutEnforcer {
  private readonly config: TimeoutConfig;
  private readonly toolPatterns: ReadonlyArray<CompiledToolPattern>;
  private turnDeadline: number | null = null;

  /**
   * @param config - Timeout configuration
   * @param toolPatterns - Array of tool timeout pattern config objects.
   *   Each pattern's `pattern` field is compiled to a RegExp at construction time.
   */
  constructor(config: TimeoutConfig, toolPatterns: ToolTimeoutPattern[] = []) {
    this.config = config;
    this.toolPatterns = Object.freeze(
      toolPatterns.map(p => ({
        regex: new RegExp(p.pattern),
        timeoutMs: p.timeoutMs,
        description: p.description,
      })),
    );

    logger.debug(
      `[TimeoutEnforcer] Initialized with turnTimeout=${config.turnTimeoutMs}ms, ` +
        `toolStepDefault=${config.toolStepTimeoutMs}ms, ${toolPatterns.length} pattern(s)`,
    );
  }

  // -----------------------------------------------------------------------
  // Tool-level timeout resolution
  // -----------------------------------------------------------------------

  /**
   * Resolve the timeout for a specific tool.
   *
   * Patterns are evaluated in order; the first match wins.
   * If no pattern matches, falls back to `config.toolStepTimeoutMs`.
   */
  getToolTimeout(toolName: string): number {
    for (const pattern of this.toolPatterns) {
      if (pattern.regex.test(toolName)) {
        logger.debug(
          `[TimeoutEnforcer] Tool "${toolName}" matched pattern "${pattern.description}" -> ${pattern.timeoutMs}ms`,
        );
        return pattern.timeoutMs;
      }
    }
    return this.config.toolStepTimeoutMs;
  }

  /**
   * Execute an async function with a tool-level timeout.
   *
   * The function receives an `AbortSignal` it can observe for cooperative
   * cancellation. If the timeout elapses before the function resolves, a
   * `ToolTimeoutError` is thrown and the signal is aborted.
   *
   * If a turn deadline is active the effective timeout is clamped to the
   * remaining turn budget so individual tools cannot outlive the turn.
   */
  async executeWithToolTimeout<T>(
    toolName: string,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    let timeoutMs = this.getToolTimeout(toolName);

    // Clamp to remaining turn budget when a turn is active
    const remainingTurn = this.getRemainingTurnMs();
    if (remainingTurn !== null && remainingTurn < timeoutMs) {
      logger.debug(
        `[TimeoutEnforcer] Clamping "${toolName}" timeout from ${timeoutMs}ms to remaining turn budget ${remainingTurn}ms`,
      );
      timeoutMs = Math.max(0, remainingTurn);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const result = await Promise.race([
        fn(controller.signal),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener(
            'abort',
            () => reject(new ToolTimeoutError(toolName, timeoutMs)),
            { once: true },
          );
        }),
      ]);
      return result;
    } finally {
      clearTimeout(timer);
      // Ensure the controller is aborted so any lingering listeners are cleaned up
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }
  }

  // -----------------------------------------------------------------------
  // Turn-level deadline tracking
  // -----------------------------------------------------------------------

  /**
   * Mark the start of a new turn. The turn expires after
   * `config.turnTimeoutMs` milliseconds.
   */
  startTurn(): void {
    this.turnDeadline = Date.now() + this.config.turnTimeoutMs;
    logger.debug(
      `[TimeoutEnforcer] Turn started -- deadline in ${this.config.turnTimeoutMs}ms`,
    );
  }

  /**
   * Returns `true` when the current turn's deadline has passed.
   * Always returns `false` if no turn has been started.
   */
  isTurnExpired(): boolean {
    if (this.turnDeadline === null) return false;
    return Date.now() >= this.turnDeadline;
  }

  /**
   * Milliseconds remaining in the current turn, or `null` if no turn is active.
   */
  getRemainingTurnMs(): number | null {
    if (this.turnDeadline === null) return null;
    return Math.max(0, this.turnDeadline - Date.now());
  }
}
