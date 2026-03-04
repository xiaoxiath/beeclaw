#!/usr/bin/env bun
/**
 * 日志演示脚本
 *
 * 展示增强的日志系统如何记录工具调用和技能使用
 *
 * 运行方式：
 *   bun run examples/logging-demo.ts
 */

import { Agent, getAllToolsForAI, SYSTEM_PROMPTS } from '../src/agent';
import type { AIProvider } from '../src/config/schema';

async function main() {
  console.log('🐝 Beeclaw 日志系统演示');
  console.log('='.repeat(80));
  console.log('这个脚本展示了增强的日志功能\n');

  // 检查环境变量
  if (!process.env.ZHIPU_API_KEY && !process.env.OPENAI_API_KEY) {
    console.error('❌ 请设置 ZHIPU_API_KEY 或 OPENAI_API_KEY 环境变量');
    process.exit(1);
  }

  // 创建 provider 配置
  const provider: AIProvider = process.env.ZHIPU_API_KEY
    ? {
        name: 'zhipu',
        type: 'zhipu',
        apiKey: process.env.ZHIPU_API_KEY,
        models: ['glm-4'],
        default: true,
      }
    : {
        name: 'openai',
        type: 'openai',
        apiKey: process.env.OPENAI_API_KEY!,
        models: ['gpt-4o-mini'],
        default: true,
      };

  // 创建 Agent
  const agent = new Agent({
    provider,
    model: provider.models[0],
    systemPrompt: SYSTEM_PROMPTS.general,
    tools: getAllToolsForAI(),
    maxToolIterations: 10,
  });

  console.log('📝 测试场景 1: 简单的工具调用');
  console.log('-'.repeat(80));

  try {
    const response1 = await agent.chat('现在几点了？');
    console.log('\n✅ 回答:', response1.substring(0, 200));
  } catch (error) {
    console.error('❌ 错误:', error);
  }

  console.log('\n\n📝 测试场景 2: 多个工具并行调用');
  console.log('-'.repeat(80));

  try {
    const response2 = await agent.chat('搜索一下今天的天气，然后读取用户的偏好设置');
    console.log('\n✅ 回答:', response2.substring(0, 200));
  } catch (error) {
    console.error('❌ 错误:', error);
  }

  console.log('\n\n📝 测试场景 3: 技能使用');
  console.log('-'.repeat(80));

  try {
    const response3 = await agent.chat('列出所有可用的技能');
    console.log('\n✅ 回答:', response3.substring(0, 200));
  } catch (error) {
    console.error('❌ 错误:', error);
  }

  console.log('\n\n' + '='.repeat(80));
  console.log('✨ 演示完成！');
  console.log('='.repeat(80));
  console.log('\n查看上面的日志输出，你可以看到：');
  console.log('  1. LLM 决定调用的工具（带参数预览）');
  console.log('  2. 工具执行计划（并行/串行批次）');
  console.log('  3. 每个工具的执行时间和结果预览');
  console.log('  4. 技能使用的特殊标记（🎯 ✅ 📝）');
  console.log('  5. 对话总结（迭代次数、使用的技能、上下文使用率）');
  console.log('\n这些日志在 PM2 模式下会保存到 ./logs/ 目录');
}

main().catch(console.error);
