import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mock logger
mock.module('../../../infra/observability/logger', () => ({
  logger: {
    info: mock(),
    error: mock(),
    warn: mock(),
    debug: mock(),
  },
}));

import { ContainerPool } from '../pool';

// Helper to create a minimal SandboxConfig for pool tests
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
    ...overrides,
  };
}

describe('ContainerPool', () => {
  describe('constructor', () => {
    it('creates with valid config', () => {
      const pool = new ContainerPool(makeConfig());
      expect(pool).toBeDefined();
    });
  });

  describe('getStats', () => {
    it('returns zero stats initially', () => {
      const pool = new ContainerPool(makeConfig());
      const stats = pool.getStats();
      expect(stats.total).toBe(0);
      expect(stats.idle).toBe(0);
      expect(stats.inUse).toBe(0);
      expect(stats.stale).toBe(0);
    });
  });

  describe('start (without Docker)', () => {
    it('skips when pool is disabled', async () => {
      const pool = new ContainerPool(makeConfig({ pool: { enabled: false } }));
      // Should not throw
      await pool.start();
    });

    it('skips when docker is disabled', async () => {
      const pool = new ContainerPool(makeConfig({ docker: { enabled: false } }));
      await pool.start();
    });
  });

  describe('acquire (without start)', () => {
    it('throws when pool not started', async () => {
      const pool = new ContainerPool(makeConfig());
      await expect(pool.acquire()).rejects.toThrow('not started');
    });
  });

  describe('shutdown', () => {
    it('shuts down cleanly even when not started', async () => {
      const pool = new ContainerPool(makeConfig());
      await pool.shutdown();
      const stats = pool.getStats();
      expect(stats.total).toBe(0);
    });
  });
});
