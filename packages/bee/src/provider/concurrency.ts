/**
 * bee — LLM Concurrency Limiter (Semaphore-based).
 *
 * Limits concurrent LLM API calls with priority queue and timeout.
 * Extracted from beeclaw's src/infra/ai/concurrency-limiter.ts.
 *
 * Changes from beeclaw:
 * - Removed singleton factory (getLLMConcurrencyLimiter)
 * - Uses bee's getLogger() instead of direct logger import
 */

import { getLogger } from '../core/logger';

// ============================================================================
// Types
// ============================================================================

/** Request priority — lower number = higher priority */
export enum LLMRequestPriority {
  /** User real-time interaction (Agent.chat main loop) */
  CRITICAL = 0,
  /** Standard tasks (skill matching, intent recognition) */
  HIGH = 1,
  /** Background tasks (compression, extraction, deep research) */
  NORMAL = 2,
  /** Low priority (cost tracking, warm-up) */
  LOW = 3,
}

export interface ConcurrencyLimiterOptions {
  /** Max concurrent requests (default 2) */
  maxConcurrent: number;
  /** Max queue depth (default 50), rejects when full */
  maxQueueSize: number;
  /** Queue wait timeout in ms (default 30000) */
  queueTimeoutMs: number;
  /** Enable priority queue (default true) */
  enablePriority: boolean;
}

export interface AcquireOptions {
  /** Request priority */
  priority?: LLMRequestPriority;
  /** Custom timeout (overrides default) */
  timeoutMs?: number;
  /** Caller identifier (for logging/metrics) */
  caller?: string;
}

export interface ConcurrencyStats {
  activeCount: number;
  queueSize: number;
  maxConcurrent: number;
  totalRequests: number;
  immediateAcquires: number;
  queuedAcquires: number;
  timeoutRejects: number;
  queueFullRejects: number;
  avgWaitTimeMs: number;
  maxWaitTimeMs: number;
}

/** Internal queue entry */
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
  private waitTimes: number[] = [];
  private maxWaitTimeMs: number = 0;

  constructor(options?: Partial<ConcurrencyLimiterOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Acquire a concurrency permit.
   *
   * - If active < maxConcurrent, returns immediately
   * - Otherwise queues and waits
   * - Caller **must** call the returned release function when done
   *
   * @throws on queue full or timeout
   */
  async acquire(options?: AcquireOptions): Promise<() => void> {
    const priority = options?.priority ?? LLMRequestPriority.NORMAL;
    const timeoutMs = options?.timeoutMs ?? this.options.queueTimeoutMs;
    const caller = options?.caller ?? 'unknown';

    this.totalRequests++;

    // Fast path: slot available
    if (this.activeCount < this.options.maxConcurrent) {
      this.activeCount++;
      this.immediateAcquires++;
      return this.createRelease(caller);
    }

    // Queue full
    if (this.queue.length >= this.options.maxQueueSize) {
      this.queueFullRejects++;
      throw new Error(
        `[ConcurrencyLimiter] Queue full (${this.queue.length}/${this.options.maxQueueSize}). ` +
          `Caller: ${caller}. Active: ${this.activeCount}/${this.options.maxConcurrent}.`,
      );
    }

    // Queue the request
    return new Promise<() => void>((resolve, reject) => {
      const entry: QueueEntry = {
        resolve: () => {
          this.activeCount++;
          this.queuedAcquires++;
          const waitTime = Date.now() - entry.enqueuedAt;
          this.recordWaitTime(waitTime);
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

      // Set timeout
      if (timeoutMs > 0) {
        entry.timeoutId = setTimeout(() => {
          const idx = this.queue.indexOf(entry);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
            this.timeoutRejects++;
            const waitTime = Date.now() - entry.enqueuedAt;
            entry.reject(
              new Error(
                `[ConcurrencyLimiter] Queue timeout after ${waitTime}ms. ` +
                  `Caller: ${caller}. Queue size: ${this.queue.length}.`,
              ),
            );
          }
        }, timeoutMs);
      }

      // Insert into queue (priority-ordered if enabled)
      if (this.options.enablePriority) {
        this.insertByPriority(entry);
      } else {
        this.queue.push(entry);
      }
    });
  }

  /**
   * Execute a function with automatic acquire/release lifecycle.
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
   * Get current statistics.
   */
  getStats(): ConcurrencyStats {
    const avgWaitTimeMs =
      this.waitTimes.length > 0
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
   * Dynamically update max concurrent.
   */
  updateMaxConcurrent(newMax: number): void {
    const oldMax = this.options.maxConcurrent;
    this.options.maxConcurrent = Math.max(1, newMax);

    if (newMax > oldMax) {
      this.drainQueue();
    }
  }

  /**
   * Reset statistics counters.
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
   * Clear queue and reject all pending requests (for graceful shutdown).
   */
  drain(): void {
    const pending = this.queue.splice(0);
    for (const entry of pending) {
      if (entry.timeoutId) clearTimeout(entry.timeoutId);
      entry.reject(new Error('[ConcurrencyLimiter] Draining: all pending requests rejected'));
    }
  }

  // --- Internal ---

  private createRelease(caller: string): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeCount--;
      this.drainQueue();
    };
  }

  private drainQueue(): void {
    while (this.activeCount < this.options.maxConcurrent && this.queue.length > 0) {
      const entry = this.queue.shift()!;
      if (entry.timeoutId) clearTimeout(entry.timeoutId);
      entry.resolve();
    }
  }

  private insertByPriority(entry: QueueEntry): void {
    let insertIdx = this.queue.length;
    for (let i = 0; i < this.queue.length; i++) {
      if (this.queue[i].priority > entry.priority) {
        insertIdx = i;
        break;
      }
    }
    this.queue.splice(insertIdx, 0, entry);
  }

  private recordWaitTime(ms: number): void {
    this.waitTimes.push(ms);
    if (ms > this.maxWaitTimeMs) {
      this.maxWaitTimeMs = ms;
    }
    if (this.waitTimes.length > 1000) {
      this.waitTimes = this.waitTimes.slice(-1000);
    }
  }
}
