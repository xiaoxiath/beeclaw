import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockState = {
  set: vi.fn(async () => {}),
  getEntry: vi.fn(async () => ({ value: 'test-value', createdAt: Date.now(), updatedAt: Date.now() })),
  delete: vi.fn(async () => true),
  exists: vi.fn(async () => true),
  keys: vi.fn(async () => ['key1', 'key2']),
  getStats: vi.fn(async () => ({ totalKeys: 2, memoryUsage: 100 })),
  guardedUpdate: vi.fn(async () => {}),
  acquireLock: vi.fn(async () => vi.fn(() => {})),
};

vi.mock('../state', () => ({
  getSharedState: vi.fn(() => mockState),
}));

vi.mock('../state-tools-consolidated', () => ({
  formatStateEntry: vi.fn((key: string, entry: any) => `Key: ${key}, Value: ${JSON.stringify(entry?.value)}`),
  formatStateStats: vi.fn((stats: any) => `Stats: ${JSON.stringify(stats)}`),
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

// ============================================================================
// Additional comprehensive tests
// ============================================================================

import {
  executeStateLock,
  executeStateUnlock,
  executeStateLockManage,
} from '../state-executor';

describe('state-executor — executeStateSet edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.getEntry.mockResolvedValue({ value: 'test-value', createdAt: Date.now(), updatedAt: Date.now() });
  });

  it('passes ttl and metadata to state.set', async () => {
    await executeStateSet({ key: 'k', value: 'v', ttl: 5000, metadata: { tag: 'x' } });

    expect(mockState.set).toHaveBeenCalledWith('k', 'v', 5000, { tag: 'x' });
  });

  it('returns formatted output with key', async () => {
    const result = await executeStateSet({ key: 'mykey', value: 42 });

    expect(result.success).toBe(true);
    expect(result.output).toContain('stored successfully');
    expect(result.data).toEqual({ key: 'mykey', ttl: undefined });
  });

  it('returns error result when state.set throws', async () => {
    mockState.set.mockRejectedValueOnce(new Error('Storage full'));

    const result = await executeStateSet({ key: 'k', value: 'v' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('Storage full');
    expect(result.error).toBe('Storage full');
  });

  it('handles non-Error throw in state.set', async () => {
    mockState.set.mockRejectedValueOnce('plain string error');

    const result = await executeStateSet({ key: 'k', value: 'v' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unknown error');
  });
});

describe('state-executor — executeStateGet edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.getEntry.mockResolvedValue({ value: 'test-value', createdAt: Date.now(), updatedAt: Date.now() });
  });

  it('returns data.value and data.found=true when found', async () => {
    const result = await executeStateGet({ key: 'existing' });

    expect(result.data?.found).toBe(true);
    expect(result.data?.value).toBe('test-value');
  });

  it('returns data.found=false when not found', async () => {
    mockState.getEntry.mockResolvedValueOnce(null);

    const result = await executeStateGet({ key: 'missing' });

    expect(result.data?.found).toBe(false);
    expect(result.output).toContain('not found');
  });

  it('returns error on exception', async () => {
    mockState.getEntry.mockRejectedValueOnce(new Error('Read failed'));

    const result = await executeStateGet({ key: 'k' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Read failed');
  });
});

describe('state-executor — executeStateDelete edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns data.existed=true when key existed', async () => {
    mockState.delete.mockResolvedValueOnce(true);
    const result = await executeStateDelete({ key: 'k' });
    expect(result.data?.existed).toBe(true);
  });

  it('returns data.existed=false when key did not exist', async () => {
    mockState.delete.mockResolvedValueOnce(false);
    const result = await executeStateDelete({ key: 'k' });
    expect(result.data?.existed).toBe(false);
  });

  it('returns error on exception', async () => {
    mockState.delete.mockRejectedValueOnce(new Error('Delete failed'));
    const result = await executeStateDelete({ key: 'k' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Delete failed');
  });
});

describe('state-executor — executeStateUpdate all operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.getEntry.mockResolvedValue({ value: 'updated', createdAt: Date.now(), updatedAt: Date.now() });
  });

  it('increment: adds value to current (default 1)', async () => {
    let capturedUpdater: any;
    mockState.guardedUpdate.mockImplementationOnce(async (_k: string, fn: any) => {
      capturedUpdater = fn;
    });

    await executeStateUpdate({ key: 'counter', operation: 'increment' });

    expect(capturedUpdater(5)).toBe(6);   // 5 + 1 (default)
    expect(capturedUpdater(null)).toBe(1); // null → 0 + 1
  });

  it('increment: uses provided value', async () => {
    let capturedUpdater: any;
    mockState.guardedUpdate.mockImplementationOnce(async (_k: string, fn: any) => {
      capturedUpdater = fn;
    });

    await executeStateUpdate({ key: 'counter', operation: 'increment', value: 10 });

    expect(capturedUpdater(5)).toBe(15);
  });

  it('decrement: subtracts value from current (default 1)', async () => {
    let capturedUpdater: any;
    mockState.guardedUpdate.mockImplementationOnce(async (_k: string, fn: any) => {
      capturedUpdater = fn;
    });

    await executeStateUpdate({ key: 'counter', operation: 'decrement' });

    expect(capturedUpdater(10)).toBe(9);    // 10 - 1
    expect(capturedUpdater(null)).toBe(-1); // 0 - 1
  });

  it('decrement: uses provided value', async () => {
    let capturedUpdater: any;
    mockState.guardedUpdate.mockImplementationOnce(async (_k: string, fn: any) => {
      capturedUpdater = fn;
    });

    await executeStateUpdate({ key: 'counter', operation: 'decrement', value: 3 });

    expect(capturedUpdater(10)).toBe(7);
  });

  it('append: adds to end of array', async () => {
    let capturedUpdater: any;
    mockState.guardedUpdate.mockImplementationOnce(async (_k: string, fn: any) => {
      capturedUpdater = fn;
    });

    await executeStateUpdate({ key: 'list', operation: 'append', value: 'new' });

    expect(capturedUpdater(['a', 'b'])).toEqual(['a', 'b', 'new']);
    expect(capturedUpdater(null)).toEqual(['new']); // null → []
  });

  it('prepend: adds to start of array', async () => {
    let capturedUpdater: any;
    mockState.guardedUpdate.mockImplementationOnce(async (_k: string, fn: any) => {
      capturedUpdater = fn;
    });

    await executeStateUpdate({ key: 'list', operation: 'prepend', value: 'first' });

    expect(capturedUpdater(['a', 'b'])).toEqual(['first', 'a', 'b']);
    expect(capturedUpdater(null)).toEqual(['first']); // null → []
  });

  it('merge: merges objects', async () => {
    let capturedUpdater: any;
    mockState.guardedUpdate.mockImplementationOnce(async (_k: string, fn: any) => {
      capturedUpdater = fn;
    });

    await executeStateUpdate({ key: 'obj', operation: 'merge', value: { b: 2 } });

    expect(capturedUpdater({ a: 1 })).toEqual({ a: 1, b: 2 });
    expect(capturedUpdater(null)).toEqual({ b: 2 }); // null → {}
  });

  it('replace: replaces entirely', async () => {
    let capturedUpdater: any;
    mockState.guardedUpdate.mockImplementationOnce(async (_k: string, fn: any) => {
      capturedUpdater = fn;
    });

    await executeStateUpdate({ key: 'val', operation: 'replace', value: 'new-value' });

    expect(capturedUpdater('old')).toBe('new-value');
    expect(capturedUpdater(null)).toBe('new-value');
  });

  it('passes ttl to guardedUpdate', async () => {
    await executeStateUpdate({ key: 'k', operation: 'increment', value: 1, ttl: 3000 });

    expect(mockState.guardedUpdate).toHaveBeenCalledWith('k', expect.any(Function), 3000);
  });

  it('returns operation in output', async () => {
    const result = await executeStateUpdate({ key: 'k', operation: 'increment', value: 1 });
    expect(result.output).toContain('increment');
    expect(result.data).toEqual({ key: 'k', operation: 'increment' });
  });

  it('returns error on guardedUpdate failure', async () => {
    mockState.guardedUpdate.mockRejectedValueOnce(new Error('Lock contention'));

    const result = await executeStateUpdate({ key: 'k', operation: 'increment', value: 1 });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Lock contention');
  });
});

