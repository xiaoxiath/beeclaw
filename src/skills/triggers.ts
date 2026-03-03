/**
 * Skill Trigger System
 *
 * 增强版技能触发规则系统
 * 支持：关键词、正则、意图检测、组合触发、链式调用
 */

import type { Skill } from './types';

// ============================================================================
// 触发器类型定义
// ============================================================================

export type TriggerType = 'keyword' | 'regex' | 'intent' | 'llm' | 'composite' | 'scheduled';

export interface BaseTrigger {
  type: TriggerType;
  priority: number;  // 优先级，越高越先匹配
  enabled: boolean;
}

export interface KeywordTrigger extends BaseTrigger {
  type: 'keyword';
  keywords: string[];
  matchAll?: boolean;  // true = 所有关键词都要匹配
  caseSensitive?: boolean;
}

export interface RegexTrigger extends BaseTrigger {
  type: 'regex';
  pattern: string;
  flags?: string;
}

export interface IntentTrigger extends BaseTrigger {
  type: 'intent';
  intents: string[];  // 例如：['create', 'update', 'delete', 'search']
  confidence?: number; // 置信度阈值
}

export interface LLMTrigger extends BaseTrigger {
  type: 'llm';
  prompt: string;  // 用于 LLM 判断的提示
  model?: string;  // 可选指定模型
}

export interface CompositeTrigger extends BaseTrigger {
  type: 'composite';
  operator: 'and' | 'or' | 'not';
  triggers: Trigger[];
}

export interface ScheduledTrigger extends BaseTrigger {
  type: 'scheduled';
  cron: string;  // cron 表达式
  timezone?: string;
}

export type Trigger =
  | KeywordTrigger
  | RegexTrigger
  | IntentTrigger
  | LLMTrigger
  | CompositeTrigger
  | ScheduledTrigger;

// ============================================================================
// 技能链定义
// ============================================================================

export interface SkillChain {
  name: string;
  description: string;
  skills: Array<{
    name: string;
    condition?: (context: TriggerContext) => boolean;
    timeout?: number;
  }>;
  orchestration: 'sequential' | 'parallel' | 'conditional';
  stopOnFailure: boolean;
}

// ============================================================================
// 触发上下文
// ============================================================================

export interface TriggerContext {
  message: string;
  userId?: string;
  sessionId?: string;
  channel?: string;
  history?: Array<{ role: string; content: string }>;
  metadata?: Record<string, unknown>;
}

export interface TriggerResult {
  skillName: string;
  confidence: number;
  matchedTrigger: Trigger;
  extractedParams?: Record<string, unknown>;
}

// ============================================================================
// 触发器匹配器
// ============================================================================

export class TriggerMatcher {
  /**
   * 匹配关键词触发器
   */
  matchKeyword(trigger: KeywordTrigger, context: TriggerContext): { matched: boolean; confidence: number } {
    const message = trigger.caseSensitive ? context.message : context.message.toLowerCase();
    const keywords = trigger.caseSensitive
      ? trigger.keywords
      : trigger.keywords.map(k => k.toLowerCase());

    if (trigger.matchAll) {
      const matched = keywords.every(kw => message.includes(kw));
      return { matched, confidence: matched ? 1.0 : 0 };
    } else {
      const matchedCount = keywords.filter(kw => message.includes(kw)).length;
      const confidence = keywords.length > 0 ? matchedCount / keywords.length : 0;
      return { matched: matchedCount > 0, confidence };
    }
  }

  /**
   * 匹配正则触发器
   */
  matchRegex(trigger: RegexTrigger, context: TriggerContext): { matched: boolean; confidence: number; params?: Record<string, unknown> } {
    try {
      const regex = new RegExp(trigger.pattern, trigger.flags || 'i');
      const match = context.message.match(regex);

      if (match) {
        // 提取命名捕获组作为参数
        const params: Record<string, unknown> = {};
        if (match.groups) {
          Object.assign(params, match.groups);
        }

        return { matched: true, confidence: 1.0, params };
      }
    } catch (error) {
      console.error('[TriggerMatcher] Invalid regex:', trigger.pattern, error);
    }

    return { matched: false, confidence: 0 };
  }

