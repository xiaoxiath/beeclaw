/**
 * 测试飞书日历授权流程
 */

import { initApp } from '../src/app';
import { getAgent } from '../src/domain/agent';
import type { UserContext } from '../src/domain/agent/types';

async function testAuthFlow() {
  await initApp();
  const agent = getAgent();

  console.log('=== 测试飞书日历授权流程 ===\n');

  // 模拟用户上下文
  const userContext: UserContext = {
    openId: 'ou_test_user',
    userId: 'test_user',
    chatId: 'oc_test_chat',
    messageId: 'om_test_message',
  };

  console.log('📝 测试场景 1: 首次使用（需要授权）');
  console.log('用户: "帮我创建明天的会议"\n');

  try {
    const result = await agent.chat(
      '帮我创建明天的会议',
      { userContext }
    );

    console.log('Bot 回复:');
    console.log(result);

    // 检查是否包含授权卡片
    if (result.includes('授权') || result.includes('auth')) {
      console.log('\n✅ 预期：返回授权卡片');
    } else {
      console.log('\n❌ 意外：没有看到授权提示');
    }
  } catch (error) {
    console.error('测试失败:', error);
  }

  console.log('\n---\n');
  console.log('📋 预期行为:');
  console.log('1. 检测到需要 calendar:calendar 权限');
  console.log('2. 尝试获取缓存的 token → 失败');
  console.log('3. 尝试静默授权 → 失败（首次使用）');
  console.log('4. 生成授权卡片');
  console.log('5. 发送授权卡片到聊天');
  console.log('6. 用户看到授权卡片，点击授权');
  console.log('7. OAuth 回调保存 token');
  console.log('8. 后续使用自动授权\n');

  console.log('🔍 调试建议:');
  console.log('- 查看日志: pm2 logs beeclaw | grep auth');
  console.log('- 检查配置: beeclaw.json 中的 feishu.redirectUri');
  console.log('- 确认权限: 飞书开放平台已启用 calendar:calendar');
  console.log('- 测试回调: 访问 /api/feishu/oauth/callback\n');
}

testAuthFlow().catch(console.error);
