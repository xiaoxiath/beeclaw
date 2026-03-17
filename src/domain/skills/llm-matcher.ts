/**
 * LLM-based Skill Matcher
 *
 * 使用 LLM 进行语义化的技能匹配，提高命中率
 */

import type { Skill } from './types';

export interface LLMMatchConfig {
  /** 是否启用 LLM 匹配 */
  enabled: boolean;
  /** 候选技能数量（从关键词过滤后） */
  maxCandidates: number;
  /** 返回的 top K 个技能 */
  topK: number;
  /** LLM 调用超时（毫秒） */
  timeout: number;
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
  provider: {
    chat: (messages: Array<{ role: string; content: string }>, options?: any) => Promise<any>;
  };
  config?: Partial<LLMMatchConfig>;
}

const DEFAULT_CONFIG: LLMMatchConfig = {
  enabled: true,
  maxCandidates: 15,
  topK: 5,
  timeout: 5000,
  cacheTTL: 3600,
  minConfidence: 0.3,
};

/**
 * LLM 技能匹配器
 */
export class LLMSkillMatcher {
  private provider: LLMMatcherOptions['provider'];
  private config: LLMMatchConfig;
  private cache: Map<string, { result: LLMMatchResult[]; timestamp: number }> = new Map();

  constructor(options: LLMMatcherOptions) {
    this.provider = options.provider;
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

    // 检查缓存
    const cacheKey = this.getCacheKey(query, candidates);
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.config.cacheTTL * 1000) {
      return cached.result;
    }

    // 限制候选数量
    const limitedCandidates = candidates.slice(0, this.config.maxCandidates);

    // 构建 prompt
    const prompt = this.buildPrompt(query, limitedCandidates);

    try {
      // 调用 LLM（带超时）
      const response = await this.callLLMWithTimeout(prompt);

      // 解析结果
      const matches = this.parseResponse(response);

      // 缓存结果
      this.cache.set(cacheKey, { result: matches, timestamp: Date.now() });

      return matches;
    } catch (error) {
      console.error('[LLMSkillMatcher] LLM matching failed:', error);
      // 降级：返回空结果，由调用者决定是否回退到关键词匹配
      return [];
    }
  }

  /**
   * 构建 LLM prompt
   */
  private buildPrompt(query: string, candidates: Skill[]): string {
    const skillList = candidates.map((skill, index) => {
      const triggers = skill.triggers.slice(0, 5).join(', ');
      const tags = skill.tags.slice(0, 5).join(', ');
      return `${index + 1}. **${skill.name}**: ${skill.description}\n   - Triggers: ${triggers || 'none'}\n   - Tags: ${tags || 'none'}`;
    }).join('\n\n');

    return `You are a skill matching assistant. Given a user query and a list of available skills, select the top ${this.config.topK} most relevant skills.

User Query: "${query}"

Available Skills:
${skillList}

Instructions:
1. Analyze the user's intent and requirements
2. Match skills based on semantic meaning, not just keywords
3. Consider synonyms and related concepts
4. Return JSON with the top ${this.config.topK} matches

Return ONLY valid JSON in this exact format:
{
  "matches": [
    {
      "skill": "exact-skill-name",
      "confidence": 0.95,
      "reason": "Brief explanation of why this skill matches"
    }
  ]
}

Important:
- Use exact skill names from the list
- Confidence should be between 0 and 1
- Only include skills with confidence >= ${this.config.minConfidence}
- Return empty "matches" array if no good matches found`;
  }

  /**
   * 调用 LLM（带超时）
   */
  private async callLLMWithTimeout(prompt: string): Promise<string> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('LLM timeout')), this.config.timeout);
    });

    const llmPromise = this.provider.chat([
      { role: 'system', content: 'You are a precise skill matching assistant. Always return valid JSON.' },
      { role: 'user', content: prompt },
    ], {
      temperature: 0.3, // 低温度，更确定性
      max_tokens: 500,
    });

    const response = await Promise.race([llmPromise, timeoutPromise]);

    // 提取内容（兼容不同 provider 的响应格式）
    if (response.choices?.[0]?.message?.content) {
      return response.choices[0].message.content;
    }
    if (response.content) {
      return response.content;
    }

    throw new Error('Invalid LLM response format');
  }

  /**
   * 解析 LLM 响应
   */
  private parseResponse(response: string): LLMMatchResult[] {
    try {
      // 提取 JSON（可能被 markdown 包裹）
      let jsonStr = response;

      // 尝试提取 markdown 代码块中的 JSON
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }

      // 解析 JSON
      const parsed = JSON.parse(jsonStr);

      if (!parsed.matches || !Array.isArray(parsed.matches)) {
        return [];
      }

      // 验证和过滤
      return parsed.matches
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
    } catch (error) {
      console.error('[LLMSkillMatcher] Failed to parse response:', error, response);
      return [];
    }
  }

  /**
   * 生成缓存 key
   */
  private getCacheKey(query: string, candidates: Skill[]): string {
    const candidateNames = candidates.map(s => s.name).sort().join(',');
    return `${query}::${candidateNames}`;
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): { size: number; hitRate: number } {
    // TODO: 实现命中率统计
    return {
      size: this.cache.size,
      hitRate: 0,
    };
  }
}

/**
 * 创建 LLM 技能匹配器
 */
export function createLLMSkillMatcher(options: LLMMatcherOptions): LLMSkillMatcher {
  return new LLMSkillMatcher(options);
}
