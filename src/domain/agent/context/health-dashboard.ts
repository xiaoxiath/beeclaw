/**
 * Context Health Dashboard — 上下文健康监控仪表板
 *
 * 实时监控上下文质量，在问题恶化之前发出预警。
 * 监控 5 个关键指标：
 * 1. tokenUtilization — token 使用率
 * 2. redundancyRate — 冗余率（相邻消息相似度）
 * 3. freshnessScore — 新鲜度（最新消息的时间衰减）
 * 4. coherenceScore — 连贯性（滑动窗口词汇重叠）
 * 5. informationDensity — 信息密度（唯一 3-gram 比例）
 *
 * 参考：ch05-context-engineering.md 5.1.6
 */

import { logger } from '../../../infra/observability/logger';
import { estimateTokens } from '../context';

/**
 * 上下文消息
 */
export interface HealthMessage {
  role: string;
  content: string;
  timestamp: number;
}

/**
 * 健康指标
 */
export interface HealthMetrics {
  tokenUtilization: number;  // [0, 1]
  redundancyRate: number;    // [0, 1]
  freshnessScore: number;    // [0, 1]
  coherenceScore: number;    // [0, 1]
  informationDensity: number; // [0, 1]
}

/**
 * 告警
 */
export interface HealthAlert {
  metric: string;
  severity: 'warning' | 'critical';
  value: number;
  threshold: number;
  message: string;
}

/**
 * 告警阈值配置
 */
export interface AlertThresholds {
  tokenUtilization: { warning: number; critical: number };
  redundancyRate: { warning: number; critical: number };
  freshnessScore: { warning: number; critical: number };
  coherenceScore: { warning: number; critical: number };
}

/**
 * 默认告警阈值
 */
export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  tokenUtilization: { warning: 0.80, critical: 0.95 },
  redundancyRate: { warning: 0.30, critical: 0.50 },
  freshnessScore: { warning: 0.40, critical: 0.20 },
  coherenceScore: { warning: 0.50, critical: 0.30 },
};

/**
 * 上下文健康仪表板
 */
export class ContextHealthDashboard {
  private history: HealthMetrics[] = [];
  private maxHistorySize = 100;

  constructor(
    private thresholds: AlertThresholds = DEFAULT_ALERT_THRESHOLDS
  ) {}

  /**
   * 测量上下文健康指标
   *
   * @param messages 消息列表
   * @param totalBudget 总 token 预算
   * @returns 健康指标
   */
  measure(
    messages: HealthMessage[],
    totalBudget: number
  ): HealthMetrics {
    if (messages.length === 0) {
      return {
        tokenUtilization: 0,
        redundancyRate: 0,
        freshnessScore: 1,
        coherenceScore: 1,
        informationDensity: 1,
      };
    }

    const allText = messages.map(m => m.content).join('\n');
    const totalTokens = estimateTokens(allText);

    // 1. token 使用率
    const tokenUtilization = totalTokens / totalBudget;

    // 2. 冗余率（相邻消息 Jaccard 相似度均值）
    const redundancyRate = this.calculateRedundancyRate(messages);

    // 3. 新鲜度（最新消息的时间衰减）
    const freshnessScore = this.calculateFreshnessScore(messages);

    // 4. 连贯性（滑动窗口词汇重叠）
    const coherenceScore = this.calculateCoherenceScore(messages);

    // 5. 信息密度（唯一 3-gram 比例）
    const informationDensity = this.calculateInformationDensity(messages);

    const metrics: HealthMetrics = {
      tokenUtilization,
      redundancyRate,
      freshnessScore,
      coherenceScore,
      informationDensity,
    };

    // 保存历史记录
    this.history.push(metrics);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }

    logger.debug(
      `[ContextHealth] Metrics: ` +
      `token=${(tokenUtilization * 100).toFixed(1)}%, ` +
      `redundancy=${(redundancyRate * 100).toFixed(1)}%, ` +
      `freshness=${(freshnessScore * 100).toFixed(1)}%, ` +
      `coherence=${(coherenceScore * 100).toFixed(1)}%, ` +
      `density=${(informationDensity * 100).toFixed(1)}%`
    );

