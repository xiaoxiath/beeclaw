#!/usr/bin/env bun
/**
 * 预计算工具 Embeddings
 *
 * 运行方式：
 *   bun run scripts/build-tool-embeddings.ts
 *
 * 作用：
 *   - 为所有工具生成 embeddings
 *   - 保存到 data/tool-embeddings.json
 *   - 加快启动速度
 *
 * 配置：
 *   使用 beeclaw.json 中的 toolSelector.embedding 配置
 *   如果未配置，会按以下优先级回退：
 *   1. toolSelector.embedding
 *   2. memory.search.vector
 *   3. default provider
 *   4. local (fallback)
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

// 动态导入，因为这是脚本
async function main() {
  console.log('🔧 Building tool embeddings...\n');

  try {
    // 导入必要的模块
    const { getAllToolsForAI } = await import('../src/domain/agent/tools');
    const { createEmbeddingProvider } = await import('../src/domain/memory/embeddings');
    const { loadConfig } = await import('../src/infra/config');

    // 加载配置
    const config = await loadConfig();

    // 构建 embedding 配置（与 app/index.ts 中的 buildEmbeddingConfig 逻辑一致）
    let embeddingConfig: any = null;

    // 1. 优先使用 toolSelector.embedding
    if (config.toolSelector?.embedding) {
      console.log('📝 Using toolSelector.embedding config');
      embeddingConfig = {
        type: config.toolSelector.embedding.provider || 'auto',
        apiKey: config.toolSelector.embedding.apiKey,
        baseUrl: config.toolSelector.embedding.baseUrl,
        model: config.toolSelector.embedding.model,
        dims: config.toolSelector.embedding.dims,
      };
    }
    // 2. 回退到 memory.search.vector
    else if (config.memory?.search?.vector?.enabled !== false) {
      const vectorConfig = config.memory?.search?.vector;
      if (vectorConfig && vectorConfig.provider !== 'auto') {
        console.log('📝 Using memory.search.vector config for embeddings');
        embeddingConfig = {
          type: vectorConfig.provider,
          model: vectorConfig.model,
          dims: vectorConfig.dims,
        };
      }
    }

    // 3. 回退到默认 AI provider
    if (!embeddingConfig) {
      const defaultProvider = config.providers?.find((p: any) => p.default);
      if (defaultProvider) {
        console.log(`📝 Using default AI provider (${defaultProvider.type}) for embeddings`);
        embeddingConfig = {
          type: defaultProvider.type as any,
          apiKey: defaultProvider.apiKey,
          baseUrl: defaultProvider.baseUrl,
        };
      }
    }

    // 4. 最终回退到 local
    if (!embeddingConfig) {
      console.log('⚠️  No embedding provider configured, using local fallback');
      embeddingConfig = { type: 'local' };
    }

    // 创建 embedding provider
    const embeddingProvider = createEmbeddingProvider(embeddingConfig);
    if (!embeddingProvider) {
      throw new Error('Failed to create embedding provider with config: ' + JSON.stringify(embeddingConfig));
    }

    console.log(`✅ Embedding provider: ${embeddingProvider.id}`);
    console.log(`   Model: ${embeddingProvider.model}`);
    console.log(`   Dimensions: ${embeddingProvider.dims}\n`);

    const allTools = getAllToolsForAI();
    console.log(`📊 Found ${allTools.length} tools\n`);

    // 批量生成 embeddings
    const batchSize = 50;
    const embeddings: Record<string, any> = {};

    for (let i = 0; i < allTools.length; i += batchSize) {
      const batch = allTools.slice(i, i + batchSize);
      const texts = batch.map(tool => buildSemanticText(tool));

      console.log(`⏳ Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allTools.length / batchSize)}...`);

      const embeddingsBatch = await embeddingProvider.embedBatch(texts);

      for (let j = 0; j < batch.length; j++) {
        const tool = batch[j];
        const embedding = embeddingsBatch[j];

        embeddings[tool.function.name] = {
          toolName: tool.function.name,
          embedding,
          description: tool.function.description,
          examples: getToolExamples(tool.function.name),
        };
      }

      // 避免触发 rate limit（仅对需要 API 调用的 provider）
      if (i + batchSize < allTools.length && embeddingProvider.id !== 'local') {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // 保存到文件
    const dataDir = join(process.cwd(), 'data');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    const outputPath = join(dataDir, 'tool-embeddings.json');
    writeFileSync(outputPath, JSON.stringify(embeddings, null, 2));

    console.log(`\n✅ Successfully built ${Object.keys(embeddings).length} tool embeddings`);
    console.log(`📁 Saved to: ${outputPath}`);
    console.log(`📏 File size: ${(JSON.stringify(embeddings).length / 1024).toFixed(2)} KB\n`);
  } catch (error) {
    console.error('❌ Failed to build tool embeddings:', error);
    process.exit(1);
  }
}

function buildSemanticText(tool: any): string {
  const func = tool.function;

  const parts = [
    `Tool: ${func.name}`,
    `Description: ${func.description}`,
  ];

  if (func.parameters.properties) {
    const params = Object.keys(func.parameters.properties).join(', ');
    parts.push(`Parameters: ${params}`);
  }

  const examples = getToolExamples(func.name);
  if (examples.length > 0) {
    parts.push(`Examples: ${examples.join(' | ')}`);
  }

  return parts.join('\n');
}

function getToolExamples(toolName: string): string[] {
  const examples: Record<string, string[]> = {
    // Memory
    'memory_ls': ['list memory', '查看记忆', 'show all memories'],
    'memory_read': ['read memory', '读取记忆', '查看某条记忆'],
    'memory_record': ['remember this', '记住这个', '保存记忆', 'record to memory'],

    // Skill
    'skill_list': ['list skills', '列出技能', 'show all skills'],
    'skill_get': ['use skill', '使用技能', 'execute skill', '运行技能'],
    'skill_ensure': ['create skill', '创建技能', 'new skill'],

    // Goal
    'goal_list': ['list goals', '列出目标', 'my goals'],
    'goal_create': ['create goal', '创建目标', 'set goal', '我的目标是'],
    'goal_update': ['update goal', '更新目标', 'change goal progress'],

    // Schedule
    'proactive_schedule': ['schedule task', '定时任务', 'remind me', '提醒我'],
    'schedule_once': ['schedule once', '一次性提醒', 'remind once'],

    // Feishu Calendar
    'feishu_calendar_list': ['show calendars', '查看日历', 'list calendars'],
    'feishu_calendar_event_create': ['create meeting', '创建会议', 'schedule event', '安排日程'],
    'feishu_calendar_today': ['today schedule', '今天的日程', 'what\'s today'],

    // Feishu Document
    'feishu_docx_get': ['get document', '获取文档', 'read doc'],
    'feishu_docx_create_text': ['create document', '创建文档', 'new doc', '新建文档'],
    'feishu_docx_append': ['append to doc', '追加文档', 'add to document'],

    // Feishu Drive
    'feishu_drive_list': ['list files', '列出文件', 'show drive'],
    'feishu_drive_upload': ['upload file', '上传文件'],

    // Feishu Bitable
    'feishu_bitable_list_records': ['list records', '列出记录', 'show table records'],

    // Feishu Wiki
    'feishu_wiki_list_spaces': ['list wiki', '列出知识库', 'show wiki spaces'],

    // Sandbox
    'sandbox_exec': ['run code', '执行代码', 'execute', '运行代码'],

    // Persona
    'persona_get': ['get persona', '查看人格', 'show personality'],
    'persona_update_traits': ['update traits', '更新性格', 'change personality'],

    // Web Search
    'web_search': ['search web', '搜索', 'google', '查找信息'],

    // Timezone
    'timezone': ['what time', '几点了', 'current time', '时区'],

    // Weather
    'weather': ['weather', '天气', 'temperature', '气温'],
  };

  return examples[toolName] || [];
}

main();
