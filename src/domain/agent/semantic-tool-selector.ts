/**
 * Semantic Tool Selector - 语义化工具选择器
 *
 * 使用配置的 Embedding Provider 计算工具和用户查询的语义相似度
 *
 * 工作流程：
 * 1. 初始化时为所有工具生成 embedding
 * 2. 查询时生成用户消息的 embedding
 * 3. 计算相似度并选择 Top-N 工具
 *
 * 优化：
 * - 支持预加载工具 embeddings（避免重复计算）
 * - 缓存查询 embedding（相同查询复用）
 * - 批量处理（提高效率）
 */

import { getAllToolsForAI } from './tools';
import { logger } from '../../infra/observability/logger';
import { getEmbeddingProvider } from '../memory/vector-store';
import type { OpenAITool, ChatMessage } from './types';

interface ToolEmbedding {
  toolName: string;
  embedding: number[];
  description: string;
  examples: string[];
}

export class SemanticToolSelector {
  private toolEmbeddings: Map<string, ToolEmbedding> = new Map();
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  /**
   * 初始化：为所有工具生成 embedding
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // 避免重复初始化
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInitialize();
    await this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    const provider = getEmbeddingProvider();

    if (!provider) {
      throw new Error(
        'Embedding provider not initialized. ' +
        'Please configure embedding provider in beeclaw.json under "toolSelector.embedding" or "memory.search.vector". ' +
        'Example: {"toolSelector": {"embedding": {"provider": "zhipu", "apiKey": "..."}}}'
      );
    }

    const startTime = Date.now();
    const allTools = getAllToolsForAI();

    logger.info(`[SemanticSelector] Initializing embeddings for ${allTools.length} tools...`);

    // 尝试从缓存加载
    const cachedEmbeddings = await this.loadEmbeddingsFromCache();

    // 检查缓存文件的维度是否匹配当前 provider
    if (cachedEmbeddings && cachedEmbeddings.size > 0) {
      const firstEmbedding = cachedEmbeddings.values().next().value;
      if (firstEmbedding && firstEmbedding.embedding.length !== provider.dimensions) {
        logger.warn(
          `[SemanticSelector] Cache dimension mismatch (cached: ${firstEmbedding.embedding.length}, provider: ${provider.dimensions}). Rebuilding...`
        );
        // 清除不兼容的缓存
        await this.reset();
        // 重新开始初始化
        return this.doInitialize();
      }

      this.toolEmbeddings = cachedEmbeddings;
      this.isInitialized = true;
      logger.info(`[SemanticSelector] Loaded ${this.toolEmbeddings.size} embeddings from cache`, {
        elapsed: Date.now() - startTime,
      });
      return;
    }

    // 批量生成 embeddings
    const batchSize = 50; // API 限制
    const batches: OpenAITool[][] = [];

    for (let i = 0; i < allTools.length; i += batchSize) {
      batches.push(allTools.slice(i, i + batchSize));
    }

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const texts = batch.map(tool => this.buildSemanticText(tool));

      try {
        const embeddings = await provider.embedBatch!(texts);

        for (let j = 0; j < batch.length; j++) {
          const tool = batch[j];
          const embedding = embeddings[j];

          this.toolEmbeddings.set(tool.function.name, {
            toolName: tool.function.name,
            embedding,
            description: tool.function.description,
            examples: this.getToolExamples(tool.function.name),
          });
        }

        logger.debug(`[SemanticSelector] Processed batch ${i + 1}/${batches.length}`);
      } catch (error) {
        logger.error(`[SemanticSelector] Failed to process batch ${i + 1}`, error);
        throw error;
      }
    }

    this.isInitialized = true;

    // 保存到缓存
    await this.saveEmbeddingsToCache();

    logger.info(`[SemanticSelector] Initialized ${this.toolEmbeddings.size} tool embeddings`, {
      elapsed: Date.now() - startTime,
    });
  }

  /**
   * 构建工具的语义文本表示
   */
  private buildSemanticText(tool: OpenAITool): string {
    const func = tool.function;

    const parts = [
      `Tool: ${func.name}`,
      `Description: ${func.description}`,
    ];

    // 添加参数信息
    if (func.parameters.properties) {
      const params = Object.keys(func.parameters.properties).join(', ');
      parts.push(`Parameters: ${params}`);
    }

    // 添加使用示例
    const examples = this.getToolExamples(func.name);
    if (examples.length > 0) {
      parts.push(`Examples: ${examples.join(' | ')}`);
    }

    return parts.join('\n');
  }