  /**
   * 匹配意图触发器
   */
  matchIntent(trigger: IntentTrigger, context: TriggerContext): { matched: boolean; confidence: number } {
    const message = context.message.toLowerCase();

    // 简单的意图检测（基于关键词）
    const intentPatterns: Record<string, string[]> = {
      create: ['创建', '新建', '添加', 'create', 'add', 'new'],
      update: ['更新', '修改', '编辑', 'update', 'modify', 'edit'],
      delete: ['删除', '移除', 'delete', 'remove'],
      search: ['搜索', '查找', '寻找', 'search', 'find', 'look'],
      analyze: ['分析', '评估', 'analyze', 'evaluate'],
      summarize: ['总结', '摘要', 'summarize', 'summary'],
      translate: ['翻译', 'translate'],
      explain: ['解释', '说明', 'explain', 'describe'],
    };

    for (const intent of trigger.intents) {
      const patterns = intentPatterns[intent] || [intent];
      const matched = patterns.some(p => message.includes(p));
      if (matched) {
        return { matched: true, confidence: trigger.confidence ?? 0.8 };
      }
    }

    return { matched: false, confidence: 0 };
  }

  /**
   * 匹配组合触发器
   */
  matchComposite(trigger: CompositeTrigger, context: TriggerContext): { matched: boolean; confidence: number } {
    const results = trigger.triggers.map(t => this.match(t, context));
    const confidences = results.map(r => r.confidence);

    switch (trigger.operator) {
      case 'and':
        return {
          matched: results.every(r => r.matched),
          confidence: results.every(r => r.matched)
            ? confidences.reduce((a, b) => a * b, 1)
            : 0,
        };

      case 'or':
        return {
          matched: results.some(r => r.matched),
          confidence: Math.max(...confidences),
        };

      case 'not':
        return {
          matched: !results[0]?.matched,
          confidence: results[0]?.matched ? 0 : 1,
        };

      default:
        return { matched: false, confidence: 0 };
    }
  }

  /**
   * 通用匹配方法
   */
  match(trigger: Trigger, context: TriggerContext): { matched: boolean; confidence: number; params?: Record<string, unknown> } {
    if (!trigger.enabled) {
      return { matched: false, confidence: 0 };
    }

    switch (trigger.type) {
      case 'keyword':
        return this.matchKeyword(trigger, context);

      case 'regex':
        return this.matchRegex(trigger, context);

      case 'intent':
        return this.matchIntent(trigger, context);

      case 'composite':
        return this.matchComposite(trigger, context);

      case 'llm':
        // LLM 触发需要异步处理，这里返回 false
        return { matched: false, confidence: 0 };

      case 'scheduled':
        // 定时触发器不通过消息匹配
        return { matched: false, confidence: 0 };

      default:
        return { matched: false, confidence: 0 };
    }
  }
}

// ============================================================================
// 技能触发引擎
// ============================================================================

export class SkillTriggerEngine {
  private matcher: TriggerMatcher;
  private skillTriggers: Map<string, Trigger[]> = new Map();
  private chains: Map<string, SkillChain> = new Map();
  private llmEvaluator: ((prompt: string, context: TriggerContext) => Promise<boolean>) | null = null;

  constructor() {
    this.matcher = new TriggerMatcher();
  }

  /**
   * 设置 LLM 评估器
   */
  setLLMEvaluator(evaluator: (prompt: string, context: TriggerContext) => Promise<boolean>): void {
    this.llmEvaluator = evaluator;
  }

  /**
   * 注册技能触发器
   */
  registerSkillTriggers(skillName: string, triggers: Trigger[]): void {
    // 按优先级排序
    const sorted = [...triggers].sort((a, b) => b.priority - a.priority);
    this.skillTriggers.set(skillName, sorted);
  }

  /**
   * 注册技能链
   */
  registerChain(chain: SkillChain): void {
    this.chains.set(chain.name, chain);
  }

  /**
   * 从技能定义加载触发器
   */
  loadFromSkill(skill: Skill): void {
    const triggers: Trigger[] = [];

    // 解析 tags 作为关键词触发器
    if (skill.tags.length > 0) {
      triggers.push({
        type: 'keyword',
        keywords: skill.tags,
        priority: 5,
        enabled: true,
      } as KeywordTrigger);
    }

    // 解析 triggers 字段
    for (const triggerStr of skill.triggers) {
      // 检查是否是正则表达式（以 / 开头和结尾）
      if (triggerStr.startsWith('/') && triggerStr.endsWith('/')) {
        const pattern = triggerStr.slice(1, -1);
        triggers.push({
          type: 'regex',
          pattern,
          priority: 8,
          enabled: true,
        } as RegexTrigger);
      }
      // 检查是否是意图（以 @ 开头）
      else if (triggerStr.startsWith('@')) {
        const intent = triggerStr.slice(1);
        triggers.push({
          type: 'intent',
          intents: [intent],
          priority: 7,
          enabled: true,
        } as IntentTrigger);
      }
      // 默认作为关键词
      else {
        triggers.push({
          type: 'keyword',
          keywords: [triggerStr],
          priority: 5,
          enabled: true,
        } as KeywordTrigger);
      }
    }

    this.registerSkillTriggers(skill.name, triggers);
  }

