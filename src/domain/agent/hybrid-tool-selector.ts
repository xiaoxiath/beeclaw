/**
 * [V2 FIX] Updated HybridToolSelector
 *
 * Changes from original:
 * 1. Added skill enforcement integration — pre-match skills against user query
 * 2. Added health check tool to always-include core tools
 * 3. Added skill recommendation injection into tool selection
 * 4. Improved logging for skill matching decisions
 *
 * Replace: src/domain/agent/hybrid-tool-selector.ts
 */

import { logger } from '../../infra/observability/logger';
import type { OpenAITool, ChatMessage } from './types';
import { getSkillStore } from '../skills/store';

interface ToolSelectorConfig {
  maxTools: number;
  minRelevanceScore: number;
}

const DEFAULT_CONFIG: ToolSelectorConfig = {
  maxTools: 30,
  minRelevanceScore: 0.1,
};

/**
 * Core tools that must ALWAYS be included in every LLM call.
 * These are essential for the agent's self-awareness and skill usage.
 *
 * [V2 FIX] Added 'datasource_health_check' to core tools
 */
const CORE_TOOLS = new Set([
  'memory_ls',
  'memory_read',
  'memory_record',
  'skill_list',
  'skill_get',
  'skill_search',
  'skill_record',
  'web_search',
  'think',
  'task_complete',
  'datasource_health_check', // [V2 FIX] Always available for health checking
]);

/**
 * Keywords that trigger specific tool categories.
 * Used for fast rule-based selection before falling back to semantic matching.
 */
const KEYWORD_TOOL_MAP: Record<string, string[]> = {
  // Financial data keywords
  '股票|stock|行情|quote|财报|financial|K线|candlestick|涨跌|市值|PE|市盈率|基金|fund': [
    'stock_quote', 'stock_history', 'stock_financial', 'stock_info',
    'web_search', 'datasource_health_check',
  ],
  // Real-time data keywords
  '新闻|news|实时|realtime|最新|latest|今日|today|天气|weather|汇率|exchange': [
    'web_search', 'web_fetch', 'weather', 'datasource_health_check',
  ],
  // File operations
  '文件|file|读取|read|写入|write|目录|directory|删除|delete': [
    'file_read', 'file_write', 'file_list', 'file_delete',
  ],
  // Shell/code
  '执行|execute|运行|run|命令|command|代码|code|shell|bash': [
    'shell', 'code_execute', 'sandbox_exec',
  ],
  // Calendar/schedule
  '日历|calendar|日程|schedule|会议|meeting|提醒|remind': [
    'feishu_calendar_list', 'feishu_calendar_event_create', 'feishu_calendar_event_list',
    'feishu_calendar_today', 'schedule_once', 'notification_send',
  ],
  // Document/wiki
  '文档|document|wiki|知识库|knowledge|飞书|feishu|lark': [
    'feishu_docx_get', 'feishu_docx_search', 'feishu_wiki_search',
    'feishu_drive_search', 'feishu_drive_list',
  ],
  // Goal management
  '目标|goal|计划|plan|进度|progress|任务|task': [
    'goal_list', 'goal_get', 'goal_create', 'goal_update', 'goal_checkpoint',
  ],
  // Proactive/notification
  '定时|scheduled|通知|notification|提醒|alert|主动|proactive': [
    'proactive_schedule', 'proactive_list', 'notification_send',
    'schedule_once', 'notification_list',
  ],
  // Research/analysis
  '研究|research|分析|analysis|深度|deep|调研|investigate': [
    'deep_research', 'web_search', 'web_fetch', 'datasource_health_check',
  ],
  // Persona
  '性格|personality|特质|trait|人设|persona': [
    'persona_get', 'persona_update_traits', 'persona_explain_traits',
  ],
  // Sub-agent
  '子任务|subtask|并行|parallel|代理|agent': [
    'spawn_subagent', 'spawn_parallel',
  ],
};

/**
 * [V2 FIX] Skill-to-tool enrichment.
 * When a skill matches the user query, ensure its required tools are included.
 */
function getSkillRecommendedTools(userMessage: string): {
  tools: string[];
  matchedSkills: Array<{ name: string; score: number }>;
} {
  try {
    const skillStore = getSkillStore();
    const skills = skillStore.list();

    if (!skills || skills.length === 0) {
      return { tools: [], matchedSkills: [] };
    }

    const messageLower = userMessage.toLowerCase();
    const matchedSkills: Array<{ name: string; score: number; tools: string[] }> = [];

    for (const skill of skills) {
      let score = 0;

      // Match on triggers
      if (skill.triggers) {
        for (const trigger of skill.triggers) {
          if (messageLower.includes(trigger.toLowerCase())) {
            score += 0.4;
            break;
          }
        }
      }

      // Match on name
      if (messageLower.includes(skill.name.toLowerCase())) {
        score += 0.3;
      }

      // Match on description keywords
      const descWords = (skill.description || '').toLowerCase().split(/\s+/);
      const msgWords = messageLower.split(/\s+/);
      const overlapCount = descWords.filter(w => w.length > 3 && msgWords.some(mw => mw.includes(w))).length;
      if (overlapCount > 0) {
        score += Math.min(overlapCount * 0.05, 0.2);
      }

      if (score >= 0.3) {
        matchedSkills.push({
          name: skill.name,
          score,
          tools: skill.tools || [],
        });
      }
    }

    // Sort by score, take top 3
    matchedSkills.sort((a, b) => b.score - a.score);
    const topSkills = matchedSkills.slice(0, 3);

    const recommendedTools = new Set<string>();
    for (const skill of topSkills) {
      for (const tool of skill.tools) {
        recommendedTools.add(tool);
      }
    }

    if (topSkills.length > 0) {
      logger.info('[HybridToolSelector] Skill-based tool enrichment', {
        matchedSkills: topSkills.map(s => `${s.name}(${s.score.toFixed(2)})`).join(', '),
        additionalTools: Array.from(recommendedTools).join(', '),
      });
    }

    return {
      tools: Array.from(recommendedTools),
      matchedSkills: topSkills.map(s => ({ name: s.name, score: s.score })),
    };
  } catch (error) {
    logger.debug('[HybridToolSelector] Skill matching failed:', error);
    return { tools: [], matchedSkills: [] };
  }
}

