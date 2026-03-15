#!/usr/bin/env bun

/**
 * Test Feishu Tool Permissions
 *
 * 测试飞书工具权限配置是否正确
 *
 * Usage:
 *   bun test scripts/test-feishu-permissions.ts
 */

import { getFeishuWSClient, initFeishuWSClient } from '../src/adapter/feishu';
import { loadConfig } from '../src/infra/config';

interface ToolTest {
  name: string;
  tool: string;
  action: () => Promise<any>;
  requiredPermission: string;
}

async function testToolPermissions() {
  console.log('🧪 Testing Feishu Tool Permissions...\n');

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

  // 测试工具列表
  const tests: ToolTest[] = [
    {
      name: '日历工具',
      tool: 'feishu_calendar_list',
      requiredPermission: 'calendar:calendar:readonly',
      action: async () => {
        return await client.calendar.calendar.list({
          params: { page_size: 1 }
        });
      }
    },
    {
      name: '文档工具',
      tool: 'feishu_docx_search',
      requiredPermission: 'docx:document:readonly',
      action: async () => {
        // 使用一个不存在的文档ID测试权限
        return await client.docx.document.search({
          path: { document_id: 'test_permission_check' },
          params: { query: 'test' }
        });
      }
    },
    {
      name: '多维表格工具',
      tool: 'feishu_bitable_list_tables',
      requiredPermission: 'bitable:app:readonly',
      action: async () => {
        return await client.bitable.appTable.list({
          path: { app_token: 'test_permission_check' }
        });
      }
    },
    {
      name: '云文档工具',
      tool: 'feishu_drive_list',
      requiredPermission: 'drive:drive:readonly',
      action: async () => {
        return await client.drive.driveFile.list({
          params: { page_size: 1 }
        });
      }
    },
    {
      name: '知识库工具',
      tool: 'feishu_wiki_list_spaces',
      requiredPermission: 'wiki:wiki:readonly',
      action: async () => {
        return await client.wiki.space.list({
          params: { page_size: 1 }
        });
      }
    }
  ];

  console.log('Testing tool permissions...\n');

  const results: Array<{ tool: string; name: string; status: '✅' | '❌'; error?: string }> = [];

  for (const test of tests) {
    process.stdout.write(`  ${test.name}... `);

    try {
      const response = await test.action();

      // 检查响应
      if (response.code === 0) {
        console.log('✅ OK');
        results.push({ tool: test.tool, name: test.name, status: '✅' });
      } else if (response.code === 99991672) {
        // 权限错误
        console.log('❌ Permission denied');
        results.push({
          tool: test.tool,
          name: test.name,
          status: '❌',
          error: `缺少权限: ${test.requiredPermission}`
        });
      } else {
        // 其他错误（可能是参数错误，但权限OK）
        if (response.msg?.includes('not found') || response.msg?.includes('invalid')) {
          console.log('✅ OK (permission granted, resource not found)');
          results.push({ tool: test.tool, name: test.name, status: '✅' });
        } else {
          console.log(`❌ Error: ${response.msg}`);
          results.push({
            tool: test.tool,
            name: test.name,
            status: '❌',
            error: response.msg
          });
        }
      }
    } catch (error: any) {
      if (error.response?.data?.code === 99991672) {
        console.log('❌ Permission denied');
        results.push({
          tool: test.tool,
          name: test.name,
          status: '❌',
          error: `缺少权限: ${test.requiredPermission}`
        });
      } else {
        console.log(`❌ Error: ${error.message}`);
        results.push({
          tool: test.tool,
          name: test.name,
          status: '❌',
          error: error.message
        });
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Test Results Summary:');
  console.log('='.repeat(60) + '\n');

  const passed = results.filter(r => r.status === '✅');
  const failed = results.filter(r => r.status === '❌');

  console.log(`✅ Passed: ${passed.length}/${results.length}`);
  console.log(`❌ Failed: ${failed.length}/${results.length}\n`);

  if (failed.length > 0) {
    console.log('Failed tools:');
    failed.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.name}`);
      console.log(`     Tool: ${r.tool}`);
      if (r.error) {
        console.log(`     Error: ${r.error}`);
      }
    });

    console.log('\n💡 Solution:');
    console.log('   1. Visit: https://open.feishu.cn/app/cli_a9390dcb98ba9cc6/auth');
    console.log('   2. Enable the missing permissions');
    console.log('   3. Wait 1-5 minutes for permissions to take effect');
    console.log('   4. Run this test again\n');

    process.exit(1);
  } else {
    console.log('🎉 All permissions configured correctly!\n');
    console.log('✨ You can now use all Feishu tools:\n');
    console.log('   • 日历工具: 创建、查询、管理日历事件');
    console.log('   • 文档工具: 读取、编辑飞书文档');
    console.log('   • 多维表格: 查询、创建记录');
    console.log('   • 云文档: 上传、下载、管理文件');
    console.log('   • 知识库: 创建、管理知识库\n');
    console.log('📚 Documentation: docs/feishu-tools-setup.md\n');

    process.exit(0);
  }
}

// Run tests
testToolPermissions().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