  /**
   * 匹配最佳技能
   */
  async matchBest(
    context: TriggerContext,
    options?: {
      maxResults?: number;
      minConfidence?: number;
      excludeSkills?: string[];
    },
  ): Promise<TriggerResult[]> {
    const results: TriggerResult[] = [];
    const maxResults = options?.maxResults ?? 3;
    const minConfidence = options?.minConfidence ?? 0.3;
    const excludeSkills = new Set(options?.excludeSkills || []);

    for (const [skillName, triggers] of this.skillTriggers.entries()) {
      if (excludeSkills.has(skillName)) continue;

      for (const trigger of triggers) {
        // 处理 LLM 触发器
        if (trigger.type === 'llm' && this.llmEvaluator) {
          try {
            const matched = await this.llmEvaluator(trigger.prompt, context);
            if (matched) {
              results.push({
                skillName,
                confidence: trigger.priority / 10,
                matchedTrigger: trigger,
              });
            }
          } catch (error) {
            console.error('[SkillTriggerEngine] LLM evaluation failed:', error);
          }
          continue;
        }

        // 常规匹配
        const matchResult = this.matcher.match(trigger, context);

        if (matchResult.matched && matchResult.confidence >= minConfidence) {
          results.push({
            skillName,
            confidence: matchResult.confidence * (trigger.priority / 10),
            matchedTrigger: trigger,
            extractedParams: matchResult.params,
          });
          break; // 每个技能只取第一个匹配的触发器
        }
      }
    }

    // 按置信度排序并返回 top N
    return results
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxResults);
  }

  /**
   * 获取技能链
   */
  getChain(name: string): SkillChain | undefined {
    return this.chains.get(name);
  }

  /**
   * 列出所有技能链
   */
  listChains(): SkillChain[] {
    return Array.from(this.chains.values());
  }

  /**
   * 清除所有触发器
   */
  clear(): void {
    this.skillTriggers.clear();
    this.chains.clear();
  }
}

// ============================================================================
// 预定义触发器模板
// ============================================================================

export const TriggerTemplates = {
  // 日期时间相关
  datePattern: (): RegexTrigger => ({
    type: 'regex',
    pattern: '(\\d{4}[-/]\\d{1,2}[-/]\\d{1,2})|(今天|明天|后天|昨天|前天)',
    priority: 5,
    enabled: true,
  }),

  // 时间相关
  timePattern: (): RegexTrigger => ({
    type: 'regex',
    pattern: '(\\d{1,2}:\\d{2})|(上午|下午|晚上|早上|中午)',
    priority: 5,
    enabled: true,
  }),

  // 股票代码
  stockPattern: (): RegexTrigger => ({
    type: 'regex',
    pattern: '([0-9]{6}|sh[0-9]{6}|sz[0-9]{6}|\\$[A-Z]+)',
    priority: 6,
    enabled: true,
  }),

  // URL
  urlPattern: (): RegexTrigger => ({
    type: 'regex',
    pattern: 'https?://[^\\s]+',
    priority: 5,
    enabled: true,
  }),

  // 邮箱
  emailPattern: (): RegexTrigger => ({
    type: 'regex',
    pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}',
    priority: 5,
    enabled: true,
  }),

  // 创建意图
  createIntent: (): IntentTrigger => ({
    type: 'intent',
    intents: ['create'],
    priority: 7,
    enabled: true,
  }),

  // 搜索意图
  searchIntent: (): IntentTrigger => ({
    type: 'intent',
    intents: ['search'],
    priority: 7,
    enabled: true,
  }),

  // 分析意图
  analyzeIntent: (): IntentTrigger => ({
    type: 'intent',
    intents: ['analyze'],
    priority: 7,
    enabled: true,
  }),
};

// ============================================================================
// 单例
// ============================================================================

let triggerEngine: SkillTriggerEngine | null = null;

export function getSkillTriggerEngine(): SkillTriggerEngine {
  if (!triggerEngine) {
    triggerEngine = new SkillTriggerEngine();
  }
  return triggerEngine;
}

export function resetSkillTriggerEngine(): void {
  if (triggerEngine) {
    triggerEngine.clear();
  }
  triggerEngine = null;
}
