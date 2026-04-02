/**
 * HybridToolSelector — Rule-based + Semantic Tool Selection
 *
 * Reduces the number of tools sent to the LLM by pre-filtering based on:
 * 1. Rule-based matching (keyword patterns in user message)
 * 2. Semantic matching (embedding similarity, when available)
 * 3. Core tools always included
 * 4. [G-P2-05] Context-aware weighting: tools used in the previous turn
 *    receive a relevance boost so multi-step workflows are not interrupted.
 *
 * Configurable via `toolSelector` in beeclaw.json.
 * When strategy is 'all', this selector is bypassed entirely.
 */

import { logger } from '../../infra/observability/logger';
import { getEmbeddingProvider } from '../memory/vector-store';
import type { OpenAITool } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HybridToolSelectorConfig {
  /** Selection strategy: 'all' | 'layered' | 'hybrid' | 'semantic' */
  strategy: 'all' | 'layered' | 'hybrid' | 'semantic';
  /** Maximum tools to include */
  maxTools: number;
  /** Whether rule-based matching is enabled */
  rulesEnabled: boolean;
  /** Whether semantic matching is enabled */
  semanticEnabled: boolean;
  /** Whether to always include core tools when semantic filtering reduces the set */
  fallbackToCore: boolean;
}

const DEFAULT_CONFIG: HybridToolSelectorConfig = {
  strategy: 'hybrid',
  maxTools: 30,
  rulesEnabled: true,
  semanticEnabled: true,
  fallbackToCore: true,
};

// ---------------------------------------------------------------------------
// Core tools (always included regardless of filtering)
// ---------------------------------------------------------------------------

const CORE_TOOL_NAMES = new Set([
  // Memory (essential for context)
  'memory_read', 'memory_write', 'memory_grep', 'memory_ls',
  // Skills (essential for task execution)
  'skill_list', 'skill_get', 'skill_search',
]);

// ---------------------------------------------------------------------------
// Rule-based keyword -> tool category mapping
// ---------------------------------------------------------------------------

interface RuleMapping {
  patterns: RegExp[];
  toolNames: string[];
}

const RULE_MAPPINGS: RuleMapping[] = [
  {
    patterns: [
      /记忆|历史|之前|上次|记得|回忆|记录/,
      /memory|remember|history|previous|recall/i,
    ],
    toolNames: ['memory_read', 'memory_write', 'memory_grep', 'memory_ls', 'memory_record'],
  },
  {
    patterns: [
      /搜索|查找|查询|查一下|百度|谷歌|搜一下/,
      /search|find|query|look up|google/i,
    ],
    toolNames: ['web_search', 'web_fetch'],
  },
  {
    patterns: [
      /技能|skill|工具|tool/i,
    ],
    toolNames: ['skill_list', 'skill_get', 'skill_search', 'skill_ensure', 'skill_delete', 'skill_record'],
  },
  // [CLEANED v0.5.0] Feishu calendar/doc/drive/wiki rules removed.
  // These tools are now provided by the feishu-cli-toolkit skill and are
  // loaded dynamically via skill_ensure. The hybrid selector will match
  // them via semantic similarity once the skill is loaded.
  {
    patterns: [
      /日历|日程|会议|提醒|calendar|schedule|meeting|remind/i,
      /文档|文件|doc|file|drive|wiki/i,
    ],
    toolNames: ['skill_list', 'skill_get', 'skill_ensure'],
  },
  {
    patterns: [
      /目标|计划|goal|plan|任务/i,
    ],
    toolNames: ['goal_list', 'goal_get', 'goal_create', 'goal_update', 'goal_checkpoint'],
  },
  {
    patterns: [
      /沙盒|执行|运行|代码|sandbox|exec|run|code/i,
    ],
    toolNames: ['sandbox_exec', 'sandbox_write_file', 'sandbox_read_file', 'sandbox_list_files'],
  },
  {
    patterns: [
      /时间|天气|日期|几点|weather|time|date|clock/i,
    ],
    toolNames: ['time_now', 'weather', 'get_holiday_info'],
  },
  // [CLEANED v0.5.0] Finance tool rules removed.
  // stock_quote, stock_history, stock_financial, stock_info have been
  // migrated to the beeclaw-hedge-fund-research skill.
  // Finance-related queries will be routed through skill_ensure instead.
  {
    patterns: [
      /股票|基金|行情|K线|财报|市值|stock|finance|fund|quote/i,
    ],
    toolNames: ['skill_list', 'skill_get', 'skill_ensure'],
  },
  {
    patterns: [
      /深度分析|deep.?analysis|详细分析|多步/i,
    ],
    toolNames: ['request_deep_analysis'],
  },
  {
    patterns: [
      /定时|提醒|通知|schedule|notify|proactive|主动/i,
    ],
    toolNames: ['proactive_schedule', 'proactive_list', 'proactive_cancel', 'schedule_once', 'notification_send'],
  },
];

// ---------------------------------------------------------------------------
// Embedding cache for tool descriptions (lazy init)
// ---------------------------------------------------------------------------

let toolEmbeddingCache: Map<string, number[]> | null = null;

