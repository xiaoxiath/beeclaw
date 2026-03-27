/**
 * LLM Concurrency Limiter (Semaphore-based)
 *
 * 解决问题：
 *   LLM API 接口有严格的并发限制（默认 2），当多个模块同时发起 LLM 调用时
 *   （Agent.chat、FastLLMJudge、Session 压缩、Deep Research 等），
 *   会超出并发限制导致 429 错误。
 *
 * 设计思路：
 *   - 基于 Semaphore（信号量）模式实现，所有 LLM 调用必须先获取许可
 *   - 超出并发上限的调用进入 FIFO 队列等待
 *   - 支持优先级队列：高优先级任务（如用户交互）可插队
 *   - 支持超时机制：避免队列中的请求无限等待
 *   - 提供可观测性：队列深度、等待时间、利用率等指标
 *
 * 集成方式：
 *   在 callAI / streamAI 入口层透明接入，所有调用方无需改动。
 *
 * 配置方式：
 *   - 环境变量：BEECLAW_LLM_MAX_CONCURRENCY（默认 2）
 *   - 配置文件：llmRouter.concurrency.maxConcurrent
 */

import { logger } from '../observability/logger';

// ============================================================================
// Types
// ============================================================================

/** 请求优先级 —— 数值越小优先级越高 */
export enum LLMRequestPriority {
  /** 用户实时交互（Agent.chat 主流程） */
  CRITICAL = 0,
  /** 标准任务（skill matching, intent recognition） */
  HIGH = 1,
  /** 后台任务（压缩、提取、deep research） */
  NORMAL = 2,
  /** 低优先级（成本跟踪、预热等） */
  LOW = 3,
}

export interface ConcurrencyLimiterOptions {
  /** 最大并发数（默认 2） */
  maxConcurrent: number;
  /** 队列最大深度（默认 50），超出后直接拒绝 */
  maxQueueSize: number;
  /** 队列等待超时（毫秒，默认 30000） */
  queueTimeoutMs: number;
  /** 是否启用优先级队列（默认 true） */
  enablePriority: boolean;
}

export interface AcquireOptions {
  /** 请求优先级 */
  priority?: LLMRequestPriority;
  /** 自定义超时（覆盖默认值） */
  timeoutMs?: number;
  /** 调用方标识（用于日志/metrics） */
  caller?: string;
}

export interface ConcurrencyStats {
  /** 当前活跃的并发请求数 */
  activeCount: number;
  /** 当前排队等待的请求数 */
  queueSize: number;
  /** 最大并发上限 */
  maxConcurrent: number;
  /** 总请求数 */
  totalRequests: number;
  /** 直接获得许可的请求数（无需排队） */
  immediateAcquires: number;
  /** 排队后获得许可的请求数 */
  queuedAcquires: number;
  /** 超时被拒绝的请求数 */
  timeoutRejects: number;
  /** 队列满被拒绝的请求数 */
  queueFullRejects: number;
  /** 平均排队等待时间（毫秒） */
  avgWaitTimeMs: number;
  /** 最大排队等待时间（毫秒） */
  maxWaitTimeMs: number;
}

/** 内部队列条目 */
interface QueueEntry {
  resolve: () => void;
  reject: (error: Error) => void;
  priority: LLMRequestPriority;
  caller: string;
  enqueuedAt: number;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_OPTIONS: ConcurrencyLimiterOptions = {
  maxConcurrent: 2,
  maxQueueSize: 50,
  queueTimeoutMs: 30_000,
  enablePriority: true,
};

// ============================================================================
// ConcurrencyLimiter
// ============================================================================

export class ConcurrencyLimiter {
  private options: ConcurrencyLimiterOptions;
  private activeCount: number = 0;
  private queue: QueueEntry[] = [];

  // Stats
  private totalRequests: number = 0;
  private immediateAcquires: number = 0;
  private queuedAcquires: number = 0;
  private timeoutRejects: number = 0;
  private queueFullRejects: number = 0;
  private waitTimes: number[] = [];  // 保留最近 1000 条用于计算平均值
  private maxWaitTimeMs: number = 0;

