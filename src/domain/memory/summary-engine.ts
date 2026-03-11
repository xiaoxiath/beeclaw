/**
 * P3-#12: LLM 辅助摘要引擎
 * 
 * 原始问题：compression.ts 中的 generateSummary() 和 extractKeyFacts()
 * 完全基于正则匹配和字符串截取，无法理解内容语义。而 Agent 层的
 * compressContextWithLLM() 已经有 LLM 压缩能力，但记忆压缩模块未集成。
 * 
 * 优化方案：
 * 1. LLM 摘要提供者接口 — 可插拔的 AI 摘要后端
 * 2. 分层摘要策略 — 短对话规则摘要，长对话 LLM 摘要
 * 3. 结构化信息提取 — 用 LLM 从对话中提取事实、决策、待办
 * 4. 增量摘要 — 支持将新对话合并到已有摘要
 * 5. 规则兜底 — LLM 不可用时自动降级到增强版规则摘要
 */

// ─── 类型定义 ─────────────────────────────────────────────

/** LLM 摘要提供者 */
export interface SummaryLLMProvider {
  /** 调用 LLM 生成文本 */
  generate(prompt: string, options?: {
    maxTokens?: number;
    temperature?: number;
    model?: string;
  }): Promise<string>;
  /** Provider 名称 */
  name: string;
}

/** 摘要结果 */
export interface SummaryResult {
  /** 摘要文本 */
  summary: string;
  /** 提取的关键事实 */
  keyFacts: string[];
  /** 提取的决策 */
  decisions: string[];
  /** 提取的待办事项 */
  todos: string[];
  /** 参与话题 */
  topics: string[];
  /** 使用的策略（llm / rule） */
  strategy: 'llm' | 'rule' | 'hybrid';
  /** 原始内容 Token 数（估计） */
  originalTokens: number;
  /** 摘要 Token 数（估计） */
  summaryTokens: number;
  /** 压缩比 */
  compressionRatio: number;
}

/** 摘要引擎配置 */
export interface SummaryEngineConfig {
  /** LLM 摘要阈值（超过此 Token 数才使用 LLM） */
  llmThresholdTokens: number;
  /** 最大摘要 Token 数 */
  maxSummaryTokens: number;
  /** LLM 摘要超时（毫秒） */
  llmTimeoutMs: number;
  /** 是否在 LLM 失败时降级到规则 */
  fallbackToRules: boolean;
  /** 摘要语言 */
  language: 'zh' | 'en' | 'auto';
  /** 摘要风格 */
  style: 'concise' | 'detailed' | 'bullet-points';
  /** 自定义 LLM prompt 模板 */
  promptTemplate?: string;
}

// ─── 默认配置 ──────────────────────────────────────────────

const DEFAULT_CONFIG: SummaryEngineConfig = {
  llmThresholdTokens: 500,
  maxSummaryTokens: 300,
  llmTimeoutMs: 30000,
  fallbackToRules: true,
  language: 'auto',
  style: 'concise',
};

// ─── Provider 管理 ─────────────────────────────────────────

let currentLLMProvider: SummaryLLMProvider | null = null;

/** 注册 LLM 摘要提供者 */
export function setSummaryLLMProvider(provider: SummaryLLMProvider): void {
  currentLLMProvider = provider;
}

/** 获取当前 LLM 提供者 */
export function getSummaryLLMProvider(): SummaryLLMProvider | null {
  return currentLLMProvider;
}

// ─── Prompt 模板 ──────────────────────────────────────────

