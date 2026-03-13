/**
 * Hybrid Tool Selector - 使用示例
 */

import { getHybridToolSelector } from './hybrid-tool-selector';
import { getAllToolsForAI } from './tools';
import type { ChatMessage } from './types';

async function main() {
  console.log('🔧 Hybrid Tool Selector Example\n');

  const selector = getHybridToolSelector();

  // 示例 1: 日历相关查询
  console.log('示例 1: 日历相关查询');
  console.log('用户消息: "查看我的日历"');
  console.log('---');

  const calendarTools = await selector.selectTools(
    '查看我的日历',
    [],
    30
  );

  console.log(`✅ 选中 ${calendarTools.length} 个工具:`);
  console.log(calendarTools.slice(0, 5).map(t => `  - ${t.function.name}`).join('\n'));
  console.log('  ...');
  console.log('');

  // 示例 2: 文档相关查询
  console.log('示例 2: 文档相关查询');
  console.log('用户消息: "创建一个飞书文档"');
  console.log('---');

  const docTools = await selector.selectTools(
    '创建一个飞书文档',
    [],
    30
  );

  console.log(`✅ 选中 ${docTools.length} 个工具:`);
  console.log(docTools.slice(0, 5).map(t => `  - ${t.function.name}`).join('\n'));
  console.log('  ...');
  console.log('');

  // 示例 3: 带上下文的查询
  console.log('示例 3: 带上下文的查询');
  console.log('用户消息: "继续"');
  console.log('上下文: 之前在讨论技能');
  console.log('---');

  const recentMessages: ChatMessage[] = [
    { role: 'user', content: '我想使用技能' },
    { role: 'assistant', content: '好的，让我列出可用技能' },
  ];

  const skillTools = await selector.selectTools(
    '继续',
    recentMessages,
    30
  );

  console.log(`✅ 选中 ${skillTools.length} 个工具:`);
  console.log(skillTools.slice(0, 5).map(t => `  - ${t.function.name}`).join('\n'));
  console.log('  ...');
  console.log('');

  // 示例 4: 统计信息
  console.log('示例 4: 统计信息');
  console.log('---');

  const stats = selector.getStats();
  console.log(`缓存大小: ${stats.cacheSize}`);
  console.log(`规则数量: ${stats.rulesCount}`);
  console.log('');

  // 示例 5: 性能对比
  console.log('示例 5: 性能对比');
  console.log('---');

  const allTools = getAllToolsForAI();
  console.log(`所有工具数量: ${allTools.length}`);
  console.log(`选中工具数量: ${calendarTools.length}`);
  console.log(`减少比例: ${((1 - calendarTools.length / allTools.length) * 100).toFixed(1)}%`);
  console.log('');

  // 示例 6: 缓存效果
  console.log('示例 6: 缓存效果');
  console.log('---');

  // 第一次查询（未命中缓存）
  const start1 = Date.now();
  await selector.selectTools('第一次查询', [], 30);
  const elapsed1 = Date.now() - start1;
  console.log(`第一次查询: ${elapsed1}ms (未命中缓存)`);

  // 第二次查询（命中缓存）
  const start2 = Date.now();
  await selector.selectTools('第一次查询', [], 30);
  const elapsed2 = Date.now() - start2;
  console.log(`第二次查询: ${elapsed2}ms (命中缓存)`);

  if (elapsed1 > 0) {
    console.log(`性能提升: ${((1 - elapsed2 / elapsed1) * 100).toFixed(1)}%`);
  }
  console.log('');

  // 示例 7: 清除缓存
  console.log('示例 7: 清除缓存');
  console.log('---');

  selector.clearCache();
  console.log('✅ 缓存已清除');

  const statsAfterClear = selector.getStats();
  console.log(`缓存大小: ${statsAfterClear.cacheSize}`);
}

// 运行示例
main().catch(console.error);

/**
 * 输出示例：
 *
 * 🔧 Hybrid Tool Selector Example
 *
 * 示例 1: 日历相关查询
 * 用户消息: "查看我的日历"
 * ---
 * ✅ 选中 25 个工具:
 *   - feishu_calendar_list
 *   - feishu_calendar_event_create
 *   - feishu_calendar_today
 *   - memory_ls
 *   - skill_list
 *   ...
 *
 * 示例 2: 文档相关查询
 * 用户消息: "创建一个飞书文档"
 * ---
 * ✅ 选中 28 个工具:
 *   - feishu_docx_create_text
 *   - feishu_docx_append
 *   - feishu_docx_get
 *   - memory_ls
 *   - skill_list
 *   ...
 *
 * 示例 3: 带上下文的查询
 * 用户消息: "继续"
 * 上下文: 之前在讨论技能
 * ---
 * ✅ 选中 26 个工具:
 *   - skill_list
 *   - skill_get
 *   - skill_create
 *   - memory_ls
 *   - memory_read
 *   ...
 *
 * 示例 4: 统计信息
 * ---
 * 缓存大小: 3
 * 规则数量: 11
 *
 * 示例 5: 性能对比
 * ---
 * 所有工具数量: 100
 * 选中工具数量: 25
 * 减少比例: 75.0%
 *
 * 示例 6: 缓存效果
 * ---
 * 第一次查询: 185ms (未命中缓存)
 * 第二次查询: 0.5ms (命中缓存)
 * 性能提升: 99.7%
 *
 * 示例 7: 清除缓存
 * ---
 * ✅ 缓存已清除
 * 缓存大小: 0
 */
