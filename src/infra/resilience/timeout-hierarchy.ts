// @deprecated - Dead code identified in audit (2026-03-25). Not imported by any production module. Scheduled for removal.
/**
 * BeeClaw Resilience Patch — 四层超时体系
 * 
 * 解决问题:
 *   - SmartTimeout 已存在但未接入 Agent 主循环 (#1)
 *   - fetch 调用无 AbortController (#2)
 *   - 无全局 wall-clock deadline (#4)
 *   - 工具调用无 per-call 超时 (#8)
 * 
 * 架构:
 *   Layer 1: Request Timeout  — 单次 HTTP 请求级别 (AbortController)
 *   Layer 2: Step Timeout     — 单步操作级别 (per LLM call / per tool exec)
 *   Layer 3: Turn Timeout     — 单轮 chat() 级别 (wall-clock deadline)
 *   Layer 4: Inactivity       — 全局不活跃检测 (已有 SmartTimeout, 本模块提供桥接)
 * 
 * 集成方式: 在 index.ts 的 chat()/chatStream() 中创建 TimeoutOrchestrator 实例
 */

// ============================================================================
// Types
// ============================================================================

export interface TimeoutConfig {
  /** Layer 1: 单次 HTTP 请求超时 (ms), 默认 120_000 (2min) */
  requestTimeoutMs: number;
  /** Layer 1: Streaming 请求超时 (ms), 默认 300_000 (5min) */
  streamingRequestTimeoutMs: number;
  /** Layer 2: 单次 LLM 调用超时 (含重试, ms), 默认 180_000 (3min) */
  llmStepTimeoutMs: number;
  /** Layer 2: 单次工具执行超时 (ms), 默认 60_000 (1min) */
  toolStepTimeoutMs: number;
  /** Layer 2: 特定工具的自定义超时映射 */
  toolTimeoutOverrides: Record<string, number>;
  /** Layer 3: 单轮 chat() wall-clock 最大时长 (ms), 默认 900_000 (15min) */
  turnTimeoutMs: number;
  /** Layer 4: 不活跃超时 (ms), 默认 600_000 (10min) — 对接 SmartTimeout */
  inactivityTimeoutMs: number;
  /** Layer 4: 不活跃检查间隔 (ms), 默认 30_000 */
  inactivityCheckIntervalMs: number;
}

export interface TimeoutEvent {
  layer: 1 | 2 | 3 | 4;
  layerName: 'request' | 'step' | 'turn' | 'inactivity';
  reason: string;
  elapsedMs: number;
  context?: Record<string, unknown>;
}

export type TimeoutListener = (event: TimeoutEvent) => void;

export interface AbortHandle {
  signal: AbortSignal;
  cleanup: () => void;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  requestTimeoutMs: 120_000,
  streamingRequestTimeoutMs: 300_000,
  llmStepTimeoutMs: 180_000,
  toolStepTimeoutMs: 60_000,
  toolTimeoutOverrides: {},
  turnTimeoutMs: 15 * 60 * 1000,
  inactivityTimeoutMs: 10 * 60 * 1000,
  inactivityCheckIntervalMs: 30_000,
};

/**
 * 根据任务复杂度预估调整超时配置
 * 
 * @param complexity - 'simple' | 'moderate' | 'complex' | 'deep_research'
 * @param base - 基础配置
 * @returns 调整后的配置
 */
export function adjustTimeoutsForComplexity(
  complexity: 'simple' | 'moderate' | 'complex' | 'deep_research',
  base: TimeoutConfig = DEFAULT_TIMEOUT_CONFIG
): TimeoutConfig {
  const multipliers: Record<string, number> = {
    simple: 0.5,
    moderate: 1.0,
    complex: 2.0,
    deep_research: 4.0,
  };
  const m = multipliers[complexity] ?? 1.0;

  return {
    ...base,
    llmStepTimeoutMs: Math.round(base.llmStepTimeoutMs * m),
    toolStepTimeoutMs: Math.round(base.toolStepTimeoutMs * Math.max(m, 1)),
    turnTimeoutMs: Math.round(base.turnTimeoutMs * m),
    inactivityTimeoutMs: Math.round(base.inactivityTimeoutMs * Math.max(m, 1)),
  };
}

