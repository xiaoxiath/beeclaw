/**
 * budget-manager.test.ts — 预算管理器测试
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { BudgetManager, estimateBudget, BUDGET_PRESETS } from '../budget-manager';

describe('BudgetManager', () => {
  let manager: BudgetManager;

  beforeEach(() => {
    manager = new BudgetManager({
      maxInputTokens: 80_000,
      maxOutputTokens: 20_000,
      maxTotalTokens: 100_000,
      maxLLMCalls: 10,
      maxToolCalls: 30,
      maxWallClockMs: 600_000, // 10 minutes
      maxCostUSD: 5.0,
      warningThreshold: 0.8,
      hardLimitThreshold: 0.95,
    });
  });

  describe('记录消耗', () => {
    test('should record LLM calls', () => {
      manager.recordLLMCall({
        inputTokens: 1000,
        outputTokens: 500,
        model: 'gpt-4',
        iteration: 1,
      });

      const consumed = manager.getConsumed();
      expect(consumed.inputTokens).toBe(1000);
      expect(consumed.outputTokens).toBe(500);
      expect(consumed.llmCalls).toBe(1);
      expect(consumed.estimatedCostUSD).toBeGreaterThan(0);
    });

    test('should record tool calls', () => {
      manager.recordToolCall({
        toolName: 'search',
        durationMs: 1500,
        iteration: 1,
      });

      const consumed = manager.getConsumed();
      expect(consumed.toolCalls).toBe(1);
      expect(consumed.toolCallDetails).toHaveLength(1);
      expect(consumed.toolCallDetails[0].toolName).toBe('search');
      expect(consumed.toolCallDetails[0].durationMs).toBe(1500);
    });

    test('should accumulate multiple calls', () => {
      manager.recordLLMCall({ inputTokens: 1000, outputTokens: 500, model: 'gpt-4' });
      manager.recordLLMCall({ inputTokens: 2000, outputTokens: 800, model: 'gpt-4' });

      manager.recordToolCall({ toolName: 'search', durationMs: 1000 });
      manager.recordToolCall({ toolName: 'browse', durationMs: 2000 });

      const consumed = manager.getConsumed();
      expect(consumed.inputTokens).toBe(3000);
      expect(consumed.outputTokens).toBe(1300);
      expect(consumed.llmCalls).toBe(2);
      expect(consumed.toolCalls).toBe(2);
    });
  });

  describe('预算检查', () => {
    test('should return correct utilization', () => {
      manager.recordLLMCall({ inputTokens: 80_000, outputTokens: 0, model: 'gpt-4' });

      const status = manager.check();

      expect(status.utilization.inputTokens).toBeCloseTo(1.0);
      expect(status.utilization.totalTokens).toBeCloseTo(0.8);
      expect(status.bottleneck).toBe('inputTokens');
    });

    test('should identify bottleneck', () => {
      manager.recordLLMCall({ inputTokens: 50_000, outputTokens: 10_000, model: 'gpt-4' });

      const status = manager.check();

      expect(status.utilization.totalTokens).toBeCloseTo(0.6);
      expect(status.nearLimit).toBe(false);
      expect(status.recommendation).toBe('continue');
    });

    test('should detect near limit', () => {
      manager.recordLLMCall({ inputTokens: 70_000, outputTokens: 15_000, model: 'gpt-4' });

      const status = manager.check();

      expect(status.utilization.totalTokens).toBeCloseTo(0.85);
      expect(status.nearLimit).toBe(true);
      expect(status.recommendation).toBe('wrap_up');
    });

    test('should detect exceeded', () => {
      manager.recordLLMCall({ inputTokens: 78_000, outputTokens: 19_500, model: 'gpt-4' });

      const status = manager.check();

      expect(status.exceeded).toBe(true);
      expect(status.utilization.totalTokens).toBeGreaterThan(0.95);
      expect(status.recommendation).toBe('abort');
    });

    test('should track wall clock time', async () => {
      await new Promise(resolve => setTimeout(resolve, 100));

      const status = manager.check();

      expect(status.utilization.wallClock).toBeGreaterThan(0);
      expect(status.utilization.wallClock).toBeLessThan(0.01); // < 1% of 10min
    });
  });

  describe('预算告警', () => {
    test('should generate warning message', () => {
      // 记录足够多的 LLM 调用以触发警告
      for (let i = 0; i < 8; i++) {
        manager.recordLLMCall({ inputTokens: 8_000, outputTokens: 2_000, model: 'gpt-4' });
      }

      const status = manager.check();
      const warning = manager.generateBudgetWarning(status);

      expect(warning).toBeDefined();
      expect(warning).toContain('Token 预算');
      // LLM 调用次数也应该触发警告（8/10 = 0.8）
      expect(warning).toContain('LLM 调用次数');
    });

    test('should not generate warning when not near limit', () => {
      manager.recordLLMCall({ inputTokens: 10_000, outputTokens: 2_000, model: 'gpt-4' });

      const status = manager.check();
      const warning = manager.generateBudgetWarning(status);

      expect(warning).toBeNull();
    });

    test('should only warn once', () => {
      manager.recordLLMCall({ inputTokens: 70_000, outputTokens: 15_000, model: 'gpt-4' });

      const status1 = manager.check();
      const warning1 = manager.generateBudgetWarning(status1);
      expect(warning1).toBeDefined();

      manager.recordLLMCall({ inputTokens: 1_000, outputTokens: 100, model: 'gpt-4' });

      const status2 = manager.check();
      const warning2 = manager.generateBudgetWarning(status2);
      expect(warning2).toBeNull(); // 已经警告过
    });
  });

  describe('预算报告', () => {
    test('should generate report', () => {
      manager.recordLLMCall({ inputTokens: 5000, outputTokens: 1000, model: 'gpt-4' });
      manager.recordToolCall({ toolName: 'search', durationMs: 1500 });

      const report = manager.generateReport();

      expect(report.totalTokens).toBe(6000);
      expect(report.inputTokens).toBe(5000);
      expect(report.outputTokens).toBe(1000);
      expect(report.llmCalls).toBe(1);
      expect(report.toolCalls).toBe(1);
      expect(report.estimatedCostUSD).toBeGreaterThan(0);
      expect(report.avgTokensPerLLMCall).toBe(6000);
      expect(report.peakLLMCall).toBeDefined();
      expect(report.slowestToolCall).toBeDefined();
    });

    test('should track peak LLM call', () => {
      manager.recordLLMCall({ inputTokens: 2000, outputTokens: 500, model: 'gpt-4', iteration: 1 });
      manager.recordLLMCall({ inputTokens: 5000, outputTokens: 1500, model: 'gpt-4', iteration: 2 });
      manager.recordLLMCall({ inputTokens: 1000, outputTokens: 300, model: 'gpt-4', iteration: 3 });

      const report = manager.generateReport();

      expect(report.peakLLMCall).toBeDefined();
      expect(report.peakLLMCall?.iteration).toBe(2);
      expect(report.peakLLMCall?.totalTokens).toBe(6500);
    });

    test('should track slowest tool call', () => {
      manager.recordToolCall({ toolName: 'search', durationMs: 1000, iteration: 1 });
      manager.recordToolCall({ toolName: 'browse', durationMs: 3000, iteration: 2 });
      manager.recordToolCall({ toolName: 'read', durationMs: 500, iteration: 3 });

      const report = manager.generateReport();

      expect(report.slowestToolCall).toBeDefined();
      expect(report.slowestToolCall?.toolName).toBe('browse');
      expect(report.slowestToolCall?.durationMs).toBe(3000);
    });
  });

  describe('剩余预算', () => {
    test('should calculate remaining tokens', () => {
      manager.recordLLMCall({ inputTokens: 30_000, outputTokens: 10_000, model: 'gpt-4' });

      const remaining = manager.remainingTokens();

      expect(remaining).toBe(60_000);
    });

    test('should calculate remaining LLM calls', () => {
      manager.recordLLMCall({ inputTokens: 1000, outputTokens: 500, model: 'gpt-4' });
      manager.recordLLMCall({ inputTokens: 1000, outputTokens: 500, model: 'gpt-4' });

      const remaining = manager.remainingLLMCalls();

      expect(remaining).toBe(8);
    });

    test('should calculate remaining tool calls', () => {
      manager.recordToolCall({ toolName: 'search', durationMs: 1000 });
      manager.recordToolCall({ toolName: 'browse', durationMs: 2000 });

      const remaining = manager.remainingToolCalls();

      expect(remaining).toBe(28);
    });

    test('should not go negative', () => {
      manager.recordLLMCall({ inputTokens: 150_000, outputTokens: 50_000, model: 'gpt-4' });

      const remaining = manager.remainingTokens();

      expect(remaining).toBe(0); // 不应该是负数
    });
  });
});

describe('estimateBudget', () => {
  test('should estimate simple task', () => {
    const budget = estimateBudget('什么是 AI？', ['search']);

    expect(budget.maxLLMCalls).toBeLessThan(10);
    expect(budget.maxToolCalls).toBeLessThan(20);
  });

  test('should estimate complex task', () => {
    const budget = estimateBudget(
      '请搜索最新的 AI 技术发展，分析趋势，并生成一份详细的报告',
      ['search', 'browse', 'analyze', 'write']
    );

    expect(budget.maxLLMCalls).toBeGreaterThan(10);
    expect(budget.maxToolCalls).toBeGreaterThan(20);
  });

  test('should estimate deep research task', () => {
    const budget = estimateBudget(
      '请深入分析量子计算的发展现状，对比不同技术路线，给出全面的技术选型建议',
      ['search', 'browse', 'analyze', 'compare', 'report']
    );

    expect(budget.maxLLMCalls).toBeGreaterThan(30);
    expect(budget.maxToolCalls).toBeGreaterThan(50);
  });

  test('should adjust based on tool count', () => {
    const budget1 = estimateBudget('搜索并分析', ['search', 'browse', 'analyze']);
    const budget2 = estimateBudget(
      '搜索并分析',
      [
        'search', 'browse', 'analyze', 'read', 'write',
        'execute', 'test', 'deploy', 'monitor', 'log',
        'cache', 'db', 'api', 'http'
      ]
    );

    expect(budget2.maxToolCalls).toBeGreaterThan(budget1.maxToolCalls);
  });
});

describe('BUDGET_PRESETS', () => {
  test('should have all presets', () => {
    expect(BUDGET_PRESETS.simple).toBeDefined();
    expect(BUDGET_PRESETS.standard).toBeDefined();
    expect(BUDGET_PRESETS.complex).toBeDefined();
    expect(BUDGET_PRESETS.deep_research).toBeDefined();
  });

  test('should have increasing budgets', () => {
    expect(BUDGET_PRESETS.simple.maxTotalTokens).toBeLessThan(
      BUDGET_PRESETS.standard.maxTotalTokens
    );
    expect(BUDGET_PRESETS.standard.maxTotalTokens).toBeLessThan(
      BUDGET_PRESETS.complex.maxTotalTokens
    );
    expect(BUDGET_PRESETS.complex.maxTotalTokens).toBeLessThan(
      BUDGET_PRESETS.deep_research.maxTotalTokens
    );
  });
});
