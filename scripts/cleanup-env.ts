#!/usr/bin/env bun
/**
 * 清理未使用的环境变量
 *
 * 运行此脚本前请先备份当前的 .env 文件！
 */

import { writeFileSync, readFileSync, copyFileSync } from 'fs';
import { existsSync } from 'fs';
import { join } from 'path';

const UNUSED_VARS = [
  'BEECLAW_SHOW_THINKING',
  'BEECLAW_SHOW_TOOL_PROCESS',
  'QWEATHER_LOCATION',
  'GOOGLE_SEARCH_API_KEY',
  'GOOGLE_SEARCH_CX',
  'BING_SEARCH_API_KEY',
  'BRAVE_SEARCH_API_KEY',
  'DEBUG',
  'NODE_ENV',
  'TZ',
  'LANG',
  'TERM',
  'PAGER',
  'http_proxy',
  'https_proxy',
];

const ENV_FILE = join(process.cwd(), '.env');
const ENV_BACKUP = join(process.cwd(), '.env.backup');

async function cleanupEnv() {
  console.log('🧹 Cleaning up unused environment variables...\n');

  // 备份当前 .env 文件
  if (existsSync(ENV_FILE)) {
    copyFileSync(ENV_FILE, ENV_BACKUP);
    console.log(`✅ Backup created: ${ENV_BACKUP}`);
  }

  // 读取 .env 文件
  let content = '';
  if (existsSync(ENV_FILE)) {
    content = readFileSync(ENV_FILE, 'utf-8');
  }

  const lines = content.split('\n');
  const cleanedLines: string[] = [];
  let removedCount = 0;

  for (const line of lines) {
    // 保留注释和空行
    if (line.trim().startsWith('#') || line.trim() === '') {
      cleanedLines.push(line);
      continue;
    }

    // 检查是否是未使用的变量
    const varMatch = line.match(/^(\w+)=/);
    if (varMatch) {
      const varName = varMatch[1];
      if (UNUSED_VARS.includes(varName)) {
        console.log(`❌ Removing unused variable: ${varName}`);
        removedCount++;
        continue;
      }
    }

    cleanedLines.push(line);
  }

  // 写回 .env 文件
  const newContent = cleanedLines.join('\n');
  writeFileSync(ENV_FILE, newContent, 'utf-8');

  console.log(`\n✅ Cleanup complete!`);
  console.log(`   Removed: ${removedCount} unused variables`);
  console.log(`   Remaining: ${cleanedLines.filter(l => l && !l.trim().startsWith('#')).length} active variables`);
  console.log(`   Backup saved to: ${ENV_BACKUP}`);
}

cleanupEnv().catch(console.error);
