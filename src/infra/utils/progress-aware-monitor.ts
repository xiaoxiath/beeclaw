// @deprecated - Dead code identified in audit (2026-03-25). Not imported by any production module. Scheduled for removal.
/**
 * progress-aware-monitor.ts — P2 进度感知活跃检测
 * 
 * 问题：原 smart-timeout.ts 仅基于最后活动时间戳判断超时，
 *       无法区分"真正卡死"和"正在处理复杂任务"。
 * 方案：引入信息增益估计 + 里程碑追踪 + 自适应超时 + 健康评分
 */

// ─── 信息增益估计器 ─────────────────────────────────────────

/** DJB2-style 简单字符串哈希 */
function simpleHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

interface GainEntry {
  fingerprint: number;
  timestamp: number;
  gain: number;
}

export class InformationGainEstimator {
  private seen: Map<number, number> = new Map();
  private history: GainEntry[] = [];
  private readonly maxHistory: number;
  private readonly decayFactor: number;

  constructor(options?: { maxHistory?: number; decayFactor?: number }) {
    this.maxHistory = options?.maxHistory ?? 200;
    this.decayFactor = options?.decayFactor ?? 0.95;
  }

  estimate(content: string, contentSize?: number): number {
    const fp = simpleHash(content);
    const count = this.seen.get(fp) ?? 0;

    const novelty = 1 / (1 + count);
    const frequencyDecay = Math.pow(this.decayFactor, count);
    const size = contentSize ?? content.length;
    const sizeFactor = Math.min(1, Math.log2(Math.max(1, size)) / 20);
    const marginalFactor = 1 / (1 + this.history.length * 0.01);
    const gain = novelty * frequencyDecay * sizeFactor * marginalFactor;

    this.seen.set(fp, count + 1);
    this.history.push({ fingerprint: fp, timestamp: Date.now(), gain });
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
    return Math.min(1, Math.max(0, gain));
  }

  getRecentAverageGain(windowSize: number = 10): number {
    if (this.history.length === 0) return 0;
    const win = this.history.slice(-windowSize);
    return win.reduce((sum, e) => sum + e.gain, 0) / win.length;
  }

  getTrend(windowSize: number = 10): 'accelerating' | 'steady' | 'decelerating' | 'stalled' {
    if (this.history.length < windowSize * 2) return 'steady';
    const recent = this.history.slice(-windowSize);
    const previous = this.history.slice(-windowSize * 2, -windowSize);
    const recentAvg = recent.reduce((s, e) => s + e.gain, 0) / recent.length;
    const prevAvg = previous.reduce((s, e) => s + e.gain, 0) / previous.length;
    const ratio = prevAvg > 0 ? recentAvg / prevAvg : recentAvg > 0 ? 2 : 0;

    if (ratio > 1.2) return 'accelerating';
    if (ratio > 0.8) return 'steady';
    if (ratio > 0.1) return 'decelerating';
    return 'stalled';
  }

  reset(): void {
    this.seen.clear();
    this.history = [];
  }
}

// ─── 里程碑追踪器 ───────────────────────────────────────────

export interface Milestone {
  id: string;
  description: string;
  completed: boolean;
  completedAt?: number;
  addedAt: number;
}

export class MilestoneTracker {
  private milestones: Map<string, Milestone> = new Map();

  add(id: string, description: string): void {
    if (this.milestones.has(id)) return;
    this.milestones.set(id, { id, description, completed: false, addedAt: Date.now() });
  }

  complete(id: string): boolean {
    const m = this.milestones.get(id);
    if (!m || m.completed) return false;
    m.completed = true;
    m.completedAt = Date.now();
    return true;
  }

  getCompleted(): Milestone[] {
    return Array.from(this.milestones.values()).filter((m) => m.completed);
  }

  getPending(): Milestone[] {
    return Array.from(this.milestones.values()).filter((m) => !m.completed);
  }

  getCompletionRatio(): number {
    if (this.milestones.size === 0) return 0;
    return this.getCompleted().length / this.milestones.size;
  }
}

// ─── 事件类型与环形缓冲 ──────────────────────────────────────

export type MonitorEventType =
  | 'tool_call' | 'tool_result' | 'llm_response'
  | 'user_message' | 'error' | 'retry' | 'checkpoint';

export interface MonitorEvent {
  type: MonitorEventType;
  timestamp: number;
  toolName?: string;
  contentSize?: number;
  informationGain?: number;
  metadata?: Record<string, unknown>;
}

class EventRingBuffer {
  private buffer: MonitorEvent[];
  private writeIndex = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    this.buffer = new Array(capacity);
  }

  push(event: MonitorEvent): void {
    this.buffer[this.writeIndex] = event;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  getRecent(n: number): MonitorEvent[] {
    const cnt = Math.min(n, this.count);
    const result: MonitorEvent[] = [];
    for (let i = 0; i < cnt; i++) {
      const idx = (this.writeIndex - cnt + i + this.capacity) % this.capacity;
      result.push(this.buffer[idx]);
    }
    return result;
  }

  getInWindow(windowMs: number): MonitorEvent[] {
    const cutoff = Date.now() - windowMs;
    return this.getRecent(this.count).filter((e) => e.timestamp >= cutoff);
  }

  size(): number { return this.count; }
}

