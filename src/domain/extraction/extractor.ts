/**
 * Knowledge Extractor - FastLLMJudge-based knowledge extraction
 *
 * Uses FastLLMJudge for intelligent knowledge extraction from conversations
 */

import { logger } from '../../infra/observability/logger';
import { getFastLLMJudge } from '../agent/fast-llm-judge';
import type { AIProvider } from '../../infra/config/schema';
import type { ChatMessage } from '../agent/types';
import {
  formatConversationForExtraction,
  parseExtractionResult,
  validateExtraction,
} from './prompt';
import {
  DEFAULT_EXTRACTION_CONFIG,
  type ExtractionConfig,
  type ExtractionItem,
  type ExtractedKnowledge,
  type KnowledgeCategory,
} from './types';


/**
 * Map LLM-returned category names to valid KnowledgeCategory values.
 * The LLM prompt uses simplified/different category names that need normalization.
 */
const CATEGORY_MAP: Record<string, KnowledgeCategory> = {
  // Direct matches (already valid)
  personal: 'personal',
  family: 'family',
  work: 'work',
  finance: 'finance',
  preferences: 'preferences',
  events: 'events',
  lessons: 'lessons',
  goals: 'goals',
  relationships: 'relationships',
  skills: 'skills',
  decisions: 'decisions',
  health: 'health',
  // LLM prompt aliases → valid KnowledgeCategory
  user_info: 'personal',
  preference: 'preferences',
  fact: 'personal',
  project: 'work',
  technical: 'work',
  process: 'work',
  domain: 'skills',
};

function normalizeCategory(category: string): KnowledgeCategory {
  const normalized = CATEGORY_MAP[category.toLowerCase()];
  return normalized || 'personal'; // fallback to 'personal' for unknown categories
}

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
  private stats = {
    totalExtractions: 0,
    successfulExtractions: 0,
    errors: 0,
  };

  constructor(
    provider: AIProvider,
    _model: string,
    config: Partial<ExtractionConfig> = {}
  ) {
    this.provider = provider;
    this.config = { ...DEFAULT_EXTRACTION_CONFIG, ...config };
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(config: Partial<ExtractionConfig>): void {
    this.config = { ...this.config, ...config };
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
    const judge = getFastLLMJudge(this.provider, {
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

        // Normalize categories from LLM output to valid KnowledgeCategory values,
        // then validate and filter
        const validExtractions = extractions
          .map(item => ({ ...item, category: normalizeCategory(item.category) }))
          .filter(validateExtraction)
          .filter(item => item.confidence >= this.config.lowConfidenceThreshold)
          .slice(0, this.config.maxExtractionsPerRun);

        return validExtractions.length > 0 ? validExtractions : null;
      },
      defaultValue: [],
    });

    if (result.failed) {
      this.stats.errors++;
      logger.error('[Extractor] Extraction failed:', result.error);
      return [];
    }

    this.stats.successfulExtractions++;
    logger.debug(`[Extractor] Extracted ${result.result.length} items from ${messages.length} messages`);

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
   * Convert ExtractionItem[] to ExtractedKnowledge[]
   */
  toItems(extractions: ExtractionItem[], source: string): ExtractedKnowledge[] {
    return extractions.map(item => ({
      id: this.generateId(),
      category: item.category,
      key: item.key,
      value: item.value,
      confidence: item.confidence,
      source: source,
      timestamp: new Date(),
      status: 'confirmed' as const,
      context: item.reason, // Use reason as context
    }));
  }

  /**
   * Generate UUID
   */
  private generateId(): string {
    return 'ext-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
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
