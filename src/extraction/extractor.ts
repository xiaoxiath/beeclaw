/**
 * 知识提取器
 *
 * 使用 LLM 从对话中提取结构化知识
 */

import type { AIProvider } from '../config/schema';
import type { ChatMessage } from '../agent/types';
import { callAI } from '../agent/api';
import {
  EXTRACTION_PROMPT,
  INCREMENTAL_EXTRACTION_PROMPT,
  formatConversationForExtraction,
  parseExtractionResult,
  validateExtraction,
} from './prompt';
import {
  DEFAULT_EXTRACTION_CONFIG,
  type ExtractionConfig,
  type ExtractionItem,
  type ExtractedKnowledge,
} from './types';

export class KnowledgeExtractor {
  private config: ExtractionConfig;
  private provider: AIProvider;
  private model: string;

  constructor(
    provider: AIProvider,
    model: string,
    config: Partial<ExtractionConfig> = {}
  ) {
    this.provider = provider;
    this.model = model;
    this.config = { ...DEFAULT_EXTRACTION_CONFIG, ...config };
  }

  /**
   * 执行知识提取
   */
  async extract(
    messages: ChatMessage[],
    options?: {
      existingKnowledge?: ExtractedKnowledge[];
      incremental?: boolean;
    }
  ): Promise<ExtractionItem[]> {
    const { existingKnowledge = [], incremental = false } = options || {};

    // 1. 格式化对话
    const conversationText = formatConversationForExtraction(
      messages,
      8000  // max chars
    );

    if (!conversationText.trim()) {
      return [];
    }

    // 2. 构建提示词
    let prompt: string;
    if (incremental && existingKnowledge.length > 0) {
      prompt = this.buildIncrementalPrompt(conversationText, existingKnowledge);
    } else {
      prompt = EXTRACTION_PROMPT.replace('{conversation}', conversationText);
    }

    // 3. 调用 LLM
    try {
      console.log('[Extractor] Calling LLM for knowledge extraction...');

      const response = await callAI({
        provider: this.provider,
        model: this.model,
        messages: [
          {
            role: 'system',
            content: '你是一个知识提取专家，擅长从对话中识别和提取有价值的信息。',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,  // 较低温度，更稳定
        maxTokens: 2000,
      });

      const content = response.choices[0]?.message?.content || '';

      // 4. 解析结果
      const extractions = parseExtractionResult(content);

      // 5. 验证和过滤
      const validExtractions = extractions
        .filter(validateExtraction)
        .filter(item => item.confidence >= this.config.lowConfidenceThreshold)
        .slice(0, this.config.maxExtractionsPerRun);

      console.log(`[Extractor] Extracted ${validExtractions.length} items from ${messages.length} messages`);

      return validExtractions;
    } catch (error) {
      console.error('[Extractor] Extraction failed:', error);
      return [];
    }
  }

  /**
   * 增量提取
   */
  async extractIncremental(
    newMessages: ChatMessage[],
    existingKnowledge: ExtractedKnowledge[]
  ): Promise<ExtractionItem[]> {
    return this.extract(newMessages, {
      existingKnowledge,
      incremental: true,
    });
  }

  /**
   * 构建增量提取提示词
   */
  private buildIncrementalPrompt(
    conversationText: string,
    existingKnowledge: ExtractedKnowledge[]
  ): string {
    const existingText = existingKnowledge
      .map(k => `- ${k.category}/${k.key}: ${k.value} (置信度: ${k.confidence})`)
      .join('\n');

    return INCREMENTAL_EXTRACTION_PROMPT
      .replace('{existingKnowledge}', existingText || '暂无')
      .replace('{conversation}', conversationText)
      .replace('{outputFormat}', `输出 JSON 数组，格式同主提取提示词`);
  }

  /**
   * 检测敏感信息
   */
  detectSensitiveInfo(content: string): {
    hasSensitive: boolean;
    patterns: string[];
    shouldSkip: boolean;
  } {
    const detectedPatterns: string[] = [];

    // 检查配置的敏感模式
    for (const pattern of this.config.sensitivePatterns) {
      try {
        const regex = new RegExp(pattern, 'gi');
        if (regex.test(content)) {
          detectedPatterns.push(pattern);
        }
      } catch {
        // 无效正则，跳过
      }
    }

    // 额外的启发式检测
    const heuristicPatterns = [
      { pattern: /密码[是为：:]\s*\S+/gi, name: 'password' },
      { pattern: /密钥[是为：:]\s*\S+/gi, name: 'secret_key' },
      { pattern: /token[是为：:]\s*\S+/gi, name: 'token' },
      { pattern: /api[_-]?key[是为：:]\s*\S+/gi, name: 'api_key' },
      { pattern: /[a-zA-Z0-9]{32,}/g, name: 'long_hash' },
      { pattern: /-----BEGIN[^-]+-----/g, name: 'pem_key' },
    ];

    for (const { pattern, name } of heuristicPatterns) {
      if (pattern.test(content)) {
        detectedPatterns.push(name);
      }
    }

    return {
      hasSensitive: detectedPatterns.length > 0,
      patterns: [...new Set(detectedPatterns)],
      shouldSkip: detectedPatterns.length > 0,
    };
  }

  /**
   * 过滤敏感信息
   */
  filterSensitiveContent(content: string): string {
    let filtered = content;

    // 过滤密码
    filtered = filtered.replace(/密码[是为：:]\s*\S+/gi, '密码: [已过滤]');
    filtered = filtered.replace(/密钥[是为：:]\s*\S+/gi, '密钥: [已过滤]');
    filtered = filtered.replace(/token[是为：:]\s*\S+/gi, 'token: [已过滤]');
    filtered = filtered.replace(/api[_-]?key[是为：:]\s*\S+/gi, 'api_key: [已过滤]');

    // 过滤长哈希
    filtered = filtered.replace(/[a-zA-Z0-9]{32,}/g, '[已过滤]');

    // 过滤 PEM 格式
    filtered = filtered.replace(/-----BEGIN[^-]+-----[\s\S]*?-----END[^-]+-----/g, '[密钥已过滤]');

    return filtered;
  }

  /**
   * 转换为 ExtractedKnowledge
   */
  toItem(
    extraction: ExtractionItem,
    source: string
  ): ExtractedKnowledge {
    const now = new Date();
    return {
      id: `${extraction.category}_${extraction.key}_${Date.now()}`,
      category: extraction.category,
      key: extraction.key,
      value: extraction.value,
      confidence: extraction.confidence,
      source,
      timestamp: now,
      status: extraction.confidence >= this.config.confidenceThreshold
        ? 'confirmed'
        : 'pending',
    };
  }

  /**
   * 批量转换
   */
  toItems(
    extractions: ExtractionItem[],
    source: string
  ): ExtractedKnowledge[] {
    return extractions.map(e => this.toItem(e, source));
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ExtractionConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// 单例
let extractorInstance: KnowledgeExtractor | null = null;

export function getKnowledgeExtractor(
  provider?: AIProvider,
  model?: string,
  config?: Partial<ExtractionConfig>
): KnowledgeExtractor {
  if (!extractorInstance && provider && model) {
    extractorInstance = new KnowledgeExtractor(provider, model, config);
  }
  if (!extractorInstance) {
    throw new Error('KnowledgeExtractor not initialized. Call initKnowledgeExtractor first.');
  }
  return extractorInstance;
}

export function initKnowledgeExtractor(
  provider: AIProvider,
  model: string,
  config?: Partial<ExtractionConfig>
): KnowledgeExtractor {
  extractorInstance = new KnowledgeExtractor(provider, model, config);
  return extractorInstance;
}

export function resetKnowledgeExtractor(): void {
  extractorInstance = null;
}