// ============================================================================
// Layer 1: Request Timeout (AbortController based)
// ============================================================================

/**
 * 为单次 HTTP 请求创建带超时的 AbortController
 * 
 * 替换原有 api.ts 中无超时的 fetch 调用:
 *   const res = await fetch(url, { ...init, signal: handle.signal });
 * 
 * @param timeoutMs - 超时时间
 * @param label - 用于日志的请求标签
 * @returns AbortHandle, 调用方需在 finally 中调 cleanup()
 */
export function createRequestTimeout(timeoutMs: number, label?: string): AbortHandle {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(
      `[TimeoutHierarchy:L1] Request timeout after ${timeoutMs}ms${label ? ` (${label})` : ''}`
    ));
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
    },
  };
}

/**
 * 包装 fetch 调用，自动注入超时 AbortController
 * 
 * 直接替换原有 api.ts 中的 fetch:
 *   // Before: const res = await fetch(url, init);
 *   // After:  const res = await fetchWithTimeout(url, init, 120_000);
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label?: string
): Promise<Response> {
  const handle = createRequestTimeout(timeoutMs, label ?? url);

  // 如果调用方已经传了 signal, 用 race 方式合并
  const combinedInit = mergeAbortSignals(init, handle.signal);

  try {
    const response = await fetch(url, combinedInit);
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new TimeoutError(
        `Request to ${label ?? url} timed out after ${timeoutMs}ms`,
        'request',
        timeoutMs
      );
    }
    throw error;
  } finally {
    handle.cleanup();
  }
}

/**
 * 合并两个 AbortSignal — 任一触发则 abort
 */
function mergeAbortSignals(init: RequestInit, timeoutSignal: AbortSignal): RequestInit {
  if (!init.signal) {
    return { ...init, signal: timeoutSignal };
  }

  // 如果环境支持 AbortSignal.any (Node 20+), 直接使用
  if (typeof AbortSignal !== 'undefined' && 'any' in AbortSignal) {
    return {
      ...init,
      signal: (AbortSignal as any).any([init.signal, timeoutSignal]),
    };
  }

  // Fallback: 手动合并
  const merged = new AbortController();
  const onAbort = () => merged.abort();
  init.signal.addEventListener('abort', onAbort);
  timeoutSignal.addEventListener('abort', onAbort);

  return { ...init, signal: merged.signal };
}

// ============================================================================
// Layer 2: Step Timeout (per-operation)
// ============================================================================

/**
 * 为单步操作（LLM 调用 / 工具执行）添加超时包装
 * 
 * 替换原有 index.ts 中的直接 await:
 *   // Before: const result = await this.toolExecutor(name, params);
 *   // After:  const result = await executeWithStepTimeout(
 *   //           () => this.toolExecutor(name, params), 60_000, 'tool:search');
 */
export async function executeWithStepTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  operationLabel: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new TimeoutError(
          `Step "${operationLabel}" timed out after ${timeoutMs}ms`,
          'step',
          timeoutMs,
          { operation: operationLabel }
        ));
      }
    }, timeoutMs);

    fn().then(
      (result) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(result);
        }
      },
      (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      }
    );
  });
}

/**
 * 获取特定工具的超时时间
 */
export function getToolTimeout(toolName: string, config: TimeoutConfig): number {
  // 优先使用工具级自定义超时
  if (config.toolTimeoutOverrides[toolName] !== undefined) {
    return config.toolTimeoutOverrides[toolName];
  }

  // 按工具类型分类设置默认超时
  if (toolName.startsWith('feishu_')) {
    return Math.max(config.toolStepTimeoutMs, 90_000); // 飞书 API 较慢，至少 90s
  }
  if (toolName.startsWith('mcp_')) {
    return Math.max(config.toolStepTimeoutMs, 120_000); // MCP 远程工具，至少 120s
  }
  if (toolName.includes('search') || toolName.includes('browse')) {
    return Math.max(config.toolStepTimeoutMs, 90_000); // 搜索/浏览类，至少 90s
  }

  return config.toolStepTimeoutMs;
}

// ============================================================================
// Layer 3: Turn Timeout (wall-clock deadline for entire chat() call)
// ============================================================================

