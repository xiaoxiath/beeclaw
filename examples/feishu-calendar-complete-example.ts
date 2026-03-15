/**
 * 飞书日历管理完整示例
 *
 * 演示如何通过 beeclaw 给用户创建、查询、更新、删除日程
 */

import { getAgent } from '../src/domain/agent';
import { initApp } from '../src/app';
import { getFeishuWSClient } from '../src/adapter/feishu';
import type { UserContext } from '../src/domain/agent/types';

async function main() {
  // 初始化应用
  await initApp();
  const agent = getAgent();

  console.log('=== 飞书日历管理示例 ===\n');

  // 模拟飞书用户上下文（实际运行时从消息事件中自动获取）
  const userContext: UserContext = {
    openId: 'ou_84aad35d084aa403a838cf73ee18467', // 用户的 open_id
    userId: 'e33ggbyz',
    chatId: 'oc_5ce6d572455d361153b7xx51da133945',
    messageId: 'om_5ce6d572455d361153b7cb51da133945',
  };

  // ============================================
  // 示例 1: 创建日程
  // ============================================
  console.log('📅 示例 1: 创建日程');
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
  // 示例 2: 查询今日日程
  // ============================================
  console.log('📅 示例 2: 查询今日日程');
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
  // 示例 3: 快速创建日程
  // ============================================
  console.log('📅 示例 3: 快速创建日程');
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

  // ============================================
  // 示例 4: 更新日程
  // ============================================
  console.log('📅 示例 4: 更新日程');
  console.log('用户: "把明天的产品方案会议改到下午4点"\n');

  try {
    const result4 = await agent.chat(
      '把明天的产品方案会议改到下午4点',
      { userContext }
    );

    console.log('Bot 回复:');
    console.log(result4);
    console.log('\n---\n');
  } catch (error) {
    console.error('更新日程失败:', error);
  }

  // ============================================
  // 示例 5: 搜索日程
  // ============================================
  console.log('📅 示例 5: 搜索日程');
  console.log('用户: "搜索包含"产品"的日程"\n');

  try {
    const result5 = await agent.chat(
      '搜索包含"产品"的日程',
      { userContext }
    );

    console.log('Bot 回复:');
    console.log(result5);
    console.log('\n---\n');
  } catch (error) {
    console.error('搜索日程失败:', error);
  }

  // ============================================
  // 示例 6: 删除日程
  // ============================================
  console.log('📅 示例 6: 删除日程');
  console.log('用户: "取消明天的产品方案会议"\n');

  try {
    const result6 = await agent.chat(
      '取消明天的产品方案会议',
      { userContext }
    );

    console.log('Bot 回复:');
    console.log(result6);
    console.log('\n---\n');
  } catch (error) {
    console.error('删除日程失败:', error);
  }

  console.log('=== 完整工作流程说明 ===\n');

  console.log('1️⃣  获取用户信息');
  console.log('   - 工具: feishu_get_current_user');
  console.log('   - 返回: openId, chatId, messageId');
  console.log('   - 权限: 无需授权\n');

  console.log('2️⃣  用户授权（首次使用）');
  console.log('   - 工具: 自动弹出授权卡片');
  console.log('   - 权限: calendar:calendar');
  console.log('   - 流程: 用户点击授权 → 保存 token\n');

  console.log('3️⃣  创建日程');
  console.log('   - 工具: feishu_calendar_event_create');
  console.log('   - calendarId: 使用用户的 openId');
  console.log('   - 参数: summary, startTime, endTime, location, attendees\n');

  console.log('4️⃣  查询日程');
  console.log('   - 工具: feishu_calendar_event_list / feishu_calendar_today');
  console.log('   - calendarId: 使用用户的 openId');
  console.log('   - 参数: startTime, endTime\n');

  console.log('5️⃣  更新日程');
  console.log('   - 工具: feishu_calendar_event_update');
  console.log('   - 参数: calendarId, eventId, 更新的字段\n');

  console.log('6️⃣  删除日程');
  console.log('   - 工具: feishu_calendar_event_delete');
  console.log('   - 参数: calendarId, eventId\n');

  console.log('📚 关键要点:\n');
  console.log('✅ 用户的 open_id 就是其主日历的 calendar_id');
  console.log('✅ 创建/更新/删除日程需要 calendar:calendar 权限');
  console.log('✅ 授权会自动处理，首次使用时弹出授权卡片');
  console.log('✅ token 会自动刷新，无需手动管理');
  console.log('✅ 所有操作都可以通过自然语言完成，AI 会自动调用工具\n');

  console.log('🚀 启动 bot 测试:');
  console.log('   bun run bot');
  console.log('   然后在飞书中发送消息给 bot:\n');
  console.log('   - "我的 open_id 是什么？"');
  console.log('   - "创建一个明天的会议"');
  console.log('   - "我今天有什么安排？"');
}

main().catch(console.error);
