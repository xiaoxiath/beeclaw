/**
 * P3-#4: 系统提示词模板化引擎
 * 
 * 原始问题：tools.ts 中的 SYSTEM_PROMPTS 硬编码 concise/default/verbose 三个 tier，
 * 内容完全由 base.md / examples-verbose.md 拼接而成。getCurrentTimeContext() 里的
 * 日期格式、locale 也写死为 zh-CN。不支持多语言、多场景、多 persona 切换。
 * 
 * 优化方案：
 * 1. 提示词模板注册中心 — 支持注册任意数量的 prompt 模板
 * 2. 多维度选择器 — 按 locale / scenario / persona / tier 动态选择
 * 3. 变量插值引擎 — 支持 {{variable}} 占位符和条件段 {{#if}}...{{/if}}
 * 4. 提示词继承 — 模板可 extend 父模板，支持分层覆盖
 * 5. 外部加载 — 从文件系统或配置对象加载模板，不再写死在代码中
 * 
 * 使用方式：
 *   import { PromptRegistry, resolvePrompt } from './prompt-template';
 *   
 *   // 注册模板
 *   PromptRegistry.register({
 *     id: 'base-zh',
 *     locale: 'zh-CN',
 *     tier: 'default',
 *     template: '你是 {{agentName}}，一个智能助手...',
 *   });
 *   
 *   // 解析
 *   const prompt = resolvePrompt({ locale: 'zh-CN', tier: 'default' }, {
 *     agentName: 'BeeClaw',
 *     userName: '汤昊',
 *   });
 */

// ─── 类型定义 ─────────────────────────────────────────────

/** 提示词模板 */
export interface PromptTemplate {
  /** 模板唯一 ID */
  id: string;
  /** 语言/区域 */
  locale: string;
  /** 使用场景 */
  scenario?: string;
  /** Persona / 角色 */
  persona?: string;
  /** 提示词层级 */
  tier: 'concise' | 'default' | 'verbose' | string;
  /** 模板内容（支持 {{var}} 和 {{#if var}}...{{/if}} 语法） */
  template: string;
  /** 继承的父模板 ID */
  extends?: string;
  /** 模板描述 */
  description?: string;
  /** 优先级（数值越高优先级越高，同维度匹配时取高优先级） */
  priority?: number;
  /** 模板元数据 */
  metadata?: Record<string, unknown>;
}

/** 模板选择条件 */
export interface PromptSelector {
  locale?: string;
  scenario?: string;
  persona?: string;
  tier?: string;
}

/** 模板变量上下文 */
export interface PromptContext {
  [key: string]: string | number | boolean | string[] | undefined;
}

/** 时间上下文配置 */
export interface TimeContextConfig {
  locale: string;
  timezone?: string;
  location?: string;
  dateFormat?: Intl.DateTimeFormatOptions;
  timeFormat?: Intl.DateTimeFormatOptions;
  template?: string;
}

// ─── 默认时间上下文配置 ──────────────────────────────────────