/**
 * Turn 级别 deadline 管理器
 * 
 * 在 chat() 方法开始时创建, 每次循环迭代检查:
 *   const turnGuard = new TurnDeadlineGuard(config.turnTimeoutMs);
 *   while (iterations < maxToolIterations) {
 *     turnGuard.check(); // 超时时抛 TimeoutError
 *     ...
 *   }
 */
export class TurnDeadlineGuard {
  private readonly deadline: number;
  private readonly startTime: number;
  private readonly timeoutMs: number;
  private _aborted = false;
  private _abortReason: string | null = null;
  private readonly listeners: TimeoutListener[] = [];

  constructor(turnTimeoutMs: number) {
    this.startTime = Date.now();
    this.timeoutMs = turnTimeoutMs;
    this.deadline = this.startTime + turnTimeoutMs;
  }

  /** 检查是否已超时，超时则抛出 TimeoutError */
  check(context?: Record<string, unknown>): void {
    if (this._aborted) {
      throw new TimeoutError(
        `Turn aborted: ${this._abortReason}`,
        'turn',
        this.elapsedMs(),
        context
      );
    }

    if (Date.now() > this.deadline) {
      const event: TimeoutEvent = {
        layer: 3,
        layerName: 'turn',
        reason: `Turn exceeded ${this.timeoutMs}ms deadline`,
        elapsedMs: this.elapsedMs(),
        context,
      };
      this.notifyListeners(event);

      throw new TimeoutError(
        `Turn timeout: exceeded ${Math.round(this.timeoutMs / 1000)}s wall-clock limit`,
        'turn',
        this.elapsedMs(),
        context
      );
    }
  }

  /** 获取剩余时间 (ms) */
  remainingMs(): number {
    return Math.max(0, this.deadline - Date.now());
  }

  /** 获取已用时间 (ms) */
  elapsedMs(): number {
    return Date.now() - this.startTime;
  }

  /** 利用率 (0-1) */
  utilization(): number {
    return this.elapsedMs() / this.timeoutMs;
  }

  /** 是否接近超时（>80%） */
  isNearDeadline(threshold = 0.8): boolean {
    return this.utilization() >= threshold;
  }

  /** 外部主动中止（如用户取消） */
  abort(reason: string): void {
    this._aborted = true;
    this._abortReason = reason;
  }

  /** 获取剩余时间内可分配给子操作的超时值 */
  getAllowedStepTimeout(preferredMs: number): number {
    const remaining = this.remainingMs();
    // 预留 10% 给收尾逻辑
    const available = Math.floor(remaining * 0.9);
    return Math.min(preferredMs, Math.max(available, 5_000)); // 至少 5s
  }

  /** 注册超时监听器 */
  onTimeout(listener: TimeoutListener): void {
    this.listeners.push(listener);
  }

  private notifyListeners(event: TimeoutEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // listener 异常不影响超时处理
      }
    }
  }
}

// ============================================================================
// Layer 4: Inactivity Bridge (对接已有 SmartTimeout)
// ============================================================================

/**
 * 增强的活跃事件类型 — 扩展现有 ActivityMonitor
 */
export type EnhancedActivityType =
  | 'llm_call_start'
  | 'llm_call_end'
  | 'llm_chunk'
  | 'tool_call_start'
  | 'tool_call_end'
  | 'tool_result'
  | 'subagent_start'
  | 'subagent_end'
  | 'progress'
  | 'thinking'
  | 'checkpoint_saved'
  | 'user_input';

/**
 * SmartTimeout 桥接器
 * 
 * 在主循环的关键点调用 recordActivity(), 确保 SmartTimeout 感知到进展:
 *   bridge.recordActivity('llm_call_start', { model: 'gpt-4' });
 *   bridge.recordActivity('tool_call_end', { tool: 'search', elapsed: 1234 });
 */
export class InactivityBridge {
  private lastActivityTime = Date.now();
  private activityCallbacks: Array<(type: EnhancedActivityType, details?: Record<string, unknown>) => void> = [];

  /**
   * 注册到现有 SmartTimeout 的回调
   * 当有活跃事件时，同时通知所有注册的 SmartTimeout 实例
   */
  onActivity(callback: (type: EnhancedActivityType, details?: Record<string, unknown>) => void): void {
    this.activityCallbacks.push(callback);
  }

