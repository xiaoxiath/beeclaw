/**
 * Tool Result Guardrails  (P2-#6)
 *
 * 原始实现中 compressToolResult() 仅处理 JSON 结构，对以下场景缺乏保护：
 *  - 非 JSON 大型文本（如网页抓取、日志输出）
 *  - 嵌套深层 JSON（递归深度无限制）
 *  - 二进制内容误传（Base64 等超长字符串）
 *  - 多个 tool 并发返回同时撑爆上下文
 *
 * 优化方案：
 *  1. 统一的 ToolResultGuard：按 token 预算截断 tool 结果
 *  2. 智能截断策略：保留结构信息，截断内容部分
 *  3. 全局 tool 结果 token 预算管理（所有并发 tool 共享预算）
 *  4. 支持自定义截断策略（按工具名注册）
 *
 * ⚡ 新增文件 — 在 agent/index.ts 中 addMessage 之前调用
 */

import { estimateTokens } from './context';

// ---------------------------------------------------------------------------
// 1. 配置
// ---------------------------------------------------------------------------

export interface ToolResultGuardConfig {
  /** 单个 tool 结果的最大 token 数 (default: 4000) */
  maxTokensPerResult: number;
  /** 所有 tool 结果的总 token 预算占 context 的比例 (default: 0.3) */
  totalBudgetRatio: number;
  /** 是否启用智能截断（保留结构信息） (default: true) */
  smartTruncation: boolean;
  /** 截断后追加的提示文本 */
  truncationSuffix: string;
  /** 对超长 Base64 或二进制内容直接替换为摘要 (default: true) */
  filterBinaryContent: boolean;
}

const DEFAULT_CONFIG: ToolResultGuardConfig = {
  maxTokensPerResult: 4000,
  totalBudgetRatio: 0.3,
  smartTruncation: true,
  truncationSuffix: '\n\n... [内容已截断，完整结果过长]',
  filterBinaryContent: true,
};

let guardConfig = { ...DEFAULT_CONFIG };

/**
 * 配置 Tool Result Guard。
 */
export function configureToolResultGuard(config: Partial<ToolResultGuardConfig>): void {
  guardConfig = { ...guardConfig, ...config };
}

// ---------------------------------------------------------------------------
// 2. 自定义截断策略注册
// ---------------------------------------------------------------------------

type TruncationStrategy = (content: string, maxTokens: number) => string;

const customStrategies = new Map<string, TruncationStrategy>();

/**
 * 为特定工具注册自定义截断策略。
 *
 * @example
 * registerTruncationStrategy('web_fetch', (content, maxTokens) => {
 *   // 保留标题和前 N 段落
 *   const paragraphs = content.split('\n\n');
 *   let result = '';
 *   for (const p of paragraphs) {
 *     if (estimateTokens(result + p) > maxTokens) break;
 *     result += p + '\n\n';
 *   }
 *   return result;
 * });
 */
export function registerTruncationStrategy(toolName: string, strategy: TruncationStrategy): void {
  customStrategies.set(toolName, strategy);
}

// ---------------------------------------------------------------------------
// 3. 核心截断逻辑
// ---------------------------------------------------------------------------

/**
 * 检测是否为 Base64 或二进制内容。
 */
function isBinaryContent(text: string): boolean {
  // Base64 data URI
  if (/^data:[^;]+;base64,/.test(text)) return true;

  // 长 Base64 字符串（连续 100+ 个 base64 字符，无空格）
  if (/^[A-Za-z0-9+/=]{100,}$/.test(text.trim())) return true;

  // 高密度不可打印字符
  const nonPrintable = (text.match(/[\x00-\x1F\x7F-\x9F]/g) || []).length;
  if (text.length > 100 && nonPrintable / text.length > 0.1) return true;

  return false;
}

/**
 * 智能 JSON 截断：保留结构，截断值。
 */