const SUMMARY_PROMPTS: Record<string, string> = {
  'zh-concise': `请对以下对话内容进行精炼摘要，用中文回答。

要求：
1. **摘要**：用 2-3 句话概括对话核心内容
2. **关键事实**：提取对话中出现的重要信息/知识点（最多 5 条）
3. **决策**：提取对话中做出的关键决定（如有）
4. **待办**：提取对话中提到需要后续跟进的事项（如有）
5. **话题**：用关键词标注对话涉及的话题（3-5 个）

请严格按以下 JSON 格式输出（不要添加其他内容）：
{
  "summary": "摘要内容",
  "keyFacts": ["事实1", "事实2"],
  "decisions": ["决策1"],
  "todos": ["待办1"],
  "topics": ["话题1", "话题2"]
}

对话内容：
---
{{content}}
---`,

  'en-concise': `Please summarize the following conversation.

Requirements:
1. **Summary**: Summarize the core content in 2-3 sentences
2. **Key Facts**: Extract important information/knowledge (max 5)
3. **Decisions**: Extract key decisions made (if any)
4. **Todos**: Extract follow-up items mentioned (if any)
5. **Topics**: Tag topics with keywords (3-5)

Output STRICTLY in this JSON format (no other content):
{
  "summary": "summary text",
  "keyFacts": ["fact1", "fact2"],
  "decisions": ["decision1"],
  "todos": ["todo1"],
  "topics": ["topic1", "topic2"]
}

Conversation:
---
{{content}}
---`,

  'zh-detailed': `请对以下对话进行详细分析和总结，用中文回答。

要求：
1. **摘要**：详细描述对话的完整脉络，包括起因、经过和结论（5-10 句话）
2. **关键事实**：详细列出对话中出现的所有重要信息，每条信息需要足够具体
3. **决策**：列出所有决策，包含决策的背景和理由
4. **待办**：列出所有需要跟进的事项，包含优先级和截止时间（如有提及）
5. **话题**：用关键词标注对话涉及的所有话题

请严格按以下 JSON 格式输出：
{
  "summary": "详细摘要",
  "keyFacts": ["详细事实1", "详细事实2"],
  "decisions": ["决策及理由1"],
  "todos": ["待办事项1（优先级/截止时间）"],
  "topics": ["话题1", "话题2"]
}

对话内容：
---
{{content}}
---`,

  'zh-incremental': `以下是一段对话的已有摘要和新增内容。请将新内容合并到已有摘要中。

已有摘要：
{{existingSummary}}

新增对话内容：
---
{{content}}
---

请输出更新后的完整摘要（JSON 格式）：
{
  "summary": "更新后的摘要",
  "keyFacts": ["合并后的所有事实"],
  "decisions": ["合并后的所有决策"],
  "todos": ["合并后的所有待办"],
  "topics": ["合并后的所有话题"]
}`,
};

// ─── Token 估算 ──────────────────────────────────────────

function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars * 1.5 + otherChars * 0.25);
}

// ─── 规则摘要引擎（增强版） ──────────────────────────────────

/**
 * 增强版规则摘要
 * 比原始 compression.ts 的 generateSummary() 更完善
 */
