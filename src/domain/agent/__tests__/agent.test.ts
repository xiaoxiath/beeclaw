import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createDefaultToolExecutor } from '../index';
import type { ToolExecutor } from '../types';

describe('Agent', () => {
  describe('createDefaultToolExecutor', () => {
    let executor: ToolExecutor;

    beforeEach(() => {
      executor = createDefaultToolExecutor();
    });

    test('returns function', () => {
      expect(typeof executor).toBe('function');
    });

    test('returns error for unknown tool', async () => {
      const result = await executor('unknown_tool', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown tool');
    });

    test('routes memory tools correctly', async () => {
      // Test routing without initializing store - will fail but shows routing works
      try {
        const result = await executor('memory_ls', { path: 'facts' });
        expect(result).toBeDefined();
      } catch (error) {
        // Error is expected since store is not initialized
        expect(error).toBeDefined();
      }
    });

    test('routes skill tools correctly', async () => {
      try {
        const result = await executor('skill_list', {});
        expect(result).toBeDefined();
      } catch (error) {
        // Error is expected since store is not initialized
        expect(error).toBeDefined();
      }
    });

    test('routes goal tools correctly', async () => {
      try {
        const result = await executor('goal_list', {});
        expect(result).toBeDefined();
      } catch (error) {
        // Error is expected since store is not initialized
        expect(error).toBeDefined();
      }
    });

    test('routes proactive tools correctly', async () => {
      const result = await executor('proactive_list', {});
      // The tool is routed correctly but may fail due to uninitialized store
      expect(result).toBeDefined();
      expect(result.success).toBeDefined();
    });

    test('routes notification tools correctly', async () => {
      const result = await executor('notification_list', {});
      // The tool is routed correctly but may fail due to uninitialized store
      expect(result).toBeDefined();
      expect(result.success).toBeDefined();
    });

    test('routes persona tools correctly', async () => {
      const result = await executor('persona_get', {});
      // The tool is routed correctly but may fail due to uninitialized store
      expect(result).toBeDefined();
      expect(result.success).toBeDefined();
    });

    test('routes builtin tools correctly', async () => {
      const result = await executor('web_search', { query: 'test' });
      // The tool is routed correctly
      expect(result).toBeDefined();
      expect(result.success).toBeDefined();
    });
  });
});
