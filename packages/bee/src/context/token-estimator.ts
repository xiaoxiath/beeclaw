/**
 * bee — Token Estimation Utilities
 *
 * Simple but reasonably accurate token estimation without external dependencies.
 * Based on empirical observations:
 * - Chinese: ~1.5 characters per token
 * - English: ~4 characters per token
 * - Code: ~3 characters per token
 * - Whitespace/punctuation: varies
 */

import { getLogger } from '../core/logger';
import type { MultimodalContent } from '../core/types';

const logger = getLogger();

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
    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-restricted-syntax
    const tiktoken = require('tiktoken');
    const enc = tiktoken.encoding_for_model('gpt-4o');
    _tiktokenEncode = (text: string) => enc.encode(text).length;
    logger.info('[TokenEstimation] tiktoken loaded — using precise token counting');
    return _tiktokenEncode;
  } catch {
    try {
      // Fallback: gpt-tokenizer (pure JS, no native deps)
      // eslint-disable-next-line @typescript-eslint/no-require-imports, no-restricted-syntax
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
 * Estimate tokens precisely (forces tiktoken if available).
 * Use this before budget trimming decisions.
 */
export function estimateTokensPrecise(text: string): number {
  return estimateTokens(text, true);
}

/**
 * Estimate total tokens for an array of messages
 */
export function estimateTotalTokens(messages: Array<{
  role: string;
  content?: string | MultimodalContent[];
  tool_calls?: Array<{ function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}>): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

/**
 * Model context window sizes (in tokens)
 * Reference: https://platform.openai.com/docs/models
 */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // OpenAI models (updated 2026-04)
  'gpt-4': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4-turbo-preview': 128000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4.1': 1047576,          // GPT-4.1: 1M context
  'gpt-4.1-mini': 1047576,     // GPT-4.1 Mini: 1M context
  'gpt-4.1-nano': 1047576,     // GPT-4.1 Nano: 1M context
  'o1': 200000,
  'o1-mini': 128000,
  'o1-pro': 200000,
  'o3': 200000,
  'o3-mini': 200000,
  'o4-mini': 200000,
  'gpt-4-32k': 32768,          // Legacy
  'gpt-3.5-turbo': 16385,      // Legacy
  'gpt-3.5-turbo-16k': 16385,  // Legacy

  // Claude models (updated 2026-04)
  'claude-3-opus': 200000,
  'claude-3-sonnet': 200000,
  'claude-3-haiku': 200000,
  'claude-3.5-sonnet': 200000,
  'claude-3.5-haiku': 200000,
  'claude-3.7-sonnet': 200000,
  'claude-4-sonnet': 200000,
  'claude-4-opus': 200000,
  'claude-2': 100000,           // Legacy
  'claude-instant': 100000,     // Legacy

  // Zhipu models (updated 2026-04)
  'glm-4': 128000,
  'glm-4-plus': 128000,
  'glm-4-air': 128000,
  'glm-4-airx': 128000,
  'glm-4-flash': 128000,
  'glm-4.7-flashx': 131072,
  'glm-4.6v': 32768,
  'glm-3-turbo': 128000,
  'glm-5': 200000,

  // MiniMax models
  'abab6.5-chat': 245000,
  'abab6.5s-chat': 245000,
  'abab5.5-chat': 16384,
  'abab5.5s-chat': 16384,

  // DeepSeek models (updated 2026-04)
  'deepseek-chat': 131072,      // DeepSeek V3: 128K context
  'deepseek-coder': 131072,     // DeepSeek Coder V2: 128K context
  'deepseek-reasoner': 131072,  // DeepSeek R1

  // Moonshot models
  'moonshot-v1-8k': 8192,
  'moonshot-v1-32k': 32768,
  'moonshot-v1-128k': 128000,

  // Google Gemini models
  'gemini-2.0-flash': 1048576,
  'gemini-2.5-pro': 1048576,
  'gemini-2.5-flash': 1048576,
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
  customConfig?: Partial<AgentContextConfig>,
): AgentContextConfig {
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

// ---------------------------------------------------------------------------
// Re-export AgentContextConfig from core/types for convenience
// ---------------------------------------------------------------------------

import type { AgentContextConfig } from '../core/types';
import { DEFAULT_CONTEXT_CONFIG } from '../core/types';

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
export function compressToolResult(content: string, maxLen?: number): string {
  const effectiveMax = maxLen ?? 1000;
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
    if (content.length > effectiveMax) {
      return content.slice(0, Math.floor(effectiveMax / 2)) + '... [compressed]';
    }

    return content;
  } catch {
    // Not JSON, just truncate
    if (content.length > effectiveMax) {
      return content.slice(0, Math.floor(effectiveMax / 2)) + '... [compressed]';
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
      },
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
