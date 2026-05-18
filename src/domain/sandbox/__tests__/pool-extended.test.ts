import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock logger
vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

// ── Mock dockerode ─────────────────────────────────────────────────────────
// IMPORTANT: Use class methods that delegate to module-level fns, NOT property
// assignment. With vitest `restoreMocks: true`, assigned vi.fn() instances get
// their implementations wiped after each test, but class methods remain intact.

const mockPing = vi.fn(() => Promise.resolve());

let containerIdCounter = 0;

interface MockContainer {
  id: string;
  exec: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

function createMockContainer(): MockContainer {
  const id = `container_${++containerIdCounter}`;
  const execStart = vi.fn(() => Promise.resolve());
  return {
    id,
    exec: vi.fn(() => Promise.resolve({ start: execStart })),
    start: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
  };
}

// Track all containers created so tests can manipulate individual container mocks
let createdContainers: MockContainer[] = [];

const mockCreateContainer = vi.fn((opts: any) => {
  const c = createMockContainer();
  createdContainers.push(c);
  return Promise.resolve(c);
});

vi.mock('dockerode', () => {
  return {
    default: class MockDocker {
      constructor(_opts?: any) {}
      // Use method definitions that delegate — NOT property assignments
      ping() { return mockPing(); }
      createContainer(opts: any) { return mockCreateContainer(opts); }
    },
  };
});

import { ContainerPool } from '../pool';

// IMPORTANT: Do NOT spread `...overrides` at the top level — it would overwrite
// the entire merged `docker` / `pool` objects with the partial overrides.
function makeConfig(overrides?: Partial<any>): any {
  return {
    docker: {
      enabled: true,
      image: 'beeclaw-sandbox:latest',
      socketPath: '/var/run/docker.sock',
      memoryLimitMb: 256,
      cpuLimit: 1,
      networkEnabled: false,
      idleTimeout: 600000,
      ...overrides?.docker,
    },
    pool: {
      enabled: true,
      minIdle: 2,
      maxTotal: 5,
      healthCheckInterval: 60000,
      ...overrides?.pool,
    },
  };
}

describe('ContainerPool (mocked)', () => {
  beforeEach(() => {
    containerIdCounter = 0;
    createdContainers = [];
    // Re-set default implementations (restoreMocks: true wipes them between tests)
    mockPing.mockImplementation(() => Promise.resolve());
    mockCreateContainer.mockImplementation((opts: any) => {
      const c = createMockContainer();
      createdContainers.push(c);
      return Promise.resolve(c);
    });
  });

  // ── constructor ──────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('creates with valid config', () => {
      const pool = new ContainerPool(makeConfig());
      expect(pool).toBeDefined();
    });
  });

  // ── getStats ─────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns zero stats initially', () => {
      const pool = new ContainerPool(makeConfig());
      const stats = pool.getStats();
      expect(stats).toEqual({ total: 0, idle: 0, inUse: 0, stale: 0 });
    });
  });

  // ── start ────────────────────────────────────────────────────────────────

  describe('start', () => {
    it('skips when pool is disabled', async () => {
      const pool = new ContainerPool(makeConfig({ pool: { enabled: false } }));
      await pool.start();
      expect(mockPing).not.toHaveBeenCalled();
    });

    it('skips when docker is disabled', async () => {
      const pool = new ContainerPool(makeConfig({ docker: { enabled: false } }));
      await pool.start();
      expect(mockPing).not.toHaveBeenCalled();
    });

    it('skips when already running', async () => {
      const pool = new ContainerPool(makeConfig({ pool: { minIdle: 0 } }));
      await pool.start();
      const pingCount = mockPing.mock.calls.length;
      await pool.start();
      // ping should not be called again on second start
      expect(mockPing.mock.calls.length).toBe(pingCount);
      await pool.shutdown();
    });

    it('returns early when Docker ping fails', async () => {
      mockPing.mockRejectedValueOnce(new Error('docker not running'));
      const pool = new ContainerPool(makeConfig({ pool: { minIdle: 2 } }));
      await pool.start();
      // Ping failed, so no containers should be created and running should be false
      expect(mockCreateContainer).not.toHaveBeenCalled();
      const stats = pool.getStats();
      expect(stats.total).toBe(0);
      expect(stats.idle).toBe(0);
    });

    it('pre-warms minIdle containers on start', async () => {
      const pool = new ContainerPool(makeConfig({ pool: { minIdle: 3, maxTotal: 10 } }));
      await pool.start();
      const stats = pool.getStats();
      expect(stats.total).toBe(3);
      expect(stats.idle).toBe(3);
      expect(mockCreateContainer).toHaveBeenCalledTimes(3);
      await pool.shutdown();
    });

    it('handles partial pre-warm failure gracefully', async () => {
      let callCount = 0;
      mockCreateContainer.mockImplementation(() => {
        callCount++;
        if (callCount === 2) return Promise.reject(new Error('image pull failed'));
        const c = createMockContainer();
        createdContainers.push(c);
        return Promise.resolve(c);
      });

      const pool = new ContainerPool(makeConfig({ pool: { minIdle: 3, maxTotal: 10 } }));
      await pool.start();
      const stats = pool.getStats();
      expect(stats.total).toBe(2); // 2 of 3 succeeded
      await pool.shutdown();
    });
  });

  // ── acquire ──────────────────────────────────────────────────────────────

  describe('acquire', () => {
    it('throws when pool not started', async () => {
      const pool = new ContainerPool(makeConfig());
      await expect(pool.acquire()).rejects.toThrow('not started');
    });

    it('returns an idle container', async () => {
      const pool = new ContainerPool(makeConfig({ pool: { minIdle: 1, maxTotal: 5 } }));
      await pool.start();

      const result = await pool.acquire();
      expect(result.containerId).toBeDefined();
      expect(result.container).toBeDefined();

      const stats = pool.getStats();
      expect(stats.inUse).toBe(1);
      expect(stats.idle).toBe(0);
      await pool.shutdown();
    });

    it('creates new container when no idle available', async () => {
      const pool = new ContainerPool(makeConfig({ pool: { minIdle: 1, maxTotal: 5 } }));
      await pool.start();

      await pool.acquire(); // takes the pre-warmed one
      const result = await pool.acquire(); // creates new
      expect(result.containerId).toBeDefined();
      const stats = pool.getStats();
      expect(stats.inUse).toBe(2);
      expect(stats.total).toBe(2);
      await pool.shutdown();
    });

    it('throws when pool is exhausted', async () => {
      const pool = new ContainerPool(makeConfig({ pool: { minIdle: 2, maxTotal: 2 } }));
      await pool.start();

      await pool.acquire();
      await pool.acquire();
      await expect(pool.acquire()).rejects.toThrow('Pool exhausted');
      await pool.shutdown();
    });
  });

  // ── release ──────────────────────────────────────────────────────────────

  describe('release', () => {
    it('returns container to idle state', async () => {
      const pool = new ContainerPool(makeConfig({ pool: { minIdle: 1, maxTotal: 5 } }));
      await pool.start();

      const acquired = await pool.acquire();
      expect(pool.getStats().inUse).toBe(1);

      await pool.release(acquired.containerId);
      const stats = pool.getStats();
      expect(stats.idle).toBe(1);
      expect(stats.inUse).toBe(0);
      await pool.shutdown();
    });

    it('does nothing for unknown containerId', async () => {
      const pool = new ContainerPool(makeConfig({ pool: { minIdle: 0 } }));
      await pool.start();
      await pool.release('unknown-id');
      expect(pool.getStats().total).toBe(0);
      await pool.shutdown();
    });

    it('destroys container when cleanup exec fails', async () => {
      const pool = new ContainerPool(makeConfig({ pool: { minIdle: 1, maxTotal: 5 } }));
      await pool.start();

      const acquired = await pool.acquire();
      // Find the mock container and make its exec fail
      const mockC = createdContainers.find(c => c.id === acquired.containerId);
      expect(mockC).toBeDefined();
      mockC!.exec.mockRejectedValueOnce(new Error('exec failed'));

      await pool.release(acquired.containerId);
      expect(pool.getStats().total).toBe(0);
      await pool.shutdown();
    });

    it('destroys container when too many idle', async () => {
      // minIdle=1, threshold is minIdle*2 = 2
      const pool = new ContainerPool(makeConfig({ pool: { minIdle: 1, maxTotal: 10 } }));
      await pool.start();

      const a1 = await pool.acquire(); // takes pre-warmed
      const a2 = await pool.acquire(); // creates new
      const a3 = await pool.acquire(); // creates new

      await pool.release(a1.containerId); // idle=1
      await pool.release(a2.containerId); // idle=2, now at threshold
      await pool.release(a3.containerId); // idle would be 3 >= minIdle*2=2, so destroy

      const stats = pool.getStats();
      expect(stats.idle).toBeLessThanOrEqual(2);
      await pool.shutdown();
    });
  });

  // ── shutdown ─────────────────────────────────────────────────────────────

  describe('shutdown', () => {
    it('shuts down cleanly even when not started', async () => {
      const pool = new ContainerPool(makeConfig());
      await pool.shutdown();
      expect(pool.getStats().total).toBe(0);
    });

    it('destroys all containers on shutdown', async () => {
      const pool = new ContainerPool(makeConfig({ pool: { minIdle: 3, maxTotal: 5 } }));
      await pool.start();
      expect(pool.getStats().total).toBe(3);
      await pool.shutdown();
      expect(pool.getStats().total).toBe(0);
    });
  });

  // ── healthCheck (via timer) ──────────────────────────────────────────────

  describe('healthCheck', () => {
    it('marks idle containers as stale after timeout and cleans them', async () => {
      vi.useFakeTimers();
      try {
        const pool = new ContainerPool(makeConfig({
          pool: { minIdle: 1, maxTotal: 5, healthCheckInterval: 1000 },
          docker: { idleTimeout: 5000 },
        }));
        await pool.start();
        expect(pool.getStats().idle).toBe(1);

        // Advance past idle timeout + health check interval
        await vi.advanceTimersByTimeAsync(6000);

        const stats = pool.getStats();
        // With minIdle=1 and 1 stale container: idleCount(0) + staleIds(1) > minIdle(1) is false,
        // so the stale container is NOT removed (kept as potential idle replacement).
        // A new idle container is created to satisfy minIdle.
        // End state: 1 stale + 1 idle = 2 total.
        expect(stats.total).toBe(2);
        expect(stats.stale).toBe(1);
        expect(stats.idle).toBe(1);
        await pool.shutdown();
      } finally {
        vi.useRealTimers();
      }
    });

    it('tops up idle containers below minIdle', async () => {
      vi.useFakeTimers();
      try {
        const pool = new ContainerPool(makeConfig({
          pool: { minIdle: 2, maxTotal: 5, healthCheckInterval: 1000 },
          docker: { idleTimeout: 600000 },
        }));
        await pool.start();
        expect(pool.getStats().idle).toBe(2);

        await pool.acquire();
        await pool.acquire();
        expect(pool.getStats().idle).toBe(0);

        // Trigger health check
        await vi.advanceTimersByTimeAsync(1500);

        const stats = pool.getStats();
        expect(stats.idle).toBe(2);
        expect(stats.inUse).toBe(2);
        await pool.shutdown();
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not create containers beyond maxTotal', async () => {
      vi.useFakeTimers();
      try {
        const pool = new ContainerPool(makeConfig({
          pool: { minIdle: 3, maxTotal: 3, healthCheckInterval: 1000 },
          docker: { idleTimeout: 600000 },
        }));
        await pool.start();

        await pool.acquire();
        await pool.acquire();
        await pool.acquire();

        await vi.advanceTimersByTimeAsync(1500);

        expect(pool.getStats().total).toBe(3);
        expect(pool.getStats().idle).toBe(0);
        await pool.shutdown();
      } finally {
        vi.useRealTimers();
      }
    });

    it('handles healthCheck when not running', async () => {
      // Create a pool, start it, then shut it down, verify healthCheck is a no-op
      const pool = new ContainerPool(makeConfig({ pool: { minIdle: 1, maxTotal: 5 } }));
      await pool.start();
      await pool.shutdown();
      // Pool is stopped; health check timer cleared; stats should be 0
      expect(pool.getStats().total).toBe(0);
    });
  });

  // ── createPooledContainer config ──────────────────────────────────────────

  describe('createPooledContainer config', () => {
    it('passes correct container config with network disabled', async () => {
      const pool = new ContainerPool(makeConfig({
        docker: { image: 'my-image:v1', memoryLimitMb: 128, cpuLimit: 0.5, networkEnabled: false },
        pool: { minIdle: 1, maxTotal: 5 },
      }));
      await pool.start();

      expect(mockCreateContainer).toHaveBeenCalledTimes(1);
      const callArgs = mockCreateContainer.mock.calls[0][0];
      expect(callArgs.Image).toBe('my-image:v1');
      expect(callArgs.HostConfig.NetworkMode).toBe('none');
      expect(callArgs.HostConfig.Memory).toBe(128 * 1024 * 1024);
      expect(callArgs.HostConfig.NanoCpus).toBe(Math.floor(0.5 * 1e9));
      expect(callArgs.Labels['beeclaw.pool']).toBe('true');
      expect(callArgs.Labels['beeclaw.sandbox']).toBe('true');
      expect(callArgs.Cmd).toEqual(['sleep', 'infinity']);
      expect(callArgs.WorkingDir).toBe('/workspace');
      expect(callArgs.Env).toContain('SANDBOX=true');
      expect(callArgs.Env).toContain('POOLED=true');
      expect(callArgs.HostConfig.PidsLimit).toBe(256);
      expect(callArgs.HostConfig.SecurityOpt).toContain('no-new-privileges');
      expect(callArgs.HostConfig.CapDrop).toEqual(['ALL']);
      expect(callArgs.HostConfig.CapAdd).toContain('CHOWN');
      await pool.shutdown();
    });

    it('passes network bridge when enabled', async () => {
      const pool = new ContainerPool(makeConfig({
        docker: { networkEnabled: true },
        pool: { minIdle: 1, maxTotal: 5 },
      }));
      await pool.start();

      const callArgs = mockCreateContainer.mock.calls[0][0];
      expect(callArgs.HostConfig.NetworkMode).toBe('bridge');
      await pool.shutdown();
    });
  });

  // ── destroyPooled error handling ──────────────────────────────────────────

  describe('destroyPooled error handling', () => {
    it('handles stop failure gracefully during shutdown', async () => {
      const pool = new ContainerPool(makeConfig({ pool: { minIdle: 1, maxTotal: 5 } }));
      await pool.start();

      for (const c of createdContainers) {
        c.stop.mockRejectedValue(new Error('stop failed'));
      }
      await pool.shutdown();
      expect(pool.getStats().total).toBe(0);
    });

    it('handles remove failure gracefully during shutdown', async () => {
      const pool = new ContainerPool(makeConfig({ pool: { minIdle: 1, maxTotal: 5 } }));
      await pool.start();

      for (const c of createdContainers) {
        c.remove.mockRejectedValueOnce(new Error('remove failed'));
      }
      await pool.shutdown();
      expect(pool.getStats().total).toBe(0);
    });
  });
});