  constructor(options?: Partial<ConcurrencyLimiterOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    logger.info('[ConcurrencyLimiter] Initialized', {
      maxConcurrent: this.options.maxConcurrent,
      maxQueueSize: this.options.maxQueueSize,
      queueTimeoutMs: this.options.queueTimeoutMs,
      enablePriority: this.options.enablePriority,
    });
  }

  /**
   * 获取并发许可。
   *
   * - 如果当前活跃数 < maxConcurrent，立即返回
   * - 否则进入队列等待
   * - 返回 release 函数，调用方**必须**在 LLM 调用完成后调用
   *
   * @throws {Error} 队列满或等待超时时抛出
   */
  async acquire(options?: AcquireOptions): Promise<() => void> {
    const priority = options?.priority ?? LLMRequestPriority.NORMAL;
    const timeoutMs = options?.timeoutMs ?? this.options.queueTimeoutMs;
    const caller = options?.caller ?? 'unknown';

    this.totalRequests++;

    // Fast path: 有空位直接获取
    if (this.activeCount < this.options.maxConcurrent) {
      this.activeCount++;
      this.immediateAcquires++;
      logger.debug(`[ConcurrencyLimiter] Acquired immediately`, {
        caller,
        active: this.activeCount,
        max: this.options.maxConcurrent,
      });
      return this.createRelease(caller);
    }

    // 队列满则拒绝
    if (this.queue.length >= this.options.maxQueueSize) {
      this.queueFullRejects++;
      const err = new Error(
        `[ConcurrencyLimiter] Queue full (${this.queue.length}/${this.options.maxQueueSize}). ` +
        `Caller: ${caller}. Active: ${this.activeCount}/${this.options.maxConcurrent}.`
      );
      logger.warn(err.message);
      throw err;
    }

    // 进入队列等待
    logger.debug(`[ConcurrencyLimiter] Queuing request`, {
      caller,
      priority,
      queueSize: this.queue.length,
      active: this.activeCount,
    });

    return new Promise<() => void>((resolve, reject) => {
      const entry: QueueEntry = {
        resolve: () => {
          this.activeCount++;
          this.queuedAcquires++;
          const waitTime = Date.now() - entry.enqueuedAt;
          this.recordWaitTime(waitTime);
          logger.debug(`[ConcurrencyLimiter] Acquired after waiting ${waitTime}ms`, {
            caller,
            active: this.activeCount,
          });
          resolve(this.createRelease(caller));
        },
        reject: (error: Error) => {
          reject(error);
        },
        priority,
        caller,
        enqueuedAt: Date.now(),
        timeoutId: null,
      };

      // 设置超时
      if (timeoutMs > 0) {
        entry.timeoutId = setTimeout(() => {
          // 从队列中移除
          const idx = this.queue.indexOf(entry);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
            this.timeoutRejects++;
            const waitTime = Date.now() - entry.enqueuedAt;
            logger.warn(`[ConcurrencyLimiter] Queue timeout after ${waitTime}ms`, {
              caller,
              priority,
              queueSize: this.queue.length,
            });
            entry.reject(new Error(
              `[ConcurrencyLimiter] Queue timeout after ${waitTime}ms. ` +
              `Caller: ${caller}. Queue size: ${this.queue.length}.`
            ));
          }
        }, timeoutMs);
      }

      // 插入队列（按优先级排序）
      if (this.options.enablePriority) {
        this.insertByPriority(entry);
      } else {
        this.queue.push(entry);
      }
    });
  }

