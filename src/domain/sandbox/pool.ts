/**
 * Container Pool — Pre-warmed Container Management
 *
 * Maintains a pool of idle Docker containers for fast sandbox acquisition.
 * Reduces cold-start latency from ~2-3s to ~50ms for Docker sandboxes.
 *
 * Features:
 * - Pre-warm idle containers on startup
 * - Auto-scale based on demand
 * - Health checks and stale container recycling
 * - Graceful shutdown support
 */

import { logger } from '../../infra/observability/logger';
import type { SandboxConfig } from './types';

// Lazy-import dockerode (optional dependency for container environments)
let Docker: any = null;

// Optional: dockerode may not be installed in all environments
async function getDockerModule(): Promise<any> {
  if (Docker) return Docker;
  try {
    // eslint-disable-next-line no-restricted-syntax
    const mod = await import('dockerode');
    Docker = mod.default || mod;
    return Docker;
  } catch (_error) {
    throw new Error('ContainerPool requires "dockerode" package.');
  }
}

interface PooledContainer {
  id: string;
  container: any;
  createdAt: number;
  lastUsedAt: number;
  status: 'idle' | 'in-use' | 'stale';
}

export class ContainerPool {
  private config: SandboxConfig;
  private docker: any = null;
  private pool: Map<string, PooledContainer> = new Map();
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(config: SandboxConfig) {
    this.config = config;
  }

  /**
   * Start the pool — pre-warm containers and begin health checks.
   */
  async start(): Promise<void> {
    if (this.running) return;

    if (!this.config.pool.enabled || !this.config.docker.enabled) {
      logger.info('[ContainerPool] Pool disabled, skipping start');
      return;
    }

    const DockerCtor = await getDockerModule();
    this.docker = new DockerCtor({
      socketPath: this.config.docker.socketPath || '/var/run/docker.sock',
    });

    // Verify Docker connectivity
    try {
      await this.docker.ping();
    } catch (_error) {
      logger.error('[ContainerPool] Docker not available, pool disabled');
      return;
    }

    this.running = true;

    // Pre-warm containers
    const warmCount = this.config.pool.minIdle;
    logger.info(`[ContainerPool] Pre-warming ${warmCount} container(s)...`);

    const warmPromises = Array.from({ length: warmCount }, () => this.createPooledContainer());
    const results = await Promise.allSettled(warmPromises);

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    logger.info(`[ContainerPool] Pre-warm complete: ${succeeded} ready, ${failed} failed`);

    // Start health check timer
    this.healthCheckTimer = setInterval(
      () => this.healthCheck(),
      this.config.pool.healthCheckInterval,
    );
  }

  /**
   * Acquire a container from the pool.
   * Returns an idle container if available, or creates a new one.
   */
  async acquire(): Promise<{ containerId: string; container: any }> {
    if (!this.docker) {
      throw new Error('[ContainerPool] Pool not started');
    }

    // Find an idle container
    for (const [id, pooled] of this.pool.entries()) {
      if (pooled.status === 'idle') {
        pooled.status = 'in-use';
        pooled.lastUsedAt = Date.now();
        logger.debug(`[ContainerPool] Acquired idle container ${id.slice(0, 12)}`);
        return { containerId: id, container: pooled.container };
      }
    }

    // No idle container — check if we can create one
    if (this.pool.size >= this.config.pool.maxTotal) {
      throw new Error(`[ContainerPool] Pool exhausted (max: ${this.config.pool.maxTotal})`);
    }

    // Create a new container
    const pooled = await this.createPooledContainer();
    pooled.status = 'in-use';
    logger.debug(`[ContainerPool] Created new container (pool size: ${this.pool.size})`);
    return { containerId: pooled.id, container: pooled.container };
  }

  /**
   * Return a container to the pool.
   * If pool is full or container is stale, destroy it instead.
   */
  async release(containerId: string): Promise<void> {
    const pooled = this.pool.get(containerId);
    if (!pooled) return;

    // Clean the container workspace for reuse
    try {
      const exec = await pooled.container.exec({
        Cmd: ['bash', '-c', 'cd /workspace && rm -rf ./* 2>/dev/null; true'],
        AttachStdout: false,
        AttachStderr: false,
      });
      await exec.start({ Detach: true });
    } catch (error) {
      logger.debug(`[ContainerPool] Error cleaning container ${containerId.slice(0, 12)}:`, error);
      // If cleanup fails, destroy the container
      await this.destroyPooled(containerId);
      return;
    }

    // Count idle containers
    const idleCount = Array.from(this.pool.values()).filter(p => p.status === 'idle').length;

    if (idleCount >= this.config.pool.minIdle * 2) {
      // Too many idle containers, destroy this one
      await this.destroyPooled(containerId);
    } else {
      // Return to pool
      pooled.status = 'idle';
      pooled.lastUsedAt = Date.now();
    }
  }