  /** 记录活跃事件 — 在 Agent 主循环的关键点调用 */
  recordActivity(type: EnhancedActivityType, details?: Record<string, unknown>): void {
    this.lastActivityTime = Date.now();
    for (const cb of this.activityCallbacks) {
      try {
        cb(type, details);
      } catch {
        // 回调异常不影响主流程
      }
    }
  }

  /** 获取最后活跃到现在的毫秒数 */
  getInactiveMs(): number {
    return Date.now() - this.lastActivityTime;
  }
}

// ============================================================================
// TimeoutOrchestrator — 统一编排四层超时
// ============================================================================

/**
 * 超时编排器 — 在每次 chat() 调用中创建一个实例
 * 
 * 用法:
 *   const orchestrator = new TimeoutOrchestrator(config);
 *   orchestrator.onTimeout((event) => { ... });
 *   orchestrator.start();
 *   
 *   // 在主循环中
 *   while (...) {
 *     orchestrator.checkTurn();                    // Layer 3
 *     orchestrator.recordActivity('llm_call_start'); // Layer 4
 *     
 *     const res = await orchestrator.wrapLLMCall(  // Layer 1+2
 *       () => callAI(params), { streaming }
 *     );
 *     
 *     const toolResult = await orchestrator.wrapToolCall( // Layer 1+2
 *       'search', () => executor('search', params)
 *     );
 *   }
 *   
 *   orchestrator.stop();
 */
export class TimeoutOrchestrator {
  private readonly config: TimeoutConfig;
  private readonly turnGuard: TurnDeadlineGuard;
  private readonly inactivityBridge: InactivityBridge;
  private readonly listeners: TimeoutListener[] = [];