const DEFAULT_TIME_CONFIGS: Record<string, TimeContextConfig> = {
  'zh-CN': {
    locale: 'zh-CN',
    dateFormat: { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' },
    timeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    template: '{{location}} | **日期**: {{date}} | **时间**: {{time}} | {{timezone}}',
  },
  'en-US': {
    locale: 'en-US',
    dateFormat: { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' },
    timeFormat: { hour: '2-digit', minute: '2-digit', hour12: true },
    template: '{{location}} | **Date**: {{date}} | **Time**: {{time}} | {{timezone}}',
  },
  'ja-JP': {
    locale: 'ja-JP',
    dateFormat: { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' },
    timeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    template: '{{location}} | **日付**: {{date}} | **時刻**: {{time}} | {{timezone}}',
  },
};

// ─── 模板变量插值引擎 ─────────────────────────────────────

/**
 * 简单模板插值引擎
 * 
 * 支持：
 *   - {{variable}} — 变量替换
 *   - {{#if variable}}...{{/if}} — 条件段（变量为 truthy 时保留）
 *   - {{#unless variable}}...{{/unless}} — 反向条件段
 *   - {{#each array}}...{{/each}} — 数组迭代（用 {{.}} 引用当前元素）
 */
export function interpolate(template: string, context: PromptContext): string {
  let result = template;

  // 处理 {{#each array}}...{{/each}}
  result = result.replace(
    /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_, key, body) => {
      const value = context[key];
      if (!Array.isArray(value)) return '';
      return value.map(item => body.replace(/\{\{\.\}\}/g, String(item))).join('');
    }
  );

  // 处理 {{#if variable}}...{{/if}}
  result = result.replace(
    /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, key, body) => {
      const value = context[key];
      return value ? body : '';
    }
  );

  // 处理 {{#unless variable}}...{{/unless}}
  result = result.replace(
    /\{\{#unless\s+(\w+)\}\}([\s\S]*?)\{\{\/unless\}\}/g,
    (_, key, body) => {
      const value = context[key];
      return !value ? body : '';
    }
  );

  // 处理 {{variable}}
  result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = context[key];
    if (value === undefined) return `{{${key}}}`;
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
  });

  // 清理多余的空行（连续超过 2 个）
  result = result.replace(/\n{3,}/g, '\n\n');

  return result;
}

// ─── 提示词模板注册中心 ──────────────────────────────────────

class PromptRegistryImpl {
  private templates: Map<string, PromptTemplate> = new Map();
  private timeConfigs: Map<string, TimeContextConfig> = new Map();

  constructor() {
    // 初始化默认时间配置
    for (const [locale, config] of Object.entries(DEFAULT_TIME_CONFIGS)) {
      this.timeConfigs.set(locale, config);
    }
  }

  /**
   * 注册提示词模板
   */
  register(template: PromptTemplate): void {
    this.templates.set(template.id, template);
  }

  /**
   * 批量注册
   */
  registerAll(templates: PromptTemplate[]): void {
    for (const t of templates) {
      this.register(t);
    }
  }

  /**
   * 注销模板
   */
  unregister(id: string): boolean {
    return this.templates.delete(id);
  }

  /**
   * 获取指定 ID 的模板
   */
  get(id: string): PromptTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * 按条件选择最佳匹配模板
   * 
   * 匹配规则（按优先级递减）：
   * 1. 精确匹配所有条件维度
   * 2. 匹配 locale + tier（忽略 scenario/persona）
   * 3. 匹配 tier（忽略 locale）
   * 4. 返回任意 'default' tier 模板
   * 
   * 同级别多个匹配时取 priority 最高者
   */
  select(selector: PromptSelector): PromptTemplate | null {
    const candidates = Array.from(this.templates.values());

    // 计算每个模板与 selector 的匹配度
    const scored = candidates.map(t => ({
      template: t,
      score: this.matchScore(t, selector),
    })).filter(s => s.score > 0);

    if (scored.length === 0) return null;

    // 按匹配度降序，同分按 priority 降序
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.template.priority || 0) - (a.template.priority || 0);
    });

    return scored[0].template;
  }

  /**
   * 列出所有注册的模板
   */
  list(filter?: Partial<PromptSelector>): PromptTemplate[] {
    let results = Array.from(this.templates.values());
    if (filter) {
      if (filter.locale) results = results.filter(t => t.locale === filter.locale);
      if (filter.scenario) results = results.filter(t => t.scenario === filter.scenario);
      if (filter.persona) results = results.filter(t => t.persona === filter.persona);
      if (filter.tier) results = results.filter(t => t.tier === filter.tier);
    }
    return results;
  }

  /**
   * 注册时间上下文配置
   */
  registerTimeConfig(locale: string, config: TimeContextConfig): void {
    this.timeConfigs.set(locale, config);
  }

  /**
   * 获取时间上下文配置
   */
  getTimeConfig(locale: string): TimeContextConfig | undefined {
    return this.timeConfigs.get(locale) || this.timeConfigs.get('en-US');
  }

  /**
   * 解析模板（含继承链）并插值
   */
  resolve(selector: PromptSelector, context: PromptContext = {}): string {
    const template = this.select(selector);
    if (!template) {
      return `[No prompt template found for: ${JSON.stringify(selector)}]`;
    }

    // 处理模板继承
    const resolvedTemplate = this.resolveInheritance(template);

    // 插值
    return interpolate(resolvedTemplate, context);
  }

  /**
   * 清除所有模板（测试用）
   */
  clear(): void {
    this.templates.clear();
    // 重新加载默认时间配置
    for (const [locale, config] of Object.entries(DEFAULT_TIME_CONFIGS)) {
      this.timeConfigs.set(locale, config);
    }
  }

  // ─── 内部方法 ──────────────────────────────────────────

  private matchScore(template: PromptTemplate, selector: PromptSelector): number {
    let score = 0;
    let requiredMatches = 0;
    let actualMatches = 0;

    // tier 是必须匹配的（如果指定了的话）
    if (selector.tier) {
      requiredMatches++;
      if (template.tier === selector.tier) {
        score += 10;
        actualMatches++;
      } else {
        return 0; // tier 不匹配则直接排除
      }
    }

    // locale 匹配
    if (selector.locale) {
      requiredMatches++;
      if (template.locale === selector.locale) {
        score += 8;
        actualMatches++;
      } else if (template.locale.split('-')[0] === selector.locale.split('-')[0]) {
        // 语言相同但区域不同（如 zh-CN vs zh-TW）
        score += 4;
        actualMatches++;
      }
    }

    // scenario 匹配
    if (selector.scenario) {
      requiredMatches++;
      if (template.scenario === selector.scenario) {
        score += 6;
        actualMatches++;
      } else if (!template.scenario) {
        // 模板未指定 scenario，视为通配
        score += 2;
      }
    }

    // persona 匹配
    if (selector.persona) {
      requiredMatches++;
      if (template.persona === selector.persona) {
        score += 6;
        actualMatches++;
      } else if (!template.persona) {
        score += 2;
      }
    }

    // 至少匹配一个维度
    if (requiredMatches > 0 && actualMatches === 0) return 0;

    // 没有指定任何 selector 条件时，给所有模板最低分
    if (requiredMatches === 0) return 1;

    return score;
  }

  private resolveInheritance(template: PromptTemplate): string {
    if (!template.extends) return template.template;

    const parent = this.templates.get(template.extends);
    if (!parent) {
      console.warn(`[PromptRegistry] Parent template "${template.extends}" not found for "${template.id}"`);
      return template.template;
    }

    // 递归解析父模板
    const parentContent = this.resolveInheritance(parent);

    // 子模板内容追加在父模板之后
    return `${parentContent}\n\n${template.template}`;
  }
}

