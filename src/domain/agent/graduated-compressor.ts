/**
 * [P1 FIX #5] Graduated Context Compressor
 *
 * New module replacing the "cliff-edge" compression that removes all old
 * messages at once. Implements a sliding-window approach with three zones:
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  Zone A: Recent (原文)  │  Zone B: Summary  │  Zone C: Facts  │
 *   │  Last N turns kept      │  Mid-term digest   │  Long-term KV    │
 *   │  verbatim               │  incremental LLM   │  extracted from  │
 *   │                         │  summaries          │  Zone B overflow │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Drop this file into src/agent/graduated-compressor.ts
 */

import type { AIProvider } from '../../infra/config/schema';
import type { ChatMessage } from './types';
import { estimateTokens, estimateMessageTokens, estimateTotalTokens } from './context';
import { callAI } from './api';
import { logger } from '../../infra/observability/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GraduatedCompressionConfig {
  /** Number of recent message pairs (user+assistant) to keep verbatim */
  recentTurns: number;
  /** Maximum tokens for the summary zone */
  maxSummaryTokens: number;
  /** Maximum tokens for the facts zone */
  maxFactsTokens: number;
  /** Model to use for compression (default: cheap/fast model) */
  compressionModel?: string;
  /** Enable message importance scoring */
  enableImportanceScoring: boolean;
}

export const DEFAULT_GRADUATED_CONFIG: GraduatedCompressionConfig = {
  recentTurns: 4,      // Keep last 4 turns (8 messages) verbatim
  maxSummaryTokens: 1500,
  maxFactsTokens: 500,
  compressionModel: undefined,  // Use provider's default
  enableImportanceScoring: true,
};

export interface MessageImportance {
  message: ChatMessage;
  index: number;
  score: number;
  reasons: string[];
}

export interface GraduatedCompressionResult {
  /** The new message array to use */
  messages: ChatMessage[];
  /** How many tokens were saved */
  tokensSaved: number;
  /** The summary text generated */
  summaryText: string;
  /** Extracted long-term facts */
  facts: string[];
  /** Method used */
  method: 'graduated' | 'incremental' | 'fallback-rule';
}

// ---------------------------------------------------------------------------
// Message Importance Scoring
// ---------------------------------------------------------------------------

/**
 * Score the importance of each message for compression decisions.
 *
 * Higher score = more important = should be preserved longer.
 *
 * Scoring factors:
 * - Contains user instruction/command: +30
 * - Contains tool call results: +20
 * - Contains code blocks: +15
 * - Contains decision/conclusion: +15
 * - Contains preference expression: +25
 * - Contains error/correction: +20
 * - Short casual message: -10
 * - Duplicate/repetitive: -15
 */
export function scoreMessageImportance(
  messages: ChatMessage[],
): MessageImportance[] {
  return messages.map((msg, index) => {
    let score = 50; // Base score
    const reasons: string[] = [];
    const content = typeof msg.content === 'string' ? msg.content : '';
    const lowerContent = content.toLowerCase();

    // --- Positive signals ---

    // User instructions / commands
    if (msg.role === 'user') {
      if (/请|帮我|能不能|可以|need|please|could|should|must/i.test(content)) {
        score += 30;
        reasons.push('user-instruction');
      }
      // Preference expressions
      if (/喜欢|偏好|习惯|prefer|always|never|不要|记住/i.test(content)) {
        score += 25;
        reasons.push('preference');
      }
      // Correction
      if (/不对|错了|纠正|wrong|incorrect|correct|其实/i.test(content)) {
        score += 20;
        reasons.push('correction');
      }
    }

    // Tool call results
    if (msg.role === 'tool') {
      score += 20;
      reasons.push('tool-result');

      // Error results are more important (need to preserve for context)
      try {
        const parsed = JSON.parse(content);
        if (parsed.success === false || parsed.error) {
          score += 15;
          reasons.push('tool-error');
        }
      } catch { /* not JSON */ }
    }

    // Assistant with tool calls
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      score += 20;
      reasons.push('has-tool-calls');
    }

    // Code blocks
    if (/```[\s\S]+```/.test(content)) {
      score += 15;
      reasons.push('code-block');
    }

    // Decision / conclusion markers
    if (/结论|决定|总结|conclusion|decision|summary|result|最终/i.test(content)) {
      score += 15;
      reasons.push('conclusion');
    }

    // --- Negative signals ---

    // Very short casual messages
    if (msg.role === 'user' && content.length < 10 && !/[\u4e00-\u9fff]/.test(content)) {
      score -= 10;
      reasons.push('short-casual');
    }

    // System messages (usually don't need to be in the window)
    if (msg.role === 'system') {
      score -= 20;
      reasons.push('system-message');
    }

    // Clamp to [0, 100]
    score = Math.max(0, Math.min(100, score));

    return { message: msg, index, score, reasons };
  });
}

// ---------------------------------------------------------------------------
// Incremental Summary Generator
// ---------------------------------------------------------------------------

