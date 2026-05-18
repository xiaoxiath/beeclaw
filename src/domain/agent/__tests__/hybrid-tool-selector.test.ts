/**
 * Tests for hybrid-tool-selector.ts (simplified v2)
 *
 * Covers: HybridToolSelector — select, recordToolUsage, budget-cap logic,
 *         getHybridToolSelector, resetHybridToolSelector
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('../../../infra/observability/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

import {
  HybridToolSelector,
  getHybridToolSelector,
  resetHybridToolSelector,
} from '../hybrid-tool-selector';
import type { OpenAITool } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeTool(name: string, description = ''): OpenAITool {
  return {
    type: 'function',
    function: {
      name,
      description: description || `Tool ${name}`,
      parameters: { type: 'object', properties: {}, required: [] },
    },
  };
}

// Core tools that are always included (7 total)
const CORE_NAMES = [
  'memory_read', 'memory_write', 'memory_grep', 'memory_ls',
  'skill_list', 'skill_get', 'skill_search',
];

const ALL_TOOLS: OpenAITool[] = [
  ...CORE_NAMES.map(n => makeTool(n)),
  makeTool('web_search', 'Search the web'), makeTool('web_fetch', 'Fetch a URL'),
  makeTool('goal_create', 'Create a goal'), makeTool('goal_list', 'List goals'),
  makeTool('goal_get', 'Get goal'), makeTool('goal_update', 'Update a goal'),
  makeTool('sandbox_exec', 'Execute code'), makeTool('sandbox_write_file', 'Write file'),
  makeTool('sandbox_read_file', 'Read file'), makeTool('sandbox_list_files', 'List files'),
  makeTool('time_now', 'Get current time'), makeTool('weather', 'Get weather'),
  makeTool('request_deep_analysis', 'Deep analysis'),
  makeTool('proactive_schedule', 'Schedule task'), makeTool('proactive_list', 'List proactive'),
  makeTool('notification_send', 'Send notification'),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('HybridToolSelector (simplified v2)', () => {
  beforeEach(() => {
    resetHybridToolSelector();
  });

  // =========================================================================
  // strategy: all
  // =========================================================================
  describe('strategy: all', () => {
    it('returns all tools without filtering', async () => {
      const selector = new HybridToolSelector({ strategy: 'all' });
      const result = await selector.select(ALL_TOOLS, '你好');
      expect(result.length).toBe(ALL_TOOLS.length);
    });

    it('returns all tools regardless of message content', async () => {
      const selector = new HybridToolSelector({ strategy: 'all' });
      const result = await selector.select(ALL_TOOLS, '搜索新闻并查看日历');
      expect(result.length).toBe(ALL_TOOLS.length);
    });
  });

  // =========================================================================
  // strategy: budget-cap (default)
  // =========================================================================
  describe('strategy: budget-cap (default)', () => {
    it('returns all tools when under maxTools limit', async () => {
      const selector = new HybridToolSelector({ strategy: 'budget-cap', maxTools: 50 });
      const result = await selector.select(ALL_TOOLS, '任何消息');
      expect(result.length).toBe(ALL_TOOLS.length);
    });

    it('caps results at maxTools when over limit', async () => {
      const selector = new HybridToolSelector({ strategy: 'budget-cap', maxTools: 10 });
      const result = await selector.select(ALL_TOOLS, '任何消息');
      expect(result.length).toBeLessThanOrEqual(10);
    });

    it('always includes core tools even when capping', async () => {
      const selector = new HybridToolSelector({ strategy: 'budget-cap', maxTools: 8 });
      const result = await selector.select(ALL_TOOLS, '任何消息');
      const names = result.map(t => t.function.name);
      for (const core of CORE_NAMES) {
        expect(names).toContain(core);
      }
    });

    it('prioritizes core > lastTurn > rest when capping', async () => {
      const selector = new HybridToolSelector({ strategy: 'budget-cap', maxTools: 10 });
      selector.recordToolUsage(['sandbox_exec', 'web_search']);

      const result = await selector.select(ALL_TOOLS, '任何消息');
      const names = result.map(t => t.function.name);

      // Core tools always present
      expect(names).toContain('memory_read');
      expect(names).toContain('skill_list');
      // Last turn tools prioritized
      expect(names).toContain('sandbox_exec');
      expect(names).toContain('web_search');
      // Total capped
      expect(result.length).toBeLessThanOrEqual(10);
    });

    it('does not filter when tool count equals maxTools exactly', async () => {
      const tools = Array.from({ length: 15 }, (_, i) => makeTool(`tool_${i}`));
      const selector = new HybridToolSelector({ strategy: 'budget-cap', maxTools: 15 });
      const result = await selector.select(tools, '消息');
      expect(result.length).toBe(15);
    });
  });

  // =========================================================================
  // recordToolUsage
  // =========================================================================
  describe('recordToolUsage', () => {
    it('prioritizes previously used tools when capping', async () => {
      const selector = new HybridToolSelector({ strategy: 'budget-cap', maxTools: 9 });
      selector.recordToolUsage(['notification_send']);
      const result = await selector.select(ALL_TOOLS, '消息');
      const names = result.map(t => t.function.name);
      expect(names).toContain('notification_send');
    });

    it('replaces previous usage on each call', async () => {
      const selector = new HybridToolSelector({ strategy: 'budget-cap', maxTools: 9 });
      selector.recordToolUsage(['sandbox_exec']);
      selector.recordToolUsage(['web_search']);

      const result = await selector.select(ALL_TOOLS, '消息');
      const names = result.map(t => t.function.name);
      expect(names).toContain('web_search');
      // sandbox_exec is no longer in lastTurn, may or may not be in result
    });
  });

  // =========================================================================
  // singleton
  // =========================================================================
  describe('singleton', () => {
    it('getHybridToolSelector returns same instance', () => {
      const a = getHybridToolSelector();
      const b = getHybridToolSelector();
      expect(a).toBe(b);
    });

    it('resetHybridToolSelector clears instance', () => {
      const a = getHybridToolSelector();
      resetHybridToolSelector();
      const b = getHybridToolSelector();
      expect(a).not.toBe(b);
    });

    it('getHybridToolSelector accepts config to create new instance', () => {
      const a = getHybridToolSelector({ strategy: 'all' });
      expect(a).toBeDefined();
      const b = getHybridToolSelector({ strategy: 'budget-cap' });
      expect(b).not.toBe(a);
    });
  });

  // =========================================================================
  // resetCache (API compat)
  // =========================================================================
  describe('resetCache', () => {
    it('no-op without error (API compat)', () => {
      expect(() => HybridToolSelector.resetCache()).not.toThrow();
    });
  });

  // =========================================================================
  // edge cases
  // =========================================================================
  describe('edge cases', () => {
    it('handles empty tools array', async () => {
      const selector = new HybridToolSelector({ strategy: 'budget-cap' });
      const result = await selector.select([], '消息');
      expect(result.length).toBe(0);
    });

    it('handles empty message', async () => {
      const selector = new HybridToolSelector({ strategy: 'budget-cap', maxTools: 50 });
      const result = await selector.select(ALL_TOOLS, '');
      expect(result.length).toBe(ALL_TOOLS.length);
    });

    it('maxTools smaller than core tool count still returns core', async () => {
      // 7 core tools but maxTools = 3 — core + lastTurn exceeds cap
      // The implementation takes core + lastTurn first, then rest with remaining
      const selector = new HybridToolSelector({ strategy: 'budget-cap', maxTools: 3 });
      const result = await selector.select(ALL_TOOLS, '消息');
      // Should still include all core tools (they get priority)
      // plus remaining from rest.slice(0, max(0, 3 - 7 - 0)) = rest.slice(0, 0) = nothing
      expect(result.length).toBe(CORE_NAMES.length); // core = 7 > maxTools = 3, but all core included
    });
  });
});