    return metrics;
  }

  /**
   * 检查告警
   *
   * @param metrics 健康指标
   * @returns 告警列表
   */
  checkAlerts(metrics: HealthMetrics): HealthAlert[] {
    const alerts: HealthAlert[] = [];

    // token 使用率告警
    if (metrics.tokenUtilization >= this.thresholds.tokenUtilization.critical) {
      alerts.push({
        metric: 'tokenUtilization',
        severity: 'critical',
        value: metrics.tokenUtilization,
        threshold: this.thresholds.tokenUtilization.critical,
        message: `Token usage critical: ${(metrics.tokenUtilization * 100).toFixed(1)}% (threshold: ${(this.thresholds.tokenUtilization.critical * 100).toFixed(1)}%)`,
      });
    } else if (metrics.tokenUtilization >= this.thresholds.tokenUtilization.warning) {
      alerts.push({
        metric: 'tokenUtilization',
        severity: 'warning',
        value: metrics.tokenUtilization,
        threshold: this.thresholds.tokenUtilization.warning,
        message: `Token usage high: ${(metrics.tokenUtilization * 100).toFixed(1)}% (threshold: ${(this.thresholds.tokenUtilization.warning * 100).toFixed(1)}%)`,
      });
    }

    // 冗余率告警
    if (metrics.redundancyRate >= this.thresholds.redundancyRate.critical) {
      alerts.push({
        metric: 'redundancyRate',
        severity: 'critical',
        value: metrics.redundancyRate,
        threshold: this.thresholds.redundancyRate.critical,
        message: `Redundancy critical: ${(metrics.redundancyRate * 100).toFixed(1)}% (threshold: ${(this.thresholds.redundancyRate.critical * 100).toFixed(1)}%)`,
      });
    } else if (metrics.redundancyRate >= this.thresholds.redundancyRate.warning) {
      alerts.push({
        metric: 'redundancyRate',
        severity: 'warning',
        value: metrics.redundancyRate,
        threshold: this.thresholds.redundancyRate.warning,
        message: `Redundancy high: ${(metrics.redundancyRate * 100).toFixed(1)}% (threshold: ${(this.thresholds.redundancyRate.warning * 100).toFixed(1)}%)`,
      });
    }

    // 新鲜度告警（低于阈值）
    if (metrics.freshnessScore <= this.thresholds.freshnessScore.critical) {
      alerts.push({
        metric: 'freshnessScore',
        severity: 'critical',
        value: metrics.freshnessScore,
        threshold: this.thresholds.freshnessScore.critical,
        message: `Freshness critical: ${(metrics.freshnessScore * 100).toFixed(1)}% (threshold: ${(this.thresholds.freshnessScore.critical * 100).toFixed(1)}%)`,
      });
    } else if (metrics.freshnessScore <= this.thresholds.freshnessScore.warning) {
      alerts.push({
        metric: 'freshnessScore',
        severity: 'warning',
        value: metrics.freshnessScore,
        threshold: this.thresholds.freshnessScore.warning,
        message: `Freshness low: ${(metrics.freshnessScore * 100).toFixed(1)}% (threshold: ${(this.thresholds.freshnessScore.warning * 100).toFixed(1)}%)`,
      });
    }

    // 连贯性告警（低于阈值）
    if (metrics.coherenceScore <= this.thresholds.coherenceScore.critical) {
      alerts.push({
        metric: 'coherenceScore',
        severity: 'critical',
        value: metrics.coherenceScore,
        threshold: this.thresholds.coherenceScore.critical,
        message: `Coherence critical: ${(metrics.coherenceScore * 100).toFixed(1)}% (threshold: ${(this.thresholds.coherenceScore.critical * 100).toFixed(1)}%)`,
      });
    } else if (metrics.coherenceScore <= this.thresholds.coherenceScore.warning) {
      alerts.push({
        metric: 'coherenceScore',
        severity: 'warning',
        value: metrics.coherenceScore,
        threshold: this.thresholds.coherenceScore.warning,
        message: `Coherence low: ${(metrics.coherenceScore * 100).toFixed(1)}% (threshold: ${(this.thresholds.coherenceScore.warning * 100).toFixed(1)}%)`,
      });
    }

    if (alerts.length > 0) {
      logger.warn(`[ContextHealth] ${alerts.length} alert(s): ${alerts.map(a => a.message).join('; ')}`);
    }

    return alerts;
  }

  /**
   * 趋势分析（线性回归斜率）
   *
   * @param metric 指标名称
   * @param windowSize 窗口大小（最近 N 次采样）
   * @returns 趋势斜率（正值表示上升，负值表示下降）
   */
  trend(metric: keyof HealthMetrics, windowSize: number = 10): number {
    const data = this.history
      .slice(-windowSize)
      .map(h => h[metric] ?? 0);

    if (data.length < 2) {
      return 0; // 数据不足，无法计算趋势
    }

    // 简单线性回归
    const n = data.length;
    const xMean = (n - 1) / 2;
    const yMean = data.reduce((s, v) => s + v, 0) / n;

    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (data[i] - yMean);
      denominator += Math.pow(i - xMean, 2);
    }

    const slope = denominator !== 0 ? numerator / denominator : 0;

    return slope;
  }

  /**
   * 获取历史记录
   */
  getHistory(): HealthMetrics[] {
    return [...this.history];
  }

  /**
   * 重置历史记录
   */
  reset(): void {
    this.history = [];
    logger.info('[ContextHealth] History reset');
  }

  /**
   * 计算冗余率（相邻消息 Jaccard 相似度均值）
   */
  private calculateRedundancyRate(messages: HealthMessage[]): number {
    if (messages.length < 2) {
      return 0;
    }

    let totalSimilarity = 0;
    let pairCount = 0;

    for (let i = 1; i < messages.length; i++) {
      const prev = this.tokenize(messages[i - 1].content);
      const curr = this.tokenize(messages[i].content);

      const similarity = this.jaccardSimilarity(prev, curr);
      totalSimilarity += similarity;
      pairCount++;
    }

    return pairCount > 0 ? totalSimilarity / pairCount : 0;
  }

  /**
   * 计算新鲜度（最新消息的时间衰减）
   */
  private calculateFreshnessScore(messages: HealthMessage[]): number {
    if (messages.length === 0) {
      return 1;
    }

    const now = Date.now();
    const latestTimestamp = Math.max(...messages.map(m => m.timestamp));
    const ageHours = (now - latestTimestamp) / 3600000;

    // 指数衰减：每 24 小时衰减 50%
    const freshness = Math.exp(-ageHours / 24);

    return freshness;
  }

  /**
   * 计算连贯性（滑动窗口词汇重叠）
   */
  private calculateCoherenceScore(messages: HealthMessage[]): number {
    if (messages.length < 3) {
      return 1; // 消息太少，默认连贯
    }

    const windowSize = 3;
    let totalOverlap = 0;
    let windowCount = 0;

    for (let i = 0; i <= messages.length - windowSize; i++) {
      const window = messages.slice(i, i + windowSize);
      const allTokens = window.flatMap(m => this.tokenize(m.content));
      const uniqueTokens = new Set(allTokens);

      // 重叠度 = 唯一 token 数 / 总 token 数
      const overlap = uniqueTokens.size / allTokens.length;
      totalOverlap += overlap;
      windowCount++;
    }

    return windowCount > 0 ? totalOverlap / windowCount : 1;
  }

  /**
   * 计算信息密度（唯一 3-gram 比例）
   */
  private calculateInformationDensity(messages: HealthMessage[]): number {
    const allText = messages.map(m => m.content).join(' ');
    const tokens = this.tokenize(allText);

    if (tokens.length < 3) {
      return 1; // 文本太短，默认高密度
    }

    // 生成所有 3-gram
    const trigrams: string[] = [];
    for (let i = 0; i <= tokens.length - 3; i++) {
      trigrams.push(tokens.slice(i, i + 3).join(' '));
    }

    // 计算唯一 3-gram 比例
    const uniqueTrigrams = new Set(trigrams);
    const density = uniqueTrigrams.size / trigrams.length;

    return density;
  }

  /**
   * 文本分词（简单实现）
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/\s+/)
      .filter(token => token.length > 0);
  }

  /**
   * Jaccard 相似度
   */
  private jaccardSimilarity(setA: string[], setB: string[]): number {
    const a = new Set(setA);
    const b = new Set(setB);

    const intersection = new Set([...a].filter(x => b.has(x)));
    const union = new Set([...a, ...b]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }
}

/**
 * 全局单例
 */
let globalDashboard: ContextHealthDashboard | null = null;

/**
 * 获取全局仪表板实例
 */
export function getContextHealthDashboard(): ContextHealthDashboard {
  if (!globalDashboard) {
    globalDashboard = new ContextHealthDashboard();
  }
  return globalDashboard;
}

/**
 * 重置全局实例（用于测试）
 */
export function resetContextHealthDashboard(): void {
  globalDashboard = null;
}