  // Layer 4: Inactivity 检查定时器
  private inactivityTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<TimeoutConfig> = {}) {
    this.config = { ...DEFAULT_TIMEOUT_CONFIG, ...config };
    this.turnGuard = new TurnDeadlineGuard(this.config.turnTimeoutMs);
    this.inactivityBridge = new InactivityBridge();

    // 将 TurnGuard 的超时事件转发
    this.turnGuard.onTimeout((event) => this.notifyListeners(event));
  }

  /** 启动超时监控（包括 Layer 4 不活跃检测） */
  start(): void {
    this.inactivityBridge.recordActivity('progress', { message: 'orchestrator started' });

    // 启动 Layer 4 不活跃定时检查
    this.inactivityTimer = setInterval(() => {
      const inactiveMs = this.inactivityBridge.getInactiveMs();
      if (inactiveMs > this.config.inactivityTimeoutMs) {
        const event: TimeoutEvent = {
          layer: 4,
          layerName: 'inactivity',
          reason: `No activity for ${Math.round(inactiveMs / 1000)}s`,
          elapsedMs: this.turnGuard.elapsedMs(),
          context: { inactiveMs },
        };
        this.notifyListeners(event);
        this.turnGuard.abort(`Inactivity timeout: ${Math.round(inactiveMs / 1000)}s`);
      }
    }, this.config.inactivityCheckIntervalMs);
  }

  /** 停止所有超时监控 */
  stop(): void {
    if (this.inactivityTimer) {
      clearInterval(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }

  /** 注册超时事件监听器 */
  onTimeout(listener: TimeoutListener): void {
    this.listeners.push(listener);
  }

  // --- Layer 3: Turn 级别检查 ---

  /** 在主循环每次迭代开始时调用 */
  checkTurn(context?: Record<string, unknown>): void {
    this.turnGuard.check(context);
  }

  /** 获取 Turn 剩余时间 */
  turnRemainingMs(): number {
    return this.turnGuard.remainingMs();
  }

  /** Turn 利用率 */
  turnUtilization(): number {
    return this.turnGuard.utilization();
  }

  /** 是否接近 Turn 超时 */
  isNearTurnDeadline(threshold = 0.8): boolean {
    return this.turnGuard.isNearDeadline(threshold);
  }

  // --- Layer 4: 活跃事件记录 ---

  /** 记录活跃事件 — 在主循环的关键点调用 */
  recordActivity(type: EnhancedActivityType, details?: Record<string, unknown>): void {
    this.inactivityBridge.recordActivity(type, details);
  }

  /** 获取 InactivityBridge 实例 — 用于桥接到现有 SmartTimeout */
  getInactivityBridge(): InactivityBridge {
    return this.inactivityBridge;
  }

  // --- Layer 1+2: 包装 LLM 调用 ---

  /**
   * 包装 LLM 调用，自动添加 request timeout + step timeout
   * 
   * @param fn - 实际的 LLM 调用函数（应使用 orchestrator 提供的 signal）
   * @param options - 是否 streaming 等选项
   */
  async wrapLLMCall<T>(
    fn: (signal?: AbortSignal) => Promise<T>,
    options?: { streaming?: boolean; label?: string }
  ): Promise<T> {
    const isStreaming = options?.streaming ?? false;
    const label = options?.label ?? 'llm_call';

    // Step timeout: 取 turn 剩余和 step 配置的较小值
    const stepTimeout = this.turnGuard.getAllowedStepTimeout(this.config.llmStepTimeoutMs);
    // Request timeout
    const requestTimeout = isStreaming
      ? this.config.streamingRequestTimeoutMs
      : this.config.requestTimeoutMs;

    this.recordActivity('llm_call_start', { label, stepTimeout, requestTimeout });

    try {
      const result = await executeWithStepTimeout(
        () => {
          const handle = createRequestTimeout(Math.min(requestTimeout, stepTimeout), label);
          return fn(handle.signal).finally(() => handle.cleanup());
        },
        stepTimeout,
        label
      );

      this.recordActivity('llm_call_end', { label });
      return result;
    } catch (error) {
      this.recordActivity('llm_call_end', { label, error: (error as Error).message });
      throw error;
    }
  }

  // --- Layer 1+2: 包装工具调用 ---

  /**
   * 包装单次工具执行，自动添加 step timeout
   */
  async wrapToolCall<T>(
    toolName: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const toolTimeout = getToolTimeout(toolName, this.config);
    const stepTimeout = this.turnGuard.getAllowedStepTimeout(toolTimeout);

    this.recordActivity('tool_call_start', { tool: toolName, timeout: stepTimeout });

    try {
      const result = await executeWithStepTimeout(fn, stepTimeout, `tool:${toolName}`);
      this.recordActivity('tool_call_end', { tool: toolName });
      return result;
    } catch (error) {
      this.recordActivity('tool_call_end', {
        tool: toolName,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  // --- 获取当前状态快照 ---

  getStatus(): {
    turnElapsedMs: number;
    turnRemainingMs: number;
    turnUtilization: number;
    inactiveMs: number;
    config: TimeoutConfig;
  } {
    return {
      turnElapsedMs: this.turnGuard.elapsedMs(),
      turnRemainingMs: this.turnGuard.remainingMs(),
      turnUtilization: this.turnGuard.utilization(),
      inactiveMs: this.inactivityBridge.getInactiveMs(),
      config: { ...this.config },
    };
  }

  private notifyListeners(event: TimeoutEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 不影响主流程
      }
    }
  }
}

// ============================================================================
// TimeoutError — 统一超时错误类型
// ============================================================================

export class TimeoutError extends Error {
  readonly layer: 'request' | 'step' | 'turn' | 'inactivity';
  readonly timeoutMs: number;
  readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    layer: 'request' | 'step' | 'turn' | 'inactivity',
    timeoutMs: number,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'TimeoutError';
    this.layer = layer;
    this.timeoutMs = timeoutMs;
    this.context = context;
  }

  /** 该超时是否可重试 — request/step 层可重试, turn/inactivity 层不可 */
  get retryable(): boolean {
    return this.layer === 'request' || this.layer === 'step';
  }
}

// ============================================================================
// 便捷工厂函数
// ============================================================================

/**
 * 创建 TimeoutOrchestrator 并自动启动
 * 
 * 在 chat() 方法入口调用:
 *   const timeout = createTimeoutOrchestrator({ turnTimeoutMs: 600_000 });
 *   timeout.onTimeout((e) => logger.warn('Timeout event', e));
 *   try { ... } finally { timeout.stop(); }
 */
export function createTimeoutOrchestrator(
  config?: Partial<TimeoutConfig>
): TimeoutOrchestrator {
  const orchestrator = new TimeoutOrchestrator(config);
  orchestrator.start();
  return orchestrator;
}