export class HybridToolSelector {
  private config: ToolSelectorConfig;
  private cache: Map<string, { tools: OpenAITool[]; timestamp: number }> = new Map();
  private cacheMaxAge = 5000; // 5 seconds

  constructor(config?: Partial<ToolSelectorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Select the most relevant tools for the current user message.
   *
   * Selection strategy (3 tiers, in order):
   * 1. Cache hit (<1ms)
   * 2. Rule-based keyword matching (<5ms)
   * 3. Semantic scoring (fallback)
   *
   * [V2 FIX] Added Tier 1.5: Skill-based tool enrichment
   */
  async selectTools(
    userMessage: string,
    recentMessages: ChatMessage[],
    maxTools?: number,
  ): Promise<OpenAITool[]> {
    const max = maxTools || this.config.maxTools;

    // Tier 0: Check cache
    const cacheKey = this.computeCacheKey(userMessage);
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheMaxAge) {
      return cached.tools;
    }

    // Get all available tools (populated elsewhere)
    const allTools = this.getAllRegisteredTools();
    if (allTools.length <= max) {
      // All tools fit, no selection needed
      return allTools;
    }

    const selectedToolNames = new Set<string>();

    // Tier 1: Always include core tools
    for (const name of CORE_TOOLS) {
      selectedToolNames.add(name);
    }

    // Tier 1.5 [V2 FIX]: Skill-based tool enrichment
    const { tools: skillTools, matchedSkills } = getSkillRecommendedTools(userMessage);
    for (const toolName of skillTools) {
      selectedToolNames.add(toolName);
    }

    // Tier 2: Rule-based keyword matching
    const keywordTools = this.matchByKeywords(userMessage);
    for (const name of keywordTools) {
      selectedToolNames.add(name);
    }

    // Tier 3: Context-based matching (use recent messages for additional signal)
    if (selectedToolNames.size < max) {
      const contextTools = this.matchByContext(recentMessages);
      for (const name of contextTools) {
        if (selectedToolNames.size >= max) break;
        selectedToolNames.add(name);
      }
    }

    // Build final tool list
    const selected = allTools.filter(t => selectedToolNames.has(t.function.name));

    // If still under limit, add remaining tools by relevance
    if (selected.length < max) {
      const remaining = allTools.filter(t => !selectedToolNames.has(t.function.name));
      const slotsLeft = max - selected.length;
      selected.push(...remaining.slice(0, slotsLeft));
    }

    // Cache the result
    this.cache.set(cacheKey, { tools: selected, timestamp: Date.now() });

    logger.info('[HybridToolSelector] Tool selection complete', {
      total: allTools.length,
      selected: selected.length,
      core: CORE_TOOLS.size,
      keyword: keywordTools.length,
      skillEnriched: skillTools.length,
      matchedSkills: matchedSkills.map(s => s.name).join(', ') || 'none',
    });

    return selected;
  }

  /**
   * Match tools by keywords in user message.
   */
  private matchByKeywords(userMessage: string): string[] {
    const matched = new Set<string>();
    const messageLower = userMessage.toLowerCase();

    for (const [keywordPattern, tools] of Object.entries(KEYWORD_TOOL_MAP)) {
      const keywords = keywordPattern.split('|');
      if (keywords.some(kw => messageLower.includes(kw.toLowerCase()))) {
        for (const tool of tools) {
          matched.add(tool);
        }
      }
    }

    return Array.from(matched);
  }

  /**
   * Match tools based on recent conversation context.
   */
  private matchByContext(recentMessages: ChatMessage[]): string[] {
    const toolsUsed = new Set<string>();

    for (const msg of recentMessages) {
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          toolsUsed.add(tc.function.name);
        }
      }
    }

    return Array.from(toolsUsed);
  }

  /**
   * Compute cache key from user message (simplified).
   */
  private computeCacheKey(userMessage: string): string {
    // Simple hash: first 100 chars
    return userMessage.substring(0, 100).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // ─── Tool Registry ─────────────────────────────────────────────────────

  private registeredTools: OpenAITool[] = [];

  registerTools(tools: OpenAITool[]): void {
    this.registeredTools = tools;
  }

  getAllRegisteredTools(): OpenAITool[] {
    return this.registeredTools;
  }
}

// Singleton instance
let _selector: HybridToolSelector | null = null;

export function getHybridToolSelector(): HybridToolSelector {
  if (!_selector) {
    _selector = new HybridToolSelector();
  }
  return _selector;
}

export function resetHybridToolSelector(): void {
  _selector = null;
}
