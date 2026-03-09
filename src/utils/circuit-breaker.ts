/**
 * BeeClaw Resilience Patch — 断路器 (Circuit Breaker)
 * 
 * 解决问题:
 *   - 工具持续失败时无熔断机制，继续无效调用浪费资源 (#3)
 *   - 缺乏 per-tool 的健康状态追踪
 * 
 * 设计:
 *   每个工具维护独立的断路器，状态机: CLOSED → OPEN → HALF_OPEN → CLOSED
 *   - CLOSED: 正常，允许调用
 *   - OPEN: 熔断，拒绝调用，等待冷却
 *   - HALF_OPEN: 冷却后允许一次探测调用
 * 
 * 集成方式: 在 createDefaultToolExecutor() 中包装每个工具调用
 */

// ============================================================================
// Types
// ============================================================================

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerConfig {
  /** 触发 OPEN 所需的连续失败次数 (默认 3) */
  failureThreshold: number;
  /** OPEN 状态冷却时间 (ms, 默认 60_000) */
  cooldownMs: number;
  /** HALF_OPEN 状态下的最大探测次数 (默认 1) */
  halfOpenMaxProbes: number;
  /** 成功调用后重置失败计数所需的连续成功次数 (默认 1) */
  successThreshold: number;
  /** 是否统计超时为失败 (默认 true) */
  countTimeoutAsFailure: boolean;
  /** 滑动窗口大小 (秒), 只统计窗口内的失败 (默认 300 = 5min) */
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

/** 针对不同类型工具的预设配置 */
export const CIRCUIT_BREAKER_PRESETS: Record<string, Partial<CircuitBreakerConfig>> = {
  /** AI Provider — 更宽容，冷却更长（可能是全局性问题） */
  ai_provider: {
    failureThreshold: 5,
    cooldownMs: 120_000,
    successThreshold: 2,
  },
  /** 飞书 API — 中等宽容度 */
  feishu: {
    failureThreshold: 3,
    cooldownMs: 60_000,
  },
  /** MCP 远程工具 — 较严格，远程服务不稳定时快速熔断 */
  mcp_tool: {
    failureThreshold: 2,
    cooldownMs: 90_000,
  },
  /** 本地工具 — 最宽容，本地失败通常是参数问题 */
  local_tool: {
    failureThreshold: 5,
    cooldownMs: 30_000,
  },
};

// ============================================================================
// CircuitBreaker 单个断路器
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

  /** 滑动窗口内的失败时间记录 */
  private failureTimestamps: number[] = [];

  private readonly listeners: CircuitBreakerListener[] = [];

  constructor(name: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.name = name;
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  }

  /**
   * 检查是否允许执行调用
   * 
   * @returns true 允许调用, false 被熔断拒绝
   */
  canExecute(): boolean {
    switch (this.state) {
      case 'closed':
        return true;

      case 'open': {
        // 检查冷却时间是否已过
        const elapsed = Date.now() - this.lastStateChange;
        if (elapsed >= this.config.cooldownMs) {
          this.transitionTo('half_open', 'Cooldown period elapsed');
          this.halfOpenProbes = 0;
          return true;
        }
        // 仍在冷却期，拒绝
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
        // 允许有限的探测
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
   * 记录一次成功调用
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
        // 正常状态，无需状态变更
        break;

      case 'open':
        // 理论上不会在 OPEN 状态收到成功（因为 canExecute 返回 false）
        // 但防御性处理
        this.transitionTo('closed', 'Unexpected success in open state');
        break;
    }
  }

  /**
   * 记录一次失败调用
   * 
   * @param error - 失败原因 (可选)
   * @param isTimeout - 是否超时 (可选)
   */
  recordFailure(error?: string, isTimeout = false): void {
    // 如果配置为不统计超时，且这是超时错误，则跳过
    if (isTimeout && !this.config.countTimeoutAsFailure) {
      return;
    }

    this.totalCalls++;
    this.totalFailures++;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = Date.now();
    this.failureTimestamps.push(Date.now());

    // 清理滑动窗口外的记录
    this.pruneFailureWindow();

    switch (this.state) {
      case 'closed': {
        // 检查滑动窗口内的失败次数
        const windowFailures = this.failureTimestamps.length;
        if (windowFailures >= this.config.failureThreshold) {
          this.transitionTo('open', 
            `${windowFailures} failures in ${this.config.windowSizeSeconds}s window (threshold: ${this.config.failureThreshold})` +
            (error ? `, last error: ${error}` : '')
          );
          this.openCount++;
        }
        break;
      }

      case 'half_open':
        // 探测失败，重新回到 OPEN
        this.transitionTo('open',
          `Probe failed${error ? `: ${error}` : ''}`
        );
        this.openCount++;
        break;

      case 'open':
        // 已经是 OPEN，无需变更
        break;
    }
  }

  /**
   * 手动重置断路器到 CLOSED 状态
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
   * 获取当前状态
   */
  getState(): CircuitState {
    // 需要检查 OPEN 是否已冷却
    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastStateChange;
      if (elapsed >= this.config.cooldownMs) {
        // 惰性转换到 half_open
        this.transitionTo('half_open', 'Cooldown elapsed (lazy check)');
        this.halfOpenProbes = 0;
      }
    }
    return this.state;
  }

  /**
   * 获取统计信息
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
   * 注册事件监听器
   */
  onEvent(listener: CircuitBreakerListener): void {
    this.listeners.push(listener);
  }

  /**
   * 获取冷却剩余时间 (OPEN 状态时有意义)
   */
  cooldownRemainingMs(): number {
    if (this.state !== 'open') return 0;
    const elapsed = Date.now() - this.lastStateChange;
    return Math.max(0, this.config.cooldownMs - elapsed);
  }

  // --- 内部方法 ---

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
        // 不影响主流程
      }
    }
  }
}

