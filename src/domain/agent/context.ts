/**
 * Token Estimation Utilities
 *
 * Simple but reasonably accurate token estimation without external dependencies.
 * Based on empirical observations:
 * - Chinese: ~1.5 characters per token
 * - English: ~4 characters per token
 * - Code: ~3 characters per token
 * - Whitespace/punctuation: varies
 */

import { logger } from '../../infra/observability/logger';
import type { MultimodalContent } from './types';

// Token estimation ratios
const RATIOS = {
  chinese: 1.5,    // Chinese chars per token (中文)
  english: 4,      // English chars per token
  code: 3,         // Code chars per token
  mixed: 3,        // Default for mixed content
};

/**
 * Optional tiktoken encoder — lazy-loaded to avoid hard dependency.
 * If `tiktoken` or `gpt-tokenizer` is not installed, falls back to heuristic.
 */
let _tiktokenEncode: ((text: string) => number) | null | undefined = undefined; // undefined = not yet attempted

function _loadTiktoken(): ((text: string) => number) | null {
  if (_tiktokenEncode !== undefined) return _tiktokenEncode;
  try {
    // Try tiktoken first (official OpenAI tokenizer)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tiktoken = require('tiktoken');
    const enc = tiktoken.encoding_for_model('gpt-4o');
    _tiktokenEncode = (text: string) => enc.encode(text).length;
    logger.info('[TokenEstimation] tiktoken loaded — using precise token counting');
    return _tiktokenEncode;
  } catch {
    try {
      // Fallback: gpt-tokenizer (pure JS, no native deps)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { encode } = require('gpt-tokenizer');
      _tiktokenEncode = (text: string) => encode(text).length;
      logger.info('[TokenEstimation] gpt-tokenizer loaded — using precise token counting');
      return _tiktokenEncode;
    } catch {
      _tiktokenEncode = null;
      logger.debug('[TokenEstimation] No tokenizer library found — using heuristic estimation');
      return null;
    }
  }
}

/**
 * Dynamic ratio calibration.
 * Periodically compares heuristic estimates vs precise counts and adjusts RATIOS.
 */
const _calibrationSamples: Array<{ heuristic: number; precise: number }> = [];
const MAX_CALIBRATION_SAMPLES = 50;
let _calibrationFactor = 1.0; // Multiplier applied to heuristic result

function _updateCalibration(heuristic: number, precise: number): void {
  if (heuristic === 0) return;
  _calibrationSamples.push({ heuristic, precise });
  if (_calibrationSamples.length > MAX_CALIBRATION_SAMPLES) {
    _calibrationSamples.shift();
  }
  // Recalculate mean ratio
  const sumRatio = _calibrationSamples.reduce((s, x) => s + x.precise / x.heuristic, 0);
  _calibrationFactor = sumRatio / _calibrationSamples.length;
}

/**
 * Estimate tokens in a string.
 *
 * Strategy:
 *   1. Always compute heuristic estimate (fast, zero-dependency).
 *   2. If a tokenizer library is available, use precise count for
 *      budget-critical decisions and calibrate the heuristic.
 *   3. Apply rolling calibration factor to heuristic results.
 *
 * @param text     The text to estimate
 * @param precise  Force precise counting (default: false).
 *                 Set to true before prompt budget trimming decisions.
 */
