/**
 * BeeClaw Resilience Patch — 循环检测器
 * 
 * 解决问题:
 *   - LLM 反复用相同参数调用同一工具时无任何检测 (#3)
 *   - 30 次迭代全部忠实执行，浪费 token 和时间
 * 
 * 三级检测:
 *   Level 1: 精确重复 — 相同工具 + 相同参数 hash
 *   Level 2: 语义重复 — 相同工具 + 高度相似参数
 *   Level 3: 进度停滞 — 连续 N 步工具结果无新信息
 * 
 * 集成方式: 在 index.ts 主循环中, 每次工具调用前调用 detector.check()
 */

import * as crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface LoopDetectorConfig {
  /** Level 1: 精确重复检测窗口大小 (检查最近 N 次调用) */
  exactDuplicateWindow: number;
  /** Level 1: 允许的最大精确重复次数 */
  maxExactDuplicates: number;
  /** Level 2: 参数相似度阈值 (0-1), 超过则视为语义重复 */
  semanticSimilarityThreshold: number;
  /** Level 2: 允许的最大语义重复次数 */
  maxSemanticDuplicates: number;
  /** Level 3: 进度停滞检测窗口 (连续 N 步) */
  progressStallWindow: number;
  /** Level 3: 最小信息增量 (0-1), 低于则视为无进展 */
  minInformationGain: number;
  /** 检测到循环时是否注入提示 (而非直接终止) */
  injectWarningFirst: boolean;
  /** 注入提示后仍循环的最大容忍次数 */
  maxWarningsBeforeBreak: number;
}

export interface ToolCallRecord {
  /** 工具名 */
  toolName: string;
  /** 原始参数 */
  params: Record<string, unknown>;
  /** 参数指纹 hash */
  fingerprint: string;
  /** 工具返回结果摘要 hash */
  resultHash: string | null;
  /** 时间戳 */
  timestamp: number;
  /** 迭代序号 */
  iteration: number;
}

export interface LoopDetectionResult {
  /** 是否检测到循环 */
  detected: boolean;
  /** 检测级别 */
  level: 0 | 1 | 2 | 3;
  /** 检测类型描述 */
  type: 'none' | 'exact_duplicate' | 'semantic_duplicate' | 'progress_stall';
  /** 详细信息 */
  details: string;
  /** 建议动作 */
  action: 'continue' | 'warn' | 'break';
  /** 注入给 LLM 的警告消息 (当 action === 'warn') */
  warningMessage?: string;
  /** 循环涉及的工具名 */
  involvedTool?: string;
  /** 重复次数 */
  repetitionCount?: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_LOOP_DETECTOR_CONFIG: LoopDetectorConfig = {
  exactDuplicateWindow: 10,
  maxExactDuplicates: 2,
  semanticSimilarityThreshold: 0.85,
  maxSemanticDuplicates: 3,
  progressStallWindow: 5,
  minInformationGain: 0.1,
  injectWarningFirst: true,
  maxWarningsBeforeBreak: 2,
};

// ============================================================================
// LoopDetector
// ============================================================================

export class LoopDetector {
  private readonly config: LoopDetectorConfig;
  private readonly history: ToolCallRecord[] = [];
  private readonly resultHashes = new Set<string>();
  private warningCount = 0;
  private readonly maxHistory = 200; // 防止内存泄漏

  constructor(config: Partial<LoopDetectorConfig> = {}) {
    this.config = { ...DEFAULT_LOOP_DETECTOR_CONFIG, ...config };
  }

  /**
   * 记录一次工具调用（在工具执行前调用）
   */
  recordToolCall(toolName: string, params: Record<string, unknown>, iteration: number): void {
    const fingerprint = this.computeFingerprint(toolName, params);
    
    this.history.push({
      toolName,
      params,
      fingerprint,
      resultHash: null, // 执行前还没有结果
      timestamp: Date.now(),
      iteration,
    });

    // 防止内存泄漏
    if (this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory);
    }
  }

