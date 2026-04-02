/**
 * Tests for hybrid-tool-selector.ts
 *
 * Covers: HybridToolSelector — select, matchByRules, matchBySemantic,
 *         recordToolUsage, getHybridToolSelector, resetHybridToolSelector,
 *         cosineSim, semantic strategy, capping logic, all rule patterns
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('../../../infra/observability/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let mockEmbeddingProvider: any = null;

vi.mock('../../memory/vector-store', () => ({
  getEmbeddingProvider: () => mockEmbeddingProvider,
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
  // Core tools (always included)
  ...CORE_NAMES.map(n => makeTool(n)),
  // Other tools
  makeTool('web_search', 'Search the web'), makeTool('web_fetch', 'Fetch a URL'),
  makeTool('goal_create', 'Create a goal'), makeTool('goal_list', 'List goals'),
  makeTool('goal_get', 'Get goal'), makeTool('goal_update', 'Update a goal'), makeTool('goal_checkpoint', 'Checkpoint goal'),
  makeTool('sandbox_exec', 'Execute code'), makeTool('sandbox_write_file', 'Write file'),
  makeTool('sandbox_read_file', 'Read file'), makeTool('sandbox_list_files', 'List files'),
  makeTool('time_now', 'Get current time'), makeTool('weather', 'Get weather'), makeTool('get_holiday_info', 'Get holidays'),
  makeTool('skill_ensure', 'Ensure skill'), makeTool('skill_delete', 'Delete skill'), makeTool('skill_record', 'Record skill'),
  makeTool('request_deep_analysis', 'Deep analysis'),
  makeTool('proactive_schedule', 'Schedule task'), makeTool('proactive_list', 'List proactive'),
  makeTool('proactive_cancel', 'Cancel proactive'), makeTool('schedule_once', 'Schedule once'),
  makeTool('notification_send', 'Send notification'),
  makeTool('memory_record', 'Record memory'),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('HybridToolSelector', () => {
  beforeEach(() => {
    resetHybridToolSelector();
    HybridToolSelector.resetCache();
    mockEmbeddingProvider = null;
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

    it('returns all tools even with keywords present', async () => {
      const selector = new HybridToolSelector({ strategy: 'all' });
      const result = await selector.select(ALL_TOOLS, '搜索新闻并查看日历');
      expect(result.length).toBe(ALL_TOOLS.length);
    });
  });

  // =========================================================================
  // strategy: layered (rules only)
  // =========================================================================
  describe('strategy: layered (rules only)', () => {
    it('always includes core tools', async () => {
      const selector = new HybridToolSelector({ strategy: 'layered', semanticEnabled: false });
      const result = await selector.select(ALL_TOOLS, '随便聊聊');
      const names = result.map(t => t.function.name);
      for (const core of CORE_NAMES) {
        expect(names).toContain(core);
      }
    });

    it('matches search tools on 搜索 keyword', async () => {
      const selector = new HybridToolSelector({ strategy: 'layered', semanticEnabled: false });
      const result = await selector.select(ALL_TOOLS, '帮我搜索最新新闻');
      const names = result.map(t => t.function.name);
      expect(names).toContain('web_search');
      expect(names).toContain('web_fetch');
    });

    it('matches search tools on English keyword', async () => {
      const selector = new HybridToolSelector({ strategy: 'layered', semanticEnabled: false });
      const result = await selector.select(ALL_TOOLS, 'search for recent news');
      const names = result.map(t => t.function.name);
      expect(names).toContain('web_search');
    });

    it('matches memory tools on 记忆/回忆 keyword', async () => {
      const selector = new HybridToolSelector({ strategy: 'layered', semanticEnabled: false });
      const result = await selector.select(ALL_TOOLS, '帮我回忆之前的记录');
      const names = result.map(t => t.function.name);
      expect(names).toContain('memory_record');
    });

    it('matches skill tools on 技能 keyword', async () => {
      const selector = new HybridToolSelector({ strategy: 'layered', semanticEnabled: false });
      const result = await selector.select(ALL_TOOLS, '查看可用技能');
      const names = result.map(t => t.function.name);
      expect(names).toContain('skill_ensure');
      expect(names).toContain('skill_delete');
      expect(names).toContain('skill_record');
    });

    it('matches goal tools on 目标 keyword', async () => {
      const selector = new HybridToolSelector({ strategy: 'layered', semanticEnabled: false });
      const result = await selector.select(ALL_TOOLS, '创建一个新目标');
      const names = result.map(t => t.function.name);
      expect(names).toContain('goal_create');
      expect(names).toContain('goal_list');
    });

    it('matches goal tools on 任务 keyword', async () => {
      const selector = new HybridToolSelector({ strategy: 'layered', semanticEnabled: false });
      const result = await selector.select(ALL_TOOLS, '查看当前任务');
      const names = result.map(t => t.function.name);
      expect(names).toContain('goal_list');
    });

    it('matches calendar/doc/drive/wiki queries to skill tools', async () => {
      const selector = new HybridToolSelector({ strategy: 'layered', semanticEnabled: false });
      const result = await selector.select(ALL_TOOLS, '查看我的日程');
      const names = result.map(t => t.function.name);
      // Calendar/doc/drive/wiki tools now route through skill_list/skill_get/skill_ensure
      expect(names).toContain('skill_list');
      expect(names).toContain('skill_get');
      expect(names).toContain('skill_ensure');
    });

    it('matches calendar queries on meeting keyword', async () => {
      const selector = new HybridToolSelector({ strategy: 'layered', semanticEnabled: false });
      const result = await selector.select(ALL_TOOLS, 'schedule a meeting');
      const names = result.map(t => t.function.name);
      expect(names).toContain('skill_list');
      expect(names).toContain('skill_ensure');
    });

    it('matches document queries on 文档 keyword', async () => {
      const selector = new HybridToolSelector({ strategy: 'layered', semanticEnabled: false });
      const result = await selector.select(ALL_TOOLS, '查看这份文档');
      const names = result.map(t => t.function.name);
      expect(names).toContain('skill_list');
      expect(names).toContain('skill_get');
      expect(names).toContain('skill_ensure');
    });

    it('matches document queries on file/wiki keyword', async () => {
      const selector = new HybridToolSelector({ strategy: 'layered', semanticEnabled: false });
      const result = await selector.select(ALL_TOOLS, 'find file in wiki');
      const names = result.map(t => t.function.name);
      expect(names).toContain('skill_list');
      expect(names).toContain('skill_ensure');
    });

    it('matches sandbox tools on 代码 keyword', async () => {
      const selector = new HybridToolSelector({ strategy: 'layered', semanticEnabled: false });
      const result = await selector.select(ALL_TOOLS, '运行这段代码');
      const names = result.map(t => t.function.name);
      expect(names).toContain('sandbox_exec');
      expect(names).toContain('sandbox_write_file');
    });

    it('matches time/weather tools on 时间 keyword', async () => {
      const selector = new HybridToolSelector({ strategy: 'layered', semanticEnabled: false });
      const result = await selector.select(ALL_TOOLS, '现在几点了');
      const names = result.map(t => t.function.name);
      expect(names).toContain('time_now');
    });

    it('matches deep analysis tools on 深度分析', async () => {
      const selector = new HybridToolSelector({ strategy: 'layered', semanticEnabled: false });
      const result = await selector.select(ALL_TOOLS, '请做深度分析');
      const names = result.map(t => t.function.name);
      expect(names).toContain('request_deep_analysis');
    });

    it('matches proactive tools on 定时/提醒/通知 keyword', async () => {
      const selector = new HybridToolSelector({ strategy: 'layered', semanticEnabled: false });
      const result = await selector.select(ALL_TOOLS, '帮我设置一个定时提醒通知');
      const names = result.map(t => t.function.name);
      expect(names).toContain('proactive_schedule');
      expect(names).toContain('notification_send');
      expect(names).toContain('schedule_once');
    });
  });

  // =========================================================================
  // fallback behavior
  // =========================================================================
  describe('fallback behavior', () => {
    it('falls back to all tools when too few selected (< 5) with fallbackToCore=true', async () => {
      const selector = new HybridToolSelector({
        strategy: 'hybrid',
        semanticEnabled: false,
        fallbackToCore: true,
      });
      // Only 3 tools total, and only 1 is core -> filtered = 1 < 5 -> fallback
      const smallTools = [makeTool('memory_read'), makeTool('custom1'), makeTool('custom2')];
      const result = await selector.select(smallTools, '无关内容');
      expect(result.length).toBe(smallTools.length);
    });

    it('does NOT fall back when selected >= 5', async () => {
      const selector = new HybridToolSelector({
        strategy: 'layered',
        semanticEnabled: false,
        fallbackToCore: true,
        maxTools: 50,
      });
      // With no keyword match, core tools (7) are included -> 7 >= 5 -> no fallback
      const result = await selector.select(ALL_TOOLS, '无关内容');
      expect(result.length).toBe(CORE_NAMES.length); // Only core tools matched
    });
  });

  // =========================================================================
  // maxTools cap with prioritization
  // =========================================================================
  describe('maxTools cap', () => {
    it('caps results at maxTools', async () => {
      const selector = new HybridToolSelector({
        strategy: 'layered',
        semanticEnabled: false,
        maxTools: 5,
      });
      const manyTools = Array.from({ length: 50 }, (_, i) => makeTool(`memory_tool_${i}`));
      const result = await selector.select(manyTools, '记忆相关');
      expect(result.length).toBeLessThanOrEqual(5);
    });

    it('prioritizes core > lastTurn > rest when capping', async () => {
      const selector = new HybridToolSelector({
        strategy: 'layered',
        semanticEnabled: false,
        maxTools: 10,
      });
      selector.recordToolUsage(['sandbox_exec', 'web_search']);

      const result = await selector.select(ALL_TOOLS, '搜索文档代码目标记忆');
      const names = result.map(t => t.function.name);

      // Core tools should always be present
      expect(names).toContain('memory_read');
      expect(names).toContain('skill_list');
      // Last turn tools should be boosted
      expect(names).toContain('sandbox_exec');
      expect(names).toContain('web_search');
      // Total should be capped
      expect(result.length).toBeLessThanOrEqual(10);
    });
  });

  // =========================================================================
  // recordToolUsage (G-P2-05)
  // =========================================================================
  describe('recordToolUsage (G-P2-05)', () => {
    it('boosts previously used tools in next selection', async () => {
      const selector = new HybridToolSelector({ strategy: 'layered', semanticEnabled: false });
      selector.recordToolUsage(['sandbox_exec']);
      const result = await selector.select(ALL_TOOLS, '你好');
      const names = result.map(t => t.function.name);
      expect(names).toContain('sandbox_exec');
    });

    it('replaces previous usage on each call', async () => {
      const selector = new HybridToolSelector({ strategy: 'layered', semanticEnabled: false });
      selector.recordToolUsage(['sandbox_exec']);
      selector.recordToolUsage(['web_search']);
      const result = await selector.select(ALL_TOOLS, '你好');
      const names = result.map(t => t.function.name);
      expect(names).toContain('web_search');
    });
  });

  // =========================================================================
  // Semantic matching
  // =========================================================================
  describe('semantic matching', () => {
    it('skips semantic when no embedding provider (returns only core)', async () => {
      mockEmbeddingProvider = null;
      const selector = new HybridToolSelector({
        strategy: 'semantic',
        rulesEnabled: false,
        fallbackToCore: false,
      });
      const result = await selector.select(ALL_TOOLS, 'hello');
      // Only core tools are selected (no rules, no semantic)
      expect(result.length).toBe(CORE_NAMES.length);
    });

    it('uses embedding provider when available for scoring', async () => {
      const embedFn = vi.fn(async (_text: string) => new Array(3).fill(0.5));
      mockEmbeddingProvider = { embed: embedFn };

      const selector = new HybridToolSelector({
        strategy: 'semantic',
        rulesEnabled: false,
        fallbackToCore: false,
        maxTools: 50,
      });
      const tools = [
        ...CORE_NAMES.map(n => makeTool(n)),
        makeTool('web_search', 'Search the web for information'),
      ];
      const result = await selector.select(tools, 'find something on the internet');
      expect(embedFn).toHaveBeenCalled();
      // All identical embeddings -> cosine sim = 1.0, all pass threshold
      expect(result.length).toBeGreaterThan(CORE_NAMES.length);
    });

    it('handles embedding provider error gracefully', async () => {
      mockEmbeddingProvider = {
        embed: vi.fn(async () => { throw new Error('Embedding failed'); }),
      };
      const selector = new HybridToolSelector({
        strategy: 'semantic',
        rulesEnabled: false,
        fallbackToCore: false,
      });
      // Should not throw, returns only core tools
      const result = await selector.select(ALL_TOOLS, 'test query');
      expect(result.length).toBe(CORE_NAMES.length);
    });

    it('boosts last-turn tools by +0.15 in semantic scoring', async () => {
      mockEmbeddingProvider = {
        embed: vi.fn(async () => [0.3, 0.3, 0.3]),
      };
      const selector = new HybridToolSelector({
        strategy: 'semantic',
        rulesEnabled: false,
        fallbackToCore: false,
        maxTools: 50,
      });
      selector.recordToolUsage(['web_search']);
      const tools = [
        ...CORE_NAMES.map(n => makeTool(n)),
        makeTool('web_search', 'Search'),
      ];
      const result = await selector.select(tools, 'anything');
      const names = result.map(t => t.function.name);
      expect(names).toContain('web_search');
    });

    it('caches tool embeddings across calls', async () => {
      const embedFn = vi.fn(async () => [0.5, 0.5, 0.5]);
      mockEmbeddingProvider = { embed: embedFn };

      const selector = new HybridToolSelector({
        strategy: 'semantic',
        rulesEnabled: false,
        fallbackToCore: false,
        maxTools: 50,
      });
      const tools = [
        ...CORE_NAMES.map(n => makeTool(n)),
        makeTool('web_search', 'Search'),
      ];

      await selector.select(tools, 'query one');
      const firstCallCount = embedFn.mock.calls.length;

      await selector.select(tools, 'query two');
      const secondCallCount = embedFn.mock.calls.length;

      // Second call should use cached tool embeddings, only embed the new query
      expect(secondCallCount - firstCallCount).toBeLessThan(firstCallCount);
    });
  });

  // =========================================================================
  // hybrid strategy
  // =========================================================================
  describe('strategy: hybrid', () => {
    it('combines rules and semantic results', async () => {
      mockEmbeddingProvider = {
        embed: vi.fn(async () => [0.5, 0.5, 0.5]),
      };
      const selector = new HybridToolSelector({
        strategy: 'hybrid',
        rulesEnabled: true,
        semanticEnabled: true,
      });
      const result = await selector.select(ALL_TOOLS, '搜索最新新闻');
      const names = result.map(t => t.function.name);
      expect(names).toContain('web_search'); // from rules
      expect(names).toContain('memory_read'); // from core
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
      const b = getHybridToolSelector({ strategy: 'layered' });
      expect(b).not.toBe(a);
    });
  });

  // =========================================================================
  // resetCache
  // =========================================================================
  describe('resetCache', () => {
    it('clears static embedding cache without error', () => {
      expect(() => HybridToolSelector.resetCache()).not.toThrow();
    });
  });
});