  /**
   * 工具使用示例
   * 可以从配置文件或数据库加载，这里硬编码常见工具
   */
  private getToolExamples(toolName: string): string[] {
    const examples: Record<string, string[]> = {
      // Memory
      'memory_ls': ['list memory', '查看记忆', 'show all memories'],
      'memory_read': ['read memory', '读取记忆', '查看某条记忆'],
      'memory_record': ['remember this', '记住这个', '保存记忆', 'record to memory'],

      // Skill
      'skill_list': ['list skills', '列出技能', 'show all skills'],
      'skill_get': ['use skill', '使用技能', 'execute skill', '运行技能'],
      'skill_create': ['create skill', '创建技能', 'new skill'],

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

  /**
   * 选择最相关的工具
   */
  async selectTools(
    userMessage: string,
    recentMessages: ChatMessage[],
    maxTools: number
  ): Promise<OpenAITool[]> {
    await this.initialize();

    const startTime = Date.now();

    // 1. 构建查询上下文
    const queryContext = this.buildQueryContext(userMessage, recentMessages);

    // 2. 生成查询 embedding
    const queryEmbedding = await this.generateEmbedding(queryContext);

    // 3. 计算与所有工具的相似度
    const similarities: Array<{ toolName: string; score: number }> = [];

    for (const [toolName, toolEmb] of this.toolEmbeddings) {
      const similarity = this.cosineSimilarity(queryEmbedding, toolEmb.embedding);
      similarities.push({ toolName, score: similarity });
    }

    // 4. 排序并选择 Top-N
    similarities.sort((a, b) => b.score - a.score);

    const topTools = similarities.slice(0, maxTools);

    logger.info('[SemanticSelector] Top tools selected', {
      top3: topTools.slice(0, 3).map(t => ({ name: t.toolName, score: t.score.toFixed(3) })),
      total: topTools.length,
      elapsed: Date.now() - startTime,
    });

    // 5. 返回完整的工具定义
    const allTools = getAllToolsForAI();
    const selectedToolNames = new Set(topTools.map(t => t.toolName));
    return allTools.filter(t => selectedToolNames.has(t.function.name));
  }

  /**
   * 构建查询上下文
   */
  private buildQueryContext(
    userMessage: string,
    recentMessages: ChatMessage[]
  ): string {
    const parts: string[] = [];

    // 当前用户消息
    parts.push(`User request: ${userMessage}`);

    // 最近的消息（提供上下文）
    if (recentMessages.length > 0) {
      const recent = recentMessages.slice(-3);
      const context = recent
        .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
        .join('\n');
      parts.push(`Recent context:\n${context}`);
    }

    return parts.join('\n\n');
  }

 /**
   * Generate text embedding using configured provider
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    const provider = getEmbeddingProvider();

    if (!provider) {
      throw new Error(
        'Embedding provider not initialized. ' +
        'Please configure embedding provider in beeclaw.json under "toolSelector.embedding" or "memory.search.vector". ' +
        'Example: {"toolSelector": {"embedding": {"provider": "zhipu", "apiKey": "..."}}}'
      );
    }

    try {
      return await provider.embed(text);
    } catch (error) {
      logger.error('[SemanticSelector] Embedding generation failed', error);
      throw error;
    }
  }

  /**
   * 余弦相似度计算
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * 从缓存加载 embeddings
   */
  private async loadEmbeddingsFromCache(): Promise<Map<string, ToolEmbedding> | null> {
    try {
      const { existsSync, readFileSync } = await import('fs');
      const { join } = await import('path');

      const cachePath = join(process.cwd(), 'data', 'tool-embeddings.json');

      if (!existsSync(cachePath)) {
        return null;
      }

      const data = JSON.parse(readFileSync(cachePath, 'utf-8'));
      const embeddings = new Map<string, ToolEmbedding>();

      for (const [key, value] of Object.entries(data)) {
        embeddings.set(key, value as ToolEmbedding);
      }

      return embeddings;
    } catch (error) {
      logger.warn('[SemanticSelector] Failed to load embeddings from cache', error);
      return null;
    }
  }

  /**
   * 保存 embeddings 到缓存
   */
  private async saveEmbeddingsToCache(): Promise<void> {
    try {
      const { writeFileSync, mkdirSync, existsSync } = await import('fs');
      const { join } = await import('path');

      const dataDir = join(process.cwd(), 'data');

      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
      }

      const cachePath = join(dataDir, 'tool-embeddings.json');
      const data = Object.fromEntries(this.toolEmbeddings);

      writeFileSync(cachePath, JSON.stringify(data, null, 2));

      logger.info(`[SemanticSelector] Saved embeddings to cache: ${cachePath}`);
    } catch (error) {
      logger.warn('[SemanticSelector] Failed to save embeddings to cache', error);
    }
  }

  /**
   * 清除缓存和初始化状态
   */
  async reset(): Promise<void> {
    this.toolEmbeddings.clear();
    this.isInitialized = false;
    this.initPromise = null;

    // 删除缓存文件
    try {
      const { unlinkSync, existsSync } = await import('fs');
      const { join } = await import('path');
      const cachePath = join(process.cwd(), 'data', 'tool-embeddings.json');

      if (existsSync(cachePath)) {
        unlinkSync(cachePath);
      }
    } catch (error) {
      logger.warn('[SemanticSelector] Failed to delete cache file', error);
    }
  }
}

// 单例实例
let semanticSelectorInstance: SemanticToolSelector | null = null;

/**
 * 获取全局 SemanticToolSelector 实例
 */
export function getSemanticToolSelector(): SemanticToolSelector {
  if (!semanticSelectorInstance) {
    semanticSelectorInstance = new SemanticToolSelector();
  }
  return semanticSelectorInstance;
}