  /**
   * 记录工具返回结果（在工具执行后调用）
   */
  recordToolResult(result: unknown): void {
    const last = this.history[this.history.length - 1];
    if (last) {
      const rHash = this.hashResult(result);
      last.resultHash = rHash;
      this.resultHashes.add(rHash);
    }
  }

  /**
   * 检查是否存在循环 — 在每次工具调用前执行
   * 
   * @param toolName - 即将调用的工具名
   * @param params - 即将使用的参数
   * @returns LoopDetectionResult
   */
  check(toolName: string, params: Record<string, unknown>): LoopDetectionResult {
    const fingerprint = this.computeFingerprint(toolName, params);

    // Level 1: 精确重复检测
    const exactResult = this.checkExactDuplicate(toolName, fingerprint);
    if (exactResult.detected) return exactResult;

    // Level 2: 语义重复检测
    const semanticResult = this.checkSemanticDuplicate(toolName, params);
    if (semanticResult.detected) return semanticResult;

    // Level 3: 进度停滞检测
    const stallResult = this.checkProgressStall();
    if (stallResult.detected) return stallResult;

    return {
      detected: false,
      level: 0,
      type: 'none',
      details: 'No loop detected',
      action: 'continue',
    };
  }

  /**
   * 确认一次警告已被 LLM 看到（注入 system 消息后调用）
   */
  acknowledgeWarning(): void {
    this.warningCount++;
  }

  /**
   * 重置检测器状态（新一轮 chat 开始时调用）
   */
  reset(): void {
    this.history.length = 0;
    this.resultHashes.clear();
    this.warningCount = 0;
  }

