import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import {
  proactiveTools,
  executeProactiveTool,
  getProactiveToolsForAI,
  PROACTIVE_TOOL_NAMES,
} from '../tools';
import { getScheduler, resetScheduler } from '../scheduler';
import { getNotificationManager, resetNotificationManager } from '../notifications';
import { existsSync, mkdirSync, rmSync } from 'fs';

const TEST_DATA_PATH = './test-proactive-data';

describe('Proactive Tools', () => {
  beforeAll(() => {
    // Clean up and create test directory
    if (existsSync(TEST_DATA_PATH)) {
      rmSync(TEST_DATA_PATH, { recursive: true });
    }
    mkdirSync(TEST_DATA_PATH, { recursive: true });

    // Initialize scheduler and notification manager
    getScheduler(TEST_DATA_PATH);
    getNotificationManager(TEST_DATA_PATH);
  });

  afterAll(() => {
    // Clean up
    resetScheduler();
    resetNotificationManager();
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
      expect(PROACTIVE_TOOL_NAMES.length).toBe(8);
    });
  });

  describe('getProactiveToolsForAI', () => {
    test('returns array of tools', () => {
      const tools = getProactiveToolsForAI();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBe(8);
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
    describe('proactive_list', () => {
      test('lists all items by default', () => {
        const result = executeProactiveTool('proactive_list', {});
        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
      });

      test('filters by type schedules', () => {
        const result = executeProactiveTool('proactive_list', { type: 'schedules' });
        expect(result.success).toBe(true);
      });

      test('filters by type patterns', () => {
        const result = executeProactiveTool('proactive_list', { type: 'patterns' });
        expect(result.success).toBe(true);
      });
    });

    describe('proactive_cancel', () => {
      test('returns error for non-existent schedule', () => {
        const result = executeProactiveTool('proactive_cancel', {
          id: 'non-existent-id',
          type: 'schedule',
        });
        expect(result.success).toBe(false);
      });

      test('returns error for non-existent pattern', () => {
        const result = executeProactiveTool('proactive_cancel', {
          id: 'non-existent-id',
          type: 'pattern',
        });
        expect(result.success).toBe(false);
      });

      test('requires id parameter', () => {
        const result = executeProactiveTool('proactive_cancel', { type: 'schedule' });
        expect(result.success).toBe(false);
      });

      test('requires type parameter', () => {
        const result = executeProactiveTool('proactive_cancel', { id: 'test-id' });
        expect(result.success).toBe(false);
      });
    });

    describe('proactive_enable', () => {
      test('returns error for non-existent schedule', () => {
        const result = executeProactiveTool('proactive_enable', {
          id: 'non-existent-id',
        });
        expect(result.success).toBe(false);
      });

      test('requires id parameter', () => {
        const result = executeProactiveTool('proactive_enable', {});
        expect(result.success).toBe(false);
      });
    });

    describe('proactive_disable', () => {
      test('returns error for non-existent schedule', () => {
        const result = executeProactiveTool('proactive_disable', {
          id: 'non-existent-id',
        });
        expect(result.success).toBe(false);
      });

      test('requires id parameter', () => {
        const result = executeProactiveTool('proactive_disable', {});
        expect(result.success).toBe(false);
      });
    });

    describe('notification_send', () => {
      test('sends notification with message', () => {
        const result = executeProactiveTool('notification_send', {
          message: 'Test notification',
        });
        expect(result.success).toBe(true);
      });

      test('accepts priority parameter', () => {
        const result = executeProactiveTool('notification_send', {
          message: 'Test',
          priority: 'high',
        });
        expect(result.success).toBe(true);
      });

      test('accepts category parameter', () => {
        const result = executeProactiveTool('notification_send', {
          message: 'Test',
          category: 'test-category',
        });
        expect(result.success).toBe(true);
      });

      test('requires message parameter', () => {
        const result = executeProactiveTool('notification_send', {});
        expect(result.success).toBe(false);
      });
    });

    describe('notification_list', () => {
      test('lists notifications', () => {
        const result = executeProactiveTool('notification_list', {});
        expect(result.success).toBe(true);
      });

      test('accepts userId parameter', () => {
        const result = executeProactiveTool('notification_list', {
          userId: 'test-user',
        });
        expect(result.success).toBe(true);
      });
    });

    describe('unknown tool', () => {
      test('returns error for unknown tool name', () => {
        const result = executeProactiveTool('unknown_tool', {});
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    });
  });
});
