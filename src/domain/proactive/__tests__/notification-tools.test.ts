/**
 * Tests for new notification tools
 */

import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';

// Re-mock pusher to ensure it's not clobbered by other test files' mocks.
// Provide a working implementation that goes through the real NotificationManager.
let notifCounter = 0;
vi.mock('../pusher', () => {
  // Dynamic import to get the lazy notifications getter
  const { getNotificationsLazy } = require('../notifications');
  return {
    pushNotification: async (options: any) => {
      try {
        const manager = getNotificationsLazy();
        const result = manager.create({
          userId: 'cli-user',
          message: options.message,
          priority: options.priority || 'normal',
          category: options.category,
          scheduledFor: options.scheduledFor,
          expiresAt: options.expiresAt,
          channels: options.channels || ['cli'],
          metadata: options.metadata || {},
        });
        if (!result.success || !result.data) {
          return { success: false, error: result.error };
        }
        const notification = result.data as any;
        return { success: true, notificationId: notification.id, delivered: false };
      } catch (error: any) {
        return { success: false, error: error.message || 'Unknown error' };
      }
    },
  };
});

import {
  executeProactiveTool,
  PROACTIVE_TOOL_NAMES,
} from '../tools';
import { initStores, resetStores } from '../../../infra/db/store';

const TEST_DATA_PATH = './test-notification-data';

describe('Notification Tools', () => {
  beforeAll(() => {
    resetStores();
    if (existsSync(TEST_DATA_PATH)) {
      rmSync(TEST_DATA_PATH, { recursive: true });
    }
    mkdirSync(TEST_DATA_PATH, { recursive: true });
    initStores({ basePath: TEST_DATA_PATH });
  });

  afterAll(() => {
    resetStores();
    if (existsSync(TEST_DATA_PATH)) {
      rmSync(TEST_DATA_PATH, { recursive: true });
    }
  });

  describe('Tool Definitions', () => {
    test('includes all new notification tools', () => {
      expect(PROACTIVE_TOOL_NAMES).toContain('notification_send');
      expect(PROACTIVE_TOOL_NAMES).toContain('notification_list');
      expect(PROACTIVE_TOOL_NAMES).toContain('notification_mark_read');
      expect(PROACTIVE_TOOL_NAMES).toContain('notification_delete');
      expect(PROACTIVE_TOOL_NAMES).toContain('notification_history');
      expect(PROACTIVE_TOOL_NAMES).toContain('notification_stats');
    });

    test('has correct total number of tools', () => {
      expect(PROACTIVE_TOOL_NAMES.length).toBe(13);
    });
  });

  describe('notification_send', () => {
    test('sends a notification', async () => {
      const result = await executeProactiveTool('notification_send', {
        message: 'Test notification',
        priority: 'high',
        category: 'test',
      });
      expect(result.success).toBe(true);
      // pushNotification returns { success, notificationId, delivered }
      expect((result as any).notificationId).toBeDefined();
    });

    test('requires message parameter', async () => {
      const result = await executeProactiveTool('notification_send', {});
      expect(result.success).toBe(false);
    });
  });

  describe('notification_list', () => {
    test('lists pending notifications', async () => {
      const result = await executeProactiveTool('notification_list', {});
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
    });
  });

  describe('notification_mark_read', () => {
    test('marks notification as read', async () => {
      // First create a notification
      const sendResult = await executeProactiveTool('notification_send', {
        message: 'Test for mark read',
      });
      expect(sendResult.success).toBe(true);

      // pushNotification returns notificationId at the top level
      const notifId = (sendResult as any).notificationId;
      const result = await executeProactiveTool('notification_mark_read', {
        id: notifId,
      });
      expect(result.success).toBe(true);
    });

    test('returns error for non-existent notification', async () => {
      const result = await executeProactiveTool('notification_mark_read', {
        id: 'non-existent-id',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('notification_delete', () => {
    test('deletes a notification', async () => {
      // First create a notification
      const sendResult = await executeProactiveTool('notification_send', {
        message: 'Test for delete',
      });
      expect(sendResult.success).toBe(true);

      // pushNotification returns notificationId at the top level
      const notifId = (sendResult as any).notificationId;
      const result = await executeProactiveTool('notification_delete', {
        id: notifId,
      });
      expect(result.success).toBe(true);
    });

    test('returns error for non-existent notification', async () => {
      const result = await executeProactiveTool('notification_delete', {
        id: 'non-existent-id',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('notification_history', () => {
    test('returns notification history', async () => {
      const result = await executeProactiveTool('notification_history', {
        limit: 10,
      });
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
    });
  });

  describe('notification_stats', () => {
    test('returns notification statistics', async () => {
      const result = await executeProactiveTool('notification_stats', {});
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('pending');
      expect(result.data).toHaveProperty('history');
      expect(result.data).toHaveProperty('byPriority');
    });
  });
});
