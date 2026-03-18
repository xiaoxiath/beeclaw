/**
 * LLM-based Skill Matcher
 *
 * 使用 FastLLMJudge 进行语义化的技能匹配，提高命中率
 */

import type { Skill } from './types';
import { getFastLLMJudge } from '../agent/fast-llm-judge';
import type { AIProvider } from '../../infra/config/schema';

export interface LLMMatchConfig {
  /** 是否启用 LLM 匹配 */
  enabled: boolean;
  /** 候选技能数量（从关键词过滤后） */
  maxCandidates: number;
  /** 返回的 top K 个技能 */
  topK: number;
  /** 缓存 TTL（秒） */
  cacheTTL: number;
  /** 最小置信度阈值 */
  minConfidence: number;
}

export interface LLMMatchResult {
  skill: string;
  confidence: number;
  reason: string;
}

export interface LLMMatcherOptions {
  provider: AIProvider;
  fastModel: string;
  config?: Partial<LLMMatchConfig>;
}

const DEFAULT_CONFIG: LLMMatchConfig = {
  enabled: true,
  maxCandidates: 15,
  topK: 5,
  cacheTTL: 3600,
  minConfidence: 0.3,
};

const SKILL_MATCHING_PROMPT = `You are a skill matching assistant. Given a user query and a list of available skills, select the top {topK} most relevant skills.

User Query: "{query}"

Available Skills:
{skills}

Instructions:
1. Analyze the user's intent and requirements
2. Match skills based on semantic meaning, not just keywords
3. Consider synonyms and related concepts
4. Return JSON with the top {topK} matches

Return ONLY valid JSON in this exact format:
{{
  "matches": [
    {{
      "skill": "exact-skill-name",
      "confidence": 0.95,
      "reason": "Brief explanation of why this skill matches"
    }}
  ]
}}

Important:
- Use exact skill names from the list
- Confidence should be between 0 and 1
- Only include skills with confidence >= {minConfidence}
- Return empty "matches" array if no good matches found`;

/**
 * LLM 技能匹配器
 */
export class LLMSkillMatcher {
  private provider: AIProvider;
  private fastModel: string;
  private config: LLMMatchConfig;
  private stats = {
    totalMatches: 0,
    llmCalls: 0,
    errors: 0,
  };

  constructor(options: LLMMatcherOptions) {
    this.provider = options.provider;
    this.fastModel = options.fastModel;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
  }

  /**
   * 使用 LLM 进行语义匹配
   */
  async match(
    query: string,
    candidates: Skill[]
  ): Promise<LLMMatchResult[]> {
    if (!this.config.enabled || candidates.length === 0) {
      return [];
    }

    this.stats.totalMatches++;

    // 限制候选数量
    const limitedCandidates = candidates.slice(0, this.config.maxCandidates);

    // Get FastLLMJudge instance
    const judge = getFastLLMJudge(this.provider, this.fastModel, {
      cacheEnabled: true,
      cacheSize: 50,
      defaultTimeout: 5000,
    });

    // Build skill list
    const skillList = limitedCandidates.map((skill, index) => {
      const triggers = skill.triggers.slice(0, 5).join(', ');
      const tags = skill.tags.slice(0, 5).join(', ');
      return `${index + 1}. **${skill.name}**: ${skill.description}\n   - Triggers: ${triggers || 'none'}\n   - Tags: ${tags || 'none'}`;
    }).join('\n\n');

    // Execute judgment
    const result = await judge.judge<LLMMatchResult[]>({
      taskName: 'skill-matching',
      promptTemplate: SKILL_MATCHING_PROMPT,
      promptVariables: {
        query,
        skills: skillList,
        topK: this.config.topK,
        minConfidence: this.config.minConfidence,
      },
      validateOutput: (output) => {
        if (!output.matches || !Array.isArray(output.matches)) {
          return null;
        }

        // Validate and filter
        const validMatches = output.matches
          .filter((m: any) => {
            return (
              typeof m.skill === 'string' &&
              typeof m.confidence === 'number' &&
              m.confidence >= this.config.minConfidence
            );
          })
          .slice(0, this.config.topK)
          .map((m: any) => ({
            skill: m.skill,
            confidence: m.confidence,
            reason: m.reason || 'Semantic match',
          }));

        return validMatches.length > 0 ? validMatches : null;
      },
      defaultValue: [],
      cacheTTL: this.config.cacheTTL * 1000, // Convert to ms
    });

    if (result.failed) {
      this.stats.errors++;
      console.warn('[LLMSkillMatcher] Judgment failed:', result.error);
    } else {
      this.stats.llmCalls++;
    }

    return result.result;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
    };
  }
}

/**
 * 创建 LLM 技能匹配器
 */
export function createLLMSkillMatcher(options: LLMMatcherOptions): LLMSkillMatcher {
  return new LLMSkillMatcher(options);
}
