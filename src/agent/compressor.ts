/**
 * LLM-based Context Compression
 *
 * Uses LLM to intelligently compress conversation history while preserving
 * important information like code blocks, decisions, and user questions.
 */

import type { AIProvider, CompressionConfig } from '../config/schema';
import type { ChatMessage } from './types';
import { estimateTokens, estimateTotalTokens } from './context';
import { callAI } from './api';

// Default compression config
export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  enabled: true,
  model: 'glm-4.7-flash',  // Default to cheap model
  threshold: 0.8,  // Trigger at 80% context
  keepRecent: 8,  // Keep recent messages
  maxSummaryTokens: 1000,
  strategy: 'hybrid',  // Use LLM for important content
};

// Compression prompt
const COMPRESSION_PROMPT = `你是一个对话压缩专家。请将以下对话历史压缩成一个简洁的摘要。

## 压缩要求

1. **保留关键信息**：
   - 用户的核心问题和需求
   - 重要的决定和结论
   - 关键代码片段（用 \`\`\` 标记）
   - 工具调用的关键结果

2. **可以省略**：
   - 重复的讨论
   - 无关的闲聊
   - 过长的工具输出详情
   - 错误尝试的细节

3. **格式要求**：
   - 按时间顺序组织
   - 每个主题用简短的要点描述
   - 代码块保留关键部分（不超过 20 行）
   - 总长度控制在 300-500 字

## 对话历史

{conversation}

## 压缩后的摘要`;

// Interface for compression result
export interface CompressionResult {
  summary: string;
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
}

/**
 * Compress messages using LLM
 */
export async function compressWithLLM(
  messages: ChatMessage[],
  provider: AIProvider,
  config: Partial<CompressionConfig> = {}
): Promise<CompressionResult> {
  const model = config.model || DEFAULT_COMPRESSION_CONFIG.model;
  const maxSummaryTokens = config.maxSummaryTokens || DEFAULT_COMPRESSION_CONFIG.maxSummaryTokens;

  const originalTokens = estimateTotalTokens(messages);

  // Skip if already small enough
  if (originalTokens < 2000) {
    return {
      summary: '',
      originalTokens,
      compressedTokens: 0,
      compressionRatio: 1,
    };
  }

  // Format messages for compression
  const conversationText = formatMessagesForCompression(messages);

  // Create compression prompt
  const prompt = COMPRESSION_PROMPT.replace('{conversation}', conversationText);

  try {
    // Use callAI instead of provider directly
    const response = await callAI({
      provider,
      model,
      messages: [
        {
          role: 'system',
          content: '你是一个对话压缩专家，擅长保留关键信息的同时大幅减少文本长度。',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      maxTokens: maxSummaryTokens,
    });

    const summary = response.choices[0]?.message?.content || '';
    const compressedTokens = estimateTokens(summary);

    return {
      summary,
      originalTokens,
      compressedTokens,
      compressionRatio: compressedTokens / originalTokens,
    };
  } catch (error) {
    console.error('[LLMCompressor] Compression failed:', error);
    throw error;
  }
}

/**
 * Format messages for compression prompt
 */
function formatMessagesForCompression(messages: ChatMessage[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    const timestamp = (msg as any).timestamp
      ? `[${new Date((msg as any).timestamp).toLocaleTimeString()}] `
      : '';

    switch (msg.role) {
      case 'user':
        lines.push(`\n### 用户 ${timestamp}`);
        lines.push(formatContent(msg.content));
        break;

      case 'assistant':
        lines.push(`\n### 助手 ${timestamp}`);
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          const toolNames = msg.tool_calls.map(tc => tc.function.name).join(', ');
          lines.push(`[调用工具: ${toolNames}]`);
        }
        lines.push(formatContent(msg.content));
        break;

      case 'tool':
        const toolName = (msg as any).name || 'unknown';
        lines.push(`\n### 工具结果 (${toolName})`);
        lines.push(formatToolResult(msg.content, 300));
        break;

      case 'system':
        // Skip system messages in compression
        break;
    }
  }

  return lines.join('\n');
}

/**
 * Format message content
 */
function formatContent(content: string | any[]): string {
  if (!content) return '';

  if (typeof content === 'string') {
    // Truncate very long content
    if (content.length > 2000) {
      return content.slice(0, 2000) + '\n... [内容过长已截断]';
    }
    return content;
  }

  // Handle multimodal content
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (part.type === 'text') return part.text;
        if (part.type === 'image_url') return '[图片]';
        return '[其他内容]';
      })
      .join('\n');
  }

  return String(content);
}

/**
 * Format tool result for compression
 */
function formatToolResult(content: string | any[], maxLength: number = 300): string {
  if (!content) return '';

  let text: string;
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = JSON.stringify(content, null, 2);
  } else {
    text = JSON.stringify(content, null, 2);
  }

  // Try to parse JSON and extract key info
  try {
    const json = JSON.parse(text);

    // Handle common result patterns
    if (json.success === false && json.error) {
      return `错误: ${json.error}`;
    }

    if (Array.isArray(json.data)) {
      const preview = json.data.slice(0, 3);
      return `成功: ${json.data.length} 项数据\n预览: ${JSON.stringify(preview)}`;
    }

    if (typeof json.data === 'object') {
      const keys = Object.keys(json.data);
      return `成功: 对象数据 (${keys.join(', ')})`;
    }
  } catch {
    // Not JSON, continue with text
  }

  // Truncate long text
  if (text.length > maxLength) {
    return text.slice(0, maxLength) + '... [已截断]';
  }

  return text;
}

