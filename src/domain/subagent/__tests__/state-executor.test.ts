import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockState = {
  set: mock(async () => {}),
  getEntry: mock(async () => ({ value: 'test-value', createdAt: Date.now(), updatedAt: Date.now() })),
  delete: mock(async () => true),
  exists: mock(async () => true),
  keys: mock(async () => ['key1', 'key2']),
  getStats: mock(async () => ({ totalKeys: 2, memoryUsage: 100 })),
  guardedUpdate: mock(async () => {}),
  acquireLock: mock(async () => mock(() => {})),
};

mock.module('../state', () => ({
  getSharedState: mock(() => mockState),
}));

mock.module('../state-tools-consolidated', () => ({
  formatStateEntry: mock((key: string, entry: any) => `Key: ${key}, Value: ${JSON.stringify(entry?.value)}`),
  formatStateStats: mock((stats: any) => `Stats: ${JSON.stringify(stats)}`),
}));

import {
  executeStateSet,
  executeStateGet,
  executeStateDelete,
  executeStateUpdate,
  executeStateExists,
  executeStateList,
  executeStateStats,
  executeStateManage,
  executeStateQuery,
} from '../state-executor';

describe('state-executor', () => {
  beforeEach(() => {
    mockState.set.mockClear();
    mockState.getEntry.mockClear();
    mockState.delete.mockClear();
    mockState.exists.mockClear();
    mockState.keys.mockClear();
  });

  describe('executeStateSet', () => {
    it('should store value and return success', async () => {
      const result = await executeStateSet({ key: 'mykey', value: 'myval' });
      expect(result.success).toBe(true);
      expect(mockState.set).toHaveBeenCalled();
    });
  });

  describe('executeStateGet', () => {
    it('should return found entry', async () => {
      const result = await executeStateGet({ key: 'mykey' });
      expect(result.success).toBe(true);
    });

    it('should handle missing key', async () => {
      mockState.getEntry.mockResolvedValueOnce(null);
      const result = await executeStateGet({ key: 'missing' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('not found');
    });
  });

  describe('executeStateDelete', () => {
    it('should delete existing key', async () => {
      const result = await executeStateDelete({ key: 'mykey' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('deleted');
    });

    it('should report when key did not exist', async () => {
      mockState.delete.mockResolvedValueOnce(false);
      const result = await executeStateDelete({ key: 'nope' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('did not exist');
    });
  });

  describe('executeStateUpdate', () => {
    it('should handle increment operation', async () => {
      const result = await executeStateUpdate({ key: 'counter', operation: 'increment', value: 1 });
      expect(result.success).toBe(true);
      expect(mockState.guardedUpdate).toHaveBeenCalled();
    });

    it('should handle append operation', async () => {
      const result = await executeStateUpdate({ key: 'list', operation: 'append', value: 'item' });
      expect(result.success).toBe(true);
    });

    it('should reject unknown operation', async () => {
      const result = await executeStateUpdate({ key: 'k', operation: 'unknown_op' as any, value: 1 });
      expect(result.success).toBe(false);
    });
  });

  describe('executeStateExists', () => {
    it('should confirm existing key', async () => {
      const result = await executeStateExists({ key: 'mykey' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('exists');
    });
  });

  describe('executeStateList', () => {
    it('should list all keys', async () => {
      const result = await executeStateList({});
      expect(result.success).toBe(true);
      expect(result.data?.total).toBe(2);
    });

    it('should filter by prefix', async () => {
      mockState.keys.mockResolvedValueOnce(['prefix:a', 'prefix:b', 'other:c']);
      const result = await executeStateList({ prefix: 'prefix:' });
      expect(result.success).toBe(true);
    });
  });

  describe('executeStateStats', () => {
    it('should return stats', async () => {
      const result = await executeStateStats();
      expect(result.success).toBe(true);
    });
  });

  describe('executeStateManage (consolidated)', () => {
    it('should dispatch set action', async () => {
      const result = await executeStateManage({ action: 'set', key: 'k', value: 'v' });
      expect(result.success).toBe(true);
    });

    it('should dispatch get action', async () => {
      const result = await executeStateManage({ action: 'get', key: 'k' });
      expect(result.success).toBe(true);
    });

    it('should dispatch delete action', async () => {
      const result = await executeStateManage({ action: 'delete', key: 'k' });
      expect(result.success).toBe(true);
    });

    it('should return error for unknown action', async () => {
      const result = await executeStateManage({ action: 'bad' as any, key: 'k' });
      expect(result.success).toBe(false);
    });
  });

  describe('executeStateQuery (consolidated)', () => {
    it('should dispatch list action', async () => {
      const result = await executeStateQuery({ action: 'list' });
      expect(result.success).toBe(true);
    });

    it('should dispatch exists action', async () => {
      const result = await executeStateQuery({ action: 'exists', key: 'k' });
      expect(result.success).toBe(true);
    });

    it('should dispatch stats action', async () => {
      const result = await executeStateQuery({ action: 'stats' });
      expect(result.success).toBe(true);
    });
  });
});
