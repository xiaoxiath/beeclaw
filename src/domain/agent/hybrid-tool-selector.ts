/**
 * HybridToolSelector - LLM-Driven Tool Selection
 *
 * 使用 FastLLMJudge 智能选择最相关的工具。
 *
 * 策略：
 * 1. Cache hit (<1ms)
 * 2. Core tools (always included)
 * 3. LLM-based selection (via FastLLMJudge)
 * 4. Context-based matching (recent tools)
 */

import { logger } from '../../infra/observability/logger';
import type { OpenAITool, ChatMessage } from './types';
import { getFastLLMJudge } from './fast-llm-judge';
import type { AIProvider } from '../../infra/config/schema';
import { getConfig_ } from '../../app';

// ---------------------------------------------------------------------------
// 1. 配置
// ---------------------------------------------------------------------------

interface ToolSelectorConfig {
  maxTools: number;
  cacheEnabled: boolean;
  cacheMaxAge: number;
}

const DEFAULT_CONFIG: ToolSelectorConfig = {
  maxTools: 30,
  cacheEnabled: true,
  cacheMaxAge: 5000, // 5 seconds
};

/**
 * Core tools that must ALWAYS be included in every LLM call.
 * These are essential for the agent's self-awareness and skill usage.
 */
const CORE_TOOLS = new Set([
  'memory_ls',
  'memory_read',
  'memory_record',
  'skill_list',
  'skill_get',
  'skill_search',
  'skill_record',
  'web_search',
  'think',
  'task_complete',
  'datasource_health_check',
]);

// ---------------------------------------------------------------------------
// 2. LLM Prompt
// ---------------------------------------------------------------------------

const TOOL_SELECTION_PROMPT = `你是一个工具选择专家，负责从可用工具列表中选择最相关的工具来处理用户请求。

用户请求：{task}

可用工具列表：
{tools}

请选择最相关的 {maxTools} 个工具。返回 JSON（不要包含 markdown 代码块标记）：
{{
  "selectedTools": ["tool1", "tool2", ...],
  "reasoning": "简要说明选择这些工具的理由"
}}

重要提示：
- 只返回工具名称，不要包含参数
- 按相关性排序，最相关的放在前面
- 如果不确定，宁可不选也不要误选
- 最多选择 {maxTools} 个工具`;

// ---------------------------------------------------------------------------
// 3. HybridToolSelector 实现
// ---------------------------------------------------------------------------

export class HybridToolSelector {
  private config: ToolSelectorConfig;
  private provider: AIProvider;
  private fastModel: string;
  private registeredTools: OpenAITool[] = [];
  private stats = {
    totalSelections: 0,
    cacheHits: 0,
    llmCalls: 0,
    errors: 0,
  };

  constructor(
    provider: AIProvider,
    fastModel: string,
    config?: Partial<ToolSelectorConfig>
  ) {
    this.provider = provider;
    this.fastModel = fastModel;
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('[HybridToolSelector] Initialized', {
      ...this.config,
      provider: provider.type,
      fastModel,
    });
  }

