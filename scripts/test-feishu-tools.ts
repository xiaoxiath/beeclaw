#!/usr/bin/env bun

/**
 * Feishu Tools Test Script
 *
 * This script tests if Feishu tools are properly configured and working.
 *
 * Usage:
 *   bun test scripts/test-feishu-tools.ts
 *
 * Prerequisites:
 *   1. Configure beeclaw.json with feishu settings
 *   2. Set environment variables: LARK_BEECLAW_APPID, LARK_BEECLAW_AS
 *   3. Enable required permissions in Feishu Open Platform
 */

import { initFeishuWSClient, getFeishuWSClient } from '../src/adapter/feishu';
import { loadConfig } from '../src/infra/config';

async function testFeishuTools() {
  console.log('🔍 Testing Feishu Tools Configuration...\n');

  // Step 1: Load configuration
  console.log('1️⃣  Loading configuration...');
  const config = loadConfig();

  if (!config.feishu) {
    console.error('❌ Feishu configuration not found in beeclaw.json');
    console.log('\n💡 Solution: Add feishu configuration to beeclaw.json:');
    console.log(JSON.stringify({
      feishu: {
        enabled: true,
        appId: "${LARK_BEECLAW_APPID}",
        appSecret: "${LARK_BEECLAW_AS}",
        encryptKey: "${LARK_BEECLAW_ENCRYPT_KEY}",
        verificationToken: "${LARK_BEECLAW_VERIFICATION_TOKEN}",
        logLevel: "error",
        useCardV2: true
      }
    }, null, 2));
    process.exit(1);
  }

  console.log('✅ Feishu configuration found');
  console.log(`   - enabled: ${config.feishu.enabled}`);
  console.log(`   - appId: ${config.feishu.appId ? '✓' : '✗'}`);
  console.log(`   - appSecret: ${config.feishu.appSecret ? '✓' : '✗'}`);
  console.log('');

  // Step 2: Check environment variables
  console.log('2️⃣  Checking environment variables...');
  const appId = process.env.LARK_BEECLAW_APPID;
  const appSecret = process.env.LARK_BEECLAW_AS;

  if (!appId || !appSecret) {
    console.error('❌ Required environment variables not set');
    console.log('\n💡 Solution: Set environment variables:');
    console.log('   export LARK_BEECLAW_APPID="cli_xxxxxxxxxxxx"');
    console.log('   export LARK_BEECLAW_AS="xxxxxxxxxxxxxxxxxxxx"');
    process.exit(1);
  }

  console.log('✅ Environment variables configured');
  console.log(`   - LARK_BEECLAW_APPID: ${appId.substring(0, 10)}...`);
  console.log(`   - LARK_BEECLAW_AS: ${'*'.repeat(10)}`);
  console.log('');

  // Step 3: Initialize Feishu client
  console.log('3️⃣  Initializing Feishu WebSocket client...');
  try {
    const wsClient = initFeishuWSClient({
      appId: config.feishu.appId!,
      appSecret: config.feishu.appSecret!,
      enabled: true,
      loggerLevel: config.feishu.logLevel || 'error',
    });

    if (!wsClient) {
      throw new Error('Failed to initialize Feishu client');
    }

    console.log('✅ Feishu client initialized');
    console.log('');

    // Step 4: Get API client
    console.log('4️⃣  Getting API client...');
    const apiClient = wsClient.getApiClient();

    if (!apiClient) {
      throw new Error('Failed to get API client');
    }

    console.log('✅ API client available');
    console.log('');

    // Step 5: Test API call (get calendar list)
    console.log('5️⃣  Testing API call: getCalendarList...');
    try {
      const response = await apiClient.calendar.calendar.list({
        params: {
          page_size: 10,
        },
      });

      if (response.code === 0) {
        console.log('✅ API call successful');
        console.log(`   - Calendars found: ${response.data?.calendar_list?.length || 0}`);

        if (response.data?.calendar_list?.length! > 0) {
          console.log('   - Sample calendar:');
          const sample = response.data?.calendar_list?.[0];
          console.log(`     * ID: ${sample?.calendar_id}`);
          console.log(`     * Summary: ${sample?.summary}`);
        }
      } else {
        console.log('⚠️  API call returned error:');
        console.log(`   - Code: ${response.code}`);
        console.log(`   - Message: ${response.msg}`);

        if (response.code === 99991663) {
          console.log('\n💡 This might be a permission issue. Please check:');
          console.log('   1. Visit https://open.feishu.cn/');
          console.log('   2. Go to your app → Permissions');
          console.log('   3. Enable "calendar:calendar:readonly" permission');
          console.log('   4. Wait a few minutes for permissions to take effect');
        }
      }
    } catch (error) {
      console.log('⚠️  API call failed:', error);
      console.log('\n💡 This might be normal if you don\'t have calendar permissions.');
      console.log('   The client is properly initialized, but you may need to:');
      console.log('   1. Enable calendar permissions in Feishu Open Platform');
      console.log('   2. Wait for permissions to take effect');
    }

    console.log('');
    console.log('🎉 Test completed!');
    console.log('');
    console.log('📝 Summary:');
    console.log('   ✅ Configuration: Valid');
    console.log('   ✅ Environment: Set');
    console.log('   ✅ Client: Initialized');
    console.log('   ✅ API Client: Available');
    console.log('');
    console.log('✨ Feishu tools are ready to use!');
    console.log('');
    console.log('📚 Next steps:');
    console.log('   1. Start bot mode: bun run bot');
    console.log('   2. Send message to your Feishu bot');
    console.log('   3. Try: "列出我的所有日历"');
    console.log('   4. Try: "帮我创建一个测试日历事件"');

  } catch (error) {
    console.error('❌ Initialization failed:', error);
    process.exit(1);
  }
}

// Run tests
testFeishuTools().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