/**
 * Smart compression strategy selector
 *
 * Chooses between LLM and rule-based compression based on:
 * - Number of messages
 * - Estimated compression benefit
 * - Presence of code blocks or important content
 * - User config preference
 */
export function selectCompressionStrategy(
  messages: ChatMessage[],
  currentTokens: number,
  maxTokens: number,
  config: Partial<CompressionConfig> = {}
): {
  strategy: 'llm' | 'rule' | 'none';
  reason: string;
  targetMessages?: ChatMessage[];
} {
  const threshold = config.threshold || DEFAULT_COMPRESSION_CONFIG.threshold;
  const strategy = config.strategy || DEFAULT_COMPRESSION_CONFIG.strategy;
  const utilization = currentTokens / maxTokens;

  // No compression needed
  if (utilization < threshold) {
    return { strategy: 'none', reason: `Context under ${Math.round(threshold * 100)}% utilization` };
  }

  // If user explicitly wants rule-based only
  if (strategy === 'rule') {
    return { strategy: 'rule', reason: 'User configured rule-based strategy' };
  }

  // Count important content
  const hasCodeBlocks = messages.some(m =>
    typeof m.content === 'string' && m.content.includes('```')
  );
  const hasToolCalls = messages.some(m =>
    m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0
  );
  const messageCount = messages.length;

  // Few messages, use rule-based (not worth LLM call)
  if (messageCount < 5) {
    return { strategy: 'rule', reason: 'Few messages, rule-based is sufficient' };
  }

  // If user explicitly wants LLM only
  if (strategy === 'llm') {
    return {
      strategy: 'llm',
      reason: 'User configured LLM strategy',
      targetMessages: messages.slice(0, -6),
    };
  }

  // Hybrid strategy (default)
  // High utilization with important content, use LLM
  if (utilization > 0.9 && (hasCodeBlocks || hasToolCalls)) {
    return {
      strategy: 'llm',
      reason: 'High utilization with important content, LLM preserves key info',
      targetMessages: messages.slice(0, -4),
    };
  }

  // Medium utilization with many messages, use LLM for better quality
  if (utilization > threshold && messageCount > 8) {
    return {
      strategy: 'llm',
      reason: 'Many messages, LLM provides better compression quality',
      targetMessages: messages.slice(0, -6),
    };
  }

  // Default to rule-based
  return { strategy: 'rule', reason: 'Default to rule-based compression' };
}

/**
 * Hybrid compressor that combines LLM and rule-based approaches
 */
export async function hybridCompress(
  messages: ChatMessage[],
  provider: AIProvider,
  options: {
    maxTokens: number;
    currentTokens: number;
    config?: Partial<CompressionConfig>;
  }
): Promise<{
  summary: string;
  keptMessages: ChatMessage[];
  compressionRatio: number;
  method: 'llm' | 'rule' | 'none';
}> {
  const { maxTokens, currentTokens, config = {} } = options;
  const keepRecent = config.keepRecent || DEFAULT_COMPRESSION_CONFIG.keepRecent;

  // Select strategy
  const decision = selectCompressionStrategy(messages, currentTokens, maxTokens, config);

  if (decision.strategy === 'none') {
    return {
      summary: '',
      keptMessages: messages,
      compressionRatio: 1,
      method: 'none',
    };
  }

  const recentMessages = messages.slice(-keepRecent);
  const oldMessages = messages.slice(0, -keepRecent);

  if (oldMessages.length === 0) {
    return {
      summary: '',
      keptMessages: messages,
      compressionRatio: 1,
      method: 'none',
    };
  }

  // Try LLM compression first
  if (decision.strategy === 'llm') {
    try {
      console.log(`[HybridCompressor] Using LLM compression for ${oldMessages.length} messages`);
      const result = await compressWithLLM(oldMessages, provider, config);

      console.log(
        `[HybridCompressor] LLM compression: ${result.originalTokens} → ${result.compressedTokens} tokens ` +
        `(${Math.round(result.compressionRatio * 100)}%)`
      );

      return {
        summary: result.summary,
        keptMessages: recentMessages,
        compressionRatio: result.compressionRatio,
        method: 'llm',
      };
    } catch (error) {
      console.warn('[HybridCompressor] LLM compression failed, falling back to rule-based');
    }
  }

  // Rule-based compression (fallback or selected)
  console.log(`[HybridCompressor] Using rule-based compression for ${oldMessages.length} messages`);
  const { summary } = ruleBasedCompress(oldMessages);

  return {
    summary,
    keptMessages: recentMessages,
    compressionRatio: 0.5,  // Estimate
    method: 'rule',
  };
}

/**
 * Simple rule-based compression (fallback)
 */
function ruleBasedCompress(messages: ChatMessage[]): { summary: string } {
  const points: string[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      // Extract user questions
      const content = typeof msg.content === 'string' ? msg.content : '';
      const shortContent = content.length > 100 ? content.slice(0, 100) + '...' : content;
      points.push(`用户问: ${shortContent}`);
    } else if (msg.role === 'assistant') {
      // Extract key conclusions
      const content = typeof msg.content === 'string' ? msg.content : '';
      const conclusions = content.match(/结论[是为：:]\s*(.+)/g);
      if (conclusions) {
        points.push(...conclusions.slice(0, 2));
      }
    }
  }

  const summary = points.length > 0
    ? `## 历史对话要点\n${points.slice(0, 10).join('\n')}`
    : '';

  return { summary };
}