function ruleSummarize(content: string, language: 'zh' | 'en'): SummaryResult {
  const lines = content.split('\n');
  const originalTokens = estimateTokens(content);

  // 提取对话轮次
  const turns: Array<{ role: 'user' | 'assistant'; text: string }> = [];
  for (const line of lines) {
    if (line.startsWith('**用户**：') || line.startsWith('**User**:')) {
      turns.push({ role: 'user', text: line.replace(/^\*\*(用户|User)\*\*[：:]\s*/, '') });
    } else if (line.startsWith('**助手**：') || line.startsWith('**Assistant**:')) {
      turns.push({ role: 'assistant', text: line.replace(/^\*\*(助手|Assistant)\*\*[：:]\s*/, '') });
    }
  }

  // 摘要：取用户的主要问题 + 助手的关键回答
  const userQuestions = turns.filter(t => t.role === 'user').map(t => {
    return t.text.length > 100 ? t.text.substring(0, 100) + '...' : t.text;
  });
  const summary = language === 'zh'
    ? `共 ${turns.length} 轮对话。用户主要讨论：${userQuestions.slice(0, 3).join('；')}`
    : `${turns.length} turns. User discussed: ${userQuestions.slice(0, 3).join('; ')}`;

  // 关键事实提取（增强模式匹配）
  const keyFacts: string[] = [];
  const factPatterns = [
    /(?:\*\*)?(?:关键决策|决策|Decision)(?:\*\*)?[：:]\s*(.+)/,
    /(?:\*\*)?(?:重要|Important|注意|Note)(?:\*\*)?[：:]\s*(.+)/,
    /(?:\*\*)?(?:结论|Conclusion|总结|Summary)(?:\*\*)?[：:]\s*(.+)/,
    /(?:\*\*)?(?:发现|Found|确认|Confirmed)(?:\*\*)?[：:]\s*(.+)/,
  ];
  for (const line of lines) {
    for (const pattern of factPatterns) {
      const match = line.match(pattern);
      if (match && keyFacts.length < 5) {
        keyFacts.push(match[1].trim());
      }
    }
  }

  // 决策提取
  const decisions: string[] = [];
  const decisionPatterns = [
    /决定(?:了|：|:)\s*(.+)/,
    /(?:chose|decided|selected)\s+(.+)/i,
    /采用(?:了)?\s*(.+?)(?:方案|策略|方法)/,
  ];
  for (const line of lines) {
    for (const pattern of decisionPatterns) {
      const match = line.match(pattern);
      if (match && decisions.length < 3) {
        decisions.push(match[1].trim());
      }
    }
  }

  // 待办提取
  const todos: string[] = [];
  const todoPatterns = [
    /(?:TODO|待办|需要|要做)[：:]\s*(.+)/,
    /(?:下一步|接下来|后续)[：:]\s*(.+)/,
    /(?:remember to|need to|should)\s+(.+)/i,
  ];
  for (const line of lines) {
    for (const pattern of todoPatterns) {
      const match = line.match(pattern);
      if (match && todos.length < 3) {
        todos.push(match[1].trim());
      }
    }
  }

  // 话题提取
  const topics: string[] = [];
  if (content.includes('代码') || content.includes('code') || content.includes('编程')) topics.push('编程');
  if (content.includes('部署') || content.includes('deploy')) topics.push('部署');
  if (content.includes('调试') || content.includes('debug') || content.includes('错误')) topics.push('调试');
  if (content.includes('设计') || content.includes('design') || content.includes('架构')) topics.push('设计');
  if (content.includes('测试') || content.includes('test')) topics.push('测试');
  if (content.includes('文档') || content.includes('document')) topics.push('文档');
  if (content.includes('性能') || content.includes('performance') || content.includes('优化')) topics.push('性能优化');
  if (topics.length === 0) topics.push('通用对话');

  const summaryTokens = estimateTokens(summary + keyFacts.join(' ') + decisions.join(' '));

  return {
    summary,
    keyFacts,
    decisions,
    todos,
    topics: topics.slice(0, 5),
    strategy: 'rule',
    originalTokens,
    summaryTokens,
    compressionRatio: originalTokens > 0 ? summaryTokens / originalTokens : 1,
  };
}

// ─── LLM 摘要引擎 ──────────────────────────────────────────

/**
 * 使用 LLM 生成摘要
 */
async function llmSummarize(
  content: string,
  config: SummaryEngineConfig,
  existingSummary?: string
): Promise<SummaryResult> {
  if (!currentLLMProvider) {
    throw new Error('No LLM provider configured');
  }

  const originalTokens = estimateTokens(content);

  // 选择 prompt 模板
  const lang = config.language === 'auto'
    ? (content.match(/[\u4e00-\u9fff]/g)?.length || 0) > content.length * 0.1 ? 'zh' : 'en'
    : config.language;

  let promptKey: string;
  if (existingSummary) {
    promptKey = `${lang}-incremental`;
  } else {
    promptKey = `${lang}-${config.style}`;
  }

  let promptTemplate = config.promptTemplate || SUMMARY_PROMPTS[promptKey] || SUMMARY_PROMPTS['zh-concise'];

  // 替换变量
  promptTemplate = promptTemplate.replace('{{content}}', content);
  if (existingSummary) {
    promptTemplate = promptTemplate.replace('{{existingSummary}}', existingSummary);
  }

  // 调用 LLM
  const response = await Promise.race([
    currentLLMProvider.generate(promptTemplate, {
      maxTokens: config.maxSummaryTokens * 3, // JSON 格式开销
      temperature: 0.3,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('LLM summary timeout')), config.llmTimeoutMs)
    ),
  ]);

  // 解析 JSON 响应
  const parsed = parseJSONResponse(response);

  const summaryTokens = estimateTokens(
    parsed.summary + (parsed.keyFacts || []).join(' ') + (parsed.decisions || []).join(' ')
  );

  return {
    summary: parsed.summary || '',
    keyFacts: parsed.keyFacts || [],
    decisions: parsed.decisions || [],
    todos: parsed.todos || [],
    topics: parsed.topics || [],
    strategy: 'llm',
    originalTokens,
    summaryTokens,
    compressionRatio: originalTokens > 0 ? summaryTokens / originalTokens : 1,
  };
}

