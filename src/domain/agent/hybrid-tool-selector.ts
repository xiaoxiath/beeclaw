/**
 * HybridToolSelector — Simplified Tool Selection (v2)
 *
 * REFACTORED: Removed rule-based regex matching and semantic embedding filtering.
 *
 * Rationale (2026 context):
 * - Modern LLMs (Claude 4, GPT-5) natively excel at tool selection from descriptions.
 * - Rule-based regex patterns were brittle, required maintenance per tool, and could
 *   mask the LLM's own reasoning (e.g., filtering out a tool the LLM actually needed).
 * - Semantic embedding similarity added ~50-200ms latency per turn for marginal benefit.
 *
 * Remaining responsibilities:
 * 1. Core tools always included (memory, skills — essential for every turn)
 * 2. Context continuity hint (tools from last turn get a soft priority boost)
 * 3. Token-budget cap (maxTools limit to prevent context overflow)
 *
 * The LLM sees all non-core tools and makes its own selection.
 */

import { logger } from '../../infra/observability/logger';
import type { OpenAITool } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HybridToolSelectorConfig {
  /** Selection strategy: 'all' bypasses filtering entirely */
  strategy: 'all' | 'budget-cap';
  /** Maximum tools to include (token budget control) */
  maxTools: number;
}

const DEFAULT_CONFIG: HybridToolSelectorConfig = {
  strategy: 'budget-cap',
  maxTools: 30,
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
// HybridToolSelector
// ---------------------------------------------------------------------------

export class HybridToolSelector {
  private config: HybridToolSelectorConfig;

  /**
   * Tracks tool names used in the previous turn so we can prioritize
   * them when capping. This helps multi-step workflows stay coherent.
   */
  private lastTurnTools: Set<string> = new Set();

  constructor(config: Partial<HybridToolSelectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record which tools were used this turn. Call after the agent's tool
   * loop completes so the next invocation of select() can prioritize them
   * when the maxTools cap is hit.
   */
  recordToolUsage(toolNames: string[]): void {
    this.lastTurnTools = new Set(toolNames);
  }

  /**
   * Select relevant tools for a user message.
   *
   * Strategy 'all': return everything (no filtering).
   * Strategy 'budget-cap': return all tools up to maxTools, prioritizing
   *   core > last-turn > rest.
   *
   * @param allTools - Full set of available tools
   * @param _userMessage - Current user message (unused — LLM does its own selection)
   * @returns Filtered array of tools
   */
  async select(allTools: OpenAITool[], _userMessage: string): Promise<OpenAITool[]> {
    // Strategy: 'all' — bypass filtering
    if (this.config.strategy === 'all') {
      return allTools;
    }

    // If total tools within budget, return all — no filtering needed
    if (allTools.length <= this.config.maxTools) {
      return allTools;
    }

    // Over budget: prioritize core > last-turn > rest
    const core = allTools.filter(t => CORE_TOOL_NAMES.has(t.function.name));
    const lastTurn = allTools.filter(
      t => !CORE_TOOL_NAMES.has(t.function.name) && this.lastTurnTools.has(t.function.name),
    );
    const rest = allTools.filter(
      t => !CORE_TOOL_NAMES.has(t.function.name) && !this.lastTurnTools.has(t.function.name),
    );

    const remaining = this.config.maxTools - core.length - lastTurn.length;
    const filtered = [...core, ...lastTurn, ...rest.slice(0, Math.max(0, remaining))];

    logger.debug(
      `[HybridToolSelector] Budget-capped ${allTools.length} → ${filtered.length} tools` +
      ` (core: ${core.length}, lastTurn: ${lastTurn.length}, rest: ${Math.max(0, remaining)})`,
    );

    return filtered;
  }

  /** Reset (no-op in simplified version, kept for API compat) */
  static resetCache(): void {
    // No embedding cache to reset
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
}
