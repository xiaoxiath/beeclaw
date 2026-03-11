/**
 * P3-#15: 对话分析与反思引擎
 * 
 * 原始问题：Agent 只将对话记录到 MemoryStore 并生成 summary 用于节省 token，
 * 但不会从历史对话中分析行为模式、识别改进点。recordSkillFailure() 记录了
 * 技能失败但无后续分析。
 * 
 * 优化方案：
 * 1. 对话模式识别 — 统计分析用户问题类型、工具使用频率、成功率
 * 2. 反思 Pipeline — 定期生成 lessons learned 并注入 system prompt
 * 3. 策略更新 — 根据失败模式调整工具选择偏好
 * 4. 行为报告 — 生成可读的对话行为分析报告
 * 5. LLM 反思 — 可选的 LLM 深度反思（识别隐含模式）
 */

// ─── 类型定义 ─────────────────────────────────────────────

/** 对话模式 */
export interface ConversationPattern {
  /** 模式 ID */
  id: string;
  /** 模式类型 */
  type: 'recurring_query' | 'tool_preference' | 'failure_pattern' | 'efficiency' | 'user_behavior';
  /** 描述 */
  description: string;
  /** 出现频率 */
  frequency: number;
  /** 置信度 (0-1) */
  confidence: number;
  /** 相关数据 */
  evidence: Array<{ source: string; excerpt: string; timestamp?: number }>;
  /** 建议的改进措施 */
  suggestion?: string;
}

/** 反思结果 */
export interface ReflectionResult {
  /** 生成时间 */
  timestamp: string;
  /** 分析周期 */
  period: { from: string; to: string };
  /** 发现的模式 */
  patterns: ConversationPattern[];
  /** 生成的 lessons learned */
  lessons: string[];
  /** 策略更新建议 */
  strategyUpdates: StrategyUpdate[];
  /** 统计摘要 */
  stats: ConversationStats;
}

/** 策略更新 */
export interface StrategyUpdate {
  /** 更新类型 */
  type: 'tool_preference' | 'prompt_adjustment' | 'skill_recommendation' | 'behavior_change';
  /** 描述 */
  description: string;
  /** 具体调整 */
  action: string;
  /** 优先级 */
  priority: 'high' | 'medium' | 'low';
  /** 基于的证据 */
  basedOn: string;
}

/** 对话统计 */
export interface ConversationStats {
  /** 总对话轮次 */
  totalTurns: number;
  /** 总工具调用次数 */
  totalToolCalls: number;
  /** 工具成功率 */
  toolSuccessRate: number;
  /** 平均每次对话轮次 */
  avgTurnsPerSession: number;
  /** 最常用工具 TOP5 */
  topTools: Array<{ name: string; count: number; successRate: number }>;
  /** 最常见问题类型 */
  topQueryTypes: Array<{ type: string; count: number }>;
  /** 技能使用分布 */
  skillUsage: Array<{ name: string; count: number; failCount: number }>;
  /** 时间分布 */
  timeDistribution: Record<string, number>; // hour -> count
}

/** 反思引擎配置 */
export interface ReflectionConfig {
  /** 分析的最大对话数 */
  maxConversations: number;
  /** 模式检测最小频率阈值 */
  minPatternFrequency: number;
  /** 置信度阈值 */
  minConfidence: number;
  /** 是否使用 LLM 深度反思 */
  useLLMReflection: boolean;
  /** LLM 提供者 */
  llmProvider?: {
    generate(prompt: string, options?: { maxTokens?: number; temperature?: number }): Promise<string>;
  };
}

/** 对话记录（简化输入格式） */
export interface ConversationRecord {
  timestamp: string;
  userMessage: string;
  assistantMessage: string;
  toolsCalled?: Array<{ name: string; success: boolean; latencyMs?: number }>;
  skillTriggered?: string;
  tokensUsed?: number;
  metadata?: Record<string, unknown>;
}

// ─── 默认配置 ──────────────────────────────────────────────

const DEFAULT_CONFIG: ReflectionConfig = {
  maxConversations: 200,
  minPatternFrequency: 3,
  minConfidence: 0.5,
  useLLMReflection: false,
};

// ─── 核心实现 ─────────────────────────────────────────────

