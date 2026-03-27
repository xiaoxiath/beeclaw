/**
 * Tests for hybrid-tool-selector.ts
 *
 * Covers: HybridToolSelector — select, matchByRules, matchBySemantic,
 *         recordToolUsage, getHybridToolSelector, resetHybridToolSelector
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('../../../infra/observability/logger', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

const mockEmbed = vi.fn(async (_text: string) => new Array(128).fill(0.1));
vi.mock('../memory/vector-store', () => ({
  getEmbeddingProvider: () => null, // Default: no embedding provider
}));

import {
  HybridToolSelector,
  getHybridToolSelector,
  resetHybridToolSelector,
  type HybridToolSelectorConfig,
} from '../hybrid-tool-selector';
import type { OpenAITool } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeTool(name: string, description = ''): OpenAITool {
  return {
    type: 'function',
    function: { name, description: description || `Tool ${name}`, parameters: { type: 'object', properties: {} } },
  };
}

const ALL_TOOLS: OpenAITool[] = [
  // Core tools
  makeTool('memory_read'), makeTool('memory_write'), makeTool('memory_grep'), makeTool('memory_ls'),
  makeTool('skill_list'), makeTool('skill_get'), makeTool('skill_search'),
  // Other tools
  makeTool('web_search', 'Search the web'), makeTool('web_browse', 'Browse a URL'),
  makeTool('goal_create', 'Create a goal'), makeTool('goal_list', 'List goals'),
  makeTool('sandbox_exec', 'Execute code'), makeTool('sandbox_write_file'),
  makeTool('get_current_time', 'Get current time'), makeTool('get_weather', 'Get weather'),
  makeTool('feishu_calendar_list'), makeTool('feishu_drive_list'),
  makeTool('request_deep_analysis', 'Deep analysis'),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('HybridToolSelector', () => {
  beforeEach(() => {
    resetHybridToolSelector();
    HybridToolSelector.resetCache();
  });

  describe('strategy: all', () => {
    it('returns all tools without filtering', async () => {
      const selector = new HybridToolSelector({ strategy: 'all' });
      const result = await selector.select(ALL_TOOLS, '你好');
      expect(result.length).toBe(ALL_TOOLS.length);
    });
  });

  describe('strategy: layered (rules only)', () => {
    it('always includes core tools', async () => {
      const selector = new HybridToolSelector({ strategy: 'layered', semanticEnabled: false });
      const result = await selector.select(ALL_TOOLS, '随便聊聊');
      const names = result.map(t => t.function.name);
      expect(names).toContain('memory_read');
      expect(names).toContain('skill_list');
    });

    it('matches search-related tools on 搜索 keyword', async () => {
      const selector = new HybridToolSelector({ strategy: 'layered', semanticEnabled: false });
      const result = await selector.select(ALL_TOOLS, '帮我搜索最新新闻');
      const names = result.map(t => t.function.name);
      expect(names).toContain('web_search');
    });

    it('matches goal tools on 目标 keyword', async () => {
      const selector = new HybridToolSelector({ strategy: 'layered', semanticEnabled: false });
      const result = await selector.select(ALL_TOOLS, '创建一个新目标');
      const names = result.map(t => t.function.name);
      expect(names).toContain('goal_create');
    });

    it('matches calendar tools on 日程 keyword', async () => {
      const selector = new HybridToolSelector({ strategy: 'layered', semanticEnabled: false });
      const result = await selector.select(ALL_TOOLS, '查看我的日程');
      const names = result.map(t => t.function.name);
      expect(names).toContain('feishu_calendar_list');
    });

    it('matches sandbox tools on 代码 keyword', async () => {
      const selector = new HybridToolSelector({ strategy: 'layered', semanticEnabled: false });
      const result = await selector.select(ALL_TOOLS, '运行这段代码');
      const names = result.map(t => t.function.name);
      expect(names).toContain('sandbox_exec');
    });

    it('matches time/weather tools on 时间 keyword', async () => {
      const selector = new HybridToolSelector({ strategy: 'layered', semanticEnabled: false });
      const result = await selector.select(ALL_TOOLS, '现在几点了，天气怎样');
      const names = result.map(t => t.function.name);
      expect(names).toContain('get_current_time');
    });
  });

  describe('fallback behavior', () => {
    it('falls back to all tools when too few selected', async () => {
      // Message with no matching keywords and no embedding provider
      const selector = new HybridToolSelector({
        strategy: 'hybrid',
        semanticEnabled: false,
        fallbackToCore: true,
      });
      // Create a set of tools where core tools are fewer than 5
      const smallTools = [makeTool('memory_read'), makeTool('custom_tool_1'), makeTool('custom_tool_2')];
      const result = await selector.select(smallTools, '无关内容');
      // Filtered would only have memory_read (1 tool), so fallback
      expect(result.length).toBe(smallTools.length);
    });
  });

  describe('maxTools cap', () => {
    it('caps results at maxTools', async () => {
      const selector = new HybridToolSelector({
        strategy: 'layered',
        semanticEnabled: false,
        maxTools: 5,
      });
      // Generate many tools
      const manyTools = Array.from({ length: 50 }, (_, i) => makeTool(`memory_tool_${i}`));
      const result = await selector.select(manyTools, '记忆相关');
      expect(result.length).toBeLessThanOrEqual(5);
    });
  });

  describe('recordToolUsage (G-P2-05)', () => {
    it('boosts previously used tools in next selection', async () => {
      const selector = new HybridToolSelector({ strategy: 'layered', semanticEnabled: false });
      selector.recordToolUsage(['sandbox_exec']);

      const result = await selector.select(ALL_TOOLS, '你好'); // no keyword match
      const names = result.map(t => t.function.name);
      // sandbox_exec should be included due to previous turn boost
      expect(names).toContain('sandbox_exec');
    });
  });

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

    it('getHybridToolSelector accepts config', () => {
      const a = getHybridToolSelector({ strategy: 'all' });
      expect(a).toBeDefined();
    });
  });
});