// ─── 核心监控器 ─────────────────────────────────────────────

export interface StallCheckResult {
  isStalled: boolean;
  healthScore: number;
  trend: 'accelerating' | 'steady' | 'decelerating' | 'stalled';
  recommendedAction: 'continue' | 'inject_guidance' | 'escalate' | 'abort';
  suggestion?: string;
  adaptiveTimeoutMs: number;
  details: {
    eventRate: number;
    avgGain: number;
    milestoneProgress: number;
    recentErrors: number;
    recentRetries: number;
  };
}

export interface ProgressMonitorConfig {
  bufferCapacity: number;
  baseTimeoutMs: number;
  minTimeoutMs: number;
  maxTimeoutMs: number;
  rateWindowMs: number;
  stallThreshold: number;
  checkIntervalMs: number;
  onStall?: (result: StallCheckResult) => void;
}

const DEFAULT_MONITOR_CONFIG: ProgressMonitorConfig = {
  bufferCapacity: 500,
  baseTimeoutMs: 300_000,
  minTimeoutMs: 60_000,
  maxTimeoutMs: 900_000,
  rateWindowMs: 60_000,
  stallThreshold: 30,
  checkIntervalMs: 30_000,
};

export class ProgressAwareMonitor {
  private readonly config: ProgressMonitorConfig;
  private readonly events: EventRingBuffer;
  private readonly gainEstimator: InformationGainEstimator;
  private readonly milestones: MilestoneTracker;
  private checkTimer?: ReturnType<typeof setInterval>;
  private startTime: number;

  constructor(config?: Partial<ProgressMonitorConfig>) {
    this.config = { ...DEFAULT_MONITOR_CONFIG, ...config };
    this.events = new EventRingBuffer(this.config.bufferCapacity);
    this.gainEstimator = new InformationGainEstimator();
    this.milestones = new MilestoneTracker();
    this.startTime = Date.now();
  }

  startPeriodicCheck(): void {
    if (this.checkTimer) return;
    this.checkTimer = setInterval(() => {
      const result = this.checkStall();
      if (result.isStalled && this.config.onStall) this.config.onStall(result);
    }, this.config.checkIntervalMs);
  }

  stopPeriodicCheck(): void {
    if (this.checkTimer) { clearInterval(this.checkTimer); this.checkTimer = undefined; }
  }

  // ─── 事件记录 ─────────────────────────────────────────

  recordToolCall(toolName: string): void {
    this.events.push({ type: 'tool_call', timestamp: Date.now(), toolName });
  }

  recordToolResult(toolName: string, resultContent: string, resultSize: number): void {
    const gain = this.gainEstimator.estimate(resultContent, resultSize);
    this.events.push({ type: 'tool_result', timestamp: Date.now(), toolName, contentSize: resultSize, informationGain: gain });
  }

  recordLLMResponse(content: string): void {
    const gain = this.gainEstimator.estimate(content);
    this.events.push({ type: 'llm_response', timestamp: Date.now(), contentSize: content.length, informationGain: gain });
  }

  recordUserMessage(): void {
    this.events.push({ type: 'user_message', timestamp: Date.now() });
  }

  recordError(toolName?: string, errorMessage?: string): void {
    this.events.push({ type: 'error', timestamp: Date.now(), toolName, metadata: errorMessage ? { message: errorMessage } : undefined });
  }

  recordRetry(toolName?: string, attempt?: number): void {
    this.events.push({ type: 'retry', timestamp: Date.now(), toolName, metadata: attempt !== undefined ? { attempt } : undefined });
  }

  recordCheckpoint(): void {
    this.events.push({ type: 'checkpoint', timestamp: Date.now() });
  }

  // ─── 里程碑代理 ───────────────────────────────────────

  addMilestone(id: string, description: string): void { this.milestones.add(id, description); }
  completeMilestone(id: string): boolean { return this.milestones.complete(id); }
  getMilestoneProgress(): { completed: number; total: number; ratio: number } {
    return {
      completed: this.milestones.getCompleted().length,
      total: this.milestones.getCompleted().length + this.milestones.getPending().length,
      ratio: this.milestones.getCompletionRatio(),
    };
  }

  // ─── 核心分析 ─────────────────────────────────────────

