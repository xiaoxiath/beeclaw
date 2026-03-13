/**
 * Hybrid Tool Selector Integration Example
 *
 * 展示如何在 Agent 中集成混合工具选择器
 */

import { getHybridToolSelector } from './hybrid-tool-selector';
import { getAllToolsForAI } from './tools';
import { logger } from '../../infra/observability/logger';
import type { OpenAITool, ChatMessage } from './types';

/**
 * 方案 1: 简单集成（推荐用于快速上手）
 *
 * 在 Agent.chat() 方法中，替换：
 *   const tools = options?.tools || this.options.tools || getAllToolsForAI();
 *
 * 为：
 *   const tools = await selectToolsWithHybrid(userMessage, recentMessages);
 */
export async function selectToolsWithHybrid(
  userMessage: string | any[],
  recentMessages: ChatMessage[],
  maxTools: number = 30
): Promise<OpenAITool[]> {
  // 提取用户消息文本
  const messageText = typeof userMessage === 'string'
    ? userMessage
    : userMessage
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join(' ');

  try {
    const selector = getHybridToolSelector();
    const selectedTools = await selector.selectTools(
      messageText,
      recentMessages,
      maxTools
    );

    const allToolsCount = getAllToolsForAI().length;
    logger.info(`[HybridIntegration] Selected ${selectedTools.length} tools from ${allToolsCount} total`);

    return selectedTools;
  } catch (error) {
    logger.error('[HybridIntegration] Tool selection failed, fallback to all tools', error);
    // 失败时回退到加载所有工具
    return getAllToolsForAI();
  }
}

/**
 * 方案 2: 高级集成（推荐用于生产环境）
 *
 * 在 Agent 类中添加工具选择器实例
 */
export class AgentWithHybridSelector {
  private toolSelector = getHybridToolSelector();
  private messages: ChatMessage[] = [];

  async chat(userMessage: string | any[]): Promise<string> {
    // 获取最近的消息作为上下文
    const recentMessages = this.messages.slice(-5);

    // 智能选择工具
    const selectedTools = await this.toolSelector.selectTools(
      typeof userMessage === 'string' ? userMessage : JSON.stringify(userMessage),
      recentMessages,
      30
    );

    logger.info(`[Agent] Selected ${selectedTools.length} tools from ${getAllToolsForAI().length} total`);

    // 调用 AI API
    // const response = await callAI({
    //   model: this.model,
    //   messages: this.messages,
    //   tools: selectedTools,  // ← 使用选中的工具
    // });

    // ... 其余逻辑

    return '';
  }
}

/**
 * 方案 3: 条件式集成（根据配置选择策略）
 *
 * 根据配置动态选择工具加载策略
 */
export async function selectToolsByStrategy(
  strategy: 'all' | 'hybrid' | 'core',
  userMessage: string | any[],
  recentMessages: ChatMessage[],
  maxTools: number = 30
): Promise<OpenAITool[]> {
  switch (strategy) {
    case 'all':
      // 加载所有工具（不推荐）
      return getAllToolsForAI();

    case 'hybrid':
      // 混合策略（推荐）
      return selectToolsWithHybrid(userMessage, recentMessages, maxTools);

    case 'core':
      // 只加载核心工具（用于简单场景）
      const allTools = getAllToolsForAI();
      const coreToolNames = [
        'memory_ls', 'memory_read', 'memory_record',
        'skill_list', 'skill_get',
        'web_search',
      ];
      return allTools.filter(t => coreToolNames.includes(t.function.name));

    default:
      return getAllToolsForAI();
  }
}

/**
 * 使用示例
 */

// 示例 1: 在现有 Agent 中集成
/*
// src/domain/agent/index.ts

// 在 Agent.chat() 方法中（约 795 行）
async chat(userMessage: string | MultimodalContent[], options?: {...}): Promise<string> {
  // ... 现有代码 ...

  // ❌ 旧代码：
  // const tools = options?.tools || this.options.tools || getAllToolsForAI();

  // ✅ 新代码：
  const recentMessages = this.messages.slice(-5);
  const tools = options?.tools || this.options.tools || await selectToolsWithHybrid(
    userMessage,
    recentMessages,
    30
  );

  // ... 其余代码保持不变 ...
}
*/