/**
 * 对话反思引擎
 */
export class ReflectionEngine {
  private config: ReflectionConfig;
  private failureLog: Array<{
    skillName: string;
    context: string;
    timestamp: number;
  }> = [];

  constructor(config: Partial<ReflectionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 记录技能失败（增强版 recordSkillFailure）
   */
  recordFailure(skillName: string, context: string): void {
    this.failureLog.push({
      skillName,
      context,
      timestamp: Date.now(),
    });

    // 限制日志大小
    if (this.failureLog.length > 500) {
      this.failureLog = this.failureLog.slice(-500);
    }
  }

  /**
   * 执行反思分析
   */
  async reflect(conversations: ConversationRecord[]): Promise<ReflectionResult> {
    const limited = conversations.slice(-this.config.maxConversations);

    // 统计分析
    const stats = this.computeStats(limited);

    // 模式检测
    const patterns = this.detectPatterns(limited, stats);

    // 生成 lessons
    const lessons = this.generateLessons(patterns, stats);

    // 策略更新
    const strategyUpdates = this.generateStrategyUpdates(patterns, stats);

    // 可选 LLM 深度反思
    if (this.config.useLLMReflection && this.config.llmProvider) {
      const llmPatterns = await this.llmReflect(limited, stats);
      patterns.push(...llmPatterns);
    }

    const timestamps = limited.map(c => new Date(c.timestamp).getTime()).filter(t => !isNaN(t));

    return {
      timestamp: new Date().toISOString(),
      period: {
        from: timestamps.length > 0 ? new Date(Math.min(...timestamps)).toISOString() : 'unknown',
        to: timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : 'unknown',
      },
      patterns,
      lessons,
      strategyUpdates,
      stats,
    };
  }

  /**
   * 生成可注入 system prompt 的反思摘要
   */
  async generateReflectionPrompt(conversations: ConversationRecord[]): Promise<string> {
    const result = await this.reflect(conversations);

    const sections: string[] = [];

    if (result.lessons.length > 0) {
      sections.push('## 历史经验教训\n' + result.lessons.map((l, i) => `${i + 1}. ${l}`).join('\n'));
    }

    if (result.strategyUpdates.length > 0) {
      const highPriority = result.strategyUpdates.filter(s => s.priority === 'high');
      if (highPriority.length > 0) {
        sections.push(
          '## 策略调整\n' +
          highPriority.map(s => `- **${s.type}**: ${s.action}`).join('\n')
        );
      }
    }

    const topFailTools = result.stats.topTools.filter(t => t.successRate < 0.7);
    if (topFailTools.length > 0) {
      sections.push(
        '## 工具使用注意\n' +
        topFailTools.map(t =>
          `- ${t.name}: 成功率 ${(t.successRate * 100).toFixed(0)}%，请谨慎使用`
        ).join('\n')
      );
    }

    return sections.join('\n\n');
  }

  // ─── 统计分析 ──────────────────────────────────────────

  private computeStats(conversations: ConversationRecord[]): ConversationStats {
    const toolCallMap: Record<string, { total: number; success: number }> = {};
    const queryTypes: Record<string, number> = {};
    const skillMap: Record<string, { total: number; fail: number }> = {};
    const hourDist: Record<string, number> = {};
    let totalToolCalls = 0;
    let successToolCalls = 0;

    for (const conv of conversations) {
      // 时间分布
      try {
        const hour = new Date(conv.timestamp).getHours().toString();
        hourDist[hour] = (hourDist[hour] || 0) + 1;
      } catch { /* ignore */ }

      // 工具统计
      if (conv.toolsCalled) {
        for (const tool of conv.toolsCalled) {
          if (!toolCallMap[tool.name]) toolCallMap[tool.name] = { total: 0, success: 0 };
          toolCallMap[tool.name].total++;
          totalToolCalls++;
          if (tool.success) {
            toolCallMap[tool.name].success++;
            successToolCalls++;
          }
        }
      }

      // 技能统计
      if (conv.skillTriggered) {
        if (!skillMap[conv.skillTriggered]) skillMap[conv.skillTriggered] = { total: 0, fail: 0 };
        skillMap[conv.skillTriggered].total++;
      }

      // 问题类型分类
      const qType = this.classifyQuery(conv.userMessage);
      queryTypes[qType] = (queryTypes[qType] || 0) + 1;
    }

    // 合并失败日志中的技能统计
    for (const failure of this.failureLog) {
      if (!skillMap[failure.skillName]) skillMap[failure.skillName] = { total: 0, fail: 0 };
      skillMap[failure.skillName].fail++;
    }

    const topTools = Object.entries(toolCallMap)
      .map(([name, data]) => ({
        name,
        count: data.total,
        successRate: data.total > 0 ? data.success / data.total : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const topQueryTypes = Object.entries(queryTypes)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    const skillUsage = Object.entries(skillMap)
      .map(([name, data]) => ({
        name,
        count: data.total,
        failCount: data.fail,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      totalTurns: conversations.length,
      totalToolCalls,
      toolSuccessRate: totalToolCalls > 0 ? successToolCalls / totalToolCalls : 1,
      avgTurnsPerSession: conversations.length, // 单会话分析时等于总轮次
      topTools,
      topQueryTypes,
      skillUsage,
      timeDistribution: hourDist,
    };
  }

  // ─── 模式检测 ──────────────────────────────────────────

  private detectPatterns(
    conversations: ConversationRecord[],
    stats: ConversationStats
  ): ConversationPattern[] {
    const patterns: ConversationPattern[] = [];

    // 1. 重复查询检测
    patterns.push(...this.detectRecurringQueries(conversations));

    // 2. 工具偏好模式
    patterns.push(...this.detectToolPreferences(stats));

    // 3. 失败模式
    patterns.push(...this.detectFailurePatterns(conversations, stats));

    // 4. 效率模式
    patterns.push(...this.detectEfficiencyPatterns(conversations));

    // 过滤低频/低置信度模式
    return patterns.filter(
      p => p.frequency >= this.config.minPatternFrequency && p.confidence >= this.config.minConfidence
    );
  }

  private detectRecurringQueries(conversations: ConversationRecord[]): ConversationPattern[] {
    const patterns: ConversationPattern[] = [];

    // 简单的关键词聚类
    const queryGroups: Record<string, ConversationRecord[]> = {};
    for (const conv of conversations) {
      const key = this.extractQuerySignature(conv.userMessage);
      if (!queryGroups[key]) queryGroups[key] = [];
      queryGroups[key].push(conv);
    }

    for (const [signature, group] of Object.entries(queryGroups)) {
      if (group.length >= this.config.minPatternFrequency) {
        patterns.push({
          id: `recurring_${signature}`,
          type: 'recurring_query',
          description: `用户反复询问关于「${signature}」的问题（${group.length} 次）`,
          frequency: group.length,
          confidence: Math.min(group.length / 5, 1),
          evidence: group.slice(0, 3).map(g => ({
            source: g.timestamp,
            excerpt: g.userMessage.substring(0, 80),
          })),
          suggestion: `考虑为「${signature}」创建专用技能或将关键信息写入事实库`,
        });
      }
    }

    return patterns;
  }

  private detectToolPreferences(stats: ConversationStats): ConversationPattern[] {
    const patterns: ConversationPattern[] = [];

    // 高频工具
    for (const tool of stats.topTools) {
      if (tool.count >= 10) {
        patterns.push({
          id: `tool_pref_${tool.name}`,
          type: 'tool_preference',
          description: `${tool.name} 是最常用的工具（${tool.count} 次，成功率 ${(tool.successRate * 100).toFixed(0)}%）`,
          frequency: tool.count,
          confidence: 0.8,
          evidence: [{ source: 'stats', excerpt: `${tool.count} calls, ${(tool.successRate * 100).toFixed(0)}% success` }],
        });
      }
    }

    // 低成功率工具
    for (const tool of stats.topTools) {
      if (tool.count >= 5 && tool.successRate < 0.5) {
        patterns.push({
          id: `tool_fail_${tool.name}`,
          type: 'failure_pattern',
          description: `${tool.name} 成功率偏低（${(tool.successRate * 100).toFixed(0)}%），可能需要调整使用方式`,
          frequency: tool.count,
          confidence: 0.7,
          evidence: [{ source: 'stats', excerpt: `${tool.count - Math.round(tool.count * tool.successRate)} failures` }],
          suggestion: `审查 ${tool.name} 的调用参数和使用场景，考虑替代方案`,
        });
      }
    }

    return patterns;
  }

  private detectFailurePatterns(
    conversations: ConversationRecord[],
    _stats: ConversationStats
  ): ConversationPattern[] {
    const patterns: ConversationPattern[] = [];

    // 技能失败模式
    const skillFailures: Record<string, number> = {};
    for (const failure of this.failureLog) {
      skillFailures[failure.skillName] = (skillFailures[failure.skillName] || 0) + 1;
    }

    for (const [skill, count] of Object.entries(skillFailures)) {
      if (count >= this.config.minPatternFrequency) {
        patterns.push({
          id: `skill_fail_${skill}`,
          type: 'failure_pattern',
          description: `技能「${skill}」频繁失败（${count} 次）`,
          frequency: count,
          confidence: Math.min(count / 3, 1),
          evidence: this.failureLog
            .filter(f => f.skillName === skill)
            .slice(0, 3)
            .map(f => ({
              source: new Date(f.timestamp).toISOString(),
              excerpt: f.context.substring(0, 80),
            })),
          suggestion: `审查技能「${skill}」的实现，考虑重写或标记为不可用`,
        });
      }
    }

    // 连续多轮无工具调用（可能在闲聊或 Agent 无法理解需求）
    let noToolStreak = 0;
    for (const conv of conversations) {
      if (!conv.toolsCalled || conv.toolsCalled.length === 0) {
        noToolStreak++;
      } else {
        noToolStreak = 0;
      }
    }
    if (noToolStreak >= 5) {
      patterns.push({
        id: 'no_tool_streak',
        type: 'efficiency',
        description: `最近 ${noToolStreak} 轮对话未使用任何工具`,
        frequency: noToolStreak,
        confidence: 0.6,
        evidence: [],
        suggestion: '检查是否有适合的工具未被发现，或用户需求已超出 Agent 能力范围',
      });
    }

    return patterns;
  }

  private detectEfficiencyPatterns(conversations: ConversationRecord[]): ConversationPattern[] {
    const patterns: ConversationPattern[] = [];

    // 长时间对话（Token 消耗过高）
    const highTokenConvs = conversations.filter(c => (c.tokensUsed || 0) > 3000);
    if (highTokenConvs.length >= 3) {
      patterns.push({
        id: 'high_token_usage',
        type: 'efficiency',
        description: `${highTokenConvs.length} 次对话 Token 消耗超过 3000`,
        frequency: highTokenConvs.length,
        confidence: 0.7,
        evidence: highTokenConvs.slice(0, 3).map(c => ({
          source: c.timestamp,
          excerpt: `${c.tokensUsed} tokens: ${c.userMessage.substring(0, 50)}`,
        })),
        suggestion: '考虑优化上下文管理策略，或将复杂任务拆分为多步骤',
      });
    }

    return patterns;
  }

  // ─── 生成 Lessons & 策略 ──────────────────────────────────

  private generateLessons(patterns: ConversationPattern[], stats: ConversationStats): string[] {
    const lessons: string[] = [];

    // 从模式中提取 lessons
    for (const pattern of patterns) {
      if (pattern.suggestion) {
        lessons.push(pattern.suggestion);
      }
    }

    // 基于统计生成通用 lessons
    if (stats.toolSuccessRate < 0.7) {
      lessons.push(`工具总体成功率为 ${(stats.toolSuccessRate * 100).toFixed(0)}%，需要提高工具调用的准确性`);
    }

    if (stats.topQueryTypes.length > 0) {
      const topType = stats.topQueryTypes[0];
      lessons.push(`用户最常提出「${topType.type}」类型的问题（${topType.count} 次），可针对此类型优化响应`);
    }

    return lessons.slice(0, 10); // 最多 10 条
  }

  private generateStrategyUpdates(
    patterns: ConversationPattern[],
    stats: ConversationStats
  ): StrategyUpdate[] {
    const updates: StrategyUpdate[] = [];

    // 失败工具 → 调整偏好
    for (const pattern of patterns.filter(p => p.type === 'failure_pattern')) {
      const toolMatch = pattern.id.match(/tool_fail_(\w+)/);
      if (toolMatch) {
        updates.push({
          type: 'tool_preference',
          description: `降低 ${toolMatch[1]} 的使用优先级`,
          action: `在工具选择时，若有替代方案，优先选择其他工具而非 ${toolMatch[1]}`,
          priority: 'high',
          basedOn: pattern.description,
        });
      }
    }

    // 重复查询 → 技能推荐
    for (const pattern of patterns.filter(p => p.type === 'recurring_query')) {
      updates.push({
        type: 'skill_recommendation',
        description: `为重复问题创建自动化技能`,
        action: `建议创建处理「${pattern.id.replace('recurring_', '')}」的自动化技能`,
        priority: 'medium',
        basedOn: pattern.description,
      });
    }

    // 效率问题 → 行为调整
    for (const pattern of patterns.filter(p => p.type === 'efficiency')) {
      updates.push({
        type: 'behavior_change',
        description: `效率优化建议`,
        action: pattern.suggestion || '审查对话流程，减少不必要的交互',
        priority: 'low',
        basedOn: pattern.description,
      });
    }

    return updates;
  }

  // ─── LLM 反思 ──────────────────────────────────────────

  private async llmReflect(
    conversations: ConversationRecord[],
    stats: ConversationStats
  ): Promise<ConversationPattern[]> {
    if (!this.config.llmProvider) return [];

    const summary = [
      `对话统计：${stats.totalTurns} 轮对话，${stats.totalToolCalls} 次工具调用`,
      `工具成功率：${(stats.toolSuccessRate * 100).toFixed(0)}%`,
      `最常用工具：${stats.topTools.map(t => `${t.name}(${t.count}次)`).join('、')}`,
      `最近 5 轮对话：`,
      ...conversations.slice(-5).map(c => `  用户: ${c.userMessage.substring(0, 80)}`),
    ].join('\n');

    const prompt = `分析以下 AI Agent 的对话行为，识别隐含的模式和改进机会。

${summary}

请以 JSON 数组格式返回发现的模式，每个元素包含：
- description: 模式描述
- suggestion: 改进建议
- confidence: 置信度 (0-1)

只返回 JSON 数组，不要其他内容。`;

    try {
      const response = await this.config.llmProvider.generate(prompt, {
        maxTokens: 500,
        temperature: 0.5,
      });

      const parsed = JSON.parse(response.match(/\[[\s\S]*\]/)?.[0] || '[]');
      return parsed.map((p: { description: string; suggestion: string; confidence: number }, i: number) => ({
        id: `llm_pattern_${i}`,
        type: 'user_behavior' as const,
        description: p.description,
        frequency: 1,
        confidence: p.confidence || 0.5,
        evidence: [],
        suggestion: p.suggestion,
      }));
    } catch {
      return [];
    }
  }

  // ─── 工具函数 ──────────────────────────────────────────

  private classifyQuery(message: string): string {
    const lower = message.toLowerCase();
    if (lower.match(/如何|怎么|how|what.*do/)) return '方法指导';
    if (lower.match(/为什么|why|原因/)) return '原因分析';
    if (lower.match(/帮我|请|could you|please/)) return '任务执行';
    if (lower.match(/是什么|什么是|what is|define/)) return '概念解释';
    if (lower.match(/对比|比较|compare|vs/)) return '对比分析';
    if (lower.match(/修复|fix|bug|error|错误|报错/)) return '问题修复';
    if (lower.match(/优化|improve|performance|性能/)) return '优化建议';
    if (lower.match(/写|write|create|生成|创建/)) return '内容生成';
    return '其他';
  }

  private extractQuerySignature(message: string): string {
    // 提取前 2-3 个关键词作为签名
    const words = message
      .replace(/[^\u4e00-\u9fff\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 1)
      .slice(0, 3);
    return words.join('_') || 'unknown';
  }
}

// ─── 便捷工厂 ──────────────────────────────────────────────

let defaultEngine: ReflectionEngine | null = null;

export function getReflectionEngine(config?: Partial<ReflectionConfig>): ReflectionEngine {
  if (!defaultEngine || config) {
    defaultEngine = new ReflectionEngine(config);
  }
  return defaultEngine;
}
