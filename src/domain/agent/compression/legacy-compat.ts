/**
 * Legacy Compatibility Layer
 *
 * @deprecated This module re-exports the old hybridCompress API.
 * New code should use compressMessages from './agent-integration' or
 * ProgressiveCompactor directly. This file will be removed in v2.0.
 *
 * MIGRATION GUIDE:
 *   - hybridCompress()  -> import { compressMessages } from './agent-integration'
 *   - LegacyCompressionResult -> import { CompressionResult } from './types'
 *   - For fine-grained control, use ProgressiveCompactor.compact() directly.
 */

import type { AIProvider, CompressionConfig } from '../../../infra/config/schema';
import type { ChatMessage } from '../types';
import { estimateTokens, estimateTotalTokens } from '../context';
import { callAI } from '../api';

// ---- Legacy types ----

/** @deprecated Use CompressionResult from './types' instead */
export interface LegacyCompressionResult {
  summary: string;
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
}

// Default compression config
const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  enabled: true,
  model: 'glm-4.7-flash',
  threshold: 0.8,
  keepRecent: 8,
  maxSummaryTokens: 1000,
  strategy: 'hybrid',
};

function buildCompressionPrompt(conversationText: string, originalTokens: number): string {
  const targetTokens = Math.max(200, Math.min(1000, Math.round(originalTokens * 0.25)));
  const targetChars = targetTokens * 2;

  return `请将以下对话历史压缩成简洁的摘要。

## 压缩要求

### 必须保留
- 用户的核心问题和最终需求
- 关键决定和结论
- 重要代码片段（保留关键部分，不超过 20 行）
- 工具调用的成功/失败结果
- 用户表达的偏好和修正

### 可以省略
- 重复的讨论和探索过程
- 无关闲聊
- 过长的工具输出详情
- 失败尝试的中间过程（只保留最终结论）

### 格式要求
- 按主题组织（不按时间流水账）
- 每个主题用简短要点描述
- 代码块保留关键部分
- **目标长度: 约 ${targetChars} 字（${targetTokens} tokens）**

## 对话历史

${conversationText}

## 压缩后的摘要`;
}

async function compressWithLLM(
  messages: ChatMessage[],
  provider: AIProvider,
  config: Partial<CompressionConfig> = {}
): Promise<LegacyCompressionResult> {
  const model = config.model || DEFAULT_COMPRESSION_CONFIG.model;
  const maxSummaryTokens = config.maxSummaryTokens || DEFAULT_COMPRESSION_CONFIG.maxSummaryTokens;
  const originalTokens = estimateTotalTokens(messages);

  if (originalTokens < 2000) {
    return { summary: '', originalTokens, compressedTokens: 0, compressionRatio: 1 };
  }

  const conversationText = formatMessagesForCompression(messages);
  const prompt = buildCompressionPrompt(conversationText, originalTokens);

  try {
    const response = await callAI({
      provider,
      model,
      messages: [
        { role: 'system', content: '你是对话压缩专家，擅长在大幅减少文本长度的同时保留关键信息和上下文。' },
        { role: 'user', content: prompt },
      ],
      maxTokens: maxSummaryTokens,
    });

    const summary = response.choices[0]?.message?.content || '';
    const compressedTokens = estimateTokens(summary);

    return { summary, originalTokens, compressedTokens, compressionRatio: compressedTokens / originalTokens };
  } catch (error) {
    console.error('[LLMCompressor] Compression failed:', error);
    throw error;
  }
}

function formatMessagesForCompression(messages: ChatMessage[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    const timestamp = (msg as any).timestamp ? `[${new Date((msg as any).timestamp).toLocaleTimeString()}] ` : '';
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
        lines.push(`\n### 工具结果 (${(msg as any).name || 'unknown'})`);
        lines.push(formatToolResult(msg.content, 300));
        break;
    }
  }
  return lines.join('\n');
}

function formatContent(content: string | any[]): string {
  if (!content) return '';
  if (typeof content === 'string') return content.length > 2000 ? content.slice(0, 2000) + '\n... [内容过长已截断]' : content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (part.type === 'text') return part.text;
      if (part.type === 'image_url') return '[图片]';
      return '[其他内容]';
    }).join('\n');
  }
  return String(content);
}