  /**
   * Select the most relevant tools for the current user message.
   */
  async selectTools(
    userMessage: string,
    recentMessages: ChatMessage[],
    maxTools?: number,
  ): Promise<OpenAITool[]> {
    const max = maxTools || this.config.maxTools;
    this.stats.totalSelections++;

    // Get all available tools
    const allTools = this.getAllRegisteredTools();
    if (allTools.length <= max) {
      // All tools fit, no selection needed
      return allTools;
    }

    const selectedToolNames = new Set<string>();

    // Tier 1: Always include core tools
    for (const name of CORE_TOOLS) {
      selectedToolNames.add(name);
    }

    // Tier 2: LLM-based selection using FastLLMJudge
    try {
      const llmTools = await this.selectToolsWithLLM(userMessage, max - selectedToolNames.size);
      for (const name of llmTools) {
        selectedToolNames.add(name);
      }
    } catch (error) {
      this.stats.errors++;
      logger.warn('[HybridToolSelector] LLM selection failed, falling back to context', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Tier 3: Context-based matching (use recent messages for additional signal)
    if (selectedToolNames.size < max) {
      const contextTools = this.matchByContext(recentMessages);
      for (const name of contextTools) {
        if (selectedToolNames.size >= max) break;
        selectedToolNames.add(name);
      }
    }

    // Build final tool list
    const selected = allTools.filter(t => selectedToolNames.has(t.function.name));

    // If still under limit, add remaining tools
    if (selected.length < max) {
      const remaining = allTools.filter(t => !selectedToolNames.has(t.function.name));
      const slotsLeft = max - selected.length;
      selected.push(...remaining.slice(0, slotsLeft));
    }

    logger.info('[HybridToolSelector] Tool selection complete', {
      total: allTools.length,
      selected: selected.length,
      core: CORE_TOOLS.size,
      llm: selectedToolNames.size - CORE_TOOLS.size,
    });

    return selected;
  }

  /**
   * 使用 FastLLMJudge 选择工具
   */
  private async selectToolsWithLLM(userMessage: string, maxTools: number): Promise<string[]> {
    this.stats.llmCalls++;

    // Build tool descriptions
    const toolDescriptions = this.registeredTools
      .map((tool, index) => {
        const { name, description } = tool.function;
        return `${index + 1}. ${name}: ${description}`;
      })
      .join('\n');

    // Get FastLLMJudge instance
    const judge = getFastLLMJudge(this.provider, this.fastModel, {
      cacheEnabled: this.config.cacheEnabled,
      cacheSize: 100,
      defaultTimeout: 2000,
    });

    // Execute judgment
    const result = await judge.judge<string[]>({
      taskName: 'tool-selection',
      promptTemplate: TOOL_SELECTION_PROMPT,
      promptVariables: {
        task: userMessage,
        tools: toolDescriptions,
        maxTools,
      },
      validateOutput: (output) => {
        if (!output.selectedTools || !Array.isArray(output.selectedTools)) {
          return null;
        }
        // Validate tool names exist
        const validToolNames = new Set(this.registeredTools.map(t => t.function.name));
        const valid = output.selectedTools.filter((name: any) => {
          return typeof name === 'string' && validToolNames.has(name);
        });
        return valid.length > 0 ? valid : null;
      },
      defaultValue: [],
      cacheTTL: this.config.cacheMaxAge,
    });

    if (result.failed) {
      logger.warn('[HybridToolSelector] LLM judgment failed', { error: result.error });
    }

    logger.info('[HybridToolSelector] LLM selected tools', {
      count: result.result.length,
      tools: result.result.join(', '),
      fromCache: result.fromCache,
    });

    return result.result;
  }

  /**
   * Match tools based on recent conversation context.
   */
  private matchByContext(recentMessages: ChatMessage[]): string[] {
    const toolsUsed = new Set<string>();

    for (const msg of recentMessages) {
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          toolsUsed.add(tc.function.name);
        }
      }
    }

    return Array.from(toolsUsed);
  }

  // ─── Tool Registry ─────────────────────────────────────────────────────

  registerTools(tools: OpenAITool[]): void {
    this.registeredTools = tools;
  }

  getAllRegisteredTools(): OpenAITool[] {
    return this.registeredTools;
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

// ---------------------------------------------------------------------------
// 4. 单例模式
// ---------------------------------------------------------------------------

let _selector: HybridToolSelector | null = null;

/**
 * 获取 HybridToolSelector 实例
 *
 * @param provider AI Provider（首次调用时必需）
 * @param fastModel Fast 模型名称（可选，不传则从配置读取）
 * @param config 配置（可选）
 */
export function getHybridToolSelector(
  provider?: AIProvider,
  fastModel?: string,
  config?: Partial<ToolSelectorConfig>
): HybridToolSelector {
  if (!_selector) {
    if (!provider) {
      throw new Error('HybridToolSelector requires provider on first initialization');
    }

    // 从配置读取 fast 模型
    const config_ = getConfig_();
    const fastModelFromConfig = config_?.llmRouter?.tiers?.fast?.models?.[0];
    const resolvedFastModel = fastModel || fastModelFromConfig;

    if (!resolvedFastModel) {
      throw new Error(
        'Fast model not specified. Pass fastModel parameter or configure llmRouter.tiers.fast in beeclaw.json'
      );
    }

    _selector = new HybridToolSelector(provider, resolvedFastModel, config);
  }
  return _selector;
}

export function resetHybridToolSelector(): void {
  _selector = null;
}