// 示例 2: 在配置中启用
/*
// beeclaw.json
{
  "agent": {
    "toolSelectionStrategy": "hybrid",
    "maxTools": 30
  },
  "toolSelector": {
    "strategy": "hybrid",
    "maxTools": 30,
    "cache": {
      "enabled": true
    }
  }
}

// src/domain/agent/index.ts
import { loadToolSelectorConfig } from './tool-selector-config';

const config = loadToolSelectorConfig(appConfig);

async chat(userMessage: string | MultimodalContent[], options?: {...}): Promise<string> {
  const tools = await selectToolsByStrategy(
    config.strategy,
    userMessage,
    recentMessages,
    config.maxTools
  );
}
*/

// 示例 3: 监控和调试
/*
// 添加性能监控
const startTime = Date.now();
const tools = await selectToolsWithHybrid(userMessage, recentMessages, 30);
const elapsed = Date.now() - startTime;

logger.info('[ToolSelection]', {
  strategy: 'hybrid',
  toolCount: tools.length,
  elapsed: `${elapsed}ms`,
  userMessage: userMessage.substring(0, 50),
});
*/

/**
 * 迁移指南
 *
 * 从旧的工具加载方式迁移到混合选择器：
 *
 * 步骤 1: 在 Agent 构造函数中初始化选择器（可选）
 *
 * constructor(options: AgentOptions) {
 *   // ... 现有代码 ...
 *
 *   // 初始化混合选择器（延迟初始化）
 *   this.toolSelector = getHybridToolSelector();
 * }
 *
 * 步骤 2: 在 chat() 方法中使用选择器
 *
 * async chat(userMessage: string, options?: {...}): Promise<string> {
 *   // ... 现有代码 ...
 *
 *   // 选择工具
 *   const recentMessages = this.messages.slice(-5);
 *   const tools = options?.tools || this.options.tools || await this.selectTools(
 *     userMessage,
 *     recentMessages
 *   );
 *
 *   // ... 其余代码 ...
 * }
 *
 * // 添加工具选择方法
 * private async selectTools(
 *   userMessage: string,
 *   recentMessages: ChatMessage[]
 * ): Promise<OpenAITool[]> {
 *   try {
 *     return await this.toolSelector.selectTools(
 *       userMessage,
 *       recentMessages,
 *       30
 *     );
 *   } catch (error) {
 *     logger.error('[Agent] Tool selection failed, using all tools', error);
 *     return getAllToolsForAI();
 *   }
 * }
 *
 * 步骤 3: 测试和验证
 *
 * // 运行测试
 * bun test src/domain/agent/__tests__/hybrid-tool-selector.test.ts
 *
 * // 检查日志
 * [HybridSelector] Selected 25 tools from 100 total
 * [SemanticSelector] Top tools: feishu_calendar_list (0.892), ...
 *
 * 步骤 4: 预构建 Embeddings（生产环境推荐）
 *
 * // 在部署前运行
 * bun run scripts/build-tool-embeddings.ts
 *
 * // 将生成的文件加入版本控制
 * git add data/tool-embeddings.json
 */

/**
 * 性能优化建议
 *
 * 1. 预构建 Embeddings
 *    - 运行 scripts/build-tool-embeddings.ts
 *    - 避免每次启动时重新计算
 *
 * 2. 调整 maxTools 参数
 *    - 简单对话: 20-25
 *    - 标准对话: 30 (默认)
 *    - 复杂任务: 40-50
 *
 * 3. 监控缓存命中率
 *    - 目标: > 40%
 *    - 如果低于目标，考虑调整 TTL 或规则库
 *
 * 4. 根据场景选择策略
 *    - CLI 交互: 'hybrid'
 *    - Bot 消息: 'hybrid'
 *    - 后台任务: 'core'
 *
 * 5. 定期优化规则库
 *    - 添加新的关键词
 *    - 调整工具分类
 *    - 根据用户反馈改进
 */

export default {
  selectToolsWithHybrid,
  selectToolsByStrategy,
  AgentWithHybridSelector,
};
