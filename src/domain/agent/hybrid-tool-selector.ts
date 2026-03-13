/**
 * Hybrid Tool Selector - 混合工具选择器
 *
 * 结合三种策略：
 * 1. 缓存（Cache）- 相同查询复用结果
 * 2. 规则匹配（Rules）- 高置信度场景快速路径
 * 3. 语义匹配（Semantic）- 低置信度场景准确路径
 *
 * 性能目标：
 * - 缓存命中: < 1ms
 * - 规则匹配: < 5ms
 * - 语义匹配: ~200ms
 * - 准确率: > 90%
 */

import { createHash } from 'crypto';
import { getAllToolsForAI } from './tools';
import { SemanticToolSelector } from './semantic-tool-selector';
import { logger } from '../../infra/observability/logger';
import type { OpenAITool, ChatMessage } from './types';

export interface HybridSelectorConfig {
  maxTools: number;
  enableCache: boolean;
  enableRules: boolean;
  enableSemantic: boolean;
  cacheMaxSize: number;
  cacheTTL: number; // milliseconds
}

const DEFAULT_CONFIG: HybridSelectorConfig = {
  maxTools: 30,
  enableCache: true,
  enableRules: true,
  enableSemantic: true,
  cacheMaxSize: 1000,
  cacheTTL: 60 * 60 * 1000, // 1 hour
};

interface CacheEntry {
  toolNames: string[];
  timestamp: number;
}

export class HybridToolSelector {
  private config: HybridSelectorConfig;
  private semanticSelector: SemanticToolSelector;
  private cache: Map<string, CacheEntry> = new Map();
  private rules: Map<string, string[]>;

  constructor(config?: Partial<HybridSelectorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.semanticSelector = new SemanticToolSelector();
    this.rules = this.buildRules();
  }

  /**
   * 主入口：选择工具
   */
  async selectTools(
    userMessage: string,
    recentMessages: ChatMessage[] = [],
    maxTools?: number
  ): Promise<OpenAITool[]> {
    const targetCount = maxTools || this.config.maxTools;
    const startTime = Date.now();

    // 1. 检查缓存
    if (this.config.enableCache) {
      const cacheKey = this.getCacheKey(userMessage, recentMessages);
      const cached = this.getFromCache(cacheKey);

      if (cached) {
        const tools = this.getToolsByNames(cached.toolNames);
        logger.info('[HybridSelector] Cache hit', {
          toolCount: tools.length,
          elapsed: Date.now() - startTime,
        });
        return tools;
      }
    }

    // 2. 规则匹配（快速路径）
    let selectedToolNames: string[] = [];

    if (this.config.enableRules) {
      const ruleTools = this.matchRules(userMessage, recentMessages);

      // 如果规则匹配到足够多的工具（> 80%），直接使用
      if (ruleTools.length >= targetCount * 0.8) {
        selectedToolNames = this.ensureCoreTools(ruleTools).slice(0, targetCount);

        logger.info('[HybridSelector] Rule-based selection', {
          toolCount: selectedToolNames.length,
          elapsed: Date.now() - startTime,
        });

        // 缓存结果
        if (this.config.enableCache) {
          const cacheKey = this.getCacheKey(userMessage, recentMessages);
          this.setCache(cacheKey, selectedToolNames);
        }

        return this.getToolsByNames(selectedToolNames);
      }

      selectedToolNames = ruleTools;
    }

    // 3. 语义匹配（准确路径）
    if (this.config.enableSemantic) {
      try {
        const semanticTools = await this.semanticSelector.selectTools(
          userMessage,
          recentMessages,
          targetCount
        );

        const semanticToolNames = semanticTools.map(t => t.function.name);

        // 合并规则和语义结果
        selectedToolNames = this.mergeResults(
          selectedToolNames,
          semanticToolNames,
          targetCount
        );

        logger.info('[HybridSelector] Semantic-based selection', {
          toolCount: selectedToolNames.length,
          elapsed: Date.now() - startTime,
        });
      } catch (error) {
        logger.error('[HybridSelector] Semantic selection failed, fallback to core tools', error);
        selectedToolNames = this.getCoreTools();
      }
    } else {
      // 如果禁用语义匹配，使用核心工具 + 规则结果
      selectedToolNames = this.ensureCoreTools(selectedToolNames).slice(0, targetCount);
    }

    // 4. 缓存结果
    if (this.config.enableCache) {
      const cacheKey = this.getCacheKey(userMessage, recentMessages);
      this.setCache(cacheKey, selectedToolNames);
    }

    return this.getToolsByNames(selectedToolNames);
  }

