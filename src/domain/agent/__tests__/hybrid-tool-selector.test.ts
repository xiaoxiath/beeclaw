/**
 * Hybrid Tool Selector Tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { HybridToolSelector } from '../hybrid-tool-selector';
import type { ChatMessage } from '../types';

describe('HybridToolSelector', () => {
  let selector: HybridToolSelector;

  beforeEach(() => {
    selector = new HybridToolSelector({
      maxTools: 30,
      enableCache: true,
      enableRules: true,
      enableSemantic: false, // 禁用语义匹配以加快测试
    });
  });

  describe('Rule-based selection', () => {
    test('should match calendar keywords', async () => {
      const tools = await selector.selectTools(
        '查看我的日历',
        [],
        30
      );

      const toolNames = tools.map(t => t.function.name);

      expect(toolNames).toContain('feishu_calendar_list');
      expect(toolNames.length).toBeGreaterThan(0);
    });

    test('should match skill keywords', async () => {
      const tools = await selector.selectTools(
        '列出所有技能',
        [],
        30
      );

      const toolNames = tools.map(t => t.function.name);

      expect(toolNames).toContain('skill_list');
    });

    test('should match goal keywords', async () => {
      const tools = await selector.selectTools(
        '创建一个新目标',
        [],
        30
      );

      const toolNames = tools.map(t => t.function.name);

      expect(toolNames).toContain('goal_create');
    });

    test('should match memory keywords', async () => {
      const tools = await selector.selectTools(
        '记住这个重要信息',
        [],
        30
      );

      const toolNames = tools.map(t => t.function.name);

      expect(toolNames).toContain('memory_record');
    });

    test('should match document keywords', async () => {
      const tools = await selector.selectTools(
        '创建一个飞书文档',
        [],
        30
      );

      const toolNames = tools.map(t => t.function.name);

      expect(toolNames).toContain('feishu_docx_create_text');
    });
  });

  describe('Core tools inclusion', () => {
    test('should always include core tools', async () => {
      const tools = await selector.selectTools(
        '任何消息',
        [],
        30
      );

      const toolNames = tools.map(t => t.function.name);

      expect(toolNames).toContain('memory_ls');
      expect(toolNames).toContain('memory_read');
      expect(toolNames).toContain('memory_record');
      expect(toolNames).toContain('skill_list');
      expect(toolNames).toContain('skill_get');
      expect(toolNames).toContain('web_search');
    });
  });

  describe('Caching', () => {
    test('should cache selection results', async () => {
      const message = '查看日历';

      // 第一次调用
      const tools1 = await selector.selectTools(message, [], 30);

      // 第二次调用（应该命中缓存）
      const tools2 = await selector.selectTools(message, [], 30);

      const stats = selector.getStats();
      expect(stats.cacheSize).toBe(1);

      // 结果应该一致
      const names1 = tools1.map(t => t.function.name).sort();
      const names2 = tools2.map(t => t.function.name).sort();
      expect(names1).toEqual(names2);
    });

    test('should respect cache TTL', async () => {
      const shortTTLSelector = new HybridToolSelector({
        maxTools: 30,
        enableCache: true,
        cacheTTL: 100, // 100ms
      });

      const message = '测试消息';

      // 第一次调用
      await shortTTLSelector.selectTools(message, [], 30);

      // 等待 TTL 过期
      await new Promise(resolve => setTimeout(resolve, 150));

      // 缓存应该过期
      const stats = shortTTLSelector.getStats();
      expect(stats.cacheSize).toBe(0);
    });

    test('should clear cache', async () => {
      await selector.selectTools('测试1', [], 30);
      await selector.selectTools('测试2', [], 30);

      expect(selector.getStats().cacheSize).toBe(2);

      selector.clearCache();

      expect(selector.getStats().cacheSize).toBe(0);
    });
  });

  describe('Tool count limiting', () => {
    test('should limit tool count to maxTools', async () => {
      const tools = await selector.selectTools(
        '测试消息',
        [],
        20
      );

      expect(tools.length).toBeLessThanOrEqual(20);
    });

    test('should include core tools even if limit exceeded', async () => {
      const tools = await selector.selectTools(
        '测试消息',
        [],
        10 // 很小的限制
      );

      const toolNames = tools.map(t => t.function.name);

      // 核心工具应该仍然存在
      expect(toolNames).toContain('memory_ls');
    });
  });

  describe('Context awareness', () => {
    test('should consider recent messages', async () => {
      const recentMessages: ChatMessage[] = [
        { role: 'user', content: '我想使用技能' },
        { role: 'assistant', content: '好的，让我列出可用技能' },
      ];

      const tools = await selector.selectTools(
        '继续',
        recentMessages,
        30
      );

      const toolNames = tools.map(t => t.function.name);

      // 应该包含技能相关工具
      expect(toolNames.some(name => name.startsWith('skill_'))).toBe(true);
    });
  });

  describe('Statistics', () => {
    test('should track statistics', async () => {
      await selector.selectTools('测试1', [], 30);
      await selector.selectTools('测试2', [], 30);

      const stats = selector.getStats();

      expect(stats.cacheSize).toBe(2);
      expect(stats.rulesCount).toBeGreaterThan(0);
    });
  });

  describe('Edge cases', () => {
    test('should handle empty message', async () => {
      const tools = await selector.selectTools('', [], 30);

      // 应该返回核心工具
      expect(tools.length).toBeGreaterThan(0);
    });

    test('should handle unknown intent', async () => {
      const tools = await selector.selectTools(
        '这是一条无法识别意图的消息 xyz123',
        [],
        30
      );

      // 应该返回核心工具
      const toolNames = tools.map(t => t.function.name);
      expect(toolNames).toContain('memory_ls');
    });

    test('should handle concurrent requests', async () => {
      const messages = ['日历', '文档', '技能', '目标', '记忆'];

      const promises = messages.map(msg =>
        selector.selectTools(msg, [], 30)
      );

      const results = await Promise.all(promises);

      // 所有请求都应该成功
      results.forEach(tools => {
        expect(tools.length).toBeGreaterThan(0);
      });
    });
  });
});
