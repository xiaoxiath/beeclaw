/**
 * P0-2.1: Circuit Breaker Integration Tests
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { getCircuitBreakerRegistry, CircuitOpenError, CIRCUIT_BREAKER_PRESETS } from '../../circuit-breaker';

describe('Circuit Breaker Integration', () => {
  let registry: ReturnType<typeof getCircuitBreakerRegistry>;

  beforeEach(() => {
    // Get fresh registry instance and reset
    registry = getCircuitBreakerRegistry();

    // Clear all registered breakers
    const allBreakers = registry.getAllBreakers();
    for (const name of allBreakers.keys()) {
      allBreakers.get(name)?.reset();
    }
  });

  afterEach(() => {
    // Reset after each test
    if (registry) {
      registry.resetAll();
    }
  });

  describe('Tool-specific configurations', () => {
    test('should register web_search with mcp_tool preset', () => {
      registry.registerToolConfig('web_search', CIRCUIT_BREAKER_PRESETS.mcp_tool);

      const breaker = registry.getBreaker('web_search');
      expect(breaker).toBeDefined();

      const stats = breaker.getStats();
      expect(stats.state).toBe('closed');
    });

    test('should register deep_research with custom config', () => {
      registry.registerToolConfig('deep_research', {
        failureThreshold: 2,
        cooldownMs: 120_000,
      });

      const breaker = registry.getBreaker('deep_research');
      expect(breaker).toBeDefined();
    });

    test('should reuse existing breaker for same tool', () => {
      registry.registerToolConfig('test_tool', CIRCUIT_BREAKER_PRESETS.mcp_tool);

      const breaker1 = registry.getBreaker('test_tool');
      const breaker2 = registry.getBreaker('test_tool');

      expect(breaker1).toBe(breaker2);
    });
  });

  describe('Circuit breaker execution', () => {
    test('should execute successful tool call', async () => {
      registry.registerToolConfig('success_tool', CIRCUIT_BREAKER_PRESETS.mcp_tool);

      const result = await registry.execute('success_tool', async () => {
        return { success: true, data: 'test' };
      });

      expect(result).toEqual({ success: true, data: 'test' });

      const breaker = registry.getBreaker('success_tool');
      expect(breaker.getStats().totalSuccesses).toBe(1);
    });

    test('should record failures', async () => {
      registry.registerToolConfig('fail_tool', {
        failureThreshold: 3,
        cooldownMs: 1000,
      });

      // First failure
      await expect(
        registry.execute('fail_tool', async () => {
          throw new Error('Failure 1');
        })
      ).rejects.toThrow('Failure 1');

      const breaker = registry.getBreaker('fail_tool');
      expect(breaker.getStats().totalFailures).toBe(1);
      expect(breaker.getStats().state).toBe('closed'); // Not yet open
    });

    test('should open circuit after threshold', async () => {
      registry.registerToolConfig('threshold_tool', {
        failureThreshold: 2,
        cooldownMs: 1000,
      });

      // Trigger failures
      for (let i = 0; i < 2; i++) {
        try {
          await registry.execute('threshold_tool', async () => {
            throw new Error(`Failure ${i + 1}`);
          });
        } catch (error) {
          // Expected
        }
      }

      const breaker = registry.getBreaker('threshold_tool');
      expect(breaker.getStats().totalFailures).toBe(2);
      expect(breaker.getStats().state).toBe('open');
    });

    test('should reject calls when circuit is open', async () => {
      registry.registerToolConfig('open_tool', {
        failureThreshold: 1,
        cooldownMs: 5000,
      });

      // Trigger circuit open
      try {
        await registry.execute('open_tool', async () => {
          throw new Error('Trigger failure');
        });
      } catch (error) {
        // Expected
      }

      // Verify circuit is open
      const breaker = registry.getBreaker('open_tool');
      expect(breaker.getStats().state).toBe('open');

      // Next call should throw CircuitOpenError
      await expect(
        registry.execute('open_tool', async () => {
          return 'should not execute';
        })
      ).rejects.toThrow(CircuitOpenError);
    });

    test('should provide cooldown remaining time', async () => {
      registry.registerToolConfig('cooldown_tool', {
        failureThreshold: 1,
        cooldownMs: 5000,
      });

      // Trigger circuit open
      try {
        await registry.execute('cooldown_tool', async () => {
          throw new Error('Failure');
        });
      } catch (error) {
        // Expected
      }

      // Try again - should get CircuitOpenError
      try {
        await registry.execute('cooldown_tool', async () => {
          return 'test';
        });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(CircuitOpenError);
        if (error instanceof CircuitOpenError) {
          expect(error.cooldownRemainingMs).toBeGreaterThan(0);
          expect(error.cooldownRemainingMs).toBeLessThanOrEqual(5000);
        }
      }
    });
  });

  describe('Circuit breaker recovery', () => {
    test('should transition to half-open after cooldown', async () => {
      registry.registerToolConfig('recovery_tool', {
        failureThreshold: 1,
        cooldownMs: 100, // Short cooldown for testing
      });

      // Trigger circuit open
      try {
        await registry.execute('recovery_tool', async () => {
          throw new Error('Failure');
        });
      } catch (error) {
        // Expected
      }

      const breaker1 = registry.getBreaker('recovery_tool');
      expect(breaker1.getStats().state).toBe('open');

      // Wait for cooldown
      await new Promise(resolve => setTimeout(resolve, 150));

      // Next call should succeed (transitions to half-open then closed)
      const result = await registry.execute('recovery_tool', async () => {
        return 'recovered';
      });

      expect(result).toBe('recovered');

      const breaker2 = registry.getBreaker('recovery_tool');
      expect(breaker2.getStats().state).toBe('closed'); // Success closes it
    });

    test('should recover after successful probe', async () => {
      registry.registerToolConfig('probe_tool', {
        failureThreshold: 1,
        cooldownMs: 100,
        successThreshold: 1,
      });

      // Trigger circuit open
      try {
        await registry.execute('probe_tool', async () => {
          throw new Error('Failure');
        });
      } catch (error) {
        // Expected
      }

      // Wait for cooldown
      await new Promise(resolve => setTimeout(resolve, 150));

      // Successful probe should close circuit
      const result = await registry.execute('probe_tool', async () => {
        return 'success';
      });

      expect(result).toBe('success');

      const breaker = registry.getBreaker('probe_tool');
      expect(breaker.getStats().state).toBe('closed');
    });
  });

  describe('Registry statistics', () => {
    test('should get all breaker stats', async () => {
      registry.registerToolConfig('stats_tool1', CIRCUIT_BREAKER_PRESETS.mcp_tool);
      registry.registerToolConfig('stats_tool2', CIRCUIT_BREAKER_PRESETS.mcp_tool);

      // Execute to create the breakers
      await registry.execute('stats_tool1', async () => 'test1');
      await registry.execute('stats_tool2', async () => 'test2');

      const stats = registry.getAllStats();

      expect(Object.keys(stats)).toContain('stats_tool1');
      expect(Object.keys(stats)).toContain('stats_tool2');
    });

    test('should get open circuits', async () => {
      registry.registerToolConfig('open_stats1', { failureThreshold: 1, cooldownMs: 1000 });
      registry.registerToolConfig('open_stats2', { failureThreshold: 1, cooldownMs: 1000 });

      // Open open_stats1
      await expect(
        registry.execute('open_stats1', async () => {
          throw new Error('Failure');
        })
      ).rejects.toThrow('Failure');

      const openCircuits = registry.getOpenCircuits();

      expect(openCircuits).toContain('open_stats1');
      expect(openCircuits).not.toContain('open_stats2');
    });

    test('should get health summary', async () => {
      // Register new tools for this test
      registry.registerToolConfig('health_tool1', { failureThreshold: 1, cooldownMs: 1000 });
      registry.registerToolConfig('health_tool2', { failureThreshold: 1, cooldownMs: 1000 });

      // Initialize both tools
      await registry.execute('health_tool2', async () => 'init');

      // Open health_tool1
      await expect(
        registry.execute('health_tool1', async () => {
          throw new Error('Failure');
        })
      ).rejects.toThrow('Failure');

      const summary = registry.getHealthSummary();

      expect(summary.total).toBeGreaterThanOrEqual(2);
      expect(summary.open).toBeGreaterThanOrEqual(1);
      expect(summary.healthy).toBe(false);
    });
  });

  describe('Error handling', () => {
    test('should wrap errors in tool execution result', async () => {
      registry.registerToolConfig('test_tool', CIRCUIT_BREAKER_PRESETS.mcp_tool);

      try {
        await registry.execute('test_tool', async () => {
          throw new Error('Tool error');
        });
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Tool error');
      }
    });

    test('should handle non-Error throws', async () => {
      registry.registerToolConfig('test_tool', CIRCUIT_BREAKER_PRESETS.mcp_tool);

      try {
        await registry.execute('test_tool', async () => {
          throw 'String error';
        });
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });
});