  /**
   * 构建规则库
   * 只覆盖高置信度场景（明确的意图）
   */
  private buildRules(): Map<string, string[]> {
    const rules = new Map<string, string[]>();

    // ===== Memory 相关 =====
    rules.set('memory', [
      'memory_ls',
      'memory_grep',
      'memory_read',
      'memory_write',
      'memory_record',
    ]);

    // ===== Skill 相关 =====
    rules.set('skill', [
      'skill_list',
      'skill_get',
      'skill_create',
      'skill_update',
      'skill_delete',
      'skill_search',
      'skill_record',
    ]);

    // ===== Goal 相关 =====
    rules.set('goal', [
      'goal_list',
      'goal_get',
      'goal_create',
      'goal_update',
      'goal_checkpoint',
      'goal_decompose',
      'goal_delete',
      'goal_summary',
    ]);

    // ===== Proactive/Schedule 相关 =====
    rules.set('schedule', [
      'proactive_schedule',
      'proactive_list',
      'proactive_cancel',
      'schedule_once',
    ]);

    // ===== Notification 相关 =====
    rules.set('notification', [
      'notification_send',
      'notification_list',
      'notification_mark_read',
      'notification_delete',
      'notification_history',
    ]);

    // ===== Feishu Calendar 相关 =====
    rules.set('feishu_calendar', [
      'feishu_calendar_list',
      'feishu_calendar_get',
      'feishu_calendar_event_create',
      'feishu_calendar_event_list',
      'feishu_calendar_event_get',
      'feishu_calendar_event_update',
      'feishu_calendar_event_delete',
      'feishu_calendar_event_search',
      'feishu_calendar_today',
      'feishu_calendar_quick_event',
    ]);

    // ===== Feishu Document 相关 =====
    rules.set('feishu_doc', [
      'feishu_docx_get',
      'feishu_docx_list_children',
      'feishu_docx_search',
      'feishu_docx_create_text',
      'feishu_docx_append',
      'feishu_docx_update',
      'feishu_docx_delete',
      'feishu_docx_create_table',
    ]);

    // ===== Feishu Drive 相关 =====
    rules.set('feishu_drive', [
      'feishu_drive_list',
      'feishu_drive_get',
      'feishu_drive_create_folder',
      'feishu_drive_move',
      'feishu_drive_copy',
      'feishu_drive_rename',
      'feishu_drive_delete',
      'feishu_drive_search',
      'feishu_drive_download',
      'feishu_drive_upload',
      'feishu_drive_share',
    ]);

    // ===== Feishu Bitable 相关 =====
    rules.set('feishu_bitable', [
      'feishu_bitable_get_meta',
      'feishu_bitable_list_tables',
      'feishu_bitable_list_fields',
      'feishu_bitable_create_field',
      'feishu_bitable_list_records',
      'feishu_bitable_get_record',
      'feishu_bitable_create_record',
      'feishu_bitable_update_record',
      'feishu_bitable_delete_record',
      'feishu_bitable_create_app',
    ]);

    // ===== Feishu Wiki 相关 =====
    rules.set('feishu_wiki', [
      'feishu_wiki_list_spaces',
      'feishu_wiki_get_space',
      'feishu_wiki_list_nodes',
      'feishu_wiki_get_node',
      'feishu_wiki_create_page',
      'feishu_wiki_move_node',
      'feishu_wiki_rename_node',
      'feishu_wiki_delete_node',
      'feishu_wiki_copy_node',
      'feishu_wiki_search',
      'feishu_wiki_tree',
    ]);

    // ===== Sandbox 相关 =====
    rules.set('sandbox', [
      'sandbox_exec',
      'sandbox_write_file',
      'sandbox_read_file',
      'sandbox_list_files',
      'sandbox_status',
    ]);

    // ===== Persona 相关 =====
    rules.set('persona', [
      'persona_get',
      'persona_update_traits',
      'persona_export',
      'persona_import',
      'persona_explain_traits',
    ]);

    return rules;
  }

