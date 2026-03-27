/**
 * ConcurrencyLimiter 单元测试 (vitest)
 *
 * 覆盖场景：
 * 1. 基础 acquire/release（立即获取、排队等待、release 唤醒）
 * 2. 优先级调度（高优先级插队、同级 FIFO、关闭优先级）
 * 3. 超时机制（队列超时拒绝、不影响其他请求）
 * 4. 队列满拒绝（超出 maxQueueSize 立即拒绝）
 * 5. execute 便捷方法（自动生命周期、异常释放、顺序执行）
 * 6. 动态配置（运行时调整、最小值兜底）
 * 7. drain 清理（拒绝所有排队请求）
 * 8. 防重复释放（double-free 安全）
 * 9. 统计准确性（计数器正确、stats 重置）
 * 10. 高并发压力（20 并发无死锁、50 并发不超限）
 * 11. Singleton 工厂（实例复用、环境变量、默认值）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ConcurrencyLimiter,
  LLMRequestPriority,
  getLLMConcurrencyLimiter,
  resetLLMConcurrencyLimiter,
} from '../concurrency-limiter';

// Helper: wait for a short time
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('ConcurrencyLimiter', () => {
  let limiter: ConcurrencyLimiter;

  beforeEach(() => {
    limiter = new ConcurrencyLimiter({ maxConcurrent: 2, maxQueueSize: 10, queueTimeoutMs: 30000 });
  });

  afterEach(() => {
    limiter.drain();
  });

  // ==========================================================================
  // 1. 基础功能
  // ==========================================================================

  describe('Basic Acquire/Release', () => {
    it('should acquire immediately when below max concurrency', async () => {
      const release1 = await limiter.acquire({ caller: 'test1' });
      const release2 = await limiter.acquire({ caller: 'test2' });

      const stats = limiter.getStats();
      expect(stats.activeCount).toBe(2);
      expect(stats.immediateAcquires).toBe(2);
      expect(stats.queueSize).toBe(0);

      release1();
      release2();
    });

    it('should queue when at max concurrency and release wakes waiter', async () => {
      const release1 = await limiter.acquire({ caller: 'slot1' });
      const release2 = await limiter.acquire({ caller: 'slot2' });

      // This one should be queued
      let acquired3 = false;
      const acquire3Promise = limiter.acquire({ caller: 'queued1' }).then(rel => {
        acquired3 = true;
        return rel;
      });

      await delay(10);

      expect(limiter.getStats().queueSize).toBe(1);
      expect(acquired3).toBe(false);

      // Release one slot
      release1();

      const release3 = await acquire3Promise;
      expect(acquired3).toBe(true);
      expect(limiter.getStats().activeCount).toBe(2);
      expect(limiter.getStats().queuedAcquires).toBe(1);

      release2();
      release3();
    });

    it('should track totalRequests correctly', async () => {
      const release1 = await limiter.acquire();
      const release2 = await limiter.acquire();
      release1();
      release2();

      const release3 = await limiter.acquire();
      release3();

      expect(limiter.getStats().totalRequests).toBe(3);
    });
  });

  // ==========================================================================
  // 2. 优先级调度
  // ==========================================================================

  describe('Priority Scheduling', () => {
    it('should serve higher priority requests before lower priority ones', async () => {
      // Use a single-slot limiter for deterministic ordering
      const priorityLimiter = new ConcurrencyLimiter({
        maxConcurrent: 1,
        maxQueueSize: 10,
        queueTimeoutMs: 30000,
      });

      const release1 = await priorityLimiter.acquire({ caller: 'slot1' });

      // Queue requests with different priorities (all go to the same queue)
      const order: string[] = [];

      const lowPromise = priorityLimiter.acquire({
        priority: LLMRequestPriority.LOW,
        caller: 'low',
      }).then(rel => { order.push('low'); return rel; });

      await delay(5);

      const criticalPromise = priorityLimiter.acquire({
        priority: LLMRequestPriority.CRITICAL,
        caller: 'critical',
      }).then(rel => { order.push('critical'); return rel; });

      await delay(5);

      const normalPromise = priorityLimiter.acquire({
        priority: LLMRequestPriority.NORMAL,
        caller: 'normal',
      }).then(rel => { order.push('normal'); return rel; });

      await delay(10);
      expect(priorityLimiter.getStats().queueSize).toBe(3);

      // Release slot one at a time
      release1();

      const relCritical = await criticalPromise;
      expect(order[0]).toBe('critical');
      relCritical();

      const relNormal = await normalPromise;
      expect(order[1]).toBe('normal');
      relNormal();

      const relLow = await lowPromise;
      expect(order[2]).toBe('low');
      relLow();

      expect(order).toEqual(['critical', 'normal', 'low']);
      priorityLimiter.drain();
    });

    it('should maintain FIFO within same priority level', async () => {
      const fifoLimiter = new ConcurrencyLimiter({
        maxConcurrent: 1,
        maxQueueSize: 10,
        queueTimeoutMs: 30000,
      });

      const release1 = await fifoLimiter.acquire({ caller: 'slot1' });

      const order: string[] = [];

      const p1 = fifoLimiter.acquire({
        priority: LLMRequestPriority.NORMAL,
        caller: 'first',
      }).then(rel => { order.push('first'); return rel; });

      await delay(5);

      const p2 = fifoLimiter.acquire({
        priority: LLMRequestPriority.NORMAL,
        caller: 'second',
      }).then(rel => { order.push('second'); return rel; });

      await delay(5);

      const p3 = fifoLimiter.acquire({
        priority: LLMRequestPriority.NORMAL,
        caller: 'third',
      }).then(rel => { order.push('third'); return rel; });

      await delay(10);

      // Release sequentially
      release1();
      const r1 = await p1;
      r1();
      const r2 = await p2;
      r2();
      const r3 = await p3;
      r3();

      expect(order).toEqual(['first', 'second', 'third']);
      fifoLimiter.drain();
    });

    it('should work as FIFO when priority is disabled', async () => {
      const fifoLimiter = new ConcurrencyLimiter({
        maxConcurrent: 1,
        maxQueueSize: 10,
        queueTimeoutMs: 30000,
        enablePriority: false,
      });

      const release1 = await fifoLimiter.acquire({ caller: 'slot1' });

      const order: string[] = [];

      const pLow = fifoLimiter.acquire({
        priority: LLMRequestPriority.LOW,
        caller: 'low',
      }).then(rel => { order.push('low'); return rel; });

      await delay(5);

      const pCritical = fifoLimiter.acquire({
        priority: LLMRequestPriority.CRITICAL,
        caller: 'critical',
      }).then(rel => { order.push('critical'); return rel; });

      await delay(10);
      release1();

      const relLow = await pLow;
      relLow();
      const relCritical = await pCritical;
      relCritical();

      // Without priority, FIFO: low was queued first
      expect(order[0]).toBe('low');
      expect(order[1]).toBe('critical');

      fifoLimiter.drain();
    });
  });

  // ==========================================================================
  // 3. 超时机制
  // ==========================================================================

  describe('Queue Timeout', () => {
    it('should reject with timeout error after waiting too long', async () => {
      const shortLimiter = new ConcurrencyLimiter({
        maxConcurrent: 1,
        maxQueueSize: 10,
        queueTimeoutMs: 100,
      });

      const release1 = await shortLimiter.acquire({ caller: 'holder' });

      await expect(
        shortLimiter.acquire({ caller: 'waiter', timeoutMs: 100 })
      ).rejects.toThrow(/Queue timeout/);

      expect(shortLimiter.getStats().timeoutRejects).toBe(1);

      release1();
      shortLimiter.drain();
    });

    it('should not affect other queued requests when one times out', async () => {
      const shortLimiter = new ConcurrencyLimiter({
        maxConcurrent: 1,
        maxQueueSize: 10,
        queueTimeoutMs: 30000,
      });

      const release1 = await shortLimiter.acquire({ caller: 'holder' });

      const shortTimeoutPromise = shortLimiter.acquire({
        caller: 'short-timeout',
        timeoutMs: 50,
      }).catch(e => e);

      const longTimeoutPromise = shortLimiter.acquire({
        caller: 'long-timeout',
        timeoutMs: 30000,
      });

      await delay(100);

      const shortResult = await shortTimeoutPromise;
      expect(shortResult).toBeInstanceOf(Error);

      release1();
      const release2 = await longTimeoutPromise;
      expect(shortLimiter.getStats().activeCount).toBe(1);

      release2();
      shortLimiter.drain();
    });
  });

  // ==========================================================================
  // 4. 队列满拒绝
  // ==========================================================================

  describe('Queue Full Rejection', () => {
    it('should reject immediately when queue is full', async () => {
      const tinyLimiter = new ConcurrencyLimiter({
        maxConcurrent: 1,
        maxQueueSize: 2,
        queueTimeoutMs: 30000,
      });

      const release1 = await tinyLimiter.acquire({ caller: 'slot1' });

      // Fill the queue - capture promises to handle their eventual rejection
      const q1 = tinyLimiter.acquire({ caller: 'queue1' }).catch(() => {});
      const q2 = tinyLimiter.acquire({ caller: 'queue2' }).catch(() => {});
      await delay(10);

      expect(tinyLimiter.getStats().queueSize).toBe(2);

      // This should be rejected immediately
      await expect(
        tinyLimiter.acquire({ caller: 'overflow' })
      ).rejects.toThrow(/Queue full/);

      expect(tinyLimiter.getStats().queueFullRejects).toBe(1);

      release1();
      tinyLimiter.drain();
      await Promise.allSettled([q1, q2]);
    });
  });

  // ==========================================================================
  // 5. execute 便捷方法
  // ==========================================================================

  describe('execute() Helper', () => {
    it('should auto-manage acquire/release lifecycle', async () => {
      const result = await limiter.execute(async () => {
        expect(limiter.getStats().activeCount).toBe(1);
        return 42;
      }, { caller: 'test-execute' });

      expect(result).toBe(42);
      expect(limiter.getStats().activeCount).toBe(0);
    });

    it('should release permit even when function throws', async () => {
      await expect(
        limiter.execute(async () => { throw new Error('boom'); }, { caller: 'test-throw' })
      ).rejects.toThrow('boom');

      expect(limiter.getStats().activeCount).toBe(0);
    });

    it('should correctly sequence concurrent execute calls', async () => {
      const singleLimiter = new ConcurrencyLimiter({
        maxConcurrent: 1,
        maxQueueSize: 10,
        queueTimeoutMs: 30000,
      });

      const order: number[] = [];

      const p1 = singleLimiter.execute(async () => {
        order.push(1);
        await delay(20);
      });

      const p2 = singleLimiter.execute(async () => {
        order.push(2);
        await delay(20);
      });

      const p3 = singleLimiter.execute(async () => {
        order.push(3);
        await delay(20);
      });

      await Promise.all([p1, p2, p3]);

      expect(order).toEqual([1, 2, 3]);
      singleLimiter.drain();
    });
  });

  // ==========================================================================
  // 6. 动态配置
  // ==========================================================================

  describe('Dynamic Configuration', () => {
    it('should update maxConcurrent and wake waiting requests', async () => {
      const dynamicLimiter = new ConcurrencyLimiter({
        maxConcurrent: 1,
        maxQueueSize: 10,
        queueTimeoutMs: 30000,
      });

      const release1 = await dynamicLimiter.acquire({ caller: 'slot1' });

      let acquired2 = false;
      const acquire2 = dynamicLimiter.acquire({ caller: 'waiting' }).then(rel => {
        acquired2 = true;
        return rel;
      });

      await delay(10);
      expect(acquired2).toBe(false);

      dynamicLimiter.updateMaxConcurrent(2);

      const release2 = await acquire2;
      expect(acquired2).toBe(true);
      expect(dynamicLimiter.getStats().maxConcurrent).toBe(2);

      release1();
      release2();
      dynamicLimiter.drain();
    });

    it('should clamp maxConcurrent to minimum of 1', async () => {
      limiter.updateMaxConcurrent(0);
      expect(limiter.getStats().maxConcurrent).toBe(1);

      limiter.updateMaxConcurrent(-5);
      expect(limiter.getStats().maxConcurrent).toBe(1);
    });
  });

  // ==========================================================================
  // 7. drain 清理
  // ==========================================================================

  describe('Drain', () => {
    it('should reject all queued requests on drain', async () => {
      const release1 = await limiter.acquire({ caller: 'slot1' });
      const release2 = await limiter.acquire({ caller: 'slot2' });

      const q1 = limiter.acquire({ caller: 'queued1' }).catch(e => e);
      const q2 = limiter.acquire({ caller: 'queued2' }).catch(e => e);

      await delay(10);
      expect(limiter.getStats().queueSize).toBe(2);

      limiter.drain();

      const [r1, r2] = await Promise.all([q1, q2]);
      expect(r1).toBeInstanceOf(Error);
      expect(r2).toBeInstanceOf(Error);
      expect((r1 as Error).message).toContain('Draining');
      expect(limiter.getStats().queueSize).toBe(0);

      release1();
      release2();
    });
  });

  // ==========================================================================
  // 8. 防重复释放
  // ==========================================================================

  describe('Double Release Protection', () => {
    it('should not decrement activeCount on double release', async () => {
      const release = await limiter.acquire({ caller: 'test' });

      expect(limiter.getStats().activeCount).toBe(1);

      release();
      expect(limiter.getStats().activeCount).toBe(0);

      // Double release should be a no-op
      release();
      expect(limiter.getStats().activeCount).toBe(0);
    });
  });

  // ==========================================================================
  // 9. 统计准确性
  // ==========================================================================

  describe('Stats Accuracy', () => {
    it('should track all metrics correctly through a complex sequence', async () => {
      const testLimiter = new ConcurrencyLimiter({
        maxConcurrent: 1,
        maxQueueSize: 5,
        queueTimeoutMs: 30000,
      });

      // 1. Immediate acquire
      const r1 = await testLimiter.acquire({ caller: 'a' });

      // 2. Queued acquire (will be released normally)
      const p2 = testLimiter.acquire({ caller: 'b' });

      // 3. Queued acquire (will timeout)
      const p3 = testLimiter.acquire({ caller: 'c', timeoutMs: 50 }).catch(e => e);

      await delay(70); // Wait for timeout

      const timeoutResult = await p3;
      expect(timeoutResult).toBeInstanceOf(Error);

      r1();
      const r2 = await p2;
      r2();

      const stats = testLimiter.getStats();
      expect(stats.totalRequests).toBe(3);
      expect(stats.immediateAcquires).toBe(1);
      expect(stats.queuedAcquires).toBe(1);
      expect(stats.timeoutRejects).toBe(1);
      expect(stats.activeCount).toBe(0);
      expect(stats.queueSize).toBe(0);
      expect(stats.avgWaitTimeMs).toBeGreaterThan(0);

      testLimiter.drain();
    });

    it('should reset stats correctly', async () => {
      await limiter.execute(async () => {}, { caller: 'test' });

      expect(limiter.getStats().totalRequests).toBe(1);

      limiter.resetStats();

      const stats = limiter.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.immediateAcquires).toBe(0);
      expect(stats.avgWaitTimeMs).toBe(0);
      expect(stats.maxWaitTimeMs).toBe(0);
    });
  });

  // ==========================================================================
  // 10. 高并发压力测试
  // ==========================================================================

  describe('High Concurrency Stress', () => {
    it('should handle 20 concurrent requests with concurrency=2 without deadlock', async () => {
      const stressLimiter = new ConcurrencyLimiter({
        maxConcurrent: 2,
        maxQueueSize: 50,
        queueTimeoutMs: 30000,
      });

      const results: number[] = [];
      const promises: Promise<void>[] = [];

      for (let i = 0; i < 20; i++) {
        promises.push(
          stressLimiter.execute(async () => {
            expect(stressLimiter.getStats().activeCount).toBeLessThanOrEqual(2);
            await delay(10);
            results.push(i);
          }, { caller: `stress-${i}` })
        );
      }

      await Promise.all(promises);

      expect(results.length).toBe(20);
      expect(stressLimiter.getStats().totalRequests).toBe(20);
      expect(stressLimiter.getStats().activeCount).toBe(0);

      stressLimiter.drain();
    });

    it('should never exceed maxConcurrent under heavy load', async () => {
      const strictLimiter = new ConcurrencyLimiter({
        maxConcurrent: 3,
        maxQueueSize: 100,
        queueTimeoutMs: 30000,
      });

      let maxObserved = 0;
      const promises: Promise<void>[] = [];

      for (let i = 0; i < 50; i++) {
        promises.push(
          strictLimiter.execute(async () => {
            const active = strictLimiter.getStats().activeCount;
            if (active > maxObserved) maxObserved = active;
            // Random delay to simulate varying LLM latencies
            await delay(Math.random() * 20);
          })
        );
      }

      await Promise.all(promises);

      expect(maxObserved).toBeLessThanOrEqual(3);
      strictLimiter.drain();
    });
  });
});

// ============================================================================
// Singleton Factory Tests
// ============================================================================

describe('getLLMConcurrencyLimiter (Singleton)', () => {
  afterEach(() => {
    resetLLMConcurrencyLimiter();
    delete process.env.BEECLAW_LLM_MAX_CONCURRENCY;
  });

  it('should return the same instance on repeated calls', () => {
    const a = getLLMConcurrencyLimiter({ maxConcurrent: 3 });
    const b = getLLMConcurrencyLimiter();

    expect(a).toBe(b);
    expect(a.getStats().maxConcurrent).toBe(3);
  });

  it('should re-create instance when options are provided', () => {
    const a = getLLMConcurrencyLimiter({ maxConcurrent: 3 });
    const b = getLLMConcurrencyLimiter({ maxConcurrent: 5 });

    expect(b.getStats().maxConcurrent).toBe(5);
  });

  it('should read BEECLAW_LLM_MAX_CONCURRENCY from env', () => {
    process.env.BEECLAW_LLM_MAX_CONCURRENCY = '7';
    resetLLMConcurrencyLimiter();

    const l = getLLMConcurrencyLimiter();
    expect(l.getStats().maxConcurrent).toBe(7);
  });

  it('should prefer explicit options over env var', () => {
    process.env.BEECLAW_LLM_MAX_CONCURRENCY = '7';
    resetLLMConcurrencyLimiter();

    const l = getLLMConcurrencyLimiter({ maxConcurrent: 10 });
    expect(l.getStats().maxConcurrent).toBe(10);
  });

  it('should use default value 2 when no config provided', () => {
    resetLLMConcurrencyLimiter();
    const l = getLLMConcurrencyLimiter();
    expect(l.getStats().maxConcurrent).toBe(2);
  });
});
