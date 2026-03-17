#!/usr/bin/env bun
/**
 * 验证所有必需的环境变量是否设置
 */

import { existsSync } from 'fs';
import { join } from 'path';

const REQUIRED_VARS = [
  'ZHIPU_API_KEY',
  'LARK_BEECLAW_APPID',
  'LARK_BEECLAW_AS',
];

const OPTIONAL_VARS = [
  'MINIMAX_API_KEY',
  'BOCHA_API_KEY',
  'TAVILY_API_KEY',
  'QWEATHER_API_KEY',
  'QWEATHER_APIHOST',
  'WEBUI_AUTH_TOKEN',
  'BEECLAW_PORT',
  'BEECLAW_HOST',
  'BEECLAW_SHOW_TOKEN_STATS',
];

const ENV_FILE = join(process.cwd(), '.env');

function validateEnv() {
  console.log('🔍 Validating environment variables...\n');

  if (!existsSync(ENV_FILE)) {
    console.log('❌ .env file not found!');
    console.log('   Please copy .env.example to .env and fill in your values');
    process.exit(1);
  }

  // 检查必需变量
  const missing: string[] = [];
  for (const varName of REQUIRED_VARS) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    console.log(`\n❌ Missing required environment variables:`);
    missing.forEach(item => console.log(`   - ${item}`));
    console.log('\n   Please set these variables in .env file');
    process.exit(1);
  }

  console.log('✅ All required environment variables are set');

  // 检查可选变量
  const missingOptional: string[] = [];
  for (const varName of OPTIONAL_VARS) {
    if (!process.env[varName]) {
      missingOptional.push(varName);
    }
  }

  if (missingOptional.length > 0) {
    console.log(`\n⚠️  Missing optional environment variables:`);
    missingOptional.forEach(item => console.log(`   - ${item}`));
    console.log('   Some features may not work without these variables');
  }

  console.log('\n✅ Environment validation complete!');
}

// 运行验证
validateEnv();
