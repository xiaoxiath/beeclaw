/**
 * Example: Using feishu_get_current_user tool
 *
 * This example demonstrates how to use the user info tool in different scenarios
 */

import { getAgent } from '../../src/domain/agent';
import { initApp } from '../../src/app';

async function main() {
  // Initialize the app
  await initApp();
  const agent = getAgent();

  console.log('=== Feishu User Info Tool Examples ===\n');

  // Example 1: Simple user info request
  console.log('Example 1: Get user info');
  console.log('User: "我是谁？我的 open_id 是什么？"');
  console.log('Bot will call feishu_get_current_user and respond with user info\n');

  // Example 2: Using user info for authorization
  console.log('Example 2: Check calendar access');
  console.log('User: "帮我查一下今天的日程"');
  console.log('Bot workflow:');
  console.log('  1. Call feishu_get_current_user to get open_id');
  console.log('  2. Call feishu_calendar_list with user authorization');
  console.log('  3. Call feishu_calendar_today to get today\'s events\n');

  // Example 3: Logging user actions
  console.log('Example 3: Track who created a document');
  console.log('User: "创建一个文档，标题是项目计划"');
  console.log('Bot workflow:');
  console.log('  1. Call feishu_get_current_user');
  console.log('  2. Log: "User ou_xxx created document at 2026-03-15"');
  console.log('  3. Call feishu_drive_create_document\n');

  // Example 4: Personalized responses
  console.log('Example 4: Personalize bot response');
  console.log('User: "你好"');
  console.log('Bot: "你好！你的用户 ID 是 e33ggbyz，有什么可以帮助你的吗？"\n');

  console.log('=== Integration with other tools ===\n');

  console.log('The user info tool is automatically available when running in Feishu bot mode.');
  console.log('No additional configuration needed!\n');

  console.log('To test:');
  console.log('1. Run: bun run bot');
  console.log('2. Send a message to your Feishu bot: "我的 open_id 是什么？"');
  console.log('3. The bot will respond with your user information\n');
}

main().catch(console.error);
