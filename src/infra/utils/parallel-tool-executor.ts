/**
 * parallel-tool-executor.ts — P2 并行工具超时聚合
 * 
 * 问题：原 index.ts 使用 Promise.all 执行并行工具调用，一个失败全部失败，
 *       且没有单独的工具超时或断路器集成。
 * 方案：Promise.allSettled + 每工具独立 AbortController + 断路器前置检查 + 可选回退
 */

import { CircuitBreaker, CircuitState, CircuitBreakerConfig } from './circuit-breaker';

// ─── 工具超时模式匹配 ─────────────────────────────────────────

interface ToolTimeoutPattern {
  pattern: RegExp;
  timeoutMs: number;
  description: string;
}

const TOOL_TIMEOUT_PATTERNS: ToolTimeoutPattern[] = [
  { pattern: /^(web_search|search_)/,       timeoutMs: 15_000, description: 'Search tools' },
  { pattern: /^(bash|execute|run_)/,         timeoutMs: 60_000, description: 'Execution tools' },
  { pattern: /^(read_file|file_read|cat)/,   timeoutMs: 10_000, description: 'File read tools' },
  { pattern: /^(browser_|page_|navigate)/,   timeoutMs: 45_000, description: 'Browser tools' },
  { pattern: /^(api_call|http_|fetch_)/,     timeoutMs: 20_000, description: 'API tools' },
  { pattern: /^(db_|query_|sql_)/,           timeoutMs: 30_000, description: 'Database tools' },
  { pattern: /^(llm_|ai_|generate_)/,        timeoutMs: 45_000, description: 'LLM tools' },
  { pattern: /^(image_|draw_|render_)/,      timeoutMs: 60_000, description: 'Image tools' },
  { pattern: /^(deploy_|publish_)/,          timeoutMs: 90_000, description: 'Deploy tools' },
];

/** 解析工具超时：显式配置 > 精确匹配 > 模式匹配 > 默认值 */
function resolveToolTimeout(
  toolName: string,
  explicitTimeouts: Map<string, number>,
  defaultTimeoutMs: number
): number {
  const explicit = explicitTimeouts.get(toolName);
  if (explicit !== undefined) return explicit;
  for (const { pattern, timeoutMs } of TOOL_TIMEOUT_PATTERNS) {
    if (pattern.test(toolName)) return timeoutMs;
  }
  return defaultTimeoutMs;
}

// ─── 并发信号量 ─────────────────────────────────────────────

class Semaphore {
  private current = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.current++;
        resolve();
      });
    });
  }

  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) next();
  }
}

// ─── 类型定义 ───────────────────────────────────────────────

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallOutcome {
  id: string;
  name: string;
  status: 'success' | 'error' | 'timeout' | 'circuit_open' | 'skipped';
  result?: unknown;
  error?: Error;
  durationMs: number;
  usedFallback: boolean;
}

export interface BatchExecutionSummary {
  total: number;
  succeeded: number;
  failed: number;
  timedOut: number;
  circuitOpen: number;
  skipped: number;
  totalDurationMs: number;
  outcomes: ToolCallOutcome[];
}

export interface ParallelExecutorConfig {
  defaultTimeoutMs: number;
  maxConcurrency: number;
  toolTimeouts: Map<string, number>;
  criticalTools: Set<string>;
  circuitBreakers: Map<string, CircuitBreaker>;
  fallbackProvider?: (toolName: string, error: Error) => Promise<unknown>;
  onOutcome?: (outcome: ToolCallOutcome) => void;
}

interface ToolStats {
  totalCalls: number;
  successes: number;
  failures: number;
  timeouts: number;
  avgDurationMs: number;
}

// ─── 核心执行器 ─────────────────────────────────────────────

export class ParallelToolExecutor {
  private readonly config: ParallelExecutorConfig;
  private readonly semaphore: Semaphore;
  private stats: Map<string, ToolStats> = new Map();

  constructor(config: Partial<ParallelExecutorConfig> & { defaultTimeoutMs?: number } = {}) {
    this.config = {
      defaultTimeoutMs: config.defaultTimeoutMs ?? 30_000,
      maxConcurrency: config.maxConcurrency ?? 5,
      toolTimeouts: config.toolTimeouts ?? new Map(),
      criticalTools: config.criticalTools ?? new Set(),
      circuitBreakers: config.circuitBreakers ?? new Map(),
      fallbackProvider: config.fallbackProvider,
      onOutcome: config.onOutcome,
    };
    this.semaphore = new Semaphore(this.config.maxConcurrency);
  }

  async executeBatch(
    requests: ToolCallRequest[],
    executeFn: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>,
    batchAbortSignal?: AbortSignal
  ): Promise<BatchExecutionSummary> {
    const batchStart = Date.now();
    const { executable, preFiltered } = this.preFilter(requests);

    const batchController = new AbortController();
    if (batchAbortSignal) {
      batchAbortSignal.addEventListener('abort', () => {
        batchController.abort(batchAbortSignal.reason);
      });
    }

    const promises = executable.map((req) =>
      this.executeOne(req, executeFn, batchController.signal)
    );
    const settledResults = await Promise.allSettled(promises);

    const outcomes: ToolCallOutcome[] = [
      ...preFiltered,
      ...settledResults.map((result, i) => {
        if (result.status === 'fulfilled') return result.value;
        return {
          id: executable[i].id,
          name: executable[i].name,
          status: 'error' as const,
          error: result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
          durationMs: Date.now() - batchStart,
          usedFallback: false,
        };
      }),
    ];

    for (const outcome of outcomes) {
      this.updateStats(outcome);
      this.config.onOutcome?.(outcome);
    }
    return this.buildSummary(outcomes, batchStart);
  }

