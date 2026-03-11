/**
 * resilience-integration.ts — 韧性集成示例
 *
 * 展示如何将韧性模块集成到 BeeClaw Agent 中。
 * 这是一个参考实现，展示各个模块如何协同工作。
 *
 * 集成要点：
 *   1. 使用 ResilienceConfig 统一管理所有配置
 *   2. 创建 TimeoutOrchestrator 管理超时
 *   3. 使用 LoopDetector 检测循环
 *   4. 使用 BudgetManager 管理预算
 *   5. 使用 CircuitBreakerRegistry 管理熔断器
 *   6. 使用 ParallelToolExecutor 并行执行工具
 *   7. 使用 ProgressAwareMonitor 监控进度
 */

import { resolveConfig, type ResilienceConfig, type PresetName } from '../../infra/config/resilience-config';
import { TimeoutOrchestrator } from '../../infra/utils/timeout-hierarchy';
import { LoopDetector } from '../../infra/utils/loop-detector';
import { CircuitBreakerRegistry } from '../../infra/resilience/circuit-breaker';
import { BudgetManager } from '../../infra/utils/budget-manager';
import { CheckpointManager } from '../../infra/utils/checkpoint-manager';
import { UnifiedRetryEngine } from '../../infra/resilience/unified-retry';
import { ParallelToolExecutor, type ToolCallRequest } from '../../infra/utils/parallel-tool-executor';
import { ProgressAwareMonitor } from '../../infra/utils/progress-aware-monitor';

// ─── 韧性上下文 ────────────────────────────────────────────

export interface ResilienceContext {
  config: ResilienceConfig;
  timeout: TimeoutOrchestrator;
  loopDetector: LoopDetector;
  circuitBreakers: CircuitBreakerRegistry;
  budget: BudgetManager;
  checkpoint: CheckpointManager;
  retry: UnifiedRetryEngine;
  executor: ParallelToolExecutor;
  monitor: ProgressAwareMonitor;
}

/**
 * 创建完整的韧性上下文
 *
 * @example
 * ```ts
 * // 使用标准预设
 * const ctx = createResilienceContext();
 *
 * // 使用复杂研究预设
 * const ctx = createResilienceContext({ preset: 'complex_research' });
 *
 * // 预设 + 自定义覆写
 * const ctx = createResilienceContext({
 *   preset: 'standard',
 *   overrides: {
 *     timeout: { turnTimeoutMs: 900_000 },
 *     budget: { maxToolCalls: 50 }
 *   }
 * });
 * ```
 */
