/**
 * [P1 FIX #1] Dynamic Prompt Budget Manager
 *
 * New module: manages System Prompt token budget, enabling dynamic example
 * selection and layer-wise trimming to prevent prompt bloat.
 *
 * Drop this file into src/agent/prompt-budget.ts
 */

import { logger } from '../../infra/observability/logger';
import { estimateTokens } from './context';
import type { ChatMessage } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptBudgetConfig {
  /** Maximum tokens allocated to the system prompt (default: 25% of context window) */
  maxSystemPromptTokens: number;
  /** Minimum tokens to always keep for the immutable core layer (base.md) */
  minCoreTokens: number;
  /** Whether to enable dynamic example selection (default: true) */
  dynamicExamples: boolean;
  /** Maximum number of examples to inject (default: 3) */
  maxExamples: number;
}

export const DEFAULT_PROMPT_BUDGET: PromptBudgetConfig = {
  maxSystemPromptTokens: 4000,
  minCoreTokens: 1500,
  dynamicExamples: true,
  maxExamples: 3,
};


/**
 * [P2 FIX 4.1] Named layer priority constants.
 * Higher value = higher priority (kept first during trimming).
 * Extracted from hardcoded magic numbers for configurability.
 */
export const LAYER_PRIORITIES = {
  /** Core system prompt — never trimmed */
  CORE: 100,
  /** Runtime context (date/time/weather) — critical for temporal awareness */
  RUNTIME: 95,
  /** Personality traits from persona system */
  TRAITS: 90,
  /** SOUL.md identity definition */
  SOUL: 85,
  /** User context from memory */
  USER_CONTEXT: 80,
  /** Accumulated facts and lessons */
  FACTS: 70,
  /** Available skill summaries (metadata only) */
  SKILLS: 65,
  /** Worked examples — first to be trimmed */
  EXAMPLES: 10,
} as const;

export type LayerPriorityKey = keyof typeof LAYER_PRIORITIES;

export interface PromptLayer {
  /** Layer name for logging */
  name: string;
  /** Layer content */
  content: string;
  /** Priority: higher = keep first during trimming. Core = 100, examples = 10 */
  priority: number;
  /** Whether this layer can be trimmed */
  trimmable: boolean;
  /** Estimated tokens */
  tokens?: number;
}

// ---------------------------------------------------------------------------
// Example Classifier — selects relevant examples based on user intent
// ---------------------------------------------------------------------------

/** Tag each example with intent categories for matching */
export interface TaggedExample {
  id: string;
  content: string;
  /** Intent categories this example demonstrates */
  intents: string[];
  /** Estimated tokens */
  tokens: number;
}

/**
 * Detect user intent from recent messages using keyword heuristics.
 * Returns a set of intent tags for example matching.
 */
export function detectUserIntent(recentMessages: ChatMessage[]): Set<string> {
  const intents = new Set<string>();

  // Only look at the last 3 user messages
  const userMessages = recentMessages
    .filter(m => m.role === 'user')
    .slice(-3)
    .map(m => typeof m.content === 'string' ? m.content : '')
    .join(' ')
    .toLowerCase();

  // Intent detection patterns
  const intentPatterns: [RegExp, string][] = [
    // Preference / memory
    [/记住|偏好|习惯|喜欢|不喜欢|prefer|remember/i, 'preference'],
    // Reminder / scheduling
    [/提醒|闹钟|日程|定时|remind|schedule|alarm/i, 'reminder'],
    // Skill creation
    [/技能|skill|创建|create|新建|自动化|automat/i, 'skill-creation'],
    // Error / recovery
    [/报错|错误|失败|error|fail|bug|修复|fix/i, 'error-recovery'],
    // Correction
    [/不对|错了|纠正|correct|wrong|修改/i, 'correction'],
    // Search / query
    [/搜索|查找|查询|search|find|look\s?up/i, 'search'],
    // Code / technical
    [/代码|编程|函数|api|code|program|function|debug/i, 'technical'],
    // General chat
    [/你好|hi|hello|聊聊|闲聊/i, 'casual'],
  ];

  for (const [pattern, intent] of intentPatterns) {
    if (pattern.test(userMessages)) {
      intents.add(intent);
    }
  }

  // Default: if no specific intent detected, add 'general'
  if (intents.size === 0) {
    intents.add('general');
  }

  return intents;
}

/**
 * Parse the examples-verbose.md content into tagged examples.
 * Expected format: each example starts with `## Example N:` heading.
 */
export function parseExamplesIntoTagged(examplesContent: string): TaggedExample[] {
  if (!examplesContent || examplesContent.trim().length === 0) return [];

  const examples: TaggedExample[] = [];
  // Split by ## Example headings
  const sections = examplesContent.split(/^## /m).filter(s => s.trim().length > 0);

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const firstLine = section.split('\n')[0].toLowerCase();

    // Detect intents from example title/content
    const intents: string[] = [];

    if (/prefer|偏好|习惯|记住/.test(firstLine)) intents.push('preference');
    if (/remind|提醒|定时|schedule/.test(firstLine)) intents.push('reminder');
    if (/skill|技能|创建/.test(firstLine)) intents.push('skill-creation');
    if (/error|错误|recover|恢复/.test(firstLine)) intents.push('error-recovery');
    if (/correct|纠正|修正/.test(firstLine)) intents.push('correction');
    if (/search|搜索|查找/.test(firstLine)) intents.push('search');
    if (/code|代码|技术/.test(firstLine)) intents.push('technical');

    // Fallback: every example matches 'general'
    intents.push('general');

    examples.push({
      id: `example-${i + 1}`,
      content: `## ${section}`,
      intents: [...new Set(intents)],
      tokens: estimateTokens(`## ${section}`),
    });
  }

  return examples;
}