  /**
   * 规则匹配
   * 基于关键词和上下文快速匹配
   */
  private matchRules(
    userMessage: string,
    recentMessages: ChatMessage[]
  ): string[] {
    const text = userMessage.toLowerCase();
    const matchedTools: string[] = [];
    const matchedCategories: Set<string> = new Set();

    // ===== Memory 意图 =====
    if (
      this.matchesKeywords(text, ['memory', '记忆', 'remember', '记住', '回忆']) ||
      this.matchesKeywords(text, ['save', '保存', '记录', 'record'])
    ) {
      matchedCategories.add('memory');
    }

    // ===== Skill 意图 =====
    if (
      this.matchesKeywords(text, ['skill', '技能', '能力', 'workflow', '工作流']) ||
      this.matchesKeywords(text, ['use skill', '使用技能', '执行技能'])
    ) {
      matchedCategories.add('skill');
    }

    // ===== Goal 意图 =====
    if (
      this.matchesKeywords(text, ['goal', '目标', 'objective', '计划']) ||
      this.matchesKeywords(text, ['my goal', '我的目标', '长期目标'])
    ) {
      matchedCategories.add('goal');
    }

    // ===== Schedule 意图 =====
    if (
      this.matchesKeywords(text, ['schedule', '定时', '提醒', 'remind']) ||
      this.matchesKeywords(text, ['cron', '定期', '每天', '每周', '每月'])
    ) {
      matchedCategories.add('schedule');
    }

    // ===== Notification 意图 =====
    if (
      this.matchesKeywords(text, ['notification', '通知', 'message', '消息']) ||
      this.matchesKeywords(text, ['notify', '发送通知'])
    ) {
      matchedCategories.add('notification');
    }

    // ===== Feishu Calendar 意图 =====
    if (
      this.matchesKeywords(text, ['calendar', '日历', 'schedule', '日程']) ||
      this.matchesKeywords(text, ['meeting', '会议', 'event', '事件']) ||
      this.matchesKeywords(text, ['today', '今天'], ['calendar', 'schedule', 'meeting'])
    ) {
      matchedCategories.add('feishu_calendar');
    }

    // ===== Feishu Document 意图 =====
    if (
      this.matchesKeywords(text, ['doc', 'document', '文档']) ||
      this.matchesKeywords(text, ['飞书文档', 'feishu doc']) ||
      this.matchesKeywords(text, ['create doc', '创建文档', 'write doc', '写文档'])
    ) {
      matchedCategories.add('feishu_doc');
    }

    // ===== Feishu Drive 意图 =====
    if (
      this.matchesKeywords(text, ['drive', '云盘', 'folder', '文件夹']) ||
      this.matchesKeywords(text, ['upload', '上传', 'download', '下载']) ||
      this.matchesKeywords(text, ['file', '文件'])
    ) {
      matchedCategories.add('feishu_drive');
    }

    // ===== Feishu Bitable 意图 =====
    if (
      this.matchesKeywords(text, ['bitable', '多维表格', '表格']) ||
      this.matchesKeywords(text, ['table', 'record', '记录'])
    ) {
      matchedCategories.add('feishu_bitable');
    }

    // ===== Feishu Wiki 意图 =====
    if (
      this.matchesKeywords(text, ['wiki', '知识库', 'wiki space']) ||
      this.matchesKeywords(text, ['知识库'])
    ) {
      matchedCategories.add('feishu_wiki');
    }

    // ===== Sandbox 意图 =====
    if (
      this.matchesKeywords(text, ['sandbox', 'code', '代码', 'exec', '执行']) ||
      this.matchesKeywords(text, ['run code', '运行代码', 'execute'])
    ) {
      matchedCategories.add('sandbox');
    }

    // ===== Persona 意图 =====
    if (
      this.matchesKeywords(text, ['persona', '人格', '性格', 'traits']) ||
      this.matchesKeywords(text, ['personality', '个性'])
    ) {
      matchedCategories.add('persona');
    }

    // 收集匹配的工具
    for (const category of matchedCategories) {
      const tools = this.rules.get(category);
      if (tools) {
        matchedTools.push(...tools);
      }
    }

    // 去重
    return [...new Set(matchedTools)];
  }