/** 全局单例 */
export const PromptRegistry = new PromptRegistryImpl();

// ─── 便捷函数 ─────────────────────────────────────────────

/**
 * 解析提示词（PromptRegistry.resolve 的便捷包装）
 */
export function resolvePrompt(
  selector: PromptSelector,
  context?: PromptContext
): string {
  return PromptRegistry.resolve(selector, context);
}

/**
 * 生成可配置的时间上下文字符串
 * 
 * 替代原始 getCurrentTimeContext() 中硬编码的 zh-CN 格式
 */
export function getTimeContext(
  locale: string = 'zh-CN',
  options?: {
    timezone?: string;
    location?: string;
    version?: string;
  }
): string {
  const config = PromptRegistry.getTimeConfig(locale) || DEFAULT_TIME_CONFIGS['en-US'];

  const tz = options?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date();

  const dateStr = now.toLocaleDateString(config.locale, {
    ...config.dateFormat,
    timeZone: tz,
  });

  const timeStr = now.toLocaleTimeString(config.locale, {
    ...config.timeFormat,
    timeZone: tz,
  });

  const template = config.template || '{{location}} | **Date**: {{date}} | **Time**: {{time}} | {{timezone}}';

  const context: PromptContext = {
    date: dateStr,
    time: timeStr,
    timezone: `TZ: ${tz}`,
    location: options?.location ? `**Location**: ${options.location}` : '',
    version: options?.version || '',
  };

  let result = interpolate(template, context);

  // 追加版本信息
  if (options?.version) {
    result += ` | **BeeClaw**: v${options.version}`;
  }

  return result;
}

