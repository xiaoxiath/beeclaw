/**
 * Tests for CLIAdapter
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock logger
vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    debug: vi.fn(() => {}),
    info: vi.fn(() => {}),
    warn: vi.fn(() => {}),
    error: vi.fn(() => {}),
  },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

import { CLIAdapter } from '../adapter';

describe('CLIAdapter', () => {
  let adapter: CLIAdapter;

  beforeEach(() => {
    adapter = new CLIAdapter();
  });

  describe('properties', () => {
    it('has name "cli"', () => {
      expect(adapter.name).toBe('cli');
    });

    it('has type "cli"', () => {
      expect(adapter.type).toBe('cli');
    });
  });

  describe('initialize', () => {
    it('registers a CLIChannel on the gateway', async () => {
      const registerChannel = vi.fn(() => {});
      const context = {
        gateway: { registerChannel },
        config: {},
      } as any;

      await adapter.initialize(context);

      expect(registerChannel).toHaveBeenCalledTimes(1);
      // The argument should be a CLIChannel instance
      const arg = registerChannel.mock.calls[0][0];
      expect(arg).toBeDefined();
      expect(arg.type).toBe('cli');
    });
  });

  describe('start', () => {
    it('marks adapter as running', async () => {
      const context = {
        gateway: { registerChannel: vi.fn(() => {}) },
        config: {},
      } as any;
      await adapter.initialize(context);

      await adapter.start();

      const status = adapter.getStatus();
      expect(status.running).toBe(true);
      expect(status.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('stop', () => {
    it('marks adapter as not running', async () => {
      const context = {
        gateway: { registerChannel: vi.fn(() => {}) },
        config: {},
      } as any;
      await adapter.initialize(context);
      await adapter.start();

      await adapter.stop();

      const status = adapter.getStatus();
      expect(status.running).toBe(false);
    });
  });

  describe('healthCheck', () => {
    it('returns false when not running', async () => {
      expect(await adapter.healthCheck()).toBe(false);
    });

    it('returns true when running', async () => {
      const context = {
        gateway: { registerChannel: vi.fn(() => {}) },
        config: {},
      } as any;
      await adapter.initialize(context);
      await adapter.start();

      expect(await adapter.healthCheck()).toBe(true);
    });

    it('returns false after stop', async () => {
      const context = {
        gateway: { registerChannel: vi.fn(() => {}) },
        config: {},
      } as any;
      await adapter.initialize(context);
      await adapter.start();
      await adapter.stop();

      expect(await adapter.healthCheck()).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('returns not running with 0 uptime initially', () => {
      const status = adapter.getStatus();
      expect(status.running).toBe(false);
      expect(status.uptime).toBe(0);
    });

    it('returns running with positive uptime after start', async () => {
      const context = {
        gateway: { registerChannel: vi.fn(() => {}) },
        config: {},
      } as any;
      await adapter.initialize(context);
      await adapter.start();

      // small delay to ensure uptime > 0
      await new Promise((r) => setTimeout(r, 5));

      const status = adapter.getStatus();
      expect(status.running).toBe(true);
      expect(status.uptime).toBeGreaterThan(0);
    });

    it('returns 0 uptime after stop', async () => {
      const context = {
        gateway: { registerChannel: vi.fn(() => {}) },
        config: {},
      } as any;
      await adapter.initialize(context);
      await adapter.start();
      await adapter.stop();

      const status = adapter.getStatus();
      expect(status.uptime).toBe(0);
    });
  });
});