  /**
   * 获取当前统计信息
   */
  getStats(): {
    totalCalls: number;
    uniqueFingerprints: number;
    uniqueResults: number;
    warningCount: number;
    topRepeatedTools: Array<{ tool: string; count: number }>;
  } {
    const fingerprintCounts = new Map<string, number>();
    const toolCounts = new Map<string, number>();

    for (const record of this.history) {
      fingerprintCounts.set(record.fingerprint, (fingerprintCounts.get(record.fingerprint) ?? 0) + 1);
      toolCounts.set(record.toolName, (toolCounts.get(record.toolName) ?? 0) + 1);
    }

    const topTools = [...toolCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tool, count]) => ({ tool, count }));

    return {
      totalCalls: this.history.length,
      uniqueFingerprints: fingerprintCounts.size,
      uniqueResults: this.resultHashes.size,
      warningCount: this.warningCount,
      topRepeatedTools: topTools,
    };
  }

  // ============================================================================
  // Level 1: 精确重复检测
  // ============================================================================

  private checkExactDuplicate(toolName: string, fingerprint: string): LoopDetectionResult {
    const window = this.history.slice(-this.config.exactDuplicateWindow);
    const duplicateCount = window.filter(r => r.fingerprint === fingerprint).length;

    if (duplicateCount < this.config.maxExactDuplicates) {
      return { detected: false, level: 0, type: 'none', details: '', action: 'continue' };
    }

    const action = this.determineAction(duplicateCount, this.config.maxExactDuplicates);

    return {
      detected: true,
      level: 1,
      type: 'exact_duplicate',
      details: `Tool "${toolName}" called ${duplicateCount} times with identical arguments in last ${this.config.exactDuplicateWindow} calls`,
      action,
      warningMessage: action === 'warn' ? this.buildWarningMessage(
        toolName, duplicateCount, 'exact',
        `你已经连续 ${duplicateCount} 次用完全相同的参数调用 ${toolName}。` +
        `这不会产生新的结果。请换一种方式解决问题，或告知用户当前遇到的困难。`
      ) : undefined,
      involvedTool: toolName,
      repetitionCount: duplicateCount,
    };
  }

  // ============================================================================
  // Level 2: 语义重复检测
  // ============================================================================

  private checkSemanticDuplicate(toolName: string, params: Record<string, unknown>): LoopDetectionResult {
    const recentSameTool = this.history
      .filter(r => r.toolName === toolName)
      .slice(-this.config.exactDuplicateWindow);

    let semanticDuplicateCount = 0;

    for (const record of recentSameTool) {
      const similarity = this.computeParamSimilarity(record.params, params);
      if (similarity >= this.config.semanticSimilarityThreshold) {
        semanticDuplicateCount++;
      }
    }

    if (semanticDuplicateCount < this.config.maxSemanticDuplicates) {
      return { detected: false, level: 0, type: 'none', details: '', action: 'continue' };
    }

    const action = this.determineAction(semanticDuplicateCount, this.config.maxSemanticDuplicates);

    return {
      detected: true,
      level: 2,
      type: 'semantic_duplicate',
      details: `Tool "${toolName}" called ${semanticDuplicateCount} times with highly similar arguments (similarity ≥ ${this.config.semanticSimilarityThreshold})`,
      action,
      warningMessage: action === 'warn' ? this.buildWarningMessage(
        toolName, semanticDuplicateCount, 'semantic',
        `你已经 ${semanticDuplicateCount} 次用非常相似的参数调用 ${toolName}。` +
        `请尝试使用不同的关键词或换用其他工具来获取你需要的信息。`
      ) : undefined,
      involvedTool: toolName,
      repetitionCount: semanticDuplicateCount,
    };
  }

  // ============================================================================
  // Level 3: 进度停滞检测
  // ============================================================================

  private checkProgressStall(): LoopDetectionResult {
    if (this.history.length < this.config.progressStallWindow) {
      return { detected: false, level: 0, type: 'none', details: '', action: 'continue' };
    }

    const recentWindow = this.history.slice(-this.config.progressStallWindow);
    const recentWithResults = recentWindow.filter(r => r.resultHash !== null);

    if (recentWithResults.length === 0) {
      return { detected: false, level: 0, type: 'none', details: '', action: 'continue' };
    }

    // 计算最近窗口内的结果去重率
    const uniqueResults = new Set(recentWithResults.map(r => r.resultHash));
    // 所有历史已见过的结果
    const newResults = [...uniqueResults].filter(h => {
      // 检查这个 hash 是否只在当前窗口内出现（不在之前的历史中）
      const olderHistory = this.history.slice(0, -this.config.progressStallWindow);
      return !olderHistory.some(r => r.resultHash === h);
    });

    const informationGain = recentWithResults.length > 0
      ? newResults.length / recentWithResults.length
      : 1; // 无结果时不判为停滞

    if (informationGain >= this.config.minInformationGain) {
      return { detected: false, level: 0, type: 'none', details: '', action: 'continue' };
    }

    const action = this.determineAction(this.config.progressStallWindow, this.config.progressStallWindow);

    return {
      detected: true,
      level: 3,
      type: 'progress_stall',
      details: `Last ${this.config.progressStallWindow} tool calls produced ${newResults.length} new unique results (information gain: ${(informationGain * 100).toFixed(1)}%)`,
      action,
      warningMessage: action === 'warn' ? this.buildWarningMessage(
        'multiple', this.config.progressStallWindow, 'stall',
        `最近 ${this.config.progressStallWindow} 次工具调用几乎没有产生新信息。` +
        `你可能陷入了循环。请重新审视你的策略，尝试不同的方法，或向用户说明当前进展和困难。`
      ) : undefined,
      repetitionCount: this.config.progressStallWindow,
    };
  }

  // ============================================================================
  // 内部工具方法
  // ============================================================================

  /**
   * 计算工具调用指纹 — 确定性 hash
   */
  private computeFingerprint(toolName: string, params: Record<string, unknown>): string {
    const normalized = {
      tool: toolName,
      params: this.canonicalize(params),
    };
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex')
      .slice(0, 16);
  }

  /**
   * 确定性序列化参数 — 排序 key、忽略易变字段
   */
  private canonicalize(obj: unknown): unknown {
    if (obj === null || obj === undefined) return null;
    if (typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(item => this.canonicalize(item));

    const record = obj as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};

    // 忽略时间戳、随机 ID 等易变字段
    const volatileFields = new Set([
      'timestamp', 'ts', 'created_at', 'updated_at', 'request_id',
      'trace_id', 'span_id', 'nonce', 'random', 'session_id',
    ]);

    const keys = Object.keys(record).filter(k => !volatileFields.has(k)).sort();
    for (const key of keys) {
      sorted[key] = this.canonicalize(record[key]);
    }
    return sorted;
  }

  /**
   * 计算工具结果的 hash
   */
  private hashResult(result: unknown): string {
    const str = typeof result === 'string' ? result : JSON.stringify(result ?? '');
    // 对长结果截取前 2000 字符做 hash（避免性能问题）
    const truncated = str.length > 2000 ? str.slice(0, 2000) : str;
    return crypto.createHash('sha256').update(truncated).digest('hex').slice(0, 16);
  }

  /**
   * 计算两组参数的相似度 (0-1)
   * 使用键值对级别的 Jaccard 相似度
   */
  private computeParamSimilarity(
    params1: Record<string, unknown>,
    params2: Record<string, unknown>
  ): number {
    const flat1 = this.flattenParams(params1);
    const flat2 = this.flattenParams(params2);

    if (flat1.size === 0 && flat2.size === 0) return 1;
    if (flat1.size === 0 || flat2.size === 0) return 0;

    // Jaccard 系数
    let intersection = 0;
    for (const [key, value] of flat1) {
      if (flat2.get(key) === value) {
        intersection++;
      }
    }

    const union = new Set([...flat1.keys(), ...flat2.keys()]).size;
    return union === 0 ? 0 : intersection / union;
  }

  /**
   * 将嵌套参数扁平化为 key-value Map
   */
  private flattenParams(
    obj: Record<string, unknown>,
    prefix = ''
  ): Map<string, string> {
    const result = new Map<string, string>();

    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const nested = this.flattenParams(value as Record<string, unknown>, fullKey);
        for (const [nk, nv] of nested) {
          result.set(nk, nv);
        }
      } else {
        result.set(fullKey, String(value));
      }
    }

    return result;
  }

  /**
   * 根据重复次数和阈值决定动作
   */
  private determineAction(
    count: number,
    threshold: number
  ): 'continue' | 'warn' | 'break' {
    if (count < threshold) return 'continue';

    if (this.config.injectWarningFirst && this.warningCount < this.config.maxWarningsBeforeBreak) {
      return 'warn';
    }

    return 'break';
  }

  /**
   * 构建注入给 LLM 的警告消息
   */
  private buildWarningMessage(
    toolName: string,
    count: number,
    type: 'exact' | 'semantic' | 'stall',
    message: string
  ): string {
    const typeLabel = {
      exact: '精确重复',
      semantic: '语义重复',
      stall: '进度停滞',
    }[type];

    return `⚠️ 循环检测警告 [${typeLabel}]\n\n${message}\n\n` +
      `提示：如果你认为确实需要重复此操作，请在回复中明确说明原因。否则请调整策略。`;
  }
}

// ============================================================================
// 便捷工厂函数
// ============================================================================

/**
 * 创建 LoopDetector 实例
 * 
 * 用法:
 *   const detector = createLoopDetector({ maxExactDuplicates: 3 });
 *   
 *   // 在主循环中，每次工具调用前
 *   const checkResult = detector.check(toolName, params);
 *   if (checkResult.action === 'warn') {
 *     messages.push({ role: 'system', content: checkResult.warningMessage });
 *     detector.acknowledgeWarning();
 *   } else if (checkResult.action === 'break') {
 *     break; // 强制退出循环
 *   }
 *   
 *   detector.recordToolCall(toolName, params, iteration);
 *   const result = await executor(toolName, params);
 *   detector.recordToolResult(result);
 */
export function createLoopDetector(
  config?: Partial<LoopDetectorConfig>
): LoopDetector {
  return new LoopDetector(config);
}
