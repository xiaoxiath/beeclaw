import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

// Mock channel
const mockWebChannel = {
  type: 'web',
  activeListenerCount: 3,
};

vi.mock('../channel', () => ({
  getWebChannel: () => mockWebChannel,
}));

// Mock gateway
const mockGateway = {
  registerChannel: vi.fn(),
  unregisterChannel: vi.fn(),
};

vi.mock('../../../app/gateway-channel', () => ({
  getMessageGateway: () => mockGateway,
}));

// Mock server
const mockApp = { fetch: vi.fn() };
vi.mock('../server', () => ({
  createWebApp: vi.fn(() => ({ app: mockApp })),
}));

// Mock Bun.serve
const mockServer = {
  stop: vi.fn(),
};

// Define global Bun mock
(globalThis as any).Bun = {
  serve: vi.fn(() => mockServer),
};

import { WebAdapter } from '../adapter';

describe('WebAdapter', () => {
  let adapter: WebAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new WebAdapter();
    (globalThis as any).Bun = {
      serve: vi.fn(() => mockServer),
    };
  });

  // ─── Properties ───
  describe('properties', () => {
    it('has name "web"', () => {
      expect(adapter.name).toBe('web');
    });

    it('has type "web"', () => {
      expect(adapter.type).toBe('web');
    });
  });

  // ─── initialize ───
  describe('initialize', () => {
    it('registers WebChannel with gateway', async () => {
      const context = {
        config: { web: { enabled: true, port: 3000, host: '0.0.0.0' } },
      } as any;

      await adapter.initialize(context);

      expect(mockGateway.registerChannel).toHaveBeenCalledWith(mockWebChannel);
    });
  });

  // ─── start ───
  describe('start', () => {
    it('starts the server when web is enabled', async () => {
      const context = {
        config: {
          web: { enabled: true, port: 4000, host: 'localhost' },
        },
      } as any;

      await adapter.initialize(context);
      await adapter.start();

      expect((globalThis as any).Bun.serve).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 4000,
          hostname: 'localhost',
        })
      );
    });

    it('uses default port and host when not specified', async () => {
      const context = {
        config: {
          web: { enabled: true },
        },
      } as any;

      await adapter.initialize(context);
      await adapter.start();

      expect((globalThis as any).Bun.serve).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 3000,
          hostname: '0.0.0.0',
        })
      );
    });

    it('does not start server when web is disabled', async () => {
      const context = {
        config: {
          web: { enabled: false },
        },
      } as any;

      await adapter.initialize(context);
      await adapter.start();

      expect((globalThis as any).Bun.serve).not.toHaveBeenCalled();
    });

    it('does not start server when web config is missing', async () => {
      const context = {
        config: {},
      } as any;

      await adapter.initialize(context);
      await adapter.start();

      expect((globalThis as any).Bun.serve).not.toHaveBeenCalled();
    });

    it('throws when not initialized', async () => {
      await expect(adapter.start()).rejects.toThrow('Not initialized');
    });

    it('throws when Bun.serve fails', async () => {
      const context = {
        config: {
          web: { enabled: true, port: 3000, host: '0.0.0.0' },
        },
      } as any;

      (globalThis as any).Bun.serve = vi.fn(() => { throw new Error('Port in use'); });

      await adapter.initialize(context);
      await expect(adapter.start()).rejects.toThrow('Port in use');
    });
  });

  // ─── stop ───
  describe('stop', () => {
    it('stops the server and unregisters channel', async () => {
      const context = {
        config: {
          web: { enabled: true, port: 3000, host: '0.0.0.0' },
        },
      } as any;

      await adapter.initialize(context);
      await adapter.start();
      await adapter.stop();

      expect(mockServer.stop).toHaveBeenCalled();
      expect(mockGateway.unregisterChannel).toHaveBeenCalledWith('web');
    });

    it('handles stop when server not started', async () => {
      await adapter.stop();

      expect(mockGateway.unregisterChannel).toHaveBeenCalled();
      expect(mockServer.stop).not.toHaveBeenCalled();
    });

    it('handles server.stop() error gracefully', async () => {
      const context = {
        config: {
          web: { enabled: true, port: 3000, host: '0.0.0.0' },
        },
      } as any;

      mockServer.stop.mockImplementation(() => { throw new Error('Stop error'); });

      await adapter.initialize(context);
      await adapter.start();

      // Should not throw
      await adapter.stop();
    });
  });

  // ─── healthCheck ───
  describe('healthCheck', () => {
    it('returns true when server is running', async () => {
      const context = {
        config: {
          web: { enabled: true, port: 3000, host: '0.0.0.0' },
        },
      } as any;

      await adapter.initialize(context);
      await adapter.start();

      const result = await adapter.healthCheck();
      expect(result).toBe(true);
    });

    it('returns false when server is not running', async () => {
      const result = await adapter.healthCheck();
      expect(result).toBe(false);
    });
  });

  // ─── getStatus ───
  describe('getStatus', () => {
    it('returns running status with metadata', async () => {
      const context = {
        config: {
          web: { enabled: true, port: 4000, host: 'localhost' },
        },
      } as any;

      await adapter.initialize(context);
      await adapter.start();

      const status = adapter.getStatus();

      expect(status.running).toBe(true);
      expect(status.uptime).toBeGreaterThanOrEqual(0);
      expect(status.connections).toBe(0);
      expect(status.metadata).toEqual(expect.objectContaining({
        port: 4000,
        host: 'localhost',
        activeListeners: 3,
      }));
    });

    it('returns not-running status when stopped', async () => {
      const status = adapter.getStatus();

      expect(status.running).toBe(false);
      expect(status.uptime).toBe(0);
      expect(status.metadata).toEqual(expect.objectContaining({
        port: 3000,
        host: '0.0.0.0',
      }));
    });
  });
});
