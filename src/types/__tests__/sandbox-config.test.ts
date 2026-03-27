/**
 * Tests for types/sandbox-config.ts - SandboxConfigSchema
 */
import { describe, it, expect, vi } from 'vitest';

import { SandboxConfigSchema } from '../sandbox-config';

describe('SandboxConfigSchema', () => {
  describe('defaults', () => {
    it('parses empty object with all defaults', () => {
      const config = SandboxConfigSchema.parse({});
      expect(config.enabled).toBe(true);
      expect(config.provider).toBe('auto');
      expect(config.workspaceBase).toBe('./data/sandbox');
    });

    it('sets local defaults', () => {
      const config = SandboxConfigSchema.parse({});
      expect(config.local.enabled).toBe(true);
      expect(config.local.defaultTimeout).toBe(30000);
      expect(config.local.maxOutputSize).toBe(1048576);
      expect(Array.isArray(config.local.blockedCommands)).toBe(true);
      expect(config.local.blockedCommands.length).toBeGreaterThan(0);
      expect(config.local.allowedCommands).toBeUndefined();
    });

    it('sets docker defaults', () => {
      const config = SandboxConfigSchema.parse({});
      expect(config.docker.enabled).toBe(false);
      expect(config.docker.image).toBe('beeclaw-sandbox:latest');
      expect(config.docker.memoryLimitMb).toBe(512);
      expect(config.docker.cpuLimit).toBe(1);
      expect(config.docker.networkEnabled).toBe(false);
      expect(config.docker.defaultTimeout).toBe(100000);
      expect(config.docker.maxOutputSize).toBe(2097152);
      expect(config.docker.idleTimeout).toBe(300000);
    });

    it('sets pool defaults', () => {
      const config = SandboxConfigSchema.parse({});
      expect(config.pool.enabled).toBe(false);
      expect(config.pool.minIdle).toBe(1);
      expect(config.pool.maxTotal).toBe(5);
      expect(config.pool.healthCheckInterval).toBe(10000);
    });
  });

  describe('enabled', () => {
    it('accepts true/false', () => {
      expect(SandboxConfigSchema.parse({ enabled: true }).enabled).toBe(true);
      expect(SandboxConfigSchema.parse({ enabled: false }).enabled).toBe(false);
    });

    it('rejects non-boolean', () => {
      expect(() => SandboxConfigSchema.parse({ enabled: 'yes' })).toThrow();
    });
  });

  describe('provider', () => {
    it('accepts valid providers', () => {
      expect(SandboxConfigSchema.parse({ provider: 'local' }).provider).toBe('local');
      expect(SandboxConfigSchema.parse({ provider: 'docker' }).provider).toBe('docker');
      expect(SandboxConfigSchema.parse({ provider: 'auto' }).provider).toBe('auto');
    });

    it('rejects invalid provider', () => {
      expect(() => SandboxConfigSchema.parse({ provider: 'kubernetes' })).toThrow();
    });
  });

  describe('local config', () => {
    it('accepts custom timeout', () => {
      const config = SandboxConfigSchema.parse({
        local: { defaultTimeout: 5000 },
      });
      expect(config.local.defaultTimeout).toBe(5000);
    });

    it('rejects timeout below minimum (1000)', () => {
      expect(() =>
        SandboxConfigSchema.parse({ local: { defaultTimeout: 500 } })
      ).toThrow();
    });

    it('rejects timeout above maximum (300000)', () => {
      expect(() =>
        SandboxConfigSchema.parse({ local: { defaultTimeout: 400000 } })
      ).toThrow();
    });

    it('accepts custom maxOutputSize', () => {
      const config = SandboxConfigSchema.parse({
        local: { maxOutputSize: 2048 },
      });
      expect(config.local.maxOutputSize).toBe(2048);
    });

    it('rejects maxOutputSize below minimum (1024)', () => {
      expect(() =>
        SandboxConfigSchema.parse({ local: { maxOutputSize: 512 } })
      ).toThrow();
    });

    it('rejects maxOutputSize above maximum (10485760)', () => {
      expect(() =>
        SandboxConfigSchema.parse({ local: { maxOutputSize: 20000000 } })
      ).toThrow();
    });

    it('accepts custom blockedCommands', () => {
      const config = SandboxConfigSchema.parse({
        local: { blockedCommands: ['rm -rf'] },
      });
      expect(config.local.blockedCommands).toEqual(['rm -rf']);
    });

    it('accepts allowedCommands', () => {
      const config = SandboxConfigSchema.parse({
        local: { allowedCommands: ['ls', 'cat'] },
      });
      expect(config.local.allowedCommands).toEqual(['ls', 'cat']);
    });
  });

  describe('docker config', () => {
    it('accepts custom image', () => {
      const config = SandboxConfigSchema.parse({
        docker: { image: 'my-sandbox:v2' },
      });
      expect(config.docker.image).toBe('my-sandbox:v2');
    });

    it('validates memoryLimitMb range (64-8192)', () => {
      expect(SandboxConfigSchema.parse({ docker: { memoryLimitMb: 64 } }).docker.memoryLimitMb).toBe(64);
      expect(SandboxConfigSchema.parse({ docker: { memoryLimitMb: 8192 } }).docker.memoryLimitMb).toBe(8192);
      expect(() => SandboxConfigSchema.parse({ docker: { memoryLimitMb: 32 } })).toThrow();
      expect(() => SandboxConfigSchema.parse({ docker: { memoryLimitMb: 10000 } })).toThrow();
    });

    it('validates cpuLimit range (0.1-4)', () => {
      expect(SandboxConfigSchema.parse({ docker: { cpuLimit: 0.1 } }).docker.cpuLimit).toBe(0.1);
      expect(SandboxConfigSchema.parse({ docker: { cpuLimit: 4 } }).docker.cpuLimit).toBe(4);
      expect(() => SandboxConfigSchema.parse({ docker: { cpuLimit: 0.05 } })).toThrow();
      expect(() => SandboxConfigSchema.parse({ docker: { cpuLimit: 5 } })).toThrow();
    });

    it('accepts networkEnabled toggle', () => {
      const config = SandboxConfigSchema.parse({
        docker: { networkEnabled: true },
      });
      expect(config.docker.networkEnabled).toBe(true);
    });

    it('validates docker defaultTimeout range (1000-600000)', () => {
      expect(() => SandboxConfigSchema.parse({ docker: { defaultTimeout: 500 } })).toThrow();
      expect(() => SandboxConfigSchema.parse({ docker: { defaultTimeout: 700000 } })).toThrow();
      expect(SandboxConfigSchema.parse({ docker: { defaultTimeout: 120000 } }).docker.defaultTimeout).toBe(120000);
    });

    it('validates idleTimeout range (30000-3600000)', () => {
      expect(() => SandboxConfigSchema.parse({ docker: { idleTimeout: 10000 } })).toThrow();
      expect(() => SandboxConfigSchema.parse({ docker: { idleTimeout: 5000000 } })).toThrow();
    });

    it('accepts optional socketPath', () => {
      const config = SandboxConfigSchema.parse({
        docker: { socketPath: '/var/run/docker.sock' },
      });
      expect(config.docker.socketPath).toBe('/var/run/docker.sock');
    });
  });

  describe('pool config', () => {
    it('validates minIdle range (0-10)', () => {
      expect(SandboxConfigSchema.parse({ pool: { minIdle: 0 } }).pool.minIdle).toBe(0);
      expect(SandboxConfigSchema.parse({ pool: { minIdle: 10 } }).pool.minIdle).toBe(10);
      expect(() => SandboxConfigSchema.parse({ pool: { minIdle: -1 } })).toThrow();
      expect(() => SandboxConfigSchema.parse({ pool: { minIdle: 11 } })).toThrow();
    });

    it('validates maxTotal range (1-20)', () => {
      expect(SandboxConfigSchema.parse({ pool: { maxTotal: 1 } }).pool.maxTotal).toBe(1);
      expect(SandboxConfigSchema.parse({ pool: { maxTotal: 20 } }).pool.maxTotal).toBe(20);
      expect(() => SandboxConfigSchema.parse({ pool: { maxTotal: 0 } })).toThrow();
      expect(() => SandboxConfigSchema.parse({ pool: { maxTotal: 21 } })).toThrow();
    });

    it('validates healthCheckInterval range (10000-300000)', () => {
      expect(() => SandboxConfigSchema.parse({ pool: { healthCheckInterval: 5000 } })).toThrow();
      expect(() => SandboxConfigSchema.parse({ pool: { healthCheckInterval: 400000 } })).toThrow();
      expect(SandboxConfigSchema.parse({ pool: { healthCheckInterval: 30000 } }).pool.healthCheckInterval).toBe(30000);
    });
  });

  describe('full config', () => {
    it('accepts a complete valid config', () => {
      const config = SandboxConfigSchema.parse({
        enabled: true,
        provider: 'docker',
        workspaceBase: '/tmp/sandbox',
        local: {
          enabled: false,
          defaultTimeout: 10000,
          maxOutputSize: 5000,
          blockedCommands: [],
        },
        docker: {
          enabled: true,
          image: 'custom:latest',
          memoryLimitMb: 1024,
          cpuLimit: 2,
          networkEnabled: true,
          defaultTimeout: 120000,
          maxOutputSize: 4194304,
          idleTimeout: 600000,
        },
        pool: {
          enabled: true,
          minIdle: 2,
          maxTotal: 10,
          healthCheckInterval: 30000,
        },
      });

      expect(config.provider).toBe('docker');
      expect(config.docker.enabled).toBe(true);
      expect(config.docker.memoryLimitMb).toBe(1024);
      expect(config.pool.enabled).toBe(true);
    });
  });
});