export function createResilienceContext(options?: {
  preset?: PresetName;
  overrides?: Partial<ResilienceConfig>;
}): ResilienceContext {
  const config = resolveConfig(options?.preset ?? 'standard', options?.overrides);

  // 创建各个组件
  const timeout = new TimeoutOrchestrator({
    turnTimeoutMs: config.timeout.turnTimeoutMs,
    requestTimeoutMs: config.timeout.requestTimeoutMs,
    streamingRequestTimeoutMs: config.timeout.streamingRequestTimeoutMs,
    llmStepTimeoutMs: config.timeout.llmStepTimeoutMs,
    toolStepTimeoutMs: config.timeout.toolStepTimeoutMs,
    inactivityTimeoutMs: config.timeout.inactivityTimeoutMs,
    inactivityCheckIntervalMs: config.timeout.inactivityCheckIntervalMs,
  });

  const loopDetector = new LoopDetector({
    exactDuplicateWindow: config.loopDetector.semanticWindowSize,
    maxExactDuplicates: config.loopDetector.exactDuplicateThreshold,
    semanticSimilarityThreshold: config.loopDetector.semanticSimilarityThreshold,
    maxSemanticDuplicates: 3,
    progressStallWindow: config.loopDetector.progressStallRounds,
    minInformationGain: config.loopDetector.progressGainThreshold,
    injectWarningFirst: true,
    maxWarningsBeforeBreak: 2,
  });

  const circuitBreakers = new CircuitBreakerRegistry({
    failureThreshold: config.circuitBreaker.failureThreshold,
    resetTimeoutMs: config.circuitBreaker.resetTimeoutMs,
    halfOpenMaxAttempts: config.circuitBreaker.halfOpenMaxAttempts,
    rollingWindowMs: config.circuitBreaker.rollingWindowMs,
    rollingBuckets: config.circuitBreaker.rollingBuckets,
    volumeThreshold: config.circuitBreaker.volumeThreshold,
  });

  const budget = new BudgetManager({
    maxInputTokens: Math.floor(config.budget.maxTokens * 0.8),
    maxOutputTokens: Math.floor(config.budget.maxTokens * 0.2),
    maxTotalTokens: config.budget.maxTokens,
    maxLLMCalls: 30,
    maxToolCalls: config.budget.maxToolCalls,
    maxWallClockMs: config.budget.maxWallTimeMs,
    maxCostUSD: config.budget.maxCostDollars,
    warningThreshold: config.budget.warningThreshold,
    hardLimitThreshold: config.budget.hardLimitThreshold,
  });

  const checkpoint = new CheckpointManager({
    enabled: config.checkpoint.enabled,
    storageBackend: 'filesystem',
    storagePath: '.beeclaw-checkpoints',
    ttlMs: 24 * 60 * 60 * 1000,
    saveEveryNIterations: config.checkpoint.intervalSteps,
    maxCheckpointsPerTurn: config.checkpoint.maxSnapshots,
    saveFullMessages: true,
    compress: config.checkpoint.compressionThresholdBytes > 0,
  });

  const retry = new UnifiedRetryEngine();
  retry.setCircuitBreakers(circuitBreakers);

  const executor = new ParallelToolExecutor({
    defaultTimeoutMs: config.executor.defaultToolTimeoutMs,
    maxConcurrency: config.executor.maxConcurrency,
    toolTimeouts: new Map(),
    criticalTools: new Set(),
    circuitBreakers: circuitBreakers.getAllBreakers(),
  });

  const monitor = new ProgressAwareMonitor({
    baseTimeoutMs: config.timeout.toolStepTimeoutMs,
    bufferCapacity: config.monitor.healthWindowSize,
    rateWindowMs: 60_000,
    stallThreshold: config.monitor.healthAlertThreshold,
    checkIntervalMs: 30_000,
  });

  return {
    config,
    timeout,
    loopDetector,
    circuitBreakers,
    budget,
    checkpoint,
    retry,
    executor,
    monitor,
  };
}

// ─── 使用示例 ───────────────────────────────────────────────

/**
 * 基本的 Agent chat 循环示例
 */
