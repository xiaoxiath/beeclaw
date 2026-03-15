#!/usr/bin/env bun

/**
 * Feishu OAuth 配置助手
 *
 * 帮助用户快速配置飞书 OAuth 2.0 用户授权
 */

console.log('🔧 飞书 OAuth 2.0 配置助手\n');

console.log('📋 配置步骤:\n');

console.log('═══════════════════════════════════════════════════════');
console.log('步骤 1: 配置重定向 URL');
console.log('═══════════════════════════════════════════════════════\n');

console.log('1️⃣  访问飞书开放平台:');
console.log('   https://open.feishu.cn/app/cli_a9390dcb98ba9cc6\n');

console.log('2️⃣  进入应用 → 安全设置 → 重定向 URL\n');

console.log('3️⃣  添加以下 URL（根据你的环境选择）:\n');

console.log('开发环境:');
console.log('  http://localhost:3000/api/feishu/oauth/callback\n');

console.log('生产环境:');
console.log('  https://your-domain.com/api/feishu/oauth/callback\n');

console.log('═══════════════════════════════════════════════════════');
console.log('步骤 2: 配置权限范围');
console.log('═══════════════════════════════════════════════════════\n');

console.log('在 应用 → 权限管理 中，搜索并开启以下权限:\n');

const permissions = [
  { name: '获取用户基本信息', scope: 'contact:user.base:readonly', required: true },
  { name: '查看用户日历', scope: 'calendar:calendar:readonly', required: true },
  { name: '管理用户日历', scope: 'calendar:calendar', required: true },
  { name: '查看云盘文件', scope: 'drive:drive:readonly', required: true },
  { name: '管理云盘文件', scope: 'drive:drive', required: true },
  { name: '上传文件', scope: 'drive:file:upload', required: false },
  { name: '下载文件', scope: 'drive:file:download', required: false },
  { name: '查看知识库', scope: 'wiki:wiki:readonly', required: true },
  { name: '管理知识库', scope: 'wiki:wiki', required: true },
];

permissions.forEach((p, i) => {
  const required = p.required ? '✅ 必需' : '📦 可选';
  console.log(`${i + 1}. [${required}] ${p.name}`);
  console.log(`   Scope: ${p.scope}\n`);
});

console.log('一键申请所有必需权限:');
console.log('https://open.feishu.cn/app/cli_a9390dcb98ba9cc6/auth?q=' + permissions.filter(p => p.required).map(p => p.scope).join(',') + '&op_from=openapi&token_type=tenant\n');

console.log('═══════════════════════════════════════════════════════');
console.log('步骤 3: 更新 beeclaw.json');
console.log('═══════════════════════════════════════════════════════\n');

console.log('在 beeclaw.json 中添加 OAuth 配置:\n');

const exampleConfig = {
  feishu: {
    enabled: true,
    appId: '${LARK_BEECLAW_APPID}',
    appSecret: '${LARK_BEECLAW_AS}',
    encryptKey: '${LARK_BEECLAW_ENCRYPT_KEY}',
    verificationToken: '${LARK_BEECLAW_VERIFICATION_TOKEN}',
    logLevel: 'error',
    useCardV2: true,
    oauthEnabled: true,
    oauthRedirectUri: 'http://localhost:3000/api/feishu/oauth/callback',
  },
};

console.log(JSON.stringify(exampleConfig, null, 2));
console.log('\n');

console.log('═══════════════════════════════════════════════════════');
console.log('步骤 4: 重启服务');
console.log('═══════════════════════════════════════════════════════\n');

console.log('重启 bot 服务:\n');
console.log('  bun run bot\n');
console.log('或使用 PM2:\n');
console.log('  bun run pm2:restart\n');

console.log('═══════════════════════════════════════════════════════');
console.log('步骤 5: 测试授权流程');
console.log('═══════════════════════════════════════════════════════\n');

console.log('在飞书中发送消息测试:\n');

console.log('用户: 查看我的日历');
console.log('Bot:  需要授权才能访问你的个人日历');
console.log('      🔗 [点击授权](auth_url)');
console.log('用户: [点击授权链接]');
console.log('      → 跳转到飞书授权页面');
console.log('      → 用户点击"允许"');
console.log('      → 跳转回回调页面');
console.log('      → 显示"授权成功"');
console.log('Bot:  ✅ 授权成功！现在可以访问你的日历了\n');

console.log('═══════════════════════════════════════════════════════');
console.log('🎉 配置完成！');
console.log('═══════════════════════════════════════════════════════\n');

console.log('📚 相关文档:\n');
console.log('  • 用户授权设计: docs/design/feishu-user-authorization.md');
console.log('  • OAuth 实现指南: docs/guide/feishu-oauth.md');
console.log('  • 权限配置: docs/feishu-tools-setup.md\n');

console.log('🔧 故障排查:\n');
console.log('  • 如果授权失败，检查重定向 URL 是否正确');
console.log('  • 如果提示权限不足，检查权限是否已开启');
console.log('  • 如果 token 过期，用户需要重新授权\n');

console.log('💡 提示:\n');
console.log('  • 用户授权 token 有效期 2 小时，自动刷新');
console.log('  • 每个用户需要单独授权');
console.log('  • 授权信息存储在缓存中，重启后需要重新授权\n');