  /**
   * 关键词匹配辅助函数
   * @param text 搜索文本
   * @param keywords 关键词列表
   * @param contextKeywords 上下文关键词（可选，必须同时匹配）
   */
  private matchesKeywords(
    text: string,
    keywords: string[],
    contextKeywords?: string[]
  ): boolean {
    const hasKeyword = keywords.some(keyword => text.includes(keyword.toLowerCase()));

    if (!hasKeyword) return false;

    // 如果有上下文关键词要求，必须同时满足
    if (contextKeywords && contextKeywords.length > 0) {
      return contextKeywords.some(keyword => text.includes(keyword.toLowerCase()));
    }

    return true;
  }

  /**
   * 生成缓存键
   */
  private getCacheKey(
    userMessage: string,
    recentMessages: ChatMessage[]
  ): string {
    // 包含用户消息和最近2条消息
    const content = userMessage + recentMessages
      .slice(-2)
      .map(m => m.content)
      .join('');

    return createHash('md5').update(content).digest('hex');
  }

  /**
   * 从缓存获取
   */
  private getFromCache(key: string): CacheEntry | null {
    const entry = this.cache.get(key);

    if (!entry) return null;

    // 检查 TTL
    const age = Date.now() - entry.timestamp;
    if (age > this.config.cacheTTL) {
      this.cache.delete(key);
      return null;
    }

    return entry;
  }

  /**
   * 设置缓存
   */
  private setCache(key: string, toolNames: string[]): void {
    // LRU 淘汰
    if (this.cache.size >= this.config.cacheMaxSize) {
      // 删除最旧的条目
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      toolNames,
      timestamp: Date.now(),
    });
  }

  /**
   * 合并规则和语义结果
   */
  private mergeResults(
    ruleTools: string[],
    semanticTools: string[],
    maxTools: number
  ): string[] {
    // 规则结果优先
    const merged = [...ruleTools];
    const seen = new Set(ruleTools);

    // 补充语义结果
    for (const toolName of semanticTools) {
      if (!seen.has(toolName)) {
        merged.push(toolName);
        seen.add(toolName);
      }
    }

    // 确保核心工具
    const withCore = this.ensureCoreTools(merged);

    return withCore.slice(0, maxTools);
  }

  /**
   * 核心工具列表
   */
  private getCoreTools(): string[] {
    return [
      'memory_ls',
      'memory_read',
      'memory_record',
      'skill_list',
      'skill_get',
      'web_search',
    ];
  }

  /**
   * 确保核心工具存在
   */
  private ensureCoreTools(toolNames: string[]): string[] {
    const coreTools = this.getCoreTools();
    const toolSet = new Set(toolNames);
    const result = [...toolNames];

    for (const core of coreTools) {
      if (!toolSet.has(core)) {
        result.unshift(core);
      }
    }

    return result;
  }

  /**
   * 根据名称获取工具定义
   */
  private getToolsByNames(toolNames: string[]): OpenAITool[] {
    const allTools = getAllToolsForAI();
    const toolSet = new Set(toolNames);
    return allTools.filter(t => toolSet.has(t.function.name));
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('[HybridSelector] Cache cleared');
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    cacheSize: number;
    rulesCount: number;
  } {
    return {
      cacheSize: this.cache.size,
      rulesCount: this.rules.size,
    };
  }
}

// 单例实例
let hybridSelectorInstance: HybridToolSelector | null = null;

/**
 * 获取全局 HybridToolSelector 实例
 */
export function getHybridToolSelector(
  config?: Partial<HybridSelectorConfig>
): HybridToolSelector {
  if (!hybridSelectorInstance) {
    hybridSelectorInstance = new HybridToolSelector(config);
  }
  return hybridSelectorInstance;
}