describe('state-executor — executeStateExists edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns exists=false when key does not exist', async () => {
    mockState.exists.mockResolvedValueOnce(false);

    const result = await executeStateExists({ key: 'gone' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('does not exist');
    expect(result.data?.exists).toBe(false);
  });

  it('returns error on exception', async () => {
    mockState.exists.mockRejectedValueOnce(new Error('Check failed'));

    const result = await executeStateExists({ key: 'k' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Check failed');
  });
});

describe('state-executor — executeStateList edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.getEntry.mockResolvedValue({ value: 'test-value', createdAt: Date.now(), updatedAt: Date.now() });
  });

  it('returns empty message when no keys exist', async () => {
    mockState.keys.mockResolvedValueOnce([]);

    const result = await executeStateList({});

    expect(result.success).toBe(true);
    expect(result.output).toContain('No keys in state store');
    expect(result.data?.total).toBe(0);
  });

  it('returns empty message when no keys match prefix', async () => {
    mockState.keys.mockResolvedValueOnce(['other:key']);

    const result = await executeStateList({ prefix: 'missing:' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('No keys found with prefix');
    expect(result.data?.total).toBe(0);
  });

  it('truncates long value previews with ellipsis', async () => {
    const longValue = 'x'.repeat(100);
    mockState.keys.mockResolvedValueOnce(['long-key']);
    mockState.getEntry.mockResolvedValueOnce({ value: longValue, createdAt: Date.now(), updatedAt: Date.now() });

    const result = await executeStateList({});

    expect(result.output).toContain('...');
  });

  it('skips null entries in the loop', async () => {
    mockState.keys.mockResolvedValueOnce(['key1', 'key2']);
    mockState.getEntry
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ value: 'found', createdAt: Date.now(), updatedAt: Date.now() });

    const result = await executeStateList({});

    expect(result.success).toBe(true);
    expect(result.output).toContain('key2');
  });

  it('returns error on exception', async () => {
    mockState.keys.mockRejectedValueOnce(new Error('List failed'));

    const result = await executeStateList({});

    expect(result.success).toBe(false);
    expect(result.error).toBe('List failed');
  });
});