/**
 * 解析 LLM 返回的 JSON（容错处理）
 */
function parseJSONResponse(response: string): {
  summary?: string;
  keyFacts?: string[];
  decisions?: string[];
  todos?: string[];
  topics?: string[];
} {
  // 尝试直接 parse
  try {
    return JSON.parse(response);
  } catch {
    // 尝试提取 JSON 块
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // fall through
      }
    }

    // 降级：将整个响应作为摘要
    return { summary: response.trim() };
  }
}

// ─── 摘要引擎（统一入口） ────────────────────────────────────

/**
 * 智能摘要引擎
 * 
 * 根据内容长度和 LLM 可用性自动选择最佳策略
 */
export class SummaryEngine {
  private config: SummaryEngineConfig;

  constructor(config: Partial<SummaryEngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 生成摘要
   */
  async summarize(content: string, existingSummary?: string): Promise<SummaryResult> {
    const tokens = estimateTokens(content);
    const lang = this.detectLanguage(content);

    // 短内容用规则
    if (tokens < this.config.llmThresholdTokens || !currentLLMProvider) {
      return ruleSummarize(content, lang);
    }

    // 长内容用 LLM
    try {
      return await llmSummarize(content, this.config, existingSummary);
    } catch (error) {
      console.warn('[SummaryEngine] LLM summarization failed:', error);

      if (this.config.fallbackToRules) {
        console.info('[SummaryEngine] Falling back to rule-based summarization');
        const result = ruleSummarize(content, lang);
        result.strategy = 'hybrid'; // 标记为降级
        return result;
      }

      throw error;
    }
  }

  /**
   * 批量摘要
   */
  async summarizeBatch(
    items: Array<{ id: string; content: string }>,
    options?: { concurrency?: number }
  ): Promise<Map<string, SummaryResult>> {
    const results = new Map<string, SummaryResult>();
    const concurrency = options?.concurrency || 3;

    // 简单的并发控制
    const queue = [...items];
    const running: Promise<void>[] = [];

    const processOne = async () => {
      while (queue.length > 0) {
        const item = queue.shift()!;
        const result = await this.summarize(item.content);
        results.set(item.id, result);
      }
    };

    for (let i = 0; i < Math.min(concurrency, items.length); i++) {
      running.push(processOne());
    }

    await Promise.all(running);
    return results;
  }

  /**
   * 增量合并摘要
   */
  async mergeSummaries(
    existingSummary: SummaryResult,
    newContent: string
  ): Promise<SummaryResult> {
    const existingText = [
      `摘要：${existingSummary.summary}`,
      `事实：${existingSummary.keyFacts.join('；')}`,
      `决策：${existingSummary.decisions.join('；')}`,
      `待办：${existingSummary.todos.join('；')}`,
    ].join('\n');

    return this.summarize(newContent, existingText);
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<SummaryEngineConfig>): void {
    Object.assign(this.config, config);
  }

  private detectLanguage(content: string): 'zh' | 'en' {
    if (this.config.language !== 'auto') return this.config.language;
    const chineseRatio = (content.match(/[\u4e00-\u9fff]/g)?.length || 0) / content.length;
    return chineseRatio > 0.1 ? 'zh' : 'en';
  }
}

// ─── 便捷工厂 ──────────────────────────────────────────────

let defaultEngine: SummaryEngine | null = null;

export function getSummaryEngine(config?: Partial<SummaryEngineConfig>): SummaryEngine {
  if (!defaultEngine || config) {
    defaultEngine = new SummaryEngine(config);
  }
  return defaultEngine;
}

/**
 * 快捷摘要（直接调用）
 */
export async function summarize(content: string): Promise<SummaryResult> {
  return getSummaryEngine().summarize(content);
}
