/**
 * Per-Session Message Queue — Bug #1 Fix (Concurrency Control)
 *
 * Ensures messages within the same session are processed sequentially (FIFO),
 * while different sessions can be processed concurrently.
 *
 * Problem: Original code had no concurrency control on sendProactiveMessage().
 * Two messages arriving close together for the same session would both read
 * the same conversation history, producing duplicate/conflicting AI responses.
 *
 * Solution: Per-session FIFO queue with configurable depth and timeout.
 *
 * IMPORTANT: maxWaitTime should be >= turn timeout from resilience config
 * to prevent messages from expiring while the agent is processing a long task.
 */

interface QueueEntry<T = unknown> {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  enqueueTime: number;
}

export interface SessionMessageQueueOptions {
  /** Maximum queued messages per session (default: 10) */
  maxQueueDepth?: number;
  /** Maximum wait time in ms before dropping a queued message (default: 5 minutes) */
  maxWaitTime?: number;
}

const DEFAULT_MAX_QUEUE_DEPTH = 10;
const DEFAULT_MAX_WAIT_TIME = 10 * 60 * 1000; // 10 minutes (must be >= turn timeout)

export class SessionMessageQueue {
  private queues = new Map<string, QueueEntry[]>();
  private processing = new Set<string>();
  private maxQueueDepth: number;
  private maxWaitTime: number;

  // Singleton
  private static instance: SessionMessageQueue | null = null;

  static getInstance(options?: SessionMessageQueueOptions): SessionMessageQueue {
    if (!SessionMessageQueue.instance) {
      SessionMessageQueue.instance = new SessionMessageQueue(options);
    }
    return SessionMessageQueue.instance;
  }

  static resetInstance(): void {
    SessionMessageQueue.instance = null;
  }

  constructor(options?: SessionMessageQueueOptions) {
    this.maxQueueDepth = options?.maxQueueDepth ?? DEFAULT_MAX_QUEUE_DEPTH;
    this.maxWaitTime = options?.maxWaitTime ?? DEFAULT_MAX_WAIT_TIME;
  }

  /**
   * Enqueue a task for a specific session.
   * Tasks for the same session run sequentially; different sessions run concurrently.
   */
  async enqueue<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const queue = this.queues.get(sessionId) || [];
    if (queue.length >= this.maxQueueDepth) {
      throw new Error(
        `[SessionQueue] Session ${sessionId} queue full (${this.maxQueueDepth}). Message dropped.`
      );
    }

    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry<T> = {
        task,
        resolve: resolve as (value: unknown) => void,
        reject,
        enqueueTime: Date.now(),
      };

      if (!this.queues.has(sessionId)) {
        this.queues.set(sessionId, []);
      }
      this.queues.get(sessionId)!.push(entry as QueueEntry);

      if (!this.processing.has(sessionId)) {
        this.processQueue(sessionId);
      }
    });
  }

  private async processQueue(sessionId: string): Promise<void> {
    if (this.processing.has(sessionId)) return;
    this.processing.add(sessionId);

    try {
      while (true) {
        const queue = this.queues.get(sessionId);
        if (!queue || queue.length === 0) break;

        const entry = queue.shift()!;
        const waitTime = Date.now() - entry.enqueueTime;
        if (waitTime > this.maxWaitTime) {
          entry.reject(
            new Error(`[SessionQueue] Message expired after ${Math.round(waitTime / 1000)}s wait.`)
          );
          continue;
        }

        try {
          const result = await entry.task();
          entry.resolve(result);
        } catch (error) {
          entry.reject(error);
        }
      }
    } finally {
      this.processing.delete(sessionId);
      const queue = this.queues.get(sessionId);
      if (queue && queue.length === 0) {
        this.queues.delete(sessionId);
      }
    }
  }

  hasActiveTasks(): boolean {
    return this.processing.size > 0 || this.activeTaskCount() > 0;
  }

  activeTaskCount(): number {
    let count = this.processing.size;
    for (const queue of this.queues.values()) {
      count += queue.length;
    }
    return count;
  }

  async drainAll(timeoutMs: number = 30_000): Promise<void> {
    for (const [_sessionId, queue] of this.queues.entries()) {
      for (const entry of queue) {
        entry.reject(new Error('[SessionQueue] Shutting down — message dropped.'));
      }
      queue.length = 0;
    }

    const deadline = Date.now() + timeoutMs;
    while (this.processing.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    if (this.processing.size > 0) {
      console.warn(
        `[SessionQueue] Shutdown timeout: ${this.processing.size} sessions still processing.`
      );
    }
  }
}
