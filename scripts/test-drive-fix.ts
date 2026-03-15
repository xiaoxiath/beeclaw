#!/usr/bin/env bun

/**
 * Test Drive Tool Parameter Fix
 *
 * 测试 drive 工具参数修复是否生效
 */

import { getFeishuWSClient, initFeishuWSClient } from '../src/adapter/feishu';
import { loadConfig } from '../src/infra/config';

async function testDriveToolFix() {
  console.log('🧪 Testing Drive Tool Parameter Fix...\n');

  // 加载配置
  const config = loadConfig();
  if (!config.feishu?.appId || !config.feishu?.appSecret) {
    console.error('❌ Feishu configuration not found');
    process.exit(1);
  }

  // 初始化客户端
  const wsClient = initFeishuWSClient({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
    enabled: true,
    loggerLevel: 'error',
  });

  const client = wsClient.getApiClient();
  if (!client) {
    console.error('❌ Failed to get API client');
    process.exit(1);
  }

  console.log('✅ Client initialized\n');

  // 测试 listFiles 函数
  console.log('Testing feishu_drive_list with folderToken="root"...');

  try {
    // 直接调用 executeDriveTool（模拟 AI 调用）
    const { executeDriveTool } = await import('../src/adapter/feishu/tools/drive');

    const result = await executeDriveTool(client, 'feishu_drive_list', {
      folderToken: 'root'  // AI 会传递这个参数（驼峰命名）
    });

    if (result.success) {
      console.log('✅ Drive tool executed successfully!');
      console.log(`   Files found: ${(result.data as any)?.files?.length || 0}`);
      console.log(`   Has more: ${(result.data as any)?.hasMore}`);
      console.log('\n🎉 Parameter fix verified!\n');
    } else {
      console.log('❌ Drive tool failed:', result.error);
      console.log('\n💡 This might be a permission issue. Check:');
      console.log('   1. Run: bun scripts/check-feishu-permissions.ts');
      console.log('   2. Enable drive:drive:readonly permission\n');
      process.exit(1);
    }
  } catch (error: any) {
    console.log('❌ Test failed:', error.message);
    console.log('\nStack trace:', error.stack);
    process.exit(1);
  }
}

testDriveToolFix().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