  /**
   * Shutdown the pool — destroy all containers.
   */
  async shutdown(): Promise<void> {
    this.running = false;

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    const destroyPromises = Array.from(this.pool.keys()).map(id => this.destroyPooled(id));
    await Promise.allSettled(destroyPromises);

    this.pool.clear();
    logger.info('[ContainerPool] Shutdown complete');
  }

  /**
   * Get pool statistics.
   */
  getStats(): { total: number; idle: number; inUse: number; stale: number } {
    let idle = 0, inUse = 0, stale = 0;
    for (const pooled of this.pool.values()) {
      if (pooled.status === 'idle') idle++;
      else if (pooled.status === 'in-use') inUse++;
      else if (pooled.status === 'stale') stale++;
    }
    return { total: this.pool.size, idle, inUse, stale };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  private async createPooledContainer(): Promise<PooledContainer> {
    const memoryLimit = this.config.docker.memoryLimitMb * 1024 * 1024;
    const cpuLimit = this.config.docker.cpuLimit;

    const container = await this.docker.createContainer({
      Image: this.config.docker.image,
      Cmd: ['sleep', 'infinity'],
      WorkingDir: '/workspace',
      Env: ['SANDBOX=true', 'POOLED=true'],
      HostConfig: {
        Memory: memoryLimit,
        NanoCpus: Math.floor(cpuLimit * 1e9),
        NetworkMode: this.config.docker.networkEnabled ? 'bridge' : 'none',
        PidsLimit: 256,
        SecurityOpt: ['no-new-privileges'],
        CapDrop: ['ALL'],
        CapAdd: ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETGID', 'SETUID'],
      },
      Labels: {
        'beeclaw.sandbox': 'true',
        'beeclaw.pool': 'true',
      },
    });

    await container.start();

    const pooled: PooledContainer = {
      id: container.id,
      container,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      status: 'idle',
    };

    this.pool.set(container.id, pooled);
    return pooled;
  }

  private async destroyPooled(containerId: string): Promise<void> {
    const pooled = this.pool.get(containerId);
    if (!pooled) return;

    this.pool.delete(containerId);

    try {
      try {
        await pooled.container.stop({ t: 3 });
      } catch {}
      await pooled.container.remove({ force: true });
    } catch (error) {
      logger.debug(`[ContainerPool] Error destroying container ${containerId.slice(0, 12)}:`, error);
    }
  }

  /**
   * Health check — recycle stale containers, maintain minimum idle count.
   */
  private async healthCheck(): Promise<void> {
    if (!this.running) return;

    const now = Date.now();
    const idleTimeout = this.config.docker.idleTimeout;

    // Mark stale containers
    for (const [_id, pooled] of this.pool.entries()) {
      if (pooled.status === 'idle' && (now - pooled.lastUsedAt) > idleTimeout) {
        pooled.status = 'stale';
      }
    }

    // Remove stale containers (but keep minimum idle count)
    const staleIds = Array.from(this.pool.entries())
      .filter(([_, p]) => p.status === 'stale')
      .map(([id]) => id);

    for (const id of staleIds) {
      const idleCount = Array.from(this.pool.values()).filter(p => p.status === 'idle').length;
      if (idleCount + staleIds.length > this.config.pool.minIdle) {
        await this.destroyPooled(id);
      }
    }

    // Top up idle containers if below minimum
    const currentIdle = Array.from(this.pool.values()).filter(p => p.status === 'idle').length;
    const needed = this.config.pool.minIdle - currentIdle;

    if (needed > 0 && this.pool.size < this.config.pool.maxTotal) {
      const createCount = Math.min(needed, this.config.pool.maxTotal - this.pool.size);
      const promises = Array.from({ length: createCount }, () =>
        this.createPooledContainer().catch(e => {
          logger.warn('[ContainerPool] Failed to create warm container:', e);
        })
      );
      await Promise.allSettled(promises);
    }

    const stats = this.getStats();
    logger.debug(`[ContainerPool] Health check: total=${stats.total} idle=${stats.idle} in-use=${stats.inUse}`);
  }
}