describe('state-executor — executeStateStats edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns formatted stats', async () => {
    const result = await executeStateStats();
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it('returns error on exception', async () => {
    mockState.getStats.mockRejectedValueOnce(new Error('Stats failed'));

    const result = await executeStateStats();

    expect(result.success).toBe(false);
    expect(result.error).toBe('Stats failed');
  });
});

describe('state-executor — executeStateLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('acquires lock and returns success', async () => {
    const releaseFn = vi.fn();
    mockState.acquireLock.mockResolvedValueOnce(releaseFn);

    const result = await executeStateLock({ key: 'lock-key', owner: 'user-1', timeout: 5000 });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Lock acquired');
    expect(result.output).toContain('lock-key');
    expect(result.output).toContain('user-1');
    expect(mockState.acquireLock).toHaveBeenCalledWith('lock-key', 'user-1', 5000);
  });

  it('acquires lock without owner', async () => {
    mockState.acquireLock.mockResolvedValueOnce(vi.fn());

    const result = await executeStateLock({ key: 'lock-key' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Lock acquired');
  });

  it('returns error when lock acquisition fails', async () => {
    mockState.acquireLock.mockRejectedValueOnce(new Error('Lock timeout'));

    const result = await executeStateLock({ key: 'lock-key' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Lock timeout');
  });
});

describe('state-executor — executeStateUnlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('releases a previously acquired lock', async () => {
    const releaseFn = vi.fn();
    mockState.acquireLock.mockResolvedValueOnce(releaseFn);

    // First acquire
    await executeStateLock({ key: 'unlock-test' });

    // Then release
    const result = await executeStateUnlock({ key: 'unlock-test' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Lock released');
    expect(releaseFn).toHaveBeenCalled();
  });

  it('returns error when no lock found', async () => {
    const result = await executeStateUnlock({ key: 'no-such-lock' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Lock not found');
  });

  it('returns error when release function throws', async () => {
    const releaseFn = vi.fn(() => { throw new Error('Release failed'); });
    mockState.acquireLock.mockResolvedValueOnce(releaseFn);

    await executeStateLock({ key: 'error-lock' });

    const result = await executeStateUnlock({ key: 'error-lock' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Release failed');
  });
});

describe('state-executor — executeStateLockManage (consolidated)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches acquire action', async () => {
    mockState.acquireLock.mockResolvedValueOnce(vi.fn());

    const result = await executeStateLockManage({
      action: 'acquire',
      key: 'managed-lock',
      owner: 'owner-1',
      timeout: 3000,
    });

    expect(result.success).toBe(true);
  });

  it('dispatches release action', async () => {
    // Acquire first
    mockState.acquireLock.mockResolvedValueOnce(vi.fn());
    await executeStateLock({ key: 'managed-release' });

    const result = await executeStateLockManage({
      action: 'release',
      key: 'managed-release',
    });

    expect(result.success).toBe(true);
  });

  it('returns error for unknown action', async () => {
    const result = await executeStateLockManage({
      action: 'bad' as any,
      key: 'k',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid action');
  });
});

describe('state-executor — executeStateManage update action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.getEntry.mockResolvedValue({ value: 'updated', createdAt: Date.now(), updatedAt: Date.now() });
  });

  it('dispatches update action correctly', async () => {
    const result = await executeStateManage({
      action: 'update',
      key: 'k',
      operation: 'increment',
      value: 5,
      ttl: 1000,
    });

    expect(result.success).toBe(true);
    expect(mockState.guardedUpdate).toHaveBeenCalled();
  });
});

describe('state-executor — executeStateQuery unknown action', () => {
  it('returns error for unknown action', async () => {
    const result = await executeStateQuery({ action: 'invalid' as any });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid action');
  });
});
