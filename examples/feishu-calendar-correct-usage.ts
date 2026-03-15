/**
 * 飞书日历创建日程 - 正确用法示例
 *
 * 演示如何正确地为用户创建日程
 */

import { getAgent } from '../src/domain/agent';
import { initApp } from '../src/app';
import type { UserContext } from '../src/domain/agent/types';

async function main() {
  // 初始化应用
  await initApp();
  const agent = getAgent();

  console.log('=== 飞书日历创建日程 - 正确用法 ===\n');

  // 模拟飞书用户上下文
  const userContext: UserContext = {
    openId: 'ou_84aad35d084aa403a838cf73ee18467',
    userId: 'e33ggbyz',
    chatId: 'oc_5ce6d572455d361153b7xx51da133945',
    messageId: 'om_5ce6d572455d361153b7cb51da133945',
  };

  // ============================================
  // 示例 1: 创建日程（自动使用主日历）
  // ============================================
  console.log('📅 示例 1: 创建日程（无需提供 calendarId）');
  console.log('用户: "帮我创建一个明天下午3点的会议，讨论产品方案"\n');

  try {
    const result1 = await agent.chat(
      '帮我创建一个明天下午3点的会议，讨论产品方案',
      { userContext }
    );

    console.log('Bot 回复:');
    console.log(result1);
    console.log('\n---\n');
  } catch (error) {
    console.error('创建日程失败:', error);
  }

  // ============================================
  // 示例 2: 查询今日日程（自动使用主日历）
  // ============================================
  console.log('📅 示例 2: 查询今日日程（无需提供 calendarId）');
  console.log('用户: "我今天有什么安排？"\n');

  try {
    const result2 = await agent.chat(
      '我今天有什么安排？',
      { userContext }
    );

    console.log('Bot 回复:');
    console.log(result2);
    console.log('\n---\n');
  } catch (error) {
    console.error('查询日程失败:', error);
  }

  // ============================================
  // 示例 3: 快速创建日程（自动使用主日历）
  // ============================================
  console.log('📅 示例 3: 快速创建日程（无需提供 calendarId）');
  console.log('用户: "快速创建一个30分钟的站会"\n');

  try {
    const result3 = await agent.chat(
      '快速创建一个30分钟的站会',
      { userContext }
    );

    console.log('Bot 回复:');
    console.log(result3);
    console.log('\n---\n');
  } catch (error) {
    console.error('快速创建失败:', error);
  }

  console.log('=== 关键要点 ===\n');
  console.log('✅ 正确做法:');
  console.log('   1. 不需要提供 calendarId');
  console.log('   2. 系统会自动调用 calendar.primary API 获取用户主日历');
  console.log('   3. 使用真实的 calendar_id (格式: feishu.cn_xxx@group.calendar.feishu.cn)');
  console.log('   4. 日程会创建在用户的个人日历中，用户可见\n');

  console.log('❌ 错误做法 (旧版本):');
  console.log('   1. 使用用户的 open_id 作为 calendar_id');
  console.log('   2. 日程创建在错误的位置');
  console.log('   3. 用户无法在自己的日历中看到日程\n');

  console.log('📚 相关文档:');
  console.log('   - docs/fixes/feishu-calendar-fix.md');
  console.log('   - docs/guides/feishu-calendar-management.md\n');
}

main().catch(console.error);
