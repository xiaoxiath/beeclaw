/**
 * SharedState Tests
 *
 * Unit tests for the shared state management system
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { SharedState, initSharedState, getSharedState, resetSharedState } from '../state';
describe('SharedState', () => {
  let state: SharedState;

  beforeEach(() => {
    state = new SharedState({
      enableAutoCleanup: false, // Disable for tests
    });
  });

  afterEach(() => {
    state.destroy();
  });

  describe('Basic Operations', () => {
    test('should set and get a value', async () => {
      await state.set('test', 'value');
      const result = await state.get('test');
      expect(result).toBe('value');
    });

    test('should return undefined for non-existent key', async () => {
      const result = await state.get('nonexistent');
      expect(result).toBeUndefined();
    });

    test('should delete a value', async () => {
      await state.set('test', 'value');
      const deleted = await state.delete('test');
      expect(deleted).toBe(true);

      const result = await state.get('test');
      expect(result).toBeUndefined();
    });

    test('should return false when deleting non-existent key', async () => {
      const deleted = await state.delete('nonexistent');
      expect(deleted).toBe(false);
    });

    test('should check if key exists', async () => {
      await state.set('test', 'value');
      expect(await state.exists('test')).toBe(true);
      expect(await state.exists('nonexistent')).toBe(false);
    });

    test('should clear all entries', async () => {
      await state.set('key1', 'value1');
      await state.set('key2', 'value2');

      await state.clear();

      expect(await state.exists('key1')).toBe(false);
      expect(await state.exists('key2')).toBe(false);
    });

    test('should list all keys', async () => {
      await state.set('key1', 'value1');
      await state.set('key2', 'value2');
      await state.set('key3', 'value3');

      const keys = await state.keys();
      expect(keys.sort()).toEqual(['key1', 'key2', 'key3']);
    });
  });

  describe('Metadata and TTL', () => {
    test('should store metadata', async () => {
      await state.set('test', 'value', undefined, { source: 'test' });

      const entry = await state.getEntry('test');
      expect(entry?.metadata).toEqual({ source: 'test' });
    });

    test('should set TTL', async () => {
      await state.set('test', 'value', 1000); // 1 second

      const entry = await state.getEntry('test');
      expect(entry?.ttl).toBe(1000);
      expect(entry?.expiresAt).toBeDefined();
    });

    test('should expire entries', async () => {
      await state.set('test', 'value', 100); // 100ms

      // Should exist immediately
      expect(await state.get('test')).toBe('value');

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should be expired
      expect(await state.get('test')).toBeUndefined();
    });

    test('should cleanup expired entries', async () => {
      await state.set('test1', 'value1', 100);
      await state.set('test2', 'value2', 100);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));

      const removed = await state.cleanup();
      expect(removed).toBe(2);

      const keys = await state.keys();
      expect(keys.length).toBe(0);
    });

    test('should track creation and update times', async () => {
      const before = new Date();
      await state.set('test', 'value');
      const after = new Date();

      const entry = await state.getEntry('test');
      expect(entry?.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(entry?.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(entry?.updatedAt.getTime()).toBe(entry?.createdAt.getTime());
    });

    test('should update updatedAt on modification', async () => {
      await state.set('test', 'value1');
      const entry1 = await state.getEntry('test');

      await new Promise(resolve => setTimeout(resolve, 10));

      await state.set('test', 'value2');
      const entry2 = await state.getEntry('test');

      expect(entry2?.updatedAt.getTime()).toBeGreaterThan(entry1?.updatedAt.getTime() || 0);
    });
  });

  describe('Atomic Updates', () => {
    test('should increment value', async () => {
      await state.set('counter', 5);
      await state.update('counter', (current) => (current || 0) + 1);

      const result = await state.get('counter');
      expect(result).toBe(6);
    });

    test('should decrement value', async () => {
      await state.set('counter', 5);
      await state.update('counter', (current) => (current || 0) - 1);

      const result = await state.get('counter');
      expect(result).toBe(4);
    });

    test('should append to array', async () => {
      await state.set('items', [1, 2]);
      await state.update('items', (current) => [...(current || []), 3]);

      const result = await state.get('items');
      expect(result).toEqual([1, 2, 3]);
    });

    test('should prepend to array', async () => {
      await state.set('items', [2, 3]);
      await state.update('items', (current) => [1, ...(current || [])]);

      const result = await state.get('items');
      expect(result).toEqual([1, 2, 3]);
    });

    test('should merge objects', async () => {
      await state.set('config', { a: 1 });
      await state.update('config', (current) => ({ ...(current || {}), b: 2 }));

      const result = await state.get('config');
      expect(result).toEqual({ a: 1, b: 2 });
    });

    test('should handle undefined current value in update', async () => {
      await state.update('newkey', (current) => current || 'default');

      const result = await state.get('newkey');
      expect(result).toBe('default');
    });

    test('should update TTL during atomic update', async () => {
      await state.set('test', 'value', 1000);
      await state.update('test', (current) => current, 2000);

      const entry = await state.getEntry('test');
      expect(entry?.ttl).toBe(2000);
    });
  });

  describe('Locking', () => {
    test('should acquire and release lock', async () => {
      const release = await state.acquireLock('test');

      expect(state.isLocked('test')).toBe(true);

      release();

      expect(state.isLocked('test')).toBe(false);
    });

    test('should wait for existing lock', async () => {
      const release1 = await state.acquireLock('test');

      let lock2Acquired = false;
      const lock2Promise = state.acquireLock('test').then((release2) => {
        lock2Acquired = true;
        release2();
      });

      // Lock 2 should not be acquired yet
      expect(lock2Acquired).toBe(false);

      // Release lock 1
      release1();

      // Now lock 2 should be acquired
      await lock2Promise;
      expect(lock2Acquired).toBe(true);
    });

    test('should timeout on lock acquisition', async () => {
      const release1 = await state.acquireLock('test');

      await expect(
        state.acquireLock('test', undefined, 100) // 100ms timeout
      ).rejects.toThrow('Lock acquisition timeout');

      release1();
    });

    test('should support lock owner', async () => {
      const release = await state.acquireLock('test', 'owner1');

      expect(state.isLocked('test')).toBe(true);

      release();

      expect(state.isLocked('test')).toBe(false);
    });
  });

  describe('Subscriptions', () => {
    test('should notify on set', async () => {
      let notified = false;
      let newValue: any;
      let oldValue: any;

      state.subscribe('test', (newV, oldV) => {
        notified = true;
        newValue = newV;
        oldValue = oldV;
      });

      await state.set('test', 'value');

      expect(notified).toBe(true);
      expect(newValue).toBe('value');
      expect(oldValue).toBeUndefined();
    });

    test('should notify on update', async () => {
      await state.set('test', 'value1');

      let notified = false;
      let newValue: any;
      let oldValue: any;

      state.subscribe('test', (newV, oldV) => {
        notified = true;
        newValue = newV;
        oldValue = oldV;
      });

      await state.set('test', 'value2');

      expect(notified).toBe(true);
      expect(newValue).toBe('value2');
      expect(oldValue).toBe('value1');
    });

    test('should notify on delete', async () => {
      await state.set('test', 'value');

      let notified = false;
      let newValue: any;
      let oldValue: any;

      state.subscribe('test', (newV, oldV) => {
        notified = true;
        newValue = newV;
        oldValue = oldV;
      });

      await state.delete('test');

      expect(notified).toBe(true);
      expect(newValue).toBeUndefined();
      expect(oldValue).toBe('value');
    });

    test('should support wildcard subscriptions', async () => {
      const notifications: Array<{ key: string; value: any }> = [];

      state.subscribe('*', (newV, oldV, key) => {
        notifications.push({ key, value: newV });
      });

      await state.set('key1', 'value1');
      await state.set('key2', 'value2');

      expect(notifications.length).toBe(2);
      expect(notifications[0]).toEqual({ key: 'key1', value: 'value1' });
      expect(notifications[1]).toEqual({ key: 'key2', value: 'value2' });
    });

    test('should support one-time subscriptions', async () => {
      let callCount = 0;

      state.once('test', () => {
        callCount++;
      });

      await state.set('test', 'value1');
      await state.set('test', 'value2');

      expect(callCount).toBe(1);
    });

    test('should unsubscribe', async () => {
      let callCount = 0;

      const unsubscribe = state.subscribe('test', () => {
        callCount++;
      });

      await state.set('test', 'value1');
      expect(callCount).toBe(1);

      unsubscribe();

      await state.set('test', 'value2');
      expect(callCount).toBe(1); // Should not increase
    });

    test('should handle errors in subscription callbacks', async () => {
      let notified = false;

      state.subscribe('test', () => {
        throw new Error('Test error');
      });

      state.subscribe('test', () => {
        notified = true;
      });

      // Should not throw
      await state.set('test', 'value');

      // Second subscription should still be called
      expect(notified).toBe(true);
    });
  });

  describe('Statistics', () => {
    test('should return statistics', async () => {
      await state.set('key1', 'value1');
      await state.set('key2', 'value2');

      const stats = await state.getStats();

      expect(stats.totalEntries).toBe(2);
      expect(stats.lockedKeys).toBe(0);
      expect(stats.activeSubscriptions).toBe(0);
      expect(stats.expiredEntries).toBe(0);
      expect(stats.estimatedMemoryUsage).toBeGreaterThan(0);
    });

    test('should count locked keys', async () => {
      await state.acquireLock('key1');
      await state.acquireLock('key2');

      const stats = await state.getStats();

      expect(stats.lockedKeys).toBe(2);
    });

    test('should count subscriptions', async () => {
      state.subscribe('key1', () => {});
      state.subscribe('key2', () => {});
      state.subscribe('*', () => {});

      const stats = await state.getStats();

      expect(stats.activeSubscriptions).toBe(3);
    });
  });

  describe('Import/Export', () => {
    test('should export state to JSON', async () => {
      await state.set('key1', 'value1');
      await state.set('key2', { nested: 'value2' });

      const json = await state.export();
      const data = JSON.parse(json);

      expect(data['key1'].value).toBe('value1');
      expect(data['key2'].value).toEqual({ nested: 'value2' });
    });

    test('should import state from JSON', async () => {
      const json = JSON.stringify({
        key1: {
          value: 'value1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        key2: {
          value: { nested: 'value2' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

      await state.import(json);

      expect(await state.get('key1')).toBe('value1');
      expect(await state.get('key2')).toEqual({ nested: 'value2' });
    });

    test('should merge on import', async () => {
      await state.set('key1', 'old_value');

      const json = JSON.stringify({
        key2: {
          value: 'new_value',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

      await state.import(json, true); // merge = true

      expect(await state.get('key1')).toBe('old_value');
      expect(await state.get('key2')).toBe('new_value');
    });

    test('should replace on import', async () => {
      await state.set('key1', 'old_value');

      const json = JSON.stringify({
        key2: {
          value: 'new_value',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

      await state.import(json, false); // merge = false

      expect(await state.get('key1')).toBeUndefined();
      expect(await state.get('key2')).toBe('new_value');
    });
  });

  describe('Configuration', () => {
    test('should respect maxEntries limit', async () => {
      const limitedState = new SharedState({
        maxEntries: 2,
        enableAutoCleanup: false,
      });

      await limitedState.set('key1', 'value1');
      await limitedState.set('key2', 'value2');

      await expect(limitedState.set('key3', 'value3')).rejects.toThrow(
        'Maximum entries limit (2) reached'
      );

      limitedState.destroy();
    });

    test('should allow updating existing key even with maxEntries', async () => {
      const limitedState = new SharedState({
        maxEntries: 1,
        enableAutoCleanup: false,
      });

      await limitedState.set('key1', 'value1');
      await limitedState.set('key1', 'value2'); // Update existing

      expect(await limitedState.get('key1')).toBe('value2');

      limitedState.destroy();
    });

    test('should use default TTL', async () => {
      const ttlState = new SharedState({
        defaultTtl: 1000,
        enableAutoCleanup: false,
      });

      await ttlState.set('test', 'value');

      const entry = await ttlState.getEntry('test');
      expect(entry?.ttl).toBe(1000);
      expect(entry?.expiresAt).toBeDefined();

      ttlState.destroy();
    });
  });

  describe('Edge Cases', () => {
    test('should handle complex nested objects', async () => {
      const complex = {
        level1: {
          level2: {
            level3: [
              { id: 1, data: 'test' },
              { id: 2, data: 'test2' },
            ],
          },
        },
      };

      await state.set('complex', complex);
      const result = await state.get('complex');

      expect(result).toEqual(complex);
    });

    test('should handle null values', async () => {
      await state.set('null', null);
      const result = await state.get('null');
      expect(result).toBeNull();
    });

    test('should handle empty string', async () => {
      await state.set('empty', '');
      const result = await state.get('empty');
      expect(result).toBe('');
    });

    test('should handle array values', async () => {
      const array = [1, 2, 3, 'four', { five: 5 }];
      await state.set('array', array);
      const result = await state.get('array');
      expect(result).toEqual(array);
    });

    test('should handle boolean values', async () => {
      await state.set('true', true);
      await state.set('false', false);

      expect(await state.get('true')).toBe(true);
      expect(await state.get('false')).toBe(false);
    });

    test('should handle numeric values', async () => {
      await state.set('int', 42);
      await state.set('float', 3.14159);
      await state.set('zero', 0);
      await state.set('negative', -100);

      expect(await state.get('int')).toBe(42);
      expect(await state.get('float')).toBe(3.14159);
      expect(await state.get('zero')).toBe(0);
      expect(await state.get('negative')).toBe(-100);
    });
  });

  describe('Singleton Management', () => {
    test('should initialize singleton', () => {
      const instance = initSharedState({ enableAutoCleanup: false });

      expect(instance).toBeInstanceOf(SharedState);
      expect(getSharedState()).toBe(instance);

      instance.destroy();
    });

    test('should throw if not initialized', () => {
      resetSharedState();

      expect(() => getSharedState()).toThrow(
        'SharedState not initialized. Call initSharedState() first.'
      );
    });

    test('should replace existing instance on re-init', () => {
      const instance1 = initSharedState({ enableAutoCleanup: false });
      const instance2 = initSharedState({ enableAutoCleanup: false });

      expect(instance2).not.toBe(instance1);
      expect(getSharedState()).toBe(instance2);

      instance2.destroy();
    });
  });
});
