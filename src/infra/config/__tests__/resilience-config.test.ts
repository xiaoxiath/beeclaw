/**
 * resilience-config.test.ts — 绱性配置中心测试
 */

import { describe, test, expect } from 'bun:test';
import {
  resolveConfig,
  RESILIENCE_PRESETS,
  compileToolTimeoutPatterns,
  ConfigValidationError,
} from '../resilience-config';

describe('resolveConfig', () => {
  test('should return standard config by default', () => {
    const config = resolveConfig();

    expect(config).toBeDefined();
    expect(config.timeout).toBeDefined();
    expect(config.budget).toBeDefined();
    expect(config.circuitBreaker).toBeDefined();
  });

  test('should apply preset', () => {
    const config = resolveConfig('complex_research');

    expect(config.timeout.turnTimeoutMs).toBe(1_800_000);
    expect(config.budget.maxTokens).toBe(500_000);
    expect(config.budget.maxToolCalls).toBe(100);
  });

  test('should apply user overrides', () => {
    const config = resolveConfig('standard', {
      timeout: { turnTimeoutMs: 900_000 },
      budget: { maxToolCalls: 50 },
    });

    expect(config.timeout.turnTimeoutMs).toBe(900_000);
    expect(config.budget.maxToolCalls).toBe(50);
  });

  test('should validate config constraints', () => {
    expect(() => {
      resolveConfig('standard', {
        timeout: {
          requestTimeoutMs: 200_000,
          llmStepTimeoutMs: 100_000, // 违反 L1 < L2 约束
        },
      });
    }).toThrow(ConfigValidationError);
  });

  test('should support environment variables', () => {
    process.env.BEECLAW_RESILIENCE_BUDGET_MAX_TOOL_CALLS = '50';

    const config = resolveConfig('standard');

    expect(config.budget.maxToolCalls).toBe(50);

    delete process.env.BEECLAW_RESILIENCE_BUDGET_MAX_TOOL_CALLS;
  });
});

describe('RESILIENCE_PRESETS', () => {
  test('should have all four presets', () => {
    expect(RESILIENCE_PRESETS.quick_task).toBeDefined();
    expect(RESILIENCE_PRESETS.standard).toBeDefined();
    expect(RESILIENCE_PRESETS.complex_research).toBeDefined();
    expect(RESILIENCE_PRESETS.long_running).toBeDefined();
  });

  test('should have increasing limits', () => {
    expect(
      RESILIENCE_PRESETS.quick_task.budget.maxTokens
    ).toBeLessThan(
      RESILIENCE_PRESETS.standard.budget.maxTokens
    );

    expect(
      RESILIENCE_PRESETS.standard.budget.maxTokens
    ).toBeLessThan(
      RESILIENCE_PRESETS.complex_research.budget.maxTokens
    );

    expect(
      RESILIENCE_PRESETS.complex_research.budget.maxTokens
    ).toBeLessThan(
      RESILIENCE_PRESETS.long_running.budget.maxTokens
    );
  });
});

describe('compileToolTimeoutPatterns', () => {
  test('should compile patterns', () => {
    const patterns = [
      { pattern: 'search_*', timeoutMs: 30_000, description: 'Search tools' },
      { pattern: 'file_*', timeoutMs: 20_000, description: 'File tools' },
    ];

    const compiled = compileToolTimeoutPatterns(patterns);

    expect(compiled).toHaveLength(2);
    expect(compiled[0].regex).toBeDefined();
    expect(compiled[0].timeoutMs).toBe(30_000);
  });

  test('should match patterns', () => {
    const patterns = [
      { pattern: 'search_*', timeoutMs: 30_000, description: 'Search tools' },
    ];

    const compiled = compileToolTimeoutPatterns(patterns);

    expect(compiled[0].regex.test('search_web')).toBe(true);
    expect(compiled[0].regex.test('search_local')).toBe(true);
    expect(compiled[0].regex.test('other_tool')).toBe(false);
  });
});