function smartTruncateJSON(obj: any, maxTokens: number, currentDepth = 0): any {
  const MAX_DEPTH = 5;

  if (currentDepth > MAX_DEPTH) {
    return typeof obj === 'string' ? obj.slice(0, 50) + '...' : '[深层嵌套已省略]';
  }

  if (obj === null || obj === undefined || typeof obj === 'boolean' || typeof obj === 'number') {
    return obj;
  }

  if (typeof obj === 'string') {
    if (obj.length > 500) {
      // 二进制内容直接替换
      if (guardConfig.filterBinaryContent && isBinaryContent(obj)) {
        return `[二进制内容, ${obj.length} 字符]`;
      }
      return obj.slice(0, 400) + `... [${obj.length} 字符已截断]`;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return [];

    // 预估当前 token
    const currentStr = JSON.stringify(obj);
    if (estimateTokens(currentStr) <= maxTokens) return obj;

    // 保留前 N 项 + 统计摘要
    const maxItems = Math.max(3, Math.min(10, Math.floor(maxTokens / estimateTokens(JSON.stringify(obj[0]) || '{}'))));
    const truncated = obj.slice(0, maxItems).map(item =>
      smartTruncateJSON(item, Math.floor(maxTokens / maxItems), currentDepth + 1)
    );
    if (obj.length > maxItems) {
      truncated.push(`... 共 ${obj.length} 项, 已显示前 ${maxItems} 项`);
    }
    return truncated;
  }

  if (typeof obj === 'object') {
    const keys = Object.keys(obj);
    const result: Record<string, any> = {};

    // 优先保留关键字段
    const priorityKeys = ['success', 'error', 'message', 'status', 'count', 'total', 'id', 'name', 'title', 'type', 'code'];
    const sortedKeys = [
      ...keys.filter(k => priorityKeys.includes(k.toLowerCase())),
      ...keys.filter(k => !priorityKeys.includes(k.toLowerCase())),
    ];

    let usedTokens = 0;
    const perKeyBudget = Math.floor(maxTokens / Math.max(1, keys.length));

    for (const key of sortedKeys) {
      const val = smartTruncateJSON(obj[key], Math.max(100, perKeyBudget), currentDepth + 1);
      const valStr = JSON.stringify(val);
      const valTokens = estimateTokens(valStr);

      if (usedTokens + valTokens > maxTokens && Object.keys(result).length >= 3) {
        result['_truncated'] = `${keys.length - Object.keys(result).length} 个字段已省略`;
        break;
      }

      result[key] = val;
      usedTokens += valTokens;
    }

    return result;
  }

  return obj;
}

/**
 * 智能文本截断：保留段落完整性。
 */
function smartTruncateText(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;

  // 按段落分割
  const paragraphs = text.split(/\n\n+/);
  let result = '';
  let remainingTokens = maxTokens - estimateTokens(guardConfig.truncationSuffix);

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);
    if (estimateTokens(result) + paraTokens > remainingTokens) {
      // 最后一段按字符截断
      if (!result) {
        const charBudget = Math.floor(remainingTokens * 2.5); // 粗略 token → char
        result = para.slice(0, charBudget);
      }
      break;
    }
    result += (result ? '\n\n' : '') + para;
  }

  return result + guardConfig.truncationSuffix;
}

// ---------------------------------------------------------------------------
// 4. 主入口
// ---------------------------------------------------------------------------

/**
 * 对单个 tool 结果进行截断保护。
 *
 * @param content    tool 返回的原始内容
 * @param toolName   工具名称（用于查找自定义策略）
 * @param maxTokens  该 tool 的 token 预算（默认使用全局配置）
 */
export function guardToolResult(
  content: string,
  toolName?: string,
  maxTokens?: number,
): { content: string; truncated: boolean; originalTokens: number; resultTokens: number } {
  const budget = maxTokens || guardConfig.maxTokensPerResult;
  const originalTokens = estimateTokens(content);

  // 不超预算，直接返回
  if (originalTokens <= budget) {
    return { content, truncated: false, originalTokens, resultTokens: originalTokens };
  }

  // 检查自定义策略
  if (toolName && customStrategies.has(toolName)) {
    const strategy = customStrategies.get(toolName)!;
    const truncated = strategy(content, budget);
    return {
      content: truncated,
      truncated: true,
      originalTokens,
      resultTokens: estimateTokens(truncated),
    };
  }

  // 二进制检测
  if (guardConfig.filterBinaryContent && isBinaryContent(content)) {
    const summary = `[二进制/Base64 内容, 原始长度: ${content.length} 字符, 约 ${originalTokens} tokens — 已过滤]`;
    return { content: summary, truncated: true, originalTokens, resultTokens: estimateTokens(summary) };
  }

  // 尝试 JSON 智能截断
  if (guardConfig.smartTruncation) {
    try {
      const parsed = JSON.parse(content);
      const truncated = smartTruncateJSON(parsed, budget);
      const truncatedStr = JSON.stringify(truncated, null, 2);
      return {
        content: truncatedStr,
        truncated: true,
        originalTokens,
        resultTokens: estimateTokens(truncatedStr),
      };
    } catch {
      // 非 JSON，使用文本截断
    }
  }

  // 文本智能截断
  const truncated = smartTruncateText(content, budget);
  return {
    content: truncated,
    truncated: true,
    originalTokens,
    resultTokens: estimateTokens(truncated),
  };
}

// ---------------------------------------------------------------------------
// 5. 批量 Token 预算管理器
// ---------------------------------------------------------------------------

/**
 * 管理一批并发 tool 调用的总 token 预算。
 */
export class ToolResultBudgetManager {
  private totalBudget: number;
  private usedTokens = 0;
  private resultCount = 0;
  private pendingCount: number;

  constructor(contextMaxTokens: number, pendingToolCalls: number) {
    this.totalBudget = Math.floor(contextMaxTokens * guardConfig.totalBudgetRatio);
    this.pendingCount = pendingToolCalls;
  }

  /**
   * 为下一个 tool 结果分配 token 预算。
   * 动态分配：剩余预算 / 剩余 tool 数，但不低于 500 tokens。
   */
  allocate(): number {
    const remaining = this.totalBudget - this.usedTokens;
    const remainingTools = Math.max(1, this.pendingCount - this.resultCount);
    const perTool = Math.floor(remaining / remainingTools);
    return Math.max(500, Math.min(perTool, guardConfig.maxTokensPerResult));
  }

  /**
   * 记录一个 tool 结果消耗的 token 数。
   */
  record(tokens: number): void {
    this.usedTokens += tokens;
    this.resultCount++;
  }

  /**
   * 获取预算使用情况。
   */
  getStats(): { totalBudget: number; usedTokens: number; resultCount: number } {
    return {
      totalBudget: this.totalBudget,
      usedTokens: this.usedTokens,
      resultCount: this.resultCount,
    };
  }
}
