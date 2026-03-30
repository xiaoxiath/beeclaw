import { describe, test, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Mock bunqueue/client to avoid directory import error in Node/vitest
vi.mock('../../../infra/queue/manager', () => ({
  getTaskManager: vi.fn(() => null),
}));

import {
  proactiveTools,
  executeProactiveTool,
  getProactiveToolsForAI,
  PROACTIVE_TOOL_NAMES,
} from '../tools';
import { getNotificationManager, resetNotificationManager } from '../notifications';
import { getScheduler, resetScheduler } from '../scheduler';
import { setCliDeliveryHandler } from '../pusher';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const TEST_DATA_PATH = './test-proactive-data';

describe('Proactive Tools', () => {
  let deliveredMessages: Array<{ message: string; priority: string }> = [];

  beforeAll(() => {
    // Reset stores first in case other tests initialized them
    resetNotificationManager();
    resetScheduler();

    // Clean up and create test directory
    if (existsSync(TEST_DATA_PATH)) {
      rmSync(TEST_DATA_PATH, { recursive: true });
    }
    mkdirSync(TEST_DATA_PATH, { recursive: true });

    // Initialize domain stores with test path
    getNotificationManager(join(TEST_DATA_PATH, 'proactive'));
    getScheduler(join(TEST_DATA_PATH, 'proactive'));
  });

  beforeEach(() => {
    // Reset delivery tracking before each test
    deliveredMessages = [];

    // Set up CLI delivery handler to track deliveries
    setCliDeliveryHandler((message: string, priority: any) => {
      deliveredMessages.push({ message, priority });
    });
  });

  afterAll(() => {
    // Clean up
    resetNotificationManager();
    resetScheduler();
    if (existsSync(TEST_DATA_PATH)) {
      rmSync(TEST_DATA_PATH, { recursive: true });
    }
  });

  describe('proactiveTools', () => {
    test('has proactive_schedule tool', () => {
      expect(proactiveTools.proactive_schedule).toBeDefined();
      expect(proactiveTools.proactive_schedule.name).toBe('proactive_schedule');
    });

    test('has proactive_pattern tool', () => {
      expect(proactiveTools.proactive_pattern).toBeDefined();
      expect(proactiveTools.proactive_pattern.name).toBe('proactive_pattern');
    });

    test('has proactive_list tool', () => {
      expect(proactiveTools.proactive_list).toBeDefined();
      expect(proactiveTools.proactive_list.name).toBe('proactive_list');
    });

    test('has proactive_cancel tool', () => {
      expect(proactiveTools.proactive_cancel).toBeDefined();
      expect(proactiveTools.proactive_cancel.name).toBe('proactive_cancel');
    });

    test('has proactive_enable tool', () => {
      expect(proactiveTools.proactive_enable).toBeDefined();
      expect(proactiveTools.proactive_enable.name).toBe('proactive_enable');
    });

    test('has proactive_disable tool', () => {
      expect(proactiveTools.proactive_disable).toBeDefined();
      expect(proactiveTools.proactive_disable.name).toBe('proactive_disable');
    });

    test('has notification_send tool', () => {
      expect(proactiveTools.notification_send).toBeDefined();
      expect(proactiveTools.notification_send.name).toBe('notification_send');
    });

    test('has notification_list tool', () => {
      expect(proactiveTools.notification_list).toBeDefined();
      expect(proactiveTools.notification_list.name).toBe('notification_list');
    });

    test('all tools have name and parameters', () => {
      for (const [key, tool] of Object.entries(proactiveTools)) {
        expect(tool.name).toBeDefined();
        expect(tool.parameters).toBeDefined();
        expect(tool.parameters.type).toBe('object');
      }
    });
  });

  describe('PROACTIVE_TOOL_NAMES', () => {
    test('contains all tool names', () => {
      expect(PROACTIVE_TOOL_NAMES).toContain('proactive_schedule');
      expect(PROACTIVE_TOOL_NAMES).toContain('proactive_pattern');
      expect(PROACTIVE_TOOL_NAMES).toContain('proactive_list');
      expect(PROACTIVE_TOOL_NAMES).toContain('proactive_cancel');
      expect(PROACTIVE_TOOL_NAMES).toContain('proactive_enable');
      expect(PROACTIVE_TOOL_NAMES).toContain('proactive_disable');
      expect(PROACTIVE_TOOL_NAMES).toContain('notification_send');
      expect(PROACTIVE_TOOL_NAMES).toContain('notification_list');
    });

    test('has correct number of tools', () => {
      expect(PROACTIVE_TOOL_NAMES.length).toBe(13);
    });
  });

  describe('getProactiveToolsForAI', () => {
    test('returns array of tools', () => {
      const tools = getProactiveToolsForAI();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBe(13);
    });

    test('returns tools with name, description and parameters', () => {
      const tools = getProactiveToolsForAI();

      for (const tool of tools) {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.parameters).toBeDefined();
      }
    });
  });

  describe('executeProactiveTool', () => {
    describe('proactive_schedule', () => {
      test('creates a new schedule', async () => {
        const result = await executeProactiveTool('proactive_schedule', {
          name: 'Test Schedule',
          description: 'A test schedule',
          cron: '0 9 * * *',
          taskType: 'send_reminder',
          taskParams: { message: 'Test reminder' },
          enabled: true,
        });

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.data.name).toBe('Test Schedule');
        expect(result.data.cron).toBe('0 9 * * *');
        expect(result.data.enabled).toBe(true);
      });

      test('idempotency: skips duplicate schedule with same name', async () => {
        // First creation
        const result1 = await executeProactiveTool('proactive_schedule', {
          name: 'Daily Test',
          cron: '0 10 * * *',
          taskType: 'send_reminder',
          taskParams: { message: 'Daily test' },
        });

        expect(result1.success).toBe(true);
        const firstId = result1.data.id;

        // Second creation with same name (should be idempotent)
        const result2 = await executeProactiveTool('proactive_schedule', {
          name: 'Daily Test',
          cron: '0 10 * * *',
          taskType: 'send_reminder',
          taskParams: { message: 'Daily test' },
        });

        expect(result2.success).toBe(true);
        expect(result2.data.id).toBe(firstId); // Same ID
        expect(result2.data.info).toContain('already exists');
      });
    });

    describe('proactive_list', () => {
      test('lists all items by default', async () => {
        const result = await executeProactiveTool('proactive_list', {});
        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
      });

      test('filters by type schedules', async () => {
        const result = await executeProactiveTool('proactive_list', { type: 'schedules' });
        expect(result.success).toBe(true);
      });

      test('filters by type patterns', async () => {
        const result = await executeProactiveTool('proactive_list', { type: 'patterns' });
        expect(result.success).toBe(true);
      });
    });

    describe('proactive_cancel', () => {
      test('returns error for non-existent schedule', async () => {
        const result = await executeProactiveTool('proactive_cancel', {
          id: 'non-existent-id',
          type: 'schedule',
        });
        expect(result.success).toBe(false);
      });

      test('returns error for non-existent pattern', async () => {
        const result = await executeProactiveTool('proactive_cancel', {
          id: 'non-existent-id',
          type: 'pattern',
        });
        expect(result.success).toBe(false);
      });

      test('requires id parameter', async () => {
        const result = await executeProactiveTool('proactive_cancel', { type: 'schedule' });
        expect(result.success).toBe(false);
      });

      test('requires type parameter', async () => {
        const result = await executeProactiveTool('proactive_cancel', { id: 'test-id' });
        expect(result.success).toBe(false);
      });
    });

    describe('proactive_enable', () => {
      test('returns error for non-existent schedule', async () => {
        const result = await executeProactiveTool('proactive_enable', {
          id: 'non-existent-id',
        });
        expect(result.success).toBe(false);
      });

      test('requires id parameter', async () => {
        const result = await executeProactiveTool('proactive_enable', {});
        expect(result.success).toBe(false);
      });
    });

    describe('proactive_disable', () => {
      test('returns error for non-existent schedule', async () => {
        const result = await executeProactiveTool('proactive_disable', {
          id: 'non-existent-id',
        });
        expect(result.success).toBe(false);
      });

      test('requires id parameter', async () => {
        const result = await executeProactiveTool('proactive_disable', {});
        expect(result.success).toBe(false);
      });
    });

    describe('notification_send', () => {
      test('sends notification with message', async () => {
        const result = await executeProactiveTool('notification_send', {
          message: 'Test notification',
        });
        expect(result.success).toBe(true);
        expect(result.delivered).toBe(true);
        expect(result.notificationId).toBeDefined();

        // Verify the message was delivered via CLI handler
        expect(deliveredMessages.length).toBe(1);
        expect(deliveredMessages[0].message).toBe('Test notification');
      });

      test('accepts priority parameter', async () => {
        const result = await executeProactiveTool('notification_send', {
          message: 'Test',
          priority: 'high',
        });
        expect(result.success).toBe(true);
        expect(result.delivered).toBe(true);

        // Verify priority was passed to delivery handler
        expect(deliveredMessages.length).toBe(1);
        expect(deliveredMessages[0].priority).toBe('high');
      });

      test('accepts category parameter', async () => {
        const result = await executeProactiveTool('notification_send', {
          message: 'Test',
          category: 'test-category',
        });
        expect(result.success).toBe(true);
        expect(result.delivered).toBe(true);
      });

      test('requires message parameter', async () => {
        const result = await executeProactiveTool('notification_send', {});
        expect(result.success).toBe(false);
      });
    });

    describe('notification_list', () => {
      test('lists notifications', async () => {
        const result = await executeProactiveTool('notification_list', {});
        expect(result.success).toBe(true);
      });

      test('accepts userId parameter', async () => {
        const result = await executeProactiveTool('notification_list', {
          userId: 'test-user',
        });
        expect(result.success).toBe(true);
      });
    });

    describe('unknown tool', () => {
      test('returns error for unknown tool name', async () => {
        const result = await executeProactiveTool('unknown_tool', {});
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    });
  });
});
