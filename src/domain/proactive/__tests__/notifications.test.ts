import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  NotificationManager,
  getNotificationManager,
  resetNotificationManager,
} from '../notifications';

const TEST_NOTIFICATIONS_PATH = './test-notifications-data';

describe('NotificationManager', () => {
  let manager: NotificationManager;

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_NOTIFICATIONS_PATH)) {
      rmSync(TEST_NOTIFICATIONS_PATH, { recursive: true });
    }
    mkdirSync(TEST_NOTIFICATIONS_PATH, { recursive: true });
    resetNotificationManager();
    manager = new NotificationManager(TEST_NOTIFICATIONS_PATH);
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_NOTIFICATIONS_PATH)) {
      rmSync(TEST_NOTIFICATIONS_PATH, { recursive: true });
    }
    resetNotificationManager();
  });

  describe('constructor', () => {
    test('creates instance with base path', () => {
      expect(manager).toBeDefined();
    });
  });

  describe('init', () => {
    test('initializes storage', () => {
      manager.init();
      // init() ensures basePath directory exists (no 'notifications' subdirectory)
      expect(existsSync(TEST_NOTIFICATIONS_PATH)).toBe(true);
    });

    test('is idempotent', () => {
      manager.init();
      manager.init(); // Should not throw
    });
  });

  describe('create', () => {
    test('creates notification with required fields', () => {
      const result = manager.create({
        userId: 'user1',
        message: 'Test notification',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.userId).toBe('user1');
        expect(result.data.message).toBe('Test notification');
        expect(result.data.priority).toBe('normal');
        expect(result.data.id).toBeDefined();
        expect(result.data.createdAt).toBeDefined();
      }
    });

    test('creates notification with all options', () => {
      const result = manager.create({
        userId: 'user1',
        message: 'Urgent notification',
        priority: 'urgent',
        category: 'alert',
        scheduledFor: new Date(Date.now() + 3600000).toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        channels: ['cli', 'websocket'],
        metadata: { key: 'value' },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.priority).toBe('urgent');
        expect(result.data.category).toBe('alert');
        expect(result.data.delivery.channels).toEqual(['cli', 'websocket']);
        expect(result.data.metadata).toEqual({ key: 'value' });
      }
    });

    test('generates unique IDs', () => {
      const result1 = manager.create({ userId: 'user1', message: 'Test 1' });
      const result2 = manager.create({ userId: 'user1', message: 'Test 2' });

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      if (result1.success && result2.success) {
        expect(result1.data.id).not.toBe(result2.data.id);
      }
    });
  });

  describe('getPending', () => {
    test('returns pending notifications for user', () => {
      manager.create({ userId: 'user1', message: 'Test 1' });
      manager.create({ userId: 'user2', message: 'Test 2' });

      const pending = manager.getPending('user1');
      expect(pending.length).toBe(1);
      expect(pending[0].message).toBe('Test 1');
    });

    test('returns notifications for wildcard user', () => {
      manager.create({ userId: '*', message: 'Broadcast' });
      manager.create({ userId: 'user1', message: 'Personal' });

      const pending = manager.getPending('any-user');
      expect(pending.length).toBe(1);
      expect(pending[0].message).toBe('Broadcast');
    });

    test('excludes delivered notifications', () => {
      const result = manager.create({ userId: 'user1', message: 'Test' });
      if (result.success) {
        manager.markDelivered(result.data.id);
      }

      const pending = manager.getPending('user1');
      expect(pending.length).toBe(0);
    });

    test('excludes expired notifications', () => {
      manager.create({
        userId: 'user1',
        message: 'Expired',
        expiresAt: new Date(Date.now() - 1000).toISOString(), // 1 second ago
      });

      const pending = manager.getPending('user1');
      expect(pending.length).toBe(0);
    });

    test('excludes future scheduled notifications', () => {
      manager.create({
        userId: 'user1',
        message: 'Future',
        scheduledFor: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
      });

      const pending = manager.getPending('user1');
      expect(pending.length).toBe(0);
    });

    test('sorts by priority', () => {
      manager.create({ userId: 'user1', message: 'Low', priority: 'low' });
      manager.create({ userId: 'user1', message: 'Urgent', priority: 'urgent' });
      manager.create({ userId: 'user1', message: 'Normal', priority: 'normal' });

      const pending = manager.getPending('user1');
      expect(pending[0].priority).toBe('urgent');
      expect(pending[1].priority).toBe('normal');
      expect(pending[2].priority).toBe('low');
    });
  });

  describe('getAllPending', () => {
    test('returns all pending notifications', () => {
      manager.create({ userId: 'user1', message: 'Test 1' });
      manager.create({ userId: 'user2', message: 'Test 2' });

      const pending = manager.getAllPending();
      expect(pending.length).toBe(2);
    });
  });

  describe('markDelivered', () => {
    test('marks notification as delivered', () => {
      const result = manager.create({ userId: 'user1', message: 'Test' });
      expect(result.success).toBe(true);
      if (!result.success) return;

      const deliverResult = manager.markDelivered(result.data.id);
      expect(deliverResult.success).toBe(true);

      const pending = manager.getPending('user1');
      expect(pending.length).toBe(0);
    });

    test('moves to history', () => {
      const result = manager.create({ userId: 'user1', message: 'Test' });
      expect(result.success).toBe(true);
      if (!result.success) return;

      manager.markDelivered(result.data.id);

      const history = manager.getHistory();
      expect(history.length).toBe(1);
      expect(history[0].success).toBe(true);
    });

    test('returns error for non-existent notification', () => {
      const result = manager.markDelivered('non-existent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('markAttempted', () => {
    test('increments attempt count', () => {
      const result = manager.create({ userId: 'user1', message: 'Test' });
      expect(result.success).toBe(true);
      if (!result.success) return;

      manager.markAttempted(result.data.id);
      manager.markAttempted(result.data.id);

      const pending = manager.getAllPending();
      expect(pending[0].delivery.attempts).toBe(2);
    });

    test('moves to history after max attempts', () => {
      const result = manager.create({ userId: 'user1', message: 'Test' });
      expect(result.success).toBe(true);
      if (!result.success) return;

      // Default max attempts is 3
      manager.markAttempted(result.data.id);
      manager.markAttempted(result.data.id);
      manager.markAttempted(result.data.id);

      const pending = manager.getAllPending();
      expect(pending.length).toBe(0);

      const history = manager.getHistory();
      expect(history.length).toBe(1);
      expect(history[0].success).toBe(false);
    });
  });

  describe('delete', () => {
    test('deletes existing notification', () => {
      const result = manager.create({ userId: 'user1', message: 'Test' });
      expect(result.success).toBe(true);
      if (!result.success) return;

      const deleteResult = manager.delete(result.data.id);
      expect(deleteResult.success).toBe(true);

      const pending = manager.getAllPending();
      expect(pending.length).toBe(0);
    });

    test('returns error for non-existent notification', () => {
      const result = manager.delete('non-existent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('clearExpired', () => {
    test('clears expired notifications', () => {
      manager.create({
        userId: 'user1',
        message: 'Expired',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      manager.create({
        userId: 'user1',
        message: 'Valid',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });

      const cleared = manager.clearExpired();
      expect(cleared).toBe(1);

      const pending = manager.getAllPending();
      expect(pending.length).toBe(1);
    });

    test('moves expired to history', () => {
      manager.create({
        userId: 'user1',
        message: 'Expired',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });

      manager.clearExpired();

      const history = manager.getHistory();
      expect(history.length).toBe(1);
      expect(history[0].success).toBe(false);
    });
  });

  describe('getHistory', () => {
    test('returns notification history', () => {
      const result = manager.create({ userId: 'user1', message: 'Test' });
      expect(result.success).toBe(true);
      if (!result.success) return;

      manager.markDelivered(result.data.id);

      const history = manager.getHistory();
      expect(history.length).toBe(1);
    });

    test('respects limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        const result = manager.create({ userId: 'user1', message: `Test ${i}` });
        if (result.success) {
          manager.markDelivered(result.data.id);
        }
      }

      const history = manager.getHistory(5);
      expect(history.length).toBe(5);
    });
  });

  describe('getStats', () => {
    test('returns notification statistics', () => {
      manager.create({ userId: 'user1', message: 'Urgent', priority: 'urgent' });
      manager.create({ userId: 'user1', message: 'Normal', priority: 'normal' });
      manager.create({ userId: 'user1', message: 'Low', priority: 'low' });

      const stats = manager.getStats();
      expect(stats.pending).toBe(3);
      expect(stats.byPriority.urgent).toBe(1);
      expect(stats.byPriority.normal).toBe(1);
      expect(stats.byPriority.low).toBe(1);
    });
  });
});

describe('getNotificationManager', () => {
  beforeEach(() => {
    resetNotificationManager();
    if (existsSync(TEST_NOTIFICATIONS_PATH)) {
      rmSync(TEST_NOTIFICATIONS_PATH, { recursive: true });
    }
  });

  afterEach(() => {
    resetNotificationManager();
    if (existsSync(TEST_NOTIFICATIONS_PATH)) {
      rmSync(TEST_NOTIFICATIONS_PATH, { recursive: true });
    }
  });

  test('throws when not initialized', () => {
    expect(() => getNotificationManager()).toThrow('not initialized');
  });

  test('returns singleton instance', () => {
    const manager1 = getNotificationManager(TEST_NOTIFICATIONS_PATH);
    const manager2 = getNotificationManager();

    expect(manager1).toBe(manager2);
  });
});