async function getToolEmbedding(toolName: string, description: string): Promise<number[] | null> {
  const provider = getEmbeddingProvider();
  if (!provider) return null;

  if (!toolEmbeddingCache) {
    toolEmbeddingCache = new Map();
  }

  if (toolEmbeddingCache.has(toolName)) {
    return toolEmbeddingCache.get(toolName)!;
  }

  try {
    const embedding = await provider.embed(`${toolName}: ${description}`);
    toolEmbeddingCache.set(toolName, embedding);
    return embedding;
  } catch {
    return null;
  }
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// HybridToolSelector
// ---------------------------------------------------------------------------

export class HybridToolSelector {
  private config: HybridToolSelectorConfig;

  /**
   * [G-P2-05] Tracks tool names used in the previous turn so we can boost
   * their selection weight in the current turn. This helps multi-step
   * workflows (e.g., search -> browse -> summarize) stay coherent.
   */
  private lastTurnTools: Set<string> = new Set();

  constructor(config: Partial<HybridToolSelectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * [G-P2-05] Record which tools were used this turn. Call after the
   * agent's tool loop completes so the next invocation of select() can
   * boost these tools.
   */
  recordToolUsage(toolNames: string[]): void {
    this.lastTurnTools = new Set(toolNames);
  }

  /**
   * Select relevant tools for a user message.
   *
   * @param allTools - Full set of available tools
   * @param userMessage - Current user message text
   * @returns Filtered array of tools
   */
  async select(allTools: OpenAITool[], userMessage: string): Promise<OpenAITool[]> {
    // Strategy: 'all' — bypass filtering
    if (this.config.strategy === 'all') {
      return allTools;
    }

    const startTime = Date.now();

    // 1. Always include core tools
    const selectedNames = new Set<string>();
    for (const name of CORE_TOOL_NAMES) {
      selectedNames.add(name);
    }

    // [G-P2-05] 1b. Include tools from the previous turn (context continuity)
    for (const name of this.lastTurnTools) {
      selectedNames.add(name);
    }

    // 2. Rule-based matching
    if (this.config.rulesEnabled && (this.config.strategy === 'layered' || this.config.strategy === 'hybrid')) {
      const ruleMatches = this.matchByRules(userMessage);
      for (const name of ruleMatches) {
        selectedNames.add(name);
      }
    }

    // 3. Semantic matching (if enabled and strategy includes it)
    if (this.config.semanticEnabled && (this.config.strategy === 'semantic' || this.config.strategy === 'hybrid')) {
      const semanticMatches = await this.matchBySemantic(allTools, userMessage);
      for (const name of semanticMatches) {
        selectedNames.add(name);
      }
    }

    // 4. Filter and cap
    let filtered = allTools.filter(t => selectedNames.has(t.function.name));

    // If filtering removed too many, fallback to include all (safety)
    if (filtered.length < 5 && this.config.fallbackToCore) {
      logger.debug(`[HybridToolSelector] Too few tools selected (${filtered.length}), including all`);
      filtered = allTools;
    }

    // Cap at maxTools
    if (filtered.length > this.config.maxTools) {
      // Prioritize: core > last-turn > rest
      const core = filtered.filter(t => CORE_TOOL_NAMES.has(t.function.name));
      const lastTurn = filtered.filter(
        t => !CORE_TOOL_NAMES.has(t.function.name) && this.lastTurnTools.has(t.function.name),
      );
      const rest = filtered.filter(
        t => !CORE_TOOL_NAMES.has(t.function.name) && !this.lastTurnTools.has(t.function.name),
      );
      const remaining = this.config.maxTools - core.length - lastTurn.length;
      filtered = [...core, ...lastTurn, ...rest.slice(0, Math.max(0, remaining))];
    }

    const elapsed = Date.now() - startTime;
    logger.debug(`[HybridToolSelector] Selected ${filtered.length}/${allTools.length} tools in ${elapsed}ms`, {
      strategy: this.config.strategy,
      ruleMatches: selectedNames.size - CORE_TOOL_NAMES.size,
      lastTurnBoost: this.lastTurnTools.size,
    });

    return filtered;
  }

  /**
   * Rule-based matching: find tool names that match keyword patterns.
   */
  private matchByRules(userMessage: string): string[] {
    const matched: string[] = [];
    for (const rule of RULE_MAPPINGS) {
      if (rule.patterns.some(p => p.test(userMessage))) {
        matched.push(...rule.toolNames);
      }
    }
    return matched;
  }

  /**
   * Semantic matching: use embeddings to find tools with similar descriptions.
   */
  private async matchBySemantic(allTools: OpenAITool[], userMessage: string): Promise<string[]> {
    const provider = getEmbeddingProvider();
    if (!provider) {
      logger.debug('[HybridToolSelector] No embedding provider, skipping semantic matching');
      return [];
    }

    try {
      const queryEmbedding = await provider.embed(userMessage);

      const scored: Array<{ name: string; score: number }> = [];

      for (const tool of allTools) {
        const name = tool.function.name;
        const desc = tool.function.description || name;
        const toolEmb = await getToolEmbedding(name, desc);
        if (!toolEmb) continue;

        let sim = cosineSim(queryEmbedding, toolEmb);

        // [G-P2-05] Boost score for tools used in the previous turn
        if (this.lastTurnTools.has(name)) {
          sim = Math.min(1.0, sim + 0.15);
        }

        scored.push({ name, score: sim });
      }

      // Sort by similarity and take top N
      scored.sort((a, b) => b.score - a.score);
      const topN = Math.min(15, Math.ceil(this.config.maxTools * 0.6));
      return scored.slice(0, topN).filter(s => s.score > 0.2).map(s => s.name);
    } catch (error) {
      logger.warn('[HybridToolSelector] Semantic matching failed:', error);
      return [];
    }
  }

  /** Reset the embedding cache (e.g., when tools change) */
  static resetCache(): void {
    toolEmbeddingCache = null;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: HybridToolSelector | null = null;

export function getHybridToolSelector(config?: Partial<HybridToolSelectorConfig>): HybridToolSelector {
  if (!_instance || config) {
    _instance = new HybridToolSelector(config);
  }
  return _instance;
}

export function resetHybridToolSelector(): void {
  _instance = null;
  HybridToolSelector.resetCache();
}