export async function exampleChatLoop(
  ctx: ResilienceContext,
  userMessage: string,
): Promise<string> {
  // 启动监控
  ctx.timeout.start();
  ctx.monitor.startPeriodicCheck();

  const messages: Array<{ role: string; content: string }> = [
    { role: 'user', content: userMessage }
  ];

  try {
    let iterations = 0;

    while (true) {
      // 1. 检查 Turn 超时
      ctx.timeout.checkTurn({ iteration: iterations });

      // 2. 检查预算
      const budgetStatus = ctx.budget.check();
      if (budgetStatus.recommendation === 'abort') {
        return 'Budget exhausted. Please simplify your request.';
      }

      // 3. LLM 调用（示例 - 实际使用时需要替换为真实的 LLM 调用）
      const llmResponse = await ctx.timeout.wrapLLMCall(
        async (signal) => {
          // 这里应该是实际的 LLM 调用
          return {
            content: 'This is a sample response',
            toolCalls: [] as Array<{ id: string; name: string; arguments: Record<string, unknown> }>,
          };
        },
        { streaming: false }
      );

      // 4. 记录 LLM 响应
      ctx.monitor.recordLLMResponse(llmResponse.content);
      ctx.budget.recordLLMCall({
        inputTokens: 100,
        outputTokens: llmResponse.content.length,
        model: 'unknown',
        iteration: iterations,
      });

      // 5. 如果没有工具调用，返回结果
      if (!llmResponse.toolCalls || llmResponse.toolCalls.length === 0) {
        return llmResponse.content;
      }

      // 6. 循环检测
      for (const toolCall of llmResponse.toolCalls) {
        const loopResult = ctx.loopDetector.check(toolCall.name, toolCall.arguments);
        if (loopResult.action === 'warn' && loopResult.warningMessage) {
          messages.push({ role: 'system', content: loopResult.warningMessage });
          ctx.loopDetector.acknowledgeWarning();
        } else if (loopResult.action === 'break') {
          return `Loop detected: ${loopResult.details}`;
        }
        ctx.loopDetector.recordToolCall(toolCall.name, toolCall.arguments, iterations);
      }

      // 7. 执行工具调用
      const toolRequests: ToolCallRequest[] = llmResponse.toolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      }));

      const batchSummary = await ctx.executor.executeBatch(
        toolRequests,
        async (name, args, signal) => {
          ctx.monitor.recordToolCall(name);
          const startTime = Date.now();

          try {
            // 这里应该是实际的工具执行
            const result = `Result from ${name}`;
            ctx.monitor.recordToolResult(name, result, result.length);
            ctx.budget.recordToolCall({
              toolName: name,
              durationMs: Date.now() - startTime,
              iteration: iterations,
            });
            return result;
          } catch (error) {
            ctx.monitor.recordError(name, (error as Error).message);
            throw error;
          }
        }
      );

      // 8. 记录工具结果
      for (const outcome of batchSummary.outcomes) {
        if (outcome.status === 'success') {
          ctx.loopDetector.recordToolResult(outcome.result);
        }
      }

      // 9. 更新消息
      const toolResultMessage = ParallelToolExecutor.formatForLLM(batchSummary);
      messages.push({ role: 'assistant', content: llmResponse.content });
      messages.push({ role: 'tool', content: toolResultMessage });

      // 10. 保存检查点
      iterations++;
      if (ctx.config.checkpoint.enabled && iterations % ctx.config.checkpoint.intervalSteps === 0) {
        await ctx.checkpoint.save({
          turnId: 'example-session',
          iteration: iterations,
          messages: messages as any,
          estimatedTokens: messages.reduce((sum, m) => sum + m.content.length, 0),
          userMessage,
          model: 'unknown',
        });
        ctx.monitor.recordCheckpoint();
      }

      // 11. 检查进度停滞
      const stallResult = ctx.monitor.checkStall();
      if (stallResult.recommendedAction === 'abort') {
        return `Task stalled: ${stallResult.suggestion}`;
      }
      if (stallResult.recommendedAction === 'inject_guidance') {
        messages.push({
          role: 'system',
          content: `[Guidance] ${stallResult.suggestion}`,
        });
      }
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (err.message.includes('timeout') || err.message.includes('deadline')) {
      return 'Operation timed out. Please try again with a simpler request.';
    }
    throw error;
  } finally {
    // 清理资源
    ctx.timeout.stop();
    ctx.monitor.stopPeriodicCheck();
    console.log('\n[Resilience Report]');
    console.log(ctx.monitor.generateReport());
    console.log(ctx.budget.generateReport());
  }
}

// ─── 导出便捷函数 ─────────────────────────────────────────

/**
 * 快速创建标准配置的韧性上下文
 */
export function createStandardContext(): ResilienceContext {
  return createResilienceContext({ preset: 'standard' });
}

/**
 * 快速创建复杂研究配置的韧性上下文
 */
export function createComplexResearchContext(): ResilienceContext {
  return createResilienceContext({ preset: 'complex_research' });
}

/**
 * 快速创建快速任务配置的韧性上下文
 */
export function createQuickTaskContext(): ResilienceContext {
  return createResilienceContext({ preset: 'quick_task' });
}

/**
 * 快速创建长时运行配置的韧性上下文
 */
export function createLongRunningContext(): ResilienceContext {
  return createResilienceContext({ preset: 'long_running' });
}