  checkStall(): StallCheckResult {
    const recentEvents = this.events.getInWindow(this.config.rateWindowMs);
    const eventRate = recentEvents.length;
    const avgGain = this.gainEstimator.getRecentAverageGain(10);
    const trend = this.gainEstimator.getTrend(10);
    const milestoneProgress = this.milestones.getCompletionRatio();
    const recentErrors = recentEvents.filter((e) => e.type === 'error').length;
    const recentRetries = recentEvents.filter((e) => e.type === 'retry').length;

    const healthScore = this.computeHealthScore(eventRate, avgGain, milestoneProgress, recentErrors, recentRetries);
    const adaptiveTimeoutMs = this.computeAdaptiveTimeout(eventRate, avgGain, milestoneProgress);
    const isStalled = healthScore < this.config.stallThreshold;
    const recommendedAction = this.computeRecommendedAction(healthScore, trend, recentErrors);
    const suggestion = isStalled ? this.generateStallSuggestion(recentEvents, trend) : undefined;

    return { isStalled, healthScore, trend, recommendedAction, suggestion, adaptiveTimeoutMs, details: { eventRate, avgGain, milestoneProgress, recentErrors, recentRetries } };
  }

  private computeHealthScore(eventRate: number, avgGain: number, milestoneProgress: number, recentErrors: number, recentRetries: number): number {
    const rateScore = Math.min(40, eventRate * 8);
    const gainScore = avgGain * 30;
    const errorPenalty = Math.min(15, (recentErrors + recentRetries * 0.5) * 3);
    const milestoneScore = milestoneProgress * 15;
    return Math.max(0, Math.min(100, rateScore + gainScore - errorPenalty + milestoneScore));
  }

  private computeAdaptiveTimeout(eventRate: number, avgGain: number, milestoneProgress: number): number {
    let timeout = this.config.baseTimeoutMs;
    if (eventRate > 3) timeout *= 1.5;
    else if (eventRate > 1) timeout *= 1.2;
    else if (eventRate === 0) timeout *= 0.5;
    if (avgGain > 0.5) timeout *= 1.3;
    else if (avgGain < 0.1) timeout *= 0.7;
    if (milestoneProgress > 0.8) timeout *= 0.8;
    return Math.max(this.config.minTimeoutMs, Math.min(this.config.maxTimeoutMs, timeout));
  }

  private computeRecommendedAction(healthScore: number, trend: string, recentErrors: number): 'continue' | 'inject_guidance' | 'escalate' | 'abort' {
    if (healthScore >= 60) return 'continue';
    if (healthScore >= 40) return (trend === 'decelerating' || trend === 'stalled') ? 'inject_guidance' : 'continue';
    if (healthScore >= 20) return recentErrors > 3 ? 'escalate' : 'inject_guidance';
    return 'abort';
  }

  private generateStallSuggestion(recentEvents: MonitorEvent[], trend: string): string {
    const errorEvents = recentEvents.filter((e) => e.type === 'error');
    const retryEvents = recentEvents.filter((e) => e.type === 'retry');
    const toolEvents = recentEvents.filter((e) => e.type === 'tool_call');

    if (errorEvents.length > 3) {
      const toolNames = [...new Set(errorEvents.map((e) => e.toolName).filter(Boolean))];
      return `High error rate detected. Failing tools: ${toolNames.join(', ')}. Consider switching approach.`;
    }
    if (retryEvents.length > 3) return `Excessive retries detected. Consider increasing timeout or using alternative tools.`;
    if (toolEvents.length === 0) return `No tool activity detected. Agent may be stuck in reasoning loop.`;
    if (trend === 'stalled') {
      const toolCounts = new Map<string, number>();
      for (const e of toolEvents) { if (e.toolName) toolCounts.set(e.toolName, (toolCounts.get(e.toolName) ?? 0) + 1); }
      const maxTool = [...toolCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (maxTool && maxTool[1] > toolEvents.length * 0.6) return `Repeatedly calling "${maxTool[0]}" (${maxTool[1]}x). Consider a different approach.`;
      return `Progress stalled with diminishing information gain. Consider adjusting strategy.`;
    }
    return `Progress is slow. Consider intervening if no improvement.`;
  }

  generateReport(): string {
    const stall = this.checkStall();
    const elapsed = Date.now() - this.startTime;
    const mp = this.getMilestoneProgress();
    const lines: string[] = [
      `[Progress Monitor Report]`,
      `  Elapsed: ${Math.round(elapsed / 1000)}s`,
      `  Health: ${stall.healthScore.toFixed(1)}/100 (${stall.trend})`,
      `  Events in window: ${stall.details.eventRate}`,
      `  Avg info gain: ${stall.details.avgGain.toFixed(3)}`,
      `  Milestones: ${mp.completed}/${mp.total} (${(mp.ratio * 100).toFixed(0)}%)`,
      `  Errors: ${stall.details.recentErrors}, Retries: ${stall.details.recentRetries}`,
      `  Adaptive timeout: ${Math.round(stall.adaptiveTimeoutMs / 1000)}s`,
      `  Recommended: ${stall.recommendedAction}`,
    ];
    if (stall.suggestion) lines.push(`  Suggestion: ${stall.suggestion}`);
    return lines.join('\n');
  }

  dispose(): void {
    this.stopPeriodicCheck();
    this.gainEstimator.reset();
  }
}
