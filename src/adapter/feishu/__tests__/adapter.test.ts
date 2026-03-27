/**
 * Tests for FeishuAdapter (adapter.ts)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    debug: vi.fn(() => {}),
    info: vi.fn(() => {}),
    warn: vi.fn(() => {}),
    error: vi.fn(() => {}),
  },
}));

const mockRegisterChannel = vi.fn(() => {});
const mockInitFeishuWSIntegration = vi.fn(() => Promise.resolve());
const mockGetFeishuWSClient = vi.fn(() => null as any);
const mockStopClient = vi.fn(() => {});

vi.mock('../../../app/routes/proactive', () => ({
  initFeishuWSIntegration: mockInitFeishuWSIntegration,
}));

vi.mock('../ws-client', () => ({
  getFeishuWSClient: mockGetFeishuWSClient,
}));

vi.mock('../channel', () => ({
  FeishuChannel: class MockFeishuChannel {
    readonly type = 'feishu' as const;
  },
}));

import { FeishuAdapter } from '../adapter';

function makeContext(overrides: Record<string, any> = {}) {
  return {
    config: {
      feishu: { enabled: true, appId: 'id', appSecret: 'secret' },
      ...overrides.config,
    },
    gateway: {
      registerChannel: mockRegisterChannel,
    },
    ...overrides,
  } as any;
}

describe('FeishuAdapter', () => {
  let adapter: FeishuAdapter;

  beforeEach(() => {
    adapter = new FeishuAdapter();
    mockRegisterChannel.mockClear();
    mockInitFeishuWSIntegration.mockClear();
    mockGetFeishuWSClient.mockClear();
    mockStopClient.mockClear();
  });

  describe('properties', () => {
    it('has name "feishu"', () => {
      expect(adapter.name).toBe('feishu');
    });

    it('has type "bot"', () => {
      expect(adapter.type).toBe('bot');
    });
  });

  describe('initialize', () => {
    it('registers channel on gateway', async () => {
      const ctx = makeContext();
      await adapter.initialize(ctx);
      expect(mockRegisterChannel).toHaveBeenCalledTimes(1);
    });
  });

  describe('start', () => {
    it('throws if not initialized', async () => {
      await expect(adapter.start()).rejects.toThrow('Not initialized');
    });

    it('skips start if feishu is disabled in config', async () => {
      const ctx = makeContext({ config: { feishu: { enabled: false } } });
      await adapter.initialize(ctx);
      await adapter.start();
      expect(mockInitFeishuWSIntegration).not.toHaveBeenCalled();
    });

    it('skips start if feishu config is missing', async () => {
      const ctx = makeContext({ config: {} });
      await adapter.initialize(ctx);
      await adapter.start();
      expect(mockInitFeishuWSIntegration).not.toHaveBeenCalled();
    });

    it('calls initFeishuWSIntegration and marks running', async () => {
      const ctx = makeContext();
      await adapter.initialize(ctx);
      await adapter.start();
      expect(mockInitFeishuWSIntegration).toHaveBeenCalledTimes(1);
      expect(adapter.getStatus().running).toBe(true);
      expect(adapter.getStatus().connections).toBe(1);
    });

    it('throws if initFeishuWSIntegration fails', async () => {
      mockInitFeishuWSIntegration.mockRejectedValueOnce(new Error('ws fail'));
      const ctx = makeContext();
      await adapter.initialize(ctx);
      await expect(adapter.start()).rejects.toThrow('ws fail');
    });
  });

  describe('stop', () => {
    it('does nothing if not running', async () => {
      await adapter.stop();
    });

    it('stops client and marks not running', async () => {
      const mockClient = { stop: mockStopClient };
      mockGetFeishuWSClient.mockReturnValue(mockClient);
      const ctx = makeContext();
      await adapter.initialize(ctx);
      await adapter.start();
      await adapter.stop();
      expect(mockStopClient).toHaveBeenCalledTimes(1);
      expect(adapter.getStatus().running).toBe(false);
    });

    it('handles stop error gracefully', async () => {
      mockGetFeishuWSClient.mockImplementation(() => {
        throw new Error('client error');
      });
      const ctx = makeContext();
      await adapter.initialize(ctx);
      await adapter.start();
      mockGetFeishuWSClient.mockImplementation(() => { throw new Error('client error'); });
      await adapter.stop();
      // should not throw
    });
  });

  describe('healthCheck', () => {
    it('returns false if not running', async () => {
      expect(await adapter.healthCheck()).toBe(false);
    });

    it('returns true if running and client exists', async () => {
      mockGetFeishuWSClient.mockReturnValue({ some: 'client' });
      const ctx = makeContext();
      await adapter.initialize(ctx);
      await adapter.start();
      expect(await adapter.healthCheck()).toBe(true);
    });

    it('returns false if running but client is null', async () => {
      const ctx = makeContext();
      await adapter.initialize(ctx);
      await adapter.start();
      mockGetFeishuWSClient.mockReturnValue(null);
      expect(await adapter.healthCheck()).toBe(false);
    });

    it('returns false on exception', async () => {
      const ctx = makeContext();
      await adapter.initialize(ctx);
      await adapter.start();
      mockGetFeishuWSClient.mockImplementation(() => { throw new Error('boom'); });
      expect(await adapter.healthCheck()).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('returns not running by default', () => {
      const status = adapter.getStatus();
      expect(status.running).toBe(false);
      expect(status.uptime).toBe(0);
      expect(status.connections).toBe(0);
    });

    it('returns uptime when running', async () => {
      const ctx = makeContext();
      await adapter.initialize(ctx);
      await adapter.start();
      const status = adapter.getStatus();
      expect(status.running).toBe(true);
      expect(status.uptime).toBeGreaterThanOrEqual(0);
      expect(status.connections).toBe(1);
    });
  });
});