  private preFilter(requests: ToolCallRequest[]): {
    executable: ToolCallRequest[];
    preFiltered: ToolCallOutcome[];
  } {
    const executable: ToolCallRequest[] = [];
    const preFiltered: ToolCallOutcome[] = [];
    for (const req of requests) {
      const breaker = this.config.circuitBreakers.get(req.name);
      if (breaker && breaker.getState() === CircuitState.Open) {
        preFiltered.push({
          id: req.id, name: req.name, status: 'circuit_open',
          error: new Error(`Circuit breaker open for tool: ${req.name}`),
          durationMs: 0, usedFallback: false,
        });
      } else {
        executable.push(req);
      }
    }
    return { executable, preFiltered };
  }

  private async executeOne(
    req: ToolCallRequest,
    executeFn: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>,
    batchSignal: AbortSignal
  ): Promise<ToolCallOutcome> {
    await this.semaphore.acquire();
    const start = Date.now();
    try {
      const timeoutMs = resolveToolTimeout(req.name, this.config.toolTimeouts, this.config.defaultTimeoutMs);
      const toolController = new AbortController();
      const timeoutId = setTimeout(() => toolController.abort(new Error('Tool timeout')), timeoutMs);
      batchSignal.addEventListener('abort', () => toolController.abort(batchSignal.reason), { once: true });

      try {
        const result = await executeFn(req.name, req.arguments, toolController.signal);
        clearTimeout(timeoutId);
        const breaker = this.config.circuitBreakers.get(req.name);
        if (breaker) breaker.recordSuccess();
        return { id: req.id, name: req.name, status: 'success', result, durationMs: Date.now() - start, usedFallback: false };
      } catch (error) {
        clearTimeout(timeoutId);
        const err = error instanceof Error ? error : new Error(String(error));
        const isTimeout = err.message === 'Tool timeout' || toolController.signal.aborted;
        const breaker = this.config.circuitBreakers.get(req.name);
        if (breaker) breaker.recordFailure();

        const fallbackResult = await this.tryFallback(req.name, err);
        if (fallbackResult !== undefined) {
          return { id: req.id, name: req.name, status: 'success', result: fallbackResult, durationMs: Date.now() - start, usedFallback: true };
        }
        return { id: req.id, name: req.name, status: isTimeout ? 'timeout' : 'error', error: err, durationMs: Date.now() - start, usedFallback: false };
      }
    } finally {
      this.semaphore.release();
    }
  }

  private async tryFallback(toolName: string, error: Error): Promise<unknown> {
    if (!this.config.fallbackProvider) return undefined;
    try { return await this.config.fallbackProvider(toolName, error); } catch { return undefined; }
  }

  private buildSummary(outcomes: ToolCallOutcome[], batchStart: number): BatchExecutionSummary {
    const summary: BatchExecutionSummary = {
      total: outcomes.length, succeeded: 0, failed: 0, timedOut: 0,
      circuitOpen: 0, skipped: 0, totalDurationMs: Date.now() - batchStart, outcomes,
    };
    for (const o of outcomes) {
      switch (o.status) {
        case 'success': summary.succeeded++; break;
        case 'error': summary.failed++; break;
        case 'timeout': summary.timedOut++; break;
        case 'circuit_open': summary.circuitOpen++; break;
        case 'skipped': summary.skipped++; break;
      }
    }
    return summary;
  }

  private updateStats(outcome: ToolCallOutcome): void {
    const existing = this.stats.get(outcome.name) ?? { totalCalls: 0, successes: 0, failures: 0, timeouts: 0, avgDurationMs: 0 };
    existing.totalCalls++;
    if (outcome.status === 'success') existing.successes++;
    else if (outcome.status === 'timeout') existing.timeouts++;
    else existing.failures++;
    const alpha = 0.3;
    existing.avgDurationMs = existing.avgDurationMs === 0
      ? outcome.durationMs
      : existing.avgDurationMs * (1 - alpha) + outcome.durationMs * alpha;
    this.stats.set(outcome.name, existing);
  }

  getStats(): Map<string, ToolStats> { return new Map(this.stats); }

  static formatForLLM(summary: BatchExecutionSummary): string {
    const lines: string[] = [
      `[Tool Execution Summary] ${summary.succeeded}/${summary.total} succeeded in ${summary.totalDurationMs}ms`,
    ];
    if (summary.timedOut > 0) lines.push(`  ⏱ ${summary.timedOut} timed out`);
    if (summary.failed > 0) lines.push(`  ❌ ${summary.failed} failed`);
    if (summary.circuitOpen > 0) lines.push(`  🔌 ${summary.circuitOpen} circuit-breaker blocked`);
    for (const o of summary.outcomes) {
      const icon = o.status === 'success' ? '✅' : o.status === 'timeout' ? '⏱' : '❌';
      const fb = o.usedFallback ? ' (fallback)' : '';
      const detail = o.status === 'success' ? `${o.durationMs}ms${fb}` : `${o.error?.message ?? o.status}`;
      lines.push(`  ${icon} ${o.name}: ${detail}`);
    }
    return lines.join('\n');
  }
}