/**
 * 从文件系统批量加载提示词模板
 * 
 * 目录结构约定：
 *   prompts/
 *     zh-CN/
 *       default.md
 *       verbose.md
 *       concise.md
 *     en-US/
 *       default.md
 *       verbose.md
 */
export function loadPromptsFromDirectory(
  dirPath: string,
  options?: {
    scenario?: string;
    persona?: string;
  }
): number {
  const fs = require('fs');
  const path = require('path');

  if (!fs.existsSync(dirPath)) return 0;

  let count = 0;
  const locales = fs.readdirSync(dirPath).filter((d: string) =>
    fs.statSync(path.join(dirPath, d)).isDirectory()
  );

  for (const locale of locales) {
    const localePath = path.join(dirPath, locale);
    const files = fs.readdirSync(localePath).filter((f: string) => f.endsWith('.md'));

    for (const file of files) {
      const tier = path.basename(file, '.md');
      const content = fs.readFileSync(path.join(localePath, file), 'utf-8');

      PromptRegistry.register({
        id: `${locale}-${tier}${options?.scenario ? `-${options.scenario}` : ''}`,
        locale,
        tier,
        scenario: options?.scenario,
        persona: options?.persona,
        template: content,
      });
      count++;
    }
  }

  return count;
}

/**
 * 从配置对象加载提示词
 */
export function loadPromptsFromConfig(
  config: Array<{
    id: string;
    locale: string;
    tier: string;
    content: string;
    scenario?: string;
    persona?: string;
    extends?: string;
    priority?: number;
  }>
): void {
  for (const entry of config) {
    PromptRegistry.register({
      id: entry.id,
      locale: entry.locale,
      tier: entry.tier,
      template: entry.content,
      scenario: entry.scenario,
      persona: entry.persona,
      extends: entry.extends,
      priority: entry.priority,
    });
  }
}

// ─── 内置默认模板（兼容原始 SYSTEM_PROMPTS） ─────────────────

/**
 * 注册与原始 SYSTEM_PROMPTS 兼容的默认模板
 * 
 * 调用此函数可在不修改 base.md / examples-verbose.md 的前提下
 * 将已有提示词纳入模板注册中心管理
 */
export function registerLegacyPrompts(
  basePrompt: string,
  examplesVerbose: string = ''
): void {
  PromptRegistry.register({
    id: 'legacy-concise',
    locale: 'zh-CN',
    tier: 'concise',
    template: basePrompt,
    priority: 0,
    description: 'Legacy concise prompt (compatible with original SYSTEM_PROMPTS.concise)',
  });

  PromptRegistry.register({
    id: 'legacy-default',
    locale: 'zh-CN',
    tier: 'default',
    template: basePrompt,
    priority: 0,
    description: 'Legacy default prompt (compatible with original SYSTEM_PROMPTS.default)',
  });

  if (examplesVerbose) {
    PromptRegistry.register({
      id: 'legacy-verbose',
      locale: 'zh-CN',
      tier: 'verbose',
      template: `${basePrompt}\n\n---\n\n${examplesVerbose}`,
      priority: 0,
      description: 'Legacy verbose prompt (compatible with original SYSTEM_PROMPTS.verbose)',
    });
  }
}