  /**
   * 执行带并发控制的函数。自动管理 acquire/release 生命周期。
   */
  async execute<T>(fn: () => Promise<T>, options?: AcquireOptions): Promise<T> {
    const release = await this.acquire(options);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * 获取当前状态统计
   */
  getStats(): ConcurrencyStats {
    const avgWaitTimeMs = this.waitTimes.length > 0
      ? this.waitTimes.reduce((a, b) => a + b, 0) / this.waitTimes.length
      : 0;

    return {
      activeCount: this.activeCount,
      queueSize: this.queue.length,
      maxConcurrent: this.options.maxConcurrent,
      totalRequests: this.totalRequests,
      immediateAcquires: this.immediateAcquires,
      queuedAcquires: this.queuedAcquires,
      timeoutRejects: this.timeoutRejects,
      queueFullRejects: this.queueFullRejects,
      avgWaitTimeMs: Math.round(avgWaitTimeMs),
      maxWaitTimeMs: this.maxWaitTimeMs,
    };
  }

  /**
   * 动态更新最大并发数
   */
  updateMaxConcurrent(newMax: number): void {
    const oldMax = this.options.maxConcurrent;
    this.options.maxConcurrent = Math.max(1, newMax);
    logger.info(`[ConcurrencyLimiter] Max concurrency updated: ${oldMax} -> ${this.options.maxConcurrent}`);

    // 如果增大了并发数，尝试释放队列中的等待者
    if (newMax > oldMax) {
      this.drainQueue();
    }
  }

  /**
   * 重置统计计数器
   */
  resetStats(): void {
    this.totalRequests = 0;
    this.immediateAcquires = 0;
    this.queuedAcquires = 0;
    this.timeoutRejects = 0;
    this.queueFullRejects = 0;
    this.waitTimes = [];
    this.maxWaitTimeMs = 0;
  }

  /**
   * 清空队列并拒绝所有等待中的请求（用于 graceful shutdown）
   */
  drain(): void {
    const pending = this.queue.splice(0);
    for (const entry of pending) {
      if (entry.timeoutId) clearTimeout(entry.timeoutId);
      entry.reject(new Error('[ConcurrencyLimiter] Draining: all pending requests rejected'));
    }
    logger.info(`[ConcurrencyLimiter] Drained ${pending.length} pending requests`);
  }

  // ---- Internal Methods ----

  /** 创建 release 函数 */
  private createRelease(caller: string): () => void {
    let released = false;
    return () => {
      if (released) return; // 防止重复释放
      released = true;
      this.activeCount--;
      logger.debug(`[ConcurrencyLimiter] Released`, {
        caller,
        active: this.activeCount,
        queued: this.queue.length,
      });
      this.drainQueue();
    };
  }

  /** 尝试从队列中取出等待者并分配许可 */
  private drainQueue(): void {
    while (this.activeCount < this.options.maxConcurrent && this.queue.length > 0) {
      const entry = this.queue.shift()!;
      if (entry.timeoutId) clearTimeout(entry.timeoutId);
      entry.resolve();
    }
  }

  /** 按优先级插入队列（优先级高的排在前面） */
  private insertByPriority(entry: QueueEntry): void {
    // 找到第一个优先级数值更大（优先级更低）的位置
    let insertIdx = this.queue.length; // 默认插入末尾
    for (let i = 0; i < this.queue.length; i++) {
      if (this.queue[i].priority > entry.priority) {
        insertIdx = i;
        break;
      }
    }
    this.queue.splice(insertIdx, 0, entry);
  }

  /** 记录等待时间 */
  private recordWaitTime(ms: number): void {
    this.waitTimes.push(ms);
    if (ms > this.maxWaitTimeMs) {
      this.maxWaitTimeMs = ms;
    }
    // 保留最近 1000 条
    if (this.waitTimes.length > 1000) {
      this.waitTimes = this.waitTimes.slice(-1000);
    }
  }
}

// ============================================================================
// Singleton Factory
// ============================================================================

let defaultLimiter: ConcurrencyLimiter | null = null;

/**
 * 获取全局 LLM 并发限制器实例
 *
 * 配置来源（优先级从高到低）：
 * 1. 显式传入的 options
 * 2. 环境变量 BEECLAW_LLM_MAX_CONCURRENCY
 * 3. 默认值 2
 */
export function getLLMConcurrencyLimiter(options?: Partial<ConcurrencyLimiterOptions>): ConcurrencyLimiter {
  if (!defaultLimiter || options) {
    const envMax = process.env.BEECLAW_LLM_MAX_CONCURRENCY
      ? parseInt(process.env.BEECLAW_LLM_MAX_CONCURRENCY, 10)
      : undefined;

    const mergedOptions: Partial<ConcurrencyLimiterOptions> = {
      ...(envMax ? { maxConcurrent: envMax } : {}),
      ...options,
    };

    defaultLimiter = new ConcurrencyLimiter(mergedOptions);
  }
  return defaultLimiter;
}

/**
 * 重置全局实例（用于测试）
 */
export function resetLLMConcurrencyLimiter(): void {
  if (defaultLimiter) {
    defaultLimiter.drain();
  }
  defaultLimiter = null;
}
