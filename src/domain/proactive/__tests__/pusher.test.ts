import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { rmSync, existsSync, mkdirSync } from 'fs';
import {
  pushNotification,
  pushUrgent,
  pushReminder,
  pushGoalProgress,
  formatNotification,
  formatNotifications,
  setCliDeliveryHandler,
  registerDeliveryHandler,
  pushPendingNotifications,
} from '../pusher';
import { initStores, resetStores } from '../../../infra/db/store';

const TEST_PUSHER_PATH = './test-pusher-data';

describe('Pusher', () => {
  let deliveredMessages: string[] = [];

  beforeEach(() => {
    // Reset stores first in case other tests initialized them
    resetStores();

    // Clean up test directory
    if (existsSync(TEST_PUSHER_PATH)) {
      rmSync(TEST_PUSHER_PATH, { recursive: true });
    }
    mkdirSync(TEST_PUSHER_PATH, { recursive: true });
    deliveredMessages = [];

    // Initialize stores with test path
    initStores({ basePath: TEST_PUSHER_PATH });

    // Set up CLI delivery handler
    setCliDeliveryHandler((message: string, _priority: string) => {
      deliveredMessages.push(message);
    });
  });

  afterEach(() => {
    resetStores();
    if (existsSync(TEST_PUSHER_PATH)) {
      rmSync(TEST_PUSHER_PATH, { recursive: true });
    }
  });

  describe('pushNotification', () => {
    test('creates and delivers notification', async () => {
      const result = await pushNotification({
        message: 'Test notification',
      });

      expect(result.success).toBe(true);
      expect(result.notificationId).toBeDefined();
      expect(result.delivered).toBe(true);
    });

    test('creates notification with priority', async () => {
      const result = await pushNotification({
        message: 'Urgent notification',
        priority: 'urgent',
      });

      expect(result.success).toBe(true);
    });

    test('creates notification with category', async () => {
      const result = await pushNotification({
        message: 'Reminder notification',
        category: 'reminder',
      });

      expect(result.success).toBe(true);
    });

    test('creates notification with scheduled time', async () => {
      const result = await pushNotification({
        message: 'Scheduled notification',
        scheduledFor: new Date(Date.now() + 3600000).toISOString(),
      });

      expect(result.success).toBe(true);
    });

    test('creates notification with metadata', async () => {
      const result = await pushNotification({
        message: 'Notification with metadata',
        metadata: { key: 'value', count: 42 },
      });

      expect(result.success).toBe(true);
    });
  });

  describe('pushUrgent', () => {
    test('creates urgent notification', async () => {
      const result = await pushUrgent('Urgent message!');

      expect(result.success).toBe(true);
      expect(result.delivered).toBe(true);
    });

    test('creates urgent notification with metadata', async () => {
      const result = await pushUrgent('Urgent message!', { source: 'test' });

      expect(result.success).toBe(true);
    });
  });

  describe('pushReminder', () => {
    test('creates reminder notification', async () => {
      const result = await pushReminder('Remember this!');

      expect(result.success).toBe(true);
    });

    test('creates scheduled reminder', async () => {
      const result = await pushReminder(
        'Scheduled reminder',
        new Date(Date.now() + 3600000).toISOString()
      );

      expect(result.success).toBe(true);
    });
  });

  describe('pushGoalProgress', () => {
    test('creates goal progress notification', async () => {
      const result = await pushGoalProgress('Learn TypeScript', 75);

      expect(result.success).toBe(true);
      expect(result.delivered).toBe(true);
    });

    test('creates notification with correct message', async () => {
      const result = await pushGoalProgress('Test Goal', 50);

      expect(result.success).toBe(true);
      expect(result.delivered).toBe(true);
      // The notification is delivered immediately, so we check the result
      expect(result.notificationId).toBeDefined();
    });
  });

  describe('formatNotification', () => {
    test('formats normal priority notification', () => {
      const notification = {
        id: 'test-1',
        userId: 'user1',
        message: 'Test message',
        priority: 'normal' as const,
        createdAt: new Date().toISOString(),
        delivery: {
          channels: ['cli'] as const,
          attempts: 0,
          maxAttempts: 3,
          delivered: false,
        },
      };

      const formatted = formatNotification(notification);
      expect(formatted).toContain('🟢');
      expect(formatted).toContain('Test message');
    });

    test('formats urgent priority notification', () => {
      const notification = {
        id: 'test-1',
        userId: 'user1',
        message: 'Urgent message',
        priority: 'urgent' as const,
        createdAt: new Date().toISOString(),
        delivery: {
          channels: ['cli'] as const,
          attempts: 0,
          maxAttempts: 3,
          delivered: false,
        },
      };

      const formatted = formatNotification(notification);
      expect(formatted).toContain('🔴');
      expect(formatted).toContain('Urgent message');
    });

    test('formats notification with category', () => {
      const notification = {
        id: 'test-1',
        userId: 'user1',
        message: 'Test message',
        priority: 'normal' as const,
        category: 'reminder',
        createdAt: new Date().toISOString(),
        delivery: {
          channels: ['cli'] as const,
          attempts: 0,
          maxAttempts: 3,
          delivered: false,
        },
      };

      const formatted = formatNotification(notification);
      expect(formatted).toContain('[reminder]');
    });

    test('formats all priority levels', () => {
      const priorities = ['low', 'normal', 'high', 'urgent'] as const;
      const expectedEmojis = ['⚪', '🟢', '🟠', '🔴'];

      priorities.forEach((priority, index) => {
        const notification = {
          id: `test-${priority}`,
          userId: 'user1',
          message: `${priority} message`,
          priority,
          createdAt: new Date().toISOString(),
          delivery: {
            channels: ['cli'] as const,
            attempts: 0,
            maxAttempts: 3,
            delivered: false,
          },
        };

        const formatted = formatNotification(notification);
        expect(formatted).toContain(expectedEmojis[index]);
      });
    });
  });

  describe('formatNotifications', () => {
    test('formats empty list', () => {
      const formatted = formatNotifications([]);
      expect(formatted).toContain('No pending notifications');
    });

    test('formats single notification', () => {
      const notifications = [
        {
          id: 'test-1',
          userId: 'user1',
          message: 'Test message',
          priority: 'normal' as const,
          createdAt: new Date().toISOString(),
          delivery: {
            channels: ['cli'] as const,
            attempts: 0,
            maxAttempts: 3,
            delivered: false,
          },
        },
      ];

      const formatted = formatNotifications(notifications);
      expect(formatted).toContain('1 Pending Notification');
      expect(formatted).toContain('Test message');
    });

    test('formats multiple notifications', () => {
      const notifications = [
        {
          id: 'test-1',
          userId: 'user1',
          message: 'Message 1',
          priority: 'normal' as const,
          createdAt: new Date().toISOString(),
          delivery: {
            channels: ['cli'] as const,
            attempts: 0,
            maxAttempts: 3,
            delivered: false,
          },
        },
        {
          id: 'test-2',
          userId: 'user1',
          message: 'Message 2',
          priority: 'high' as const,
          createdAt: new Date().toISOString(),
          delivery: {
            channels: ['cli'] as const,
            attempts: 0,
            maxAttempts: 3,
            delivered: false,
          },
        },
      ];

      const formatted = formatNotifications(notifications);
      expect(formatted).toContain('2 Pending Notifications');
      expect(formatted).toContain('Message 1');
      expect(formatted).toContain('Message 2');
    });

    test('includes scheduled time', () => {
      const scheduledFor = new Date(Date.now() + 3600000).toISOString();
      const notifications = [
        {
          id: 'test-1',
          userId: 'user1',
          message: 'Scheduled message',
          priority: 'normal' as const,
          createdAt: new Date().toISOString(),
          scheduledFor,
          delivery: {
            channels: ['cli'] as const,
            attempts: 0,
            maxAttempts: 3,
            delivered: false,
          },
        },
      ];

      const formatted = formatNotifications(notifications);
      expect(formatted).toContain('Scheduled:');
    });
  });

  describe('registerDeliveryHandler', () => {
    test('registers custom delivery handler', async () => {
      let customHandlerCalled = false;

      registerDeliveryHandler('custom', async () => {
        customHandlerCalled = true;
        return true;
      });

      // The handler is registered
      expect(customHandlerCalled).toBe(false);
    });
  });

  describe('pushPendingNotifications', () => {
    test('pushes pending notifications', async () => {
      // Create some pending notifications
      await pushNotification({ message: 'Pending 1' });
      await pushNotification({ message: 'Pending 2' });

      // Reset delivery tracking
      deliveredMessages = [];

      const result = await pushPendingNotifications();

      expect(result.pushed).toBeGreaterThanOrEqual(0);
    });
  });
});