// ============================================================================
// CircuitBreakerRegistry — 管理多个工具的断路器
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
   * 注册工具的自定义断路器配置
   */
  registerToolConfig(toolNameOrPrefix: string, config: Partial<CircuitBreakerConfig>): void {
    this.toolConfigMapping.set(toolNameOrPrefix, config);
  }

  /**
   * 获取指定工具的断路器 (自动创建)
   */
  getBreaker(toolName: string): CircuitBreaker {
    let breaker = this.breakers.get(toolName);
    if (!breaker) {
      const config = this.resolveConfig(toolName);
      breaker = new CircuitBreaker(toolName, config);
      
      // 注册全局监听器
      for (const listener of this.globalListeners) {
        breaker.onEvent(listener);
      }

      this.breakers.set(toolName, breaker);
    }
    return breaker;
  }

  /**
   * 执行带断路器保护的调用
   * 
   * @throws CircuitOpenError 当断路器打开时
   */
  async execute<T>(
    toolName: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const breaker = this.getBreaker(toolName);

    if (!breaker.canExecute()) {
      const stats = breaker.getStats();
      throw new CircuitOpenError(
        toolName,
        breaker.cooldownRemainingMs(),
        `Circuit breaker for "${toolName}" is ${stats.state}. ` +
        `${stats.consecutiveFailures} consecutive failures, ` +
        `cooldown: ${Math.round(breaker.cooldownRemainingMs() / 1000)}s remaining`
      );
    }

    try {
      const result = await fn();
      breaker.recordSuccess();
      return result;
    } catch (error) {
      const isTimeout = error instanceof Error && (
        error.name === 'TimeoutError' ||
        error.message.toLowerCase().includes('timeout')
      );
      breaker.recordFailure(
        error instanceof Error ? error.message : String(error),
        isTimeout
      );
      throw error;
    }
  }

  /**
   * 注册全局事件监听器 (所有断路器的事件都会触发)
   */
  onEvent(listener: CircuitBreakerListener): void {
    this.globalListeners.push(listener);
    // 为已有的 breaker 也注册
    for (const breaker of this.breakers.values()) {
      breaker.onEvent(listener);
    }
  }

  /**
   * 获取所有断路器的 Map（用于 ParallelToolExecutor）
   */
  getAllBreakers(): Map<string, CircuitBreaker> {
    return new Map(this.breakers);
  }

  /**
   * 获取所有断路器的状态快照
   */
  getAllStats(): Record<string, CircuitBreakerStats> {
    const result: Record<string, CircuitBreakerStats> = {};
    for (const [name, breaker] of this.breakers) {
      result[name] = breaker.getStats();
    }
    return result;
  }

  /**
   * 获取当前处于 OPEN 状态的断路器列表
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
   * 重置所有断路器
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  /**
   * 获取健康摘要
   */
  getHealthSummary(): {
    total: number;
    closed: number;
    open: number;
    halfOpen: number;
    healthy: boolean;
  } {
    let closed = 0, open = 0, halfOpen = 0;
    for (const breaker of this.breakers.values()) {
      switch (breaker.getState()) {
        case 'closed': closed++; break;
        case 'open': open++; break;
        case 'half_open': halfOpen++; break;
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

  // --- 内部方法 ---

  private resolveConfig(toolName: string): Partial<CircuitBreakerConfig> {
    // 1. 精确匹配
    const exact = this.toolConfigMapping.get(toolName);
    if (exact) return { ...this.defaultConfig, ...exact };

    // 2. 前缀匹配 (如 feishu_ → feishu preset)
    for (const [prefix, config] of this.toolConfigMapping) {
      if (toolName.startsWith(prefix)) {
        return { ...this.defaultConfig, ...config };
      }
    }

    // 3. 内置前缀预设
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

  /** 断路器拒绝的调用不应重试 — 应等待冷却 */
  get retryable(): boolean {
    return false;
  }
}

// ============================================================================
// 便捷工厂函数
// ============================================================================

let defaultRegistry: CircuitBreakerRegistry | null = null;

/**
 * 获取全局 CircuitBreakerRegistry 单例
 * 
 * 用法:
 *   const registry = getCircuitBreakerRegistry();
 *   
 *   // 在工具执行时
 *   try {
 *     const result = await registry.execute('search', () => executor('search', params));
 *   } catch (error) {
 *     if (error instanceof CircuitOpenError) {
 *       // 断路器打开，通知 LLM 该工具暂时不可用
 *       return { success: false, error: `Tool "${error.toolName}" is temporarily unavailable` };
 *     }
 *     throw error;
 *   }
 */
export function getCircuitBreakerRegistry(
  config?: Partial<CircuitBreakerConfig>
): CircuitBreakerRegistry {
  if (!defaultRegistry || config) {
    defaultRegistry = new CircuitBreakerRegistry(config);
    // 注册常用工具预设
    defaultRegistry.registerToolConfig('feishu_', CIRCUIT_BREAKER_PRESETS.feishu);
    defaultRegistry.registerToolConfig('mcp_', CIRCUIT_BREAKER_PRESETS.mcp_tool);
  }
  return defaultRegistry;
}
