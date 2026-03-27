import { describe, test, expect, vi } from 'vitest';
import {
  TimeoutEnforcer,
  ToolTimeoutError,
} from '../timeout-enforcer';
import type { TimeoutLayerConfig } from '../../config/resilience-config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid TimeoutLayerConfig for tests. */
function makeConfig(overrides: Partial<TimeoutLayerConfig> = {}): TimeoutLayerConfig {
  return {
    requestTimeoutMs: 30_000,
    streamingRequestTimeoutMs: 120_000,
    llmStepTimeoutMs: 180_000,
    toolStepTimeoutMs: 60_000,
    turnTimeoutMs: 600_000,
    inactivityTimeoutMs: 600_000,
    inactivityCheckIntervalMs: 30_000,
    ...overrides,
  };
}

/** Compile simple glob-style patterns to regex, matching the project helper. */
function compilePatterns(
  patterns: Array<{ pattern: string; timeoutMs: number; description: string }>,
): Array<{ regex: RegExp; timeoutMs: number; description: string }> {
  return patterns.map(({ pattern, timeoutMs, description }) => {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return { regex: new RegExp(`^${escaped}$`), timeoutMs, description };
  });
}

// ---------------------------------------------------------------------------
// TimeoutEnforcer
// ---------------------------------------------------------------------------

describe('TimeoutEnforcer', () => {
  // ── getToolTimeout() ─────────────────────────────────────────────────────

  describe('getToolTimeout()', () => {
    test('returns default timeout for unknown tools', () => {
      const enforcer = new TimeoutEnforcer(makeConfig({ toolStepTimeoutMs: 60_000 }), []);

      expect(enforcer.getToolTimeout('unknown_tool')).toBe(60_000);
    });

    test('matches glob patterns (e.g. browser_* -> 120000ms)', () => {
      const patterns = compilePatterns([
        { pattern: 'browser_*', timeoutMs: 120_000, description: 'Browser tools' },
        { pattern: 'file_*', timeoutMs: 30_000, description: 'File tools' },
      ]);
      const enforcer = new TimeoutEnforcer(makeConfig(), patterns);

      expect(enforcer.getToolTimeout('browser_navigate')).toBe(120_000);
      expect(enforcer.getToolTimeout('browser_click')).toBe(120_000);
      expect(enforcer.getToolTimeout('file_read')).toBe(30_000);
    });

    test('first matching pattern wins', () => {
      const patterns = compilePatterns([
        { pattern: 'mcp_browser_*', timeoutMs: 200_000, description: 'MCP browser' },
        { pattern: 'mcp_*', timeoutMs: 180_000, description: 'MCP generic' },
        { pattern: '*', timeoutMs: 300_000, description: 'Catch-all' },
      ]);
      const enforcer = new TimeoutEnforcer(makeConfig(), patterns);

      expect(enforcer.getToolTimeout('mcp_browser_goto')).toBe(200_000);
      expect(enforcer.getToolTimeout('mcp_search')).toBe(180_000);
    });
  });

  // ── executeWithToolTimeout() ─────────────────────────────────────────────

  describe('executeWithToolTimeout()', () => {
    test('completes fast operations without error', async () => {
      const enforcer = new TimeoutEnforcer(makeConfig({ toolStepTimeoutMs: 5_000 }), []);

      const result = await enforcer.executeWithToolTimeout('fast_tool', async () => {
        return 42;
      });

      expect(result).toBe(42);
    });

    test('throws ToolTimeoutError on slow operations', async () => {
      const patterns = compilePatterns([
        { pattern: 'slow_tool', timeoutMs: 50, description: 'Very short timeout' },
      ]);
      const enforcer = new TimeoutEnforcer(makeConfig(), patterns);

      let caught: unknown;
      try {
        await enforcer.executeWithToolTimeout('slow_tool', async () => {
          await new Promise((resolve) => setTimeout(resolve, 5_000));
          return 'should not reach';
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ToolTimeoutError);
      const timeoutErr = caught as ToolTimeoutError;
      expect(timeoutErr.toolName).toBe('slow_tool');
      expect(timeoutErr.timeoutMs).toBe(50);
    });
  });

  // ── startTurn() / isTurnExpired() / getRemainingTurnMs() ─────────────────

  describe('turn deadline tracking', () => {
    test('startTurn() sets the turn deadline', () => {
      const enforcer = new TimeoutEnforcer(makeConfig({ turnTimeoutMs: 10_000 }), []);

      // Before starting, no turn active
      expect(enforcer.getRemainingTurnMs()).toBeNull();

      enforcer.startTurn();

      // After starting, remaining should be close to turnTimeoutMs
      const remaining = enforcer.getRemainingTurnMs();
      expect(remaining).not.toBeNull();
      expect(remaining!).toBeGreaterThan(0);
      expect(remaining!).toBeLessThanOrEqual(10_000);
    });

    test('isTurnExpired() returns false before deadline', () => {
      const enforcer = new TimeoutEnforcer(makeConfig({ turnTimeoutMs: 60_000 }), []);

      enforcer.startTurn();

      expect(enforcer.isTurnExpired()).toBe(false);
    });

    test('isTurnExpired() returns true after deadline (short timeout)', async () => {
      const enforcer = new TimeoutEnforcer(makeConfig({ turnTimeoutMs: 1 }), []);

      enforcer.startTurn();

      // Wait for the 1ms deadline to pass
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(enforcer.isTurnExpired()).toBe(true);
    });

    test('isTurnExpired() returns false when no turn has been started', () => {
      const enforcer = new TimeoutEnforcer(makeConfig(), []);

      expect(enforcer.isTurnExpired()).toBe(false);
    });

    test('getRemainingTurnMs() decreases over time', async () => {
      const enforcer = new TimeoutEnforcer(makeConfig({ turnTimeoutMs: 60_000 }), []);

      enforcer.startTurn();
      const r1 = enforcer.getRemainingTurnMs()!;

      await new Promise((resolve) => setTimeout(resolve, 50));
      const r2 = enforcer.getRemainingTurnMs()!;

      expect(r2).toBeLessThan(r1);
    });

    test('getRemainingTurnMs() returns null when no turn is active', () => {
      const enforcer = new TimeoutEnforcer(makeConfig(), []);

      expect(enforcer.getRemainingTurnMs()).toBeNull();
    });
  });

  // ── fromConfig() ─────────────────────────────────────────────────────────

  describe('fromConfig()', () => {
    test('factory creates a valid instance from resilience config', () => {
      // fromConfig() calls resolveConfig() internally. The default preset
      // should produce a working TimeoutEnforcer.
      const enforcer = TimeoutEnforcer.fromConfig();

      // It should be a valid instance with a working getToolTimeout
      expect(enforcer).toBeInstanceOf(TimeoutEnforcer);
      // Default toolStepTimeoutMs from the config should be returned for unknown tools
      const timeout = enforcer.getToolTimeout('some_random_tool');
      expect(typeof timeout).toBe('number');
      expect(timeout).toBeGreaterThan(0);
    });
  });

  // ── ToolTimeoutError ─────────────────────────────────────────────────────

  describe('ToolTimeoutError', () => {
    test('has correct name, toolName, and timeoutMs properties', () => {
      const err = new ToolTimeoutError('my_tool', 5000);

      expect(err.name).toBe('ToolTimeoutError');
      expect(err.toolName).toBe('my_tool');
      expect(err.timeoutMs).toBe(5000);
      expect(err.message).toContain('my_tool');
      expect(err.message).toContain('5000');
    });
  });
});