export function estimateTokens(text: string, precise = false): number {
  if (!text) return 0;

  // --- Heuristic path (always computed) ---
  // Count Chinese characters (CJK range)
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;

  // Count code-like content (brackets, operators, etc.)
  const codeChars = (text.match(/[{}[\]()<>:=;,.!?@#$%^&*+\-/\\|`~]/g) || []).length;

  // Total length
  const totalLength = text.length;

  // Remaining chars (treat as English/mixed)
  const otherChars = totalLength - chineseChars - codeChars;

  // Estimate tokens
  const chineseTokens = chineseChars / RATIOS.chinese;
  const codeTokens = codeChars / RATIOS.code;
  const otherTokens = otherChars / RATIOS.english;

  // Add overhead for message structure (role, formatting)
  const overhead = 4;

  const rawHeuristic = chineseTokens + codeTokens + otherTokens + overhead;
  const calibratedHeuristic = Math.ceil(rawHeuristic * _calibrationFactor);

  // --- Precise path (optional) ---
  const encoder = precise ? _loadTiktoken() : null;
  if (encoder) {
    const preciseCount = encoder(text) + overhead;
    // Feed back to calibration
    _updateCalibration(rawHeuristic, preciseCount - overhead);
    return preciseCount;
  }

  // --- Auto-calibration sampling (non-blocking) ---
  // Every ~20 calls, run a precise count in the background to keep calibration fresh
  if (_calibrationSamples.length < MAX_CALIBRATION_SAMPLES && Math.random() < 0.05) {
    const enc = _loadTiktoken();
    if (enc) {
      const preciseCount = enc(text);
      _updateCalibration(rawHeuristic, preciseCount);
    }
  }

  return calibratedHeuristic;
}

/**
 * Get current calibration factor (useful for debugging/monitoring)
 */
export function getTokenCalibrationFactor(): number {
  return _calibrationFactor;
}

/**
 * Get calibration sample count
 */
export function getTokenCalibrationSampleCount(): number {
  return _calibrationSamples.length;
}

/**
 * Estimate tokens for a chat message
 */
export function estimateMessageTokens(message: {
  role: string;
  content?: string | MultimodalContent[];
  tool_calls?: Array<{ function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}): number {
  let tokens = 0;

  // Role overhead
  tokens += 4; // <role> tags etc.

  // Content
  if (message.content) {
    if (typeof message.content === 'string') {
      tokens += estimateTokens(message.content);
    } else if (Array.isArray(message.content)) {
      // Multimodal content - estimate tokens for each part
      for (const part of message.content) {
        if (part.type === 'text' && part.text) {
          tokens += estimateTokens(part.text);
        } else if (part.type === 'image_url' && part.image_url?.url) {
          // Images typically use ~85 tokens (low res) or ~170 tokens (high res) for vision models
          // We'll use a conservative estimate of 100 tokens per image
          tokens += 100;
        }
      }
    }
  }

  // Tool calls
  if (message.tool_calls) {
    for (const call of message.tool_calls) {
      tokens += estimateTokens(call.function.name);
      tokens += estimateTokens(call.function.arguments);
      tokens += 4; // Structure overhead
    }
  }

  // Tool call ID
  if (message.tool_call_id) {
    tokens += estimateTokens(message.tool_call_id);
    tokens += 2;
  }

  return tokens;
}

/**
 * Estimate total tokens for an array of messages
 */
/**
 * Estimate tokens precisely (forces tiktoken if available).
 * Use this before budget trimming decisions.
 */
export function estimateTokensPrecise(text: string): number {
  return estimateTokens(text, true);
}

export function estimateTotalTokens(messages: Array<{
  role: string;
  content?: string | MultimodalContent[];
  tool_calls?: Array<{ function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}>): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

/**
 * Context management configuration
 */
export interface ContextConfig {
  /** Maximum tokens for context (default: 120000, leaving room for response) */
  maxTokens: number;
  /** Minimum recent messages to always keep (default: 6) */
  keepRecent: number;
  /** Always keep system messages (default: true) */
  keepSystem: boolean;
  /** Token threshold to start compression (default: 80% of maxTokens) */
  compressionThreshold: number;
}

export const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  maxTokens: 120000,
  keepRecent: 6,
  keepSystem: true,
  compressionThreshold: 0.8, // 80% of maxTokens
};

/**
 * Model context window sizes (in tokens)
 * Reference: https://platform.openai.com/docs/models
 */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // OpenAI models
  'gpt-4': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4-turbo-preview': 128000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-32k': 32768,
  'gpt-3.5-turbo': 16385,
  'gpt-3.5-turbo-16k': 16385,

  // Claude models
  'claude-3-opus': 200000,
  'claude-3-sonnet': 200000,
  'claude-3-haiku': 200000,
  'claude-3-5-sonnet': 200000,
  'claude-2': 100000,
  'claude-instant': 100000,

  // Zhipu models
  'glm-4': 128000,
  'glm-4-plus': 128000,
  'glm-4-air': 128000,
  'glm-4-airx': 128000,
  'glm-4-flash': 128000,
  'glm-3-turbo': 128000,
  'glm-5': 200000,  // GLM-5 supports 200K context window

  // MiniMax models
  'abab6.5-chat': 245000,
  'abab6.5s-chat': 245000,
  'abab5.5-chat': 16384,
  'abab5.5s-chat': 16384,

  // DeepSeek models
  'deepseek-chat': 32768,
  'deepseek-coder': 16384,

  // Moonshot models
  'moonshot-v1-8k': 8192,
  'moonshot-v1-32k': 32768,
  'moonshot-v1-128k': 128000,
};

/**
 * Get context window size for a model
 */
export function getModelContextWindow(model: string): number {
  // Normalize model name
  const normalizedModel = model.toLowerCase();

  // Direct match
  if (MODEL_CONTEXT_WINDOWS[normalizedModel]) {
    return MODEL_CONTEXT_WINDOWS[normalizedModel];
  }

  // Partial match (e.g., gpt-4-0125-preview matches gpt-4-turbo-preview)
  for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (normalizedModel.includes(key) || key.includes(normalizedModel)) {
      return value;
    }
  }

  // Default fallback
  return 128000; // Conservative default
}

/**
 * Calculate optimal context config based on model and response tokens
 */
export function calculateContextConfig(
  model: string,
  responseMaxTokens?: number,
  customConfig?: Partial<ContextConfig>
): ContextConfig {
  const modelContextWindow = getModelContextWindow(model);

  // Reserve tokens for response
  // If user specified response maxTokens, use that + 10% buffer
  // Otherwise, reserve 25% of context window for response
  const reservedForResponse = responseMaxTokens
    ? Math.ceil(responseMaxTokens * 1.1)
    : Math.ceil(modelContextWindow * 0.25);

  // Calculate max tokens for context (leaving room for response)
  const maxContextTokens = modelContextWindow - reservedForResponse;

  // Set safety cap based on model context window size
  // For models with 200K+ context, allow up to 150K
  // For standard models (128K), cap at 120K
  const safetyCap = modelContextWindow >= 200000 ? 150000 : 120000;

  return {
    ...DEFAULT_CONTEXT_CONFIG,
    maxTokens: Math.min(maxContextTokens, safetyCap),
    ...customConfig,
  };
}

/**
 * Compression result for a message
 */
export interface CompressedMessage {
  role: string;
  content: string;
  compressed?: boolean;
  originalTokens?: number;
  compressedTokens?: number;
}

/**
 * Compress a tool result message
 * Keeps tool name and brief result, removes verbose output
 */
export function compressToolResult(content: string): string {
  try {
    const result = JSON.parse(content);

    // If result has data, try to summarize it
    if (result.success && result.data) {
      const data = result.data;

      // For list/array results
      if (Array.isArray(data)) {
        return JSON.stringify({
          success: true,
          summary: `Array with ${data.length} items`,
          preview: data.slice(0, 2),
        });
      }

      // For object results, keep structure but truncate long strings
      if (typeof data === 'object') {
        const compressed: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(data)) {
          if (typeof value === 'string' && value.length > 500) {
            compressed[key] = value.slice(0, 200) + '... [truncated]';
          } else if (Array.isArray(value) && value.length > 10) {
            compressed[key] = [...value.slice(0, 5), `... ${value.length - 5} more items`];
          } else {
            compressed[key] = value;
          }
        }
        return JSON.stringify({ success: true, data: compressed });
      }
    }

    // For error results, keep them intact (usually short)
    if (result.error) {
      return JSON.stringify({ success: false, error: result.error });
    }

    // Fallback: truncate if too long
    if (content.length > 1000) {
      return content.slice(0, 500) + '... [compressed]';
    }

    return content;
  } catch {
    // Not JSON, just truncate
    if (content.length > 1000) {
      return content.slice(0, 500) + '... [compressed]';
    }
    return content;
  }
}

/**
 * Compress an assistant message with tool calls
 */
export function compressAssistantMessage(content: string, toolCalls?: Array<{
  function: { name: string; arguments: string };
}>): string {
  // If there are tool calls, create a summary
  if (toolCalls && toolCalls.length > 0) {
    const callSummary = toolCalls.map(tc => `${tc.function.name}()`).join(', ');
    return `[Called tools: ${callSummary}] ${content || ''}`.trim();
  }

  // For long content with code blocks, compress them
  if (content && content.length > 2000) {
    // Replace long code blocks with placeholders
    let compressed = content.replace(
      /```[\s\S]{500,}?```/g,
      (match) => {
        const lang = match.match(/```(\w+)?/)?.[1] || '';
        const lines = match.split('\n').length;
        return `[${lang} code block, ${lines} lines - compressed]`;
      }
    );

    // If still too long, truncate
    if (compressed.length > 1500) {
      compressed = compressed.slice(0, 1000) + '\n... [content compressed]';
    }

    return compressed;
  }

  return content || '';
}

/**
 * Token statistics for a conversation turn
 */
export interface TokenStats {
  /** Prompt tokens (input context) */
  promptTokens: number;
  /** Completion tokens (AI response) */
  completionTokens: number;
  /** Total tokens this turn */
  totalTokens: number;
  /** Context tokens before this turn */
  contextTokensBefore: number;
  /** Context tokens after this turn */
  contextTokensAfter: number;
  /** Maximum context tokens allowed */
  maxContextTokens: number;
  /** Context utilization percentage */
  contextUtilization: number;
}

/**
 * Clean token stats from message content to prevent pollution in history
 */
export function cleanTokenStats(content: string): string {
  // Remove inline token stats (supports ✅, ⚠️, 📊 emojis)
  // Pattern: ---\n[emoji] Tokens: +XXX | Context: XXX/XXX (XX.X%) [█░░...]
  content = content.replace(/\n\n---\n[✅⚠📊] Tokens: \+\d+[,\d]* \| Context: [\d,\/]+ \([\d.]+%\) [█░]+\n?/g, '');

  // Also handle skill attribution line to prevent duplication
  // Pattern: _📋 Used skill: XXX_
  content = content.replace(/\n\n---\n_📋 Used skill:[^_]+_/g, '');

  // Remove block token stats
  // Pattern: ---\n### 📊 Token Stats\n... (until next --- or end)
  content = content.replace(/\n\n---\n### 📊 Token Stats[\s\S]*?(?=\n\n---|$)/g, '');

  // Remove any remaining --- separator at the end if followed by nothing
  content = content.replace(/\n\n---\n*$/g, '');

  return content;
}

/**
 * Format token stats for display
 */
export function formatTokenStats(stats: TokenStats, format: 'inline' | 'block' = 'inline'): string {
  const utilizationBar = generateUtilizationBar(stats.contextUtilization);
  const utilizationColor = stats.contextUtilization > 80 ? '⚠️' : stats.contextUtilization > 60 ? '📊' : '✅';

  if (format === 'inline') {
    return `${utilizationColor} Tokens: +${stats.completionTokens} | Context: ${stats.contextTokensAfter}/${stats.maxContextTokens} (${stats.contextUtilization.toFixed(1)}%) ${utilizationBar}`;
  }

  return `### 📊 Token Stats
| Metric | Value |
|--------|-------|
| This turn | +${stats.completionTokens} tokens |
| Context | ${stats.contextTokensAfter} / ${stats.maxContextTokens} (${stats.contextUtilization.toFixed(1)}%) |
| Utilization | ${utilizationBar} |`;
}

/**
 * Generate a visual utilization bar
 */
function generateUtilizationBar(percentage: number, width: number = 10): string {
  // Ensure percentage is valid
  if (percentage === undefined || percentage === null || isNaN(percentage)) {
    return '░░░░░░░░░░░';
  }

  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  const bar = '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, empty));

  return `[${bar}]`;
}

/**
 * Token stats configuration
 */
export interface TokenStatsConfig {
  /** Show token stats in response (default: false) */
  showTokenStats: boolean;
  /** Format for stats display (default: 'inline') */
  tokenStatsFormat: 'inline' | 'block';
}

export const DEFAULT_TOKEN_STATS_CONFIG: TokenStatsConfig = {
  showTokenStats: false,
  tokenStatsFormat: 'inline',
};