function formatToolResult(content: string | any[], maxLength: number = 300): string {
  if (!content) return '';
  let text: string;
  if (typeof content === 'string') { text = content; }
  else { text = JSON.stringify(content, null, 2); }
  try {
    const json = JSON.parse(text);
    if (json.success === false && json.error) return `错误: ${json.error}`;
    if (Array.isArray(json.data)) return `成功: ${json.data.length} 项数据\n预览: ${JSON.stringify(json.data.slice(0, 3))}`;
    if (typeof json.data === 'object') return `成功: 对象数据 (${Object.keys(json.data).join(', ')})`;
  } catch { /* not JSON */ }
  return text.length > maxLength ? text.slice(0, maxLength) + '... [已截断]' : text;
}

function selectCompressionStrategy(
  messages: ChatMessage[],
  currentTokens: number,
  maxTokens: number,
  config: Partial<CompressionConfig> = {}
): { strategy: 'llm' | 'rule' | 'none'; reason: string; targetMessages?: ChatMessage[] } {
  const threshold = config.threshold || DEFAULT_COMPRESSION_CONFIG.threshold;
  const strategy = config.strategy || DEFAULT_COMPRESSION_CONFIG.strategy;
  const utilization = currentTokens / maxTokens;

  if (utilization < threshold) return { strategy: 'none', reason: `Context under ${Math.round(threshold * 100)}% utilization` };
  if (strategy === 'rule') return { strategy: 'rule', reason: 'User configured rule-based strategy' };

  const hasCodeBlocks = messages.some(m => typeof m.content === 'string' && m.content.includes('```'));
  const hasToolCalls = messages.some(m => m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0);
  const messageCount = messages.length;

  if (messageCount < 5) return { strategy: 'rule', reason: 'Few messages, rule-based is sufficient' };
  if (strategy === 'llm') return { strategy: 'llm', reason: 'User configured LLM strategy', targetMessages: messages.slice(0, -6) };
  if (utilization > 0.9 && (hasCodeBlocks || hasToolCalls)) return { strategy: 'llm', reason: 'High utilization with important content', targetMessages: messages.slice(0, -4) };
  if (utilization > threshold && messageCount > 8) return { strategy: 'llm', reason: 'Many messages', targetMessages: messages.slice(0, -6) };
  return { strategy: 'rule', reason: 'Default to rule-based compression' };
}

function ruleBasedCompress(messages: ChatMessage[]): { summary: string } {
  const points: string[] = [];
  for (const msg of messages) {
    if (msg.role === 'user') {
      const content = typeof msg.content === 'string' ? msg.content : '';
      points.push(`用户问: ${content.length > 100 ? content.slice(0, 100) + '...' : content}`);
    } else if (msg.role === 'assistant') {
      const content = typeof msg.content === 'string' ? msg.content : '';
      const conclusions = content.match(/结论[是为：:]\s*(.+)/g);
      if (conclusions) points.push(...conclusions.slice(0, 2));
    }
  }
  return { summary: points.length > 0 ? `## 历史对话要点\n${points.slice(0, 10).join('\n')}` : '' };
}

/**
 * @deprecated Use compressMessages or ProgressiveCompactor instead.
 * Hybrid compressor that combines LLM and rule-based approaches.
 */
export async function hybridCompress(
  messages: ChatMessage[],
  provider: AIProvider,
  options: { maxTokens: number; currentTokens: number; config?: Partial<CompressionConfig> }
): Promise<{ summary: string; keptMessages: ChatMessage[]; compressionRatio: number; method: 'llm' | 'rule' | 'none' }> {
  const { maxTokens, currentTokens, config = {} } = options;
  const keepRecent = config.keepRecent || DEFAULT_COMPRESSION_CONFIG.keepRecent;
  const decision = selectCompressionStrategy(messages, currentTokens, maxTokens, config);

  if (decision.strategy === 'none') return { summary: '', keptMessages: messages, compressionRatio: 1, method: 'none' };

  const recentMessages = messages.slice(-keepRecent);
  const oldMessages = messages.slice(0, -keepRecent);

  if (oldMessages.length === 0) return { summary: '', keptMessages: messages, compressionRatio: 1, method: 'none' };

  if (decision.strategy === 'llm') {
    try {
      const result = await compressWithLLM(oldMessages, provider, config);
      return { summary: result.summary, keptMessages: recentMessages, compressionRatio: result.compressionRatio, method: 'llm' };
    } catch (_error) {
      console.warn('[HybridCompressor] LLM compression failed, falling back to rule-based');
    }
  }

  const { summary } = ruleBasedCompress(oldMessages);
  return { summary, keptMessages: recentMessages, compressionRatio: 0.5, method: 'rule' };
}