/**
 * Generate an incremental summary by appending new messages to an existing summary.
 *
 * Unlike the original compressWithLLM which generates a new summary from scratch
 * every time, this INCREMENTALLY updates the existing summary, which:
 * 1. Preserves information from earlier compression cycles
 * 2. Is cheaper (only processes new messages, not the full history)
 * 3. Produces more stable summaries
 */
export async function incrementalSummarize(
  existingSummary: string,
  newMessages: ChatMessage[],
  provider: AIProvider,
  model?: string,
  maxTokens: number = 1500,
): Promise<{ summary: string; extractedFacts: string[] }> {
  const newContent = formatMessagesForSummary(newMessages);
  const newContentTokens = estimateTokens(newContent);

  // Skip if new content is trivial
  if (newContentTokens < 50) {
    return { summary: existingSummary, extractedFacts: [] };
  }

  const prompt = existingSummary
    ? `你是对话摘要助手。以下是已有的对话摘要和新增的对话内容。

## 已有摘要
${existingSummary}

## 新增对话
${newContent}

## 任务
1. 将新增对话中的重要信息合并到已有摘要中
2. 如果新信息修正了之前的结论，更新摘要
3. 提取出值得长期保留的关键事实（用户偏好、重要决定等）
4. 摘要总长度控制在 ${Math.round(maxTokens * 2)} 字以内

请按以下格式输出：

### 更新摘要
[合并后的完整摘要]

### 关键事实
- [事实1]
- [事实2]
（如果没有新的关键事实，输出"无"）`

    : `你是对话摘要助手。请将以下对话压缩为简洁摘要。

## 对话内容
${newContent}

## 任务
1. 按主题组织要点（不要按时间流水账）
2. 保留用户的核心需求和最终结论
3. 提取值得长期保留的关键事实
4. 摘要控制在 ${Math.round(maxTokens * 2)} 字以内

请按以下格式输出：

### 摘要
[对话摘要]

### 关键事实
- [事实1]
- [事实2]
（如果没有关键事实，输出"无"）`;

  try {
    const response = await callAI({
      provider,
      model: model || (provider as any).defaultModel || 'glm-4-flash',
      messages: [
        { role: 'system', content: '你是对话压缩专家，擅长增量更新对话摘要并提取关键事实。' },
        { role: 'user', content: prompt },
      ],
      maxTokens,
    });

    const output = response.choices[0]?.message?.content || '';

    // Parse summary and facts
    const summaryMatch = output.match(/###\s*(?:更新)?摘要\s*\n([\s\S]*?)(?=###\s*关键事实|$)/);
    const factsMatch = output.match(/###\s*关键事实\s*\n([\s\S]*?)$/);

    const summary = summaryMatch?.[1]?.trim() || output;
    const factsText = factsMatch?.[1]?.trim() || '';
    const extractedFacts = factsText === '无' ? [] : factsText
      .split('\n')
      .map(line => line.replace(/^[-*]\s*/, '').trim())
      .filter(line => line.length > 0);

    return { summary, extractedFacts };
  } catch (error) {
    logger.error('[GraduatedCompressor] Incremental summarization failed:', error);
    // Fallback: simple rule-based append
    const fallbackSummary = existingSummary
      ? `${existingSummary}\n\n[新增] ${ruleBasedExtract(newMessages)}`
      : ruleBasedExtract(newMessages);
    return { summary: fallbackSummary, extractedFacts: [] };
  }
}

// ---------------------------------------------------------------------------
// Core Graduated Compression
// ---------------------------------------------------------------------------

/**
 * Perform graduated compression on the message history.
 *
 * Algorithm:
 * 1. Identify the system message (always preserved)
 * 2. Split messages into "old" (candidates for compression) and "recent" (kept verbatim)
 * 3. If importance scoring is enabled, partition old messages by importance
 * 4. High-importance old messages get their key points extracted into summary
 * 5. Low-importance old messages are discarded entirely
 * 6. Existing summary is incrementally updated with new compressed content
 * 7. Extracted facts are injected as a separate system note
 */
export async function graduatedCompress(
  messages: ChatMessage[],
  existingSummary: string,
  existingFacts: string[],
  provider: AIProvider,
  config: Partial<GraduatedCompressionConfig> = {},
): Promise<GraduatedCompressionResult> {
  const cfg = { ...DEFAULT_GRADUATED_CONFIG, ...config };
  const tokensBefore = estimateTotalTokens(messages);

  // --- Step 1: Identify system message ---
  const systemMsg = messages.find(m => m.role === 'system');
  const nonSystemMessages = messages.filter(m => m.role !== 'system');

  // --- Step 2: Split into recent and old ---
  const recentCount = cfg.recentTurns * 2; // user+assistant pairs
  const recentMessages = nonSystemMessages.slice(-recentCount);
  const oldMessages = nonSystemMessages.slice(0, -recentCount);

  if (oldMessages.length === 0) {
    return {
      messages,
      tokensSaved: 0,
      summaryText: existingSummary,
      facts: existingFacts,
      method: 'graduated',
    };
  }

  // --- Step 3: Score importance (optional) ---
  let messagesToSummarize: ChatMessage[];
  if (cfg.enableImportanceScoring) {
    const scored = scoreMessageImportance(oldMessages);
    // Only summarize messages with score >= 30 (discard truly unimportant ones)
    messagesToSummarize = scored
      .filter(s => s.score >= 30)
      .map(s => s.message);

    const discardedCount = oldMessages.length - messagesToSummarize.length;
    if (discardedCount > 0) {
      logger.debug(`[GraduatedCompressor] Discarded ${discardedCount} low-importance messages`);
    }
  } else {
    messagesToSummarize = oldMessages;
  }

  // --- Step 4: Incremental summarization ---
  let newSummary = existingSummary;
  let newFacts = [...existingFacts];

  if (messagesToSummarize.length > 0) {
    try {
      const result = await incrementalSummarize(
        existingSummary,
        messagesToSummarize,
        provider,
        cfg.compressionModel,
        cfg.maxSummaryTokens,
      );
      newSummary = result.summary;
      newFacts = [...existingFacts, ...result.extractedFacts];

      // Deduplicate facts
      newFacts = [...new Set(newFacts)];

      // Trim facts if too many
      if (newFacts.length > 20) {
        newFacts = newFacts.slice(-20);
      }

      logger.info(`[GraduatedCompressor] Summary updated, ${result.extractedFacts.length} new facts extracted`);
    } catch (error) {
      logger.warn('[GraduatedCompressor] Summarization failed, using fallback');
      newSummary = existingSummary
        ? `${existingSummary}\n\n${ruleBasedExtract(messagesToSummarize)}`
        : ruleBasedExtract(messagesToSummarize);
    }
  }

  // --- Step 5: Rebuild message array ---
  const newMessages: ChatMessage[] = [];

  // System message with summary and facts injected
  if (systemMsg) {
    let enhancedSystem = typeof systemMsg.content === 'string' ? systemMsg.content : '';

    if (newSummary) {
      // Remove old summary section if present
      enhancedSystem = enhancedSystem.replace(/\n\n## 历史对话摘要[\s\S]*?(?=\n\n## |\n\n---\n|$)/, '');
      enhancedSystem += `\n\n## 历史对话摘要\n${newSummary}`;
    }

    if (newFacts.length > 0) {
      // Remove old facts section if present
      enhancedSystem = enhancedSystem.replace(/\n\n## 对话关键事实[\s\S]*?(?=\n\n## |\n\n---\n|$)/, '');
      enhancedSystem += `\n\n## 对话关键事实\n${newFacts.map(f => `- ${f}`).join('\n')}`;
    }

    newMessages.push({ ...systemMsg, content: enhancedSystem });
  }

  // Recent messages kept verbatim
  newMessages.push(...recentMessages);

  const tokensAfter = estimateTotalTokens(newMessages);

  logger.info(
    `[GraduatedCompressor] ${tokensBefore} → ${tokensAfter} tokens ` +
    `(${Math.round((1 - tokensAfter / tokensBefore) * 100)}% reduction, ` +
    `${oldMessages.length} messages compressed, ${recentMessages.length} kept verbatim)`
  );

  return {
    messages: newMessages,
    tokensSaved: tokensBefore - tokensAfter,
    summaryText: newSummary,
    facts: newFacts,
    method: 'graduated',
  };
}

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

function formatMessagesForSummary(messages: ChatMessage[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : '';

    switch (msg.role) {
      case 'user': {
        const truncated = content.length > 500 ? content.slice(0, 500) + '...' : content;
        lines.push(`用户: ${truncated}`);
        break;
      }
      case 'assistant': {
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          const toolNames = msg.tool_calls.map(tc => tc.function.name).join(', ');
          lines.push(`助手: [调用工具: ${toolNames}]`);
        }
        if (content) {
          const truncated = content.length > 300 ? content.slice(0, 300) + '...' : content;
          lines.push(`助手: ${truncated}`);
        }
        break;
      }
      case 'tool': {
        try {
          const parsed = JSON.parse(content);
          if (parsed.success === false && parsed.error) {
            lines.push(`工具结果: 错误 - ${parsed.error}`);
          } else if (parsed.success) {
            lines.push(`工具结果: 成功`);
          }
        } catch {
          if (content.length > 100) {
            lines.push(`工具结果: ${content.slice(0, 100)}...`);
          }
        }
        break;
      }
    }
  }

  return lines.join('\n');
}

function ruleBasedExtract(messages: ChatMessage[]): string {
  const points: string[] = [];

  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : '';

    if (msg.role === 'user' && content.length > 5) {
      points.push(`- 用户: ${content.slice(0, 80)}${content.length > 80 ? '...' : ''}`);
    } else if (msg.role === 'assistant' && content.length > 10) {
      // Extract conclusions only
      const conclusionMatch = content.match(/(?:结论|总结|最终)[是为：:]\s*(.{10,100})/);
      if (conclusionMatch) {
        points.push(`- 结论: ${conclusionMatch[1]}`);
      }
    }
  }

  return points.slice(0, 8).join('\n');
}
