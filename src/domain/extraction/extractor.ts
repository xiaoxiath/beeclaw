/**
 * Knowledge Extractor - FastLLMJudge-based knowledge extraction
 *
 * Uses FastLLMJudge for intelligent knowledge extraction from conversations
 */

import { getFastLLMJudge } from '../agent/fast-llm-judge';
import type { AIProvider } from '../../infra/config/schema';
import type { ChatMessage } from '../agent/types';
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

/**
 * Extraction prompt for FastLLMJudge
 */
const EXTRACTION_JUDGE_PROMPT = `You are a knowledge extraction specialist. Extract structured knowledge from the given conversation.

## Conversation

{conversation}

## Existing Knowledge (for incremental extraction)

{existingKnowledge}

## Extraction Rules

1. **Categories**: Use appropriate categories:
   - user_info: Personal information, preferences
   - project: Project details, requirements
   - technical: Technical decisions, architecture
   - process: Workflows, processes
   - domain: Domain-specific knowledge
   - preference: User preferences, habits
   - fact: General facts and information

2. **Quality Criteria**:
   - Only extract clear, actionable information
   - Avoid redundant or duplicate knowledge
   - Confidence should reflect certainty (0.0-1.0)
   - Skip sensitive information (passwords, API keys, etc.)

3. **Output Format**: Return ONLY valid JSON

## Output

{outputFormat}

Important: Return ONLY the JSON array, no markdown code blocks.`;

/**
 * Knowledge Extractor using FastLLMJudge
 */
export class KnowledgeExtractor {
  private config: ExtractionConfig;
  private provider: AIProvider;
  private model: string;
  private stats = {
    totalExtractions: 0,
    successfulExtractions: 0,
    errors: 0,
  };

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
   * Execute knowledge extraction
   */
  async extract(
    messages: ChatMessage[],
    options?: {
      existingKnowledge?: ExtractedKnowledge[];
      incremental?: boolean;
    }
  ): Promise<ExtractionItem[]> {
    const { existingKnowledge = [], incremental = false } = options || {};

    this.stats.totalExtractions++;

    // 1. Format conversation
    const conversationText = formatConversationForExtraction(
      messages,
      8000  // max chars
    );

    if (!conversationText.trim()) {
      return [];
    }

    // 2. Get FastLLMJudge instance
    const judge = getFastLLMJudge(this.provider, this.model, {
      cacheEnabled: false, // Don't cache extraction results
      cacheSize: 0,
      defaultTimeout: 10000, // 10s for extraction
    });

    // 3. Build prompt variables
    const existingText = existingKnowledge.length > 0
      ? existingKnowledge
          .map(k => `- ${k.category}/${k.key}: ${k.value} (confidence: ${k.confidence})`)
          .join('\n')
      : 'None';

    const outputFormat = `{
  "extractions": [
    {
      "category": "project",
      "key": "project-name",
      "value": "Project description or value",
      "confidence": 0.9,
      "source": "conversation"
    }
  ]
}`;

    // 4. Execute judgment
    const result = await judge.judge<ExtractionItem[]>({
      taskName: incremental ? 'incremental-extraction' : 'knowledge-extraction',
      promptTemplate: EXTRACTION_JUDGE_PROMPT,
      promptVariables: {
        conversation: conversationText,
        existingKnowledge: existingText,
        outputFormat,
      },
      validateOutput: (output) => {
        // Parse extractions
        const extractions = parseExtractionResult(JSON.stringify(output));

        // Validate and filter
        const validExtractions = extractions
          .filter(validateExtraction)
          .filter(item => item.confidence >= this.config.lowConfidenceThreshold)
          .slice(0, this.config.maxExtractionsPerRun);

        return validExtractions.length > 0 ? validExtractions : null;
      },
      defaultValue: [],
    });

    if (result.failed) {
      this.stats.errors++;
      console.error('[Extractor] Extraction failed:', result.error);
      return [];
    }

    this.stats.successfulExtractions++;
    console.log(`[Extractor] Extracted ${result.result.length} items from ${messages.length} messages`);

    return result.result;
  }

  /**
   * Incremental extraction
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
   * Detect sensitive information
   */
  detectSensitiveInfo(content: string): {
    hasSensitive: boolean;
    patterns: string[];
    shouldSkip: boolean;
  } {
    const detectedPatterns: string[] = [];

    // Check configured sensitive patterns
    for (const pattern of this.config.sensitivePatterns) {
      try {
        const regex = new RegExp(pattern, 'gi');
        if (regex.test(content)) {
          detectedPatterns.push(pattern);
        }
      } catch {
        // Invalid regex, skip
      }
    }

    return {
      hasSensitive: detectedPatterns.length > 0,
      patterns: detectedPatterns,
      shouldSkip: detectedPatterns.length > 0 && this.config.skipSensitiveContent,
    };
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.totalExtractions > 0
        ? (this.stats.successfulExtractions / this.stats.totalExtractions * 100).toFixed(1) + '%'
        : '0%',
    };
  }
}

/**
 * Create knowledge extractor
 */
export function createKnowledgeExtractor(
  provider: AIProvider,
  model: string,
  config?: Partial<ExtractionConfig>
): KnowledgeExtractor {
  return new KnowledgeExtractor(provider, model, config);
}

// ---------------------------------------------------------------------------
// 单例模式（向后兼容）
// ---------------------------------------------------------------------------

let extractorInstance: KnowledgeExtractor | null = null;

/**
 * 初始化知识提取器
 */
export function initKnowledgeExtractor(
  provider: AIProvider,
  model: string,
  config?: Partial<ExtractionConfig>
): KnowledgeExtractor {
  extractorInstance = new KnowledgeExtractor(provider, model, config);
  return extractorInstance;
}

/**
 * 获取知识提取器实例
 */
export function getKnowledgeExtractor(): KnowledgeExtractor {
  if (!extractorInstance) {
    throw new Error('KnowledgeExtractor not initialized. Call initKnowledgeExtractor first.');
  }
  return extractorInstance;
}

/**
 * 重置知识提取器
 */
export function resetKnowledgeExtractor(): void {
  extractorInstance = null;
}
