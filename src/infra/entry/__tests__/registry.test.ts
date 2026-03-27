/**
 * Adapter Registry Tests
 *
 * 测试 Entry Adapter 注册表的功能
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { adapterRegistry } from '../registry';
import type { EntryAdapter } from '../types';

// Mock adapter factory
function createMockAdapter(overrides: Partial<EntryAdapter> = {}): EntryAdapter {
  return {
    name: 'test-adapter',
    type: 'test',
    description: 'Test adapter',
    status: 'stopped',
    config: {},
    start: async () => {},
    stop: async () => {},
    handle: async () => ({ success: true, data: 'test' }),
    getStatus: () => ({ status: 'stopped', healthy: true }),
    validateConfig: () => ({ valid: true }),
    ...overrides,
  };
}

describe('AdapterRegistry', () => {
  beforeEach(() => {
    adapterRegistry.clear();
  });

  afterEach(() => {
    adapterRegistry.clear();
  });

  describe('register', () => {
    test('should register an adapter', () => {
      const adapter = createMockAdapter({ name: 'adapter1' });

      adapterRegistry.register(adapter);

      const retrieved = adapterRegistry.get('adapter1');
      expect(retrieved).toBe(adapter);
    });

    test('should throw error when registering duplicate adapter', () => {
      const adapter1 = createMockAdapter({ name: 'adapter1' });
      const adapter2 = createMockAdapter({ name: 'adapter1' });

      adapterRegistry.register(adapter1);

      expect(() => adapterRegistry.register(adapter2)).toThrow(
        'Adapter "adapter1" already registered'
      );
    });

    test('should register multiple adapters with different names', () => {
      const adapter1 = createMockAdapter({ name: 'adapter1' });
      const adapter2 = createMockAdapter({ name: 'adapter2' });

      adapterRegistry.register(adapter1);
      adapterRegistry.register(adapter2);

      expect(adapterRegistry.get('adapter1')).toBe(adapter1);
      expect(adapterRegistry.get('adapter2')).toBe(adapter2);
    });
  });

  describe('get', () => {
    test('should return undefined for non-existent adapter', () => {
      const result = adapterRegistry.get('non-existent');

      expect(result).toBeUndefined();
    });

    test('should return registered adapter', () => {
      const adapter = createMockAdapter({ name: 'test-adapter' });
      adapterRegistry.register(adapter);

      const result = adapterRegistry.get('test-adapter');

      expect(result).toBe(adapter);
    });
  });

  describe('getAll', () => {
    test('should return empty array when no adapters registered', () => {
      const adapters = adapterRegistry.getAll();

      expect(adapters).toEqual([]);
    });

    test('should return all registered adapters', () => {
      const adapter1 = createMockAdapter({ name: 'adapter1' });
      const adapter2 = createMockAdapter({ name: 'adapter2' });
      const adapter3 = createMockAdapter({ name: 'adapter3' });

      adapterRegistry.register(adapter1);
      adapterRegistry.register(adapter2);
      adapterRegistry.register(adapter3);

      const adapters = adapterRegistry.getAll();

      expect(adapters).toHaveLength(3);
      expect(adapters).toContain(adapter1);
      expect(adapters).toContain(adapter2);
      expect(adapters).toContain(adapter3);
    });
  });

  describe('getByType', () => {
    test('should return empty array when no adapters match type', () => {
      const adapter = createMockAdapter({ name: 'adapter1', type: 'cli' });
      adapterRegistry.register(adapter);

      const result = adapterRegistry.getByType('feishu');

      expect(result).toEqual([]);
    });

    test('should return adapters matching type', () => {
      const cliAdapter1 = createMockAdapter({ name: 'cli1', type: 'cli' });
      const cliAdapter2 = createMockAdapter({ name: 'cli2', type: 'cli' });
      const feishuAdapter = createMockAdapter({ name: 'feishu1', type: 'feishu' });

      adapterRegistry.register(cliAdapter1);
      adapterRegistry.register(cliAdapter2);
      adapterRegistry.register(feishuAdapter);

      const cliAdapters = adapterRegistry.getByType('cli');

      expect(cliAdapters).toHaveLength(2);
      expect(cliAdapters).toContain(cliAdapter1);
      expect(cliAdapters).toContain(cliAdapter2);
    });
  });

  describe('startAll', () => {
    test('should start all registered adapters', async () => {
      const adapter1 = createMockAdapter({
        name: 'adapter1',
        start: async () => {
          adapter1.status = 'running';
        },
      });
      const adapter2 = createMockAdapter({
        name: 'adapter2',
        start: async () => {
          adapter2.status = 'running';
        },
      });

      adapterRegistry.register(adapter1);
      adapterRegistry.register(adapter2);

      await adapterRegistry.startAll();

      expect(adapter1.status).toBe('running');
      expect(adapter2.status).toBe('running');
    });

    test('should throw error if adapter fails to start', async () => {
      const adapter = createMockAdapter({
        name: 'failing-adapter',
        start: async () => {
          throw new Error('Start failed');
        },
      });

      adapterRegistry.register(adapter);

      await expect(adapterRegistry.startAll()).rejects.toThrow('Start failed');
    });

    test('should not start adapters if already initialized', async () => {
      const adapter = createMockAdapter({
        name: 'adapter1',
        start: async () => {
          adapter.status = 'running';
        },
      });

      adapterRegistry.register(adapter);

      await adapterRegistry.startAll();

      // Second call should be no-op
      await adapterRegistry.startAll();

      expect(adapter.status).toBe('running');
    });

    test('should handle empty registry', async () => {
      await adapterRegistry.startAll();
      // Should not throw
    });
  });

  describe('stopAll', () => {
    test('should stop all running adapters', async () => {
      const adapter1 = createMockAdapter({
        name: 'adapter1',
        status: 'running',
        stop: async () => {
          adapter1.status = 'stopped';
        },
      });
      const adapter2 = createMockAdapter({
        name: 'adapter2',
        status: 'running',
        stop: async () => {
          adapter2.status = 'stopped';
        },
      });

      adapterRegistry.register(adapter1);
      adapterRegistry.register(adapter2);

      await adapterRegistry.stopAll();

      expect(adapter1.status).toBe('stopped');
      expect(adapter2.status).toBe('stopped');
    });

    test('should continue stopping other adapters if one fails', async () => {
      const adapter1 = createMockAdapter({
        name: 'adapter1',
        status: 'running',
        stop: async () => {
          throw new Error('Stop failed');
        },
      });
      const adapter2 = createMockAdapter({
        name: 'adapter2',
        status: 'running',
        stop: async () => {
          adapter2.status = 'stopped';
        },
      });

      adapterRegistry.register(adapter1);
      adapterRegistry.register(adapter2);

      await adapterRegistry.stopAll();

      expect(adapter2.status).toBe('stopped');
    });

    test('should handle empty registry', async () => {
      await adapterRegistry.stopAll();
      // Should not throw
    });
  });

  describe('getAllStatuses', () => {
    test('should return statuses of all adapters', () => {
      const adapter1 = createMockAdapter({
        name: 'adapter1',
        getStatus: () => ({ status: 'running', healthy: true }),
      });
      const adapter2 = createMockAdapter({
        name: 'adapter2',
        getStatus: () => ({ status: 'stopped', healthy: false }),
      });

      adapterRegistry.register(adapter1);
      adapterRegistry.register(adapter2);

      const statuses = adapterRegistry.getAllStatuses();

      expect(statuses).toEqual({
        adapter1: { status: 'running', healthy: true },
        adapter2: { status: 'stopped', healthy: false },
      });
    });

    test('should return empty object when no adapters registered', () => {
      const statuses = adapterRegistry.getAllStatuses();

      expect(statuses).toEqual({});
    });
  });

  describe('clear', () => {
    test('should clear all registered adapters', () => {
      const adapter1 = createMockAdapter({ name: 'adapter1' });
      const adapter2 = createMockAdapter({ name: 'adapter2' });

      adapterRegistry.register(adapter1);
      adapterRegistry.register(adapter2);

      adapterRegistry.clear();

      expect(adapterRegistry.getAll()).toEqual([]);
      expect(adapterRegistry.get('adapter1')).toBeUndefined();
      expect(adapterRegistry.get('adapter2')).toBeUndefined();
    });

    test('should reset initialized flag', async () => {
      const adapter = createMockAdapter({
        name: 'adapter1',
        start: async () => {
          adapter.status = 'running';
        },
      });

      adapterRegistry.register(adapter);
      await adapterRegistry.startAll();

      adapterRegistry.clear();

      // Should be able to start again after clear
      adapterRegistry.register(adapter);
      await adapterRegistry.startAll();
      // Should not throw
    });
  });

  describe('integration tests', () => {
    test('should support full lifecycle', async () => {
      const adapter = createMockAdapter({
        name: 'lifecycle-adapter',
        status: 'stopped',
        start: async () => {
          adapter.status = 'running';
        },
        stop: async () => {
          adapter.status = 'stopped';
        },
        getStatus: () => ({
          status: adapter.status,
          healthy: adapter.status === 'running',
        }),
      });

      // Register
      adapterRegistry.register(adapter);
      expect(adapterRegistry.get('lifecycle-adapter')).toBe(adapter);

      // Start
      await adapterRegistry.startAll();
      expect(adapter.status).toBe('running');

      // Check status
      const statuses = adapterRegistry.getAllStatuses();
      expect(statuses['lifecycle-adapter']).toEqual({
        status: 'running',
        healthy: true,
      });

      // Stop
      await adapterRegistry.stopAll();
      expect(adapter.status).toBe('stopped');

      // Clear
      adapterRegistry.clear();
      expect(adapterRegistry.getAll()).toEqual([]);
    });

    test('should handle multiple adapters with different types', async () => {
      const cliAdapter = createMockAdapter({
        name: 'cli',
        type: 'cli',
        start: async () => {
          cliAdapter.status = 'running';
        },
      });
      const feishuAdapter = createMockAdapter({
        name: 'feishu',
        type: 'feishu',
        start: async () => {
          feishuAdapter.status = 'running';
        },
      });

      adapterRegistry.register(cliAdapter);
      adapterRegistry.register(feishuAdapter);

      await adapterRegistry.startAll();

      const cliAdapters = adapterRegistry.getByType('cli');
      const feishuAdapters = adapterRegistry.getByType('feishu');

      expect(cliAdapters).toHaveLength(1);
      expect(cliAdapters[0]).toBe(cliAdapter);
      expect(feishuAdapters).toHaveLength(1);
      expect(feishuAdapters[0]).toBe(feishuAdapter);
    });
  });
});
