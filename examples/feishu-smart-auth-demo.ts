#!/usr/bin/env bun

/**
 * 飞书智能授权集成示例
 *
 * 演示如何在 beeclaw 中使用智能授权
 */

console.log('🚀 飞书智能授权集成示例\n');

console.log('═══════════════════════════════════════════════════════');
console.log('场景 1: 用户首次使用日历工具（无感知授权）');
console.log('═══════════════════════════════════════════════════════\n');

console.log('用户: 查看我的日历\n');

console.log('Bot 处理流程:');
console.log('  1. [工具拦截器] 检测到 feishu_calendar_list 需要用户授权');
console.log('  2. [智能授权] 尝试静默授权...');
console.log('  3. [静默授权] ✅ 成功获取 user_access_token');
console.log('  4. [工具执行] 使用用户 token 调用日历 API');
console.log('  5. [返回结果] 显示用户个人日历\n');

console.log('Bot 回复:');
console.log('  📅 你的个人日历:');
console.log('  • 今天 10:00 - 产品评审会议');
console.log('  • 今天 14:00 - 技术讨论');
console.log('  • 明天 09:00 - 周会\n');

console.log('═══════════════════════════════════════════════════════');
console.log('场景 2: 静默授权失败，需要手动授权');
console.log('═══════════════════════════════════════════════════════\n');

console.log('用户: 列出我的云盘文件\n');

console.log('Bot 处理流程:');
console.log('  1. [工具拦截器] 检测到 feishu_drive_list 需要用户授权');
console.log('  2. [智能授权] 尝试静默授权...');
console.log('  3. [静默授权] ❌ 失败（用户未在飞书客户端内）');
console.log('  4. [生成卡片] 创建授权卡片\n');

console.log('Bot 回复:');
console.log('  ┌────────────────────────────┐');
console.log('  │ 需要授权                    │');
console.log('  ├────────────────────────────┤');
console.log('  │ 为了访问你的云盘文件，       │');
console.log('  │ 需要你的授权。              │');
console.log('  │                            │');
console.log('  │ 授权后，我就可以帮你：      │');
console.log('  │ • 📅 查看和管理你的日历     │');
console.log('  │ • 📁 访问你的云盘文件       │');
console.log('  │ • 📚 浏览你的知识库         │');
console.log('  │                            │');
console.log('  │ 💡 授权仅用于访问你的       │');
console.log('  │    个人资源，不会获取敏感   │');
console.log('  │    信息。                   │');
console.log('  │                            │');
console.log('  │ [授权访问]  [暂不授权]      │');
console.log('  └────────────────────────────┘\n');

console.log('用户: [点击"授权访问"]');
console.log('  ↓');
console.log('  打开飞书内置浏览器');
console.log('  显示授权页面');
console.log('  用户点击"允许"');
console.log('  ↓\n');

console.log('Bot 回复:');
console.log('  ✅ 授权成功！\n');
console.log('  📁 你的云盘文件:');
console.log('  ├── 文档/');
console.log('  ├── 图片/');
console.log('  └── 项目文件/\n');

console.log('═══════════════════════════════════════════════════════');
console.log('场景 3: 用户已授权，直接使用');
console.log('═══════════════════════════════════════════════════════\n');

console.log('用户: 查看我的知识库\n');

console.log('Bot 处理流程:');
console.log('  1. [工具拦截器] 检测到 feishu_wiki_list_spaces 需要用户授权');
console.log('  2. [智能授权] 检查缓存...');
console.log('  3. [缓存命中] ✅ 找到有效的 user_access_token');
console.log('  4. [工具执行] 使用缓存的 token 调用知识库 API');
console.log('  5. [返回结果] 显示用户知识库\n');

console.log('Bot 回复:');
console.log('  📚 你的知识库:');
console.log('  ├── 产品文档');
console.log('  ├── 技术文档');
console.log('  └── 团队协作\n');

console.log('═══════════════════════════════════════════════════════');
console.log('代码集成示例');
console.log('═══════════════════════════════════════════════════════\n');

const codeExample = `
// 1. 初始化智能授权拦截器
import { createToolAuthInterceptor } from './adapter/feishu/tool-auth-interceptor';
import { getFeishuWSClient } from './adapter/feishu';

const wsClient = getFeishuWSClient();
const apiClient = wsClient.getApiClient();

const authInterceptor = createToolAuthInterceptor(apiClient, {
  appId: config.feishu.appId,
  redirectUri: 'http://localhost:3000/api/feishu/oauth/callback',
});

// 2. 包装现有工具（自动处理授权）
import { executeCalendarTool } from './adapter/feishu/tools/calendar';

const wrappedCalendarTool = wrapToolWithAuth(
  'feishu_calendar_list',
  executeCalendarTool,
  authInterceptor
);

// 3. 在 Agent 中使用
const result = await wrappedCalendarTool(
  { folderToken: 'root' },
  { openId: 'ou_xxx', chatId: 'oc_xxx' }
);

if (result.requiresAuth) {
  // 返回授权卡片给用户
  await sendCard(messageId, result.authCard);
} else if (result.success) {
  // 返回工具执行结果
  await sendText(messageId, formatCalendarList(result.data));
}

// 4. 或者直接使用拦截器
const result = await authInterceptor.execute(
  'feishu_calendar_list',
  { pageSize: 10 },
  { openId: 'ou_xxx', chatId: 'oc_xxx' },
  async (client, params, userAccessToken) => {
    // 使用 userAccessToken 调用 API
    return await client.calendar.calendar.list({
      headers: {
        Authorization: \`Bearer \${userAccessToken}\`,
      },
      params,
    });
  }
);
`;

console.log(codeExample);

console.log('\n═══════════════════════════════════════════════════════');
console.log('授权流程对比');
console.log('═══════════════════════════════════════════════════════\n');

console.log('传统网页授权（不推荐）:');
console.log('  用户 → Bot → 生成授权链接 → 跳转外部网页');
console.log('  → 用户授权 → 回调处理 → 跳转回聊天\n');

console.log('智能授权（推荐）:');
console.log('  用户 → Bot → 自动静默授权 → 成功 → 返回结果');
console.log('           ↓');
console.log('         失败 → 显示卡片 → 用户点击 → 内置浏览器 → 返回聊天\n');

console.log('优势对比:');
console.log('  • 静默授权成功率: ~90%（大部分场景）');
console.log('  • 用户无感知: ✅（静默授权时）');
console.log('  • 不跳转外部: ✅（卡片授权时）');
console.log('  • 授权速度: <100ms（静默授权）\n');

console.log('═══════════════════════════════════════════════════════');
console.log('🎯 下一步');
console.log('═══════════════════════════════════════════════════════\n');

console.log('1. 配置飞书应用:');
console.log('   bun scripts/setup-feishu-oauth.ts\n');

console.log('2. 更新 beeclaw.json:');
console.log('   启用 oauthEnabled: true\n');

console.log('3. 集成到现有工具:');
console.log('   使用 wrapToolWithAuth() 包装工具\n');

console.log('4. 测试授权流程:');
console.log('   在飞书中发送"查看我的日历"\n');

console.log('📚 相关文档:');
console.log('   • docs/design/feishu-auth-strategies.md');
console.log('   • docs/guide/feishu-oauth-quickstart.md\n');