/**
 * Select the most relevant examples given a token budget and user intents.
 *
 * Strategy:
 * 1. Score each example by intent overlap (matching intents count)
 * 2. Sort by score descending
 * 3. Greedily pick examples until budget or maxExamples is reached
 */
export function selectExamples(
  taggedExamples: TaggedExample[],
  userIntents: Set<string>,
  tokenBudget: number,
  maxExamples: number = 3,
): TaggedExample[] {
  // Score examples
  const scored = taggedExamples.map(ex => {
    const matchCount = ex.intents.filter(i => userIntents.has(i)).length;
    // Subtract 'general' matches to prioritize specific intents
    const specificMatches = ex.intents.filter(i => i !== 'general' && userIntents.has(i)).length;
    return {
      example: ex,
      score: specificMatches * 2 + matchCount,
    };
  });

  // Sort by score descending, then by token count ascending (prefer smaller)
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.example.tokens - b.example.tokens;
  });

  const selected: TaggedExample[] = [];
  let usedTokens = 0;

  for (const { example } of scored) {
    if (selected.length >= maxExamples) break;
    if (usedTokens + example.tokens > tokenBudget) continue;
    selected.push(example);
    usedTokens += example.tokens;
  }

  return selected;
}

// ---------------------------------------------------------------------------
// Prompt Budget Manager — trims layers to fit within token budget
// ---------------------------------------------------------------------------

/**
 * Assemble system prompt layers within a token budget.
 *
 * Process:
 * 1. Calculate each layer's token cost
 * 2. If total exceeds budget, trim lowest-priority trimmable layers first
 * 3. If still over budget, truncate the largest trimmable layer
 *
 * Returns the assembled prompt string and metadata.
 */
export function assembleBudgetedPrompt(
  layers: PromptLayer[],
  budgetConfig: PromptBudgetConfig,
): {
  prompt: string;
  totalTokens: number;
  droppedLayers: string[];
  truncatedLayers: string[];
} {
  const maxTokens = budgetConfig.maxSystemPromptTokens;
  const droppedLayers: string[] = [];
  const truncatedLayers: string[] = [];

  // Calculate tokens for each layer
  const layersWithTokens = layers.map(layer => ({
    ...layer,
    tokens: layer.tokens || estimateTokens(layer.content),
  }));

  let totalTokens = layersWithTokens.reduce((sum, l) => sum + l.tokens, 0);

  // If within budget, return as-is
  if (totalTokens <= maxTokens) {
    return {
      prompt: layersWithTokens.map(l => l.content).join('\n'),
      totalTokens,
      droppedLayers,
      truncatedLayers,
    };
  }

  // Phase 1: Drop lowest-priority trimmable layers until within budget
  const sortedByPriority = [...layersWithTokens].sort((a, b) => a.priority - b.priority);
  const toDrop = new Set<string>();

  for (const layer of sortedByPriority) {
    if (totalTokens <= maxTokens) break;
    if (!layer.trimmable) continue;

    toDrop.add(layer.name);
    totalTokens -= layer.tokens;
    droppedLayers.push(layer.name);
    logger.debug(`[PromptBudget] Dropped layer "${layer.name}" (${layer.tokens} tokens) — over budget`);
  }

  const remainingLayers = layersWithTokens.filter(l => !toDrop.has(l.name));

  // Phase 2: If still over budget, truncate the largest trimmable remaining layer
  if (totalTokens > maxTokens) {
    const largestTrimmable = remainingLayers
      .filter(l => l.trimmable)
      .sort((a, b) => b.tokens - a.tokens)[0];

    if (largestTrimmable) {
      const excessTokens = totalTokens - maxTokens;
      const excessChars = excessTokens * 3; // rough char estimate
      const truncateAt = Math.max(100, largestTrimmable.content.length - excessChars);
      largestTrimmable.content = largestTrimmable.content.slice(0, truncateAt) + '\n\n... [内容因预算限制已截断]';
      const newTokens = estimateTokens(largestTrimmable.content);
      totalTokens = totalTokens - largestTrimmable.tokens + newTokens;
      largestTrimmable.tokens = newTokens;
      truncatedLayers.push(largestTrimmable.name);
      logger.debug(`[PromptBudget] Truncated layer "${largestTrimmable.name}" to fit budget`);
    }
  }

  return {
    prompt: remainingLayers.map(l => l.content).join('\n'),
    totalTokens,
    droppedLayers,
    truncatedLayers,
  };
}

/**
 * Calculate optimal prompt budget based on model context window.
 * Rule: system prompt should not exceed 25% of total context window.
 */
export function calculatePromptBudget(
  modelContextWindow: number,
  customConfig?: Partial<PromptBudgetConfig>,
): PromptBudgetConfig {
  const maxSystemTokens = Math.min(
    Math.floor(modelContextWindow * 0.25),
    6000  // Hard cap: even for 200K models, 6000 tokens for system prompt is plenty
  );

  return {
    ...DEFAULT_PROMPT_BUDGET,
    maxSystemPromptTokens: maxSystemTokens,
    ...customConfig,
  };
}
