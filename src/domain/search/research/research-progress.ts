/**
 * research-progress.ts — P1-2: 研究进度事件系统
 *
 * 提供结构化的进度事件，使 Deep Research 过程中的每个阶段
 * 对用户可见（可通过 chatStream() 推送到前端）。
 *
 * 支持两种消费模式：
 *   1. 回调模式 — 注册 listener，实时接收事件
 *   2. 轮询模式 — getSnapshot() 获取当前状态快照
 *
 * 集成点：
 *   - deep-research-v2.ts 在每个阶段转换时发射事件
 *   - Agent 的 chatStream() 将事件转换为 SSE 推送
 *   - 前端渲染为进度条/步骤列表/实时日志
 */

// ─── Types ────────────────────────────────────────────────

/** 研究阶段 */
export type ResearchPhase =
  | 'planning'       // 生成研究计划
  | 'searching'      // 执行搜索查询
  | 'fetching'       // 获取来源内容
  | 'analyzing'      // 来源可信度评估
  | 'synthesizing'   // LLM 综合
  | 'refining'       // 迭代精炼
  | 'finalizing'     // 生成最终报告
  | 'completed'      // 完成
  | 'error';         // 出错

/** 研究进度事件 */
export interface ResearchProgressEvent {
  /** 当前阶段 */
  phase: ResearchPhase;
  /** 人类可读的详情说明 */
  detail: string;
  /** 当前阶段进度 (0.0 - 1.0) */
  progress: number;
  /** 时间戳 (ms) */
  timestamp: number;
  /** 可选: 中间结果预览 */
  partialResult?: string;
  /** 可选: 已获取来源数 */
  sourcesFound?: number;
  /** 可选: 当前精炼轮次 */
  refinementRound?: number;
  /** 可选: 覆盖度分数 */
  coverageScore?: number;
  /** 可选: 错误信息 */
  error?: string;
}

/** 研究状态快照 */
export interface ResearchSnapshot {
  /** 研究开始时间 */
  startedAt: number;
  /** 当前阶段 */
  currentPhase: ResearchPhase;
  /** 整体进度 (0.0 - 1.0) */
  overallProgress: number;
  /** 已完成的阶段列表 */
  completedPhases: ResearchPhase[];
  /** 事件历史 */
  events: ResearchProgressEvent[];
  /** 当前统计 */
  stats: {
    queriesExecuted: number;
    sourcesFetched: number;
    refinementRounds: number;
    elapsedMs: number;
    estimatedRemainingMs: number;
  };
}

/** 进度监听器 */
export type ProgressListener = (event: ResearchProgressEvent) => void;

/** 阶段权重（用于计算整体进度） */
const PHASE_WEIGHTS: Record<ResearchPhase, { start: number; end: number }> = {
  planning:     { start: 0.00, end: 0.08 },
  searching:    { start: 0.08, end: 0.25 },
  fetching:     { start: 0.25, end: 0.45 },
  analyzing:    { start: 0.45, end: 0.55 },
  synthesizing: { start: 0.55, end: 0.70 },
  refining:     { start: 0.70, end: 0.92 },
  finalizing:   { start: 0.92, end: 1.00 },
  completed:    { start: 1.00, end: 1.00 },
  error:        { start: 0.00, end: 0.00 },
};

// ─── Emitter Class ───────────────────────────────────────

export class ResearchProgressEmitter {
  private listeners: Set<ProgressListener> = new Set();
  private events: ResearchProgressEvent[] = [];
  private startedAt: number = 0;
  private currentPhase: ResearchPhase = 'planning';
  private completedPhases: Set<ResearchPhase> = new Set();
  private stats = {
    queriesExecuted: 0,
    sourcesFetched: 0,
    refinementRounds: 0,
  };

  /** 开始追踪 */
  start(): void {
    this.startedAt = Date.now();
    this.events = [];
    this.completedPhases.clear();
    this.stats = { queriesExecuted: 0, sourcesFetched: 0, refinementRounds: 0 };
    this.currentPhase = 'planning';
  }

  /** 注册进度监听器 */
  on(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 发射进度事件 */
  emit(event: ResearchProgressEvent): void {
    // 更新内部状态
    if (event.phase !== this.currentPhase) {
      this.completedPhases.add(this.currentPhase);
      this.currentPhase = event.phase;
    }

    // 更新统计
    if (event.sourcesFound !== undefined) {
      this.stats.sourcesFetched = event.sourcesFound;
    }
    if (event.refinementRound !== undefined) {
      this.stats.refinementRounds = event.refinementRound;
    }

    // 存储事件
    this.events.push(event);

    // 通知所有监听器
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(event);
      } catch (e) {
        // 监听器异常不应影响主流程
        console.warn('[ResearchProgress] Listener error:', e);
      }
    }
  }

  /** 便捷方法: 发射阶段进度 */
  phaseProgress(
    phase: ResearchPhase,
    detail: string,
    phaseProgress: number,
    extra?: Partial<ResearchProgressEvent>,
  ): void {
    this.emit({
      phase,
      detail,
      progress: phaseProgress,
      timestamp: Date.now(),
      ...extra,
    });
  }

  /** 便捷方法: 标记阶段开始 */
  phaseStart(phase: ResearchPhase, detail: string): void {
    this.phaseProgress(phase, detail, 0);
  }

  /** 便捷方法: 标记阶段完成 */
  phaseComplete(phase: ResearchPhase, detail: string): void {
    this.phaseProgress(phase, detail, 1.0);
  }

  /** 便捷方法: 增加查询计数 */
  incrementQueries(count: number = 1): void {
    this.stats.queriesExecuted += count;
  }

  /** 便捷方法: 增加来源计数 */
  incrementSources(count: number = 1): void {
    this.stats.sourcesFetched += count;
  }

  /** 便捷方法: 发射错误 */
  emitError(error: string, detail?: string): void {
    this.emit({
      phase: 'error',
      detail: detail || error,
      progress: 0,
      timestamp: Date.now(),
      error,
    });
  }

  /** 获取当前状态快照 */
  getSnapshot(): ResearchSnapshot {
    const now = Date.now();
    const elapsed = this.startedAt > 0 ? now - this.startedAt : 0;
    const overallProgress = this.calculateOverallProgress();

    // 估算剩余时间
    let estimatedRemaining = 0;
    if (overallProgress > 0.05 && overallProgress < 1.0) {
      estimatedRemaining = Math.round(elapsed * (1 - overallProgress) / overallProgress);
    }

    return {
      startedAt: this.startedAt,
      currentPhase: this.currentPhase,
      overallProgress,
      completedPhases: Array.from(this.completedPhases),
      events: [...this.events],
      stats: {
        ...this.stats,
        elapsedMs: elapsed,
        estimatedRemainingMs: estimatedRemaining,
      },
    };
  }

  /** 生成人类可读的进度摘要（可用于 SSE 推送） */
  getProgressMessage(): string {
    const snapshot = this.getSnapshot();
    const pct = Math.round(snapshot.overallProgress * 100);
    const elapsed = (snapshot.stats.elapsedMs / 1000).toFixed(0);
    const remaining = snapshot.stats.estimatedRemainingMs > 0
      ? ` | 预计剩余 ${(snapshot.stats.estimatedRemainingMs / 1000).toFixed(0)}s`
      : '';

    const phaseLabel = this.getPhaseLabel(snapshot.currentPhase);
    const lastEvent = this.events[this.events.length - 1];
    const detail = lastEvent?.detail || '';

    return `[${pct}%] ${phaseLabel}: ${detail} (${elapsed}s${remaining})`;
  }

  /** 生成 SSE 格式的进度事件（可直接用于 chatStream） */
  toSSEEvent(event: ResearchProgressEvent): string {
    return JSON.stringify({
      type: 'research_progress',
      phase: event.phase,
      detail: event.detail,
      progress: event.progress,
      overallProgress: this.calculateOverallProgress(),
      stats: this.getSnapshot().stats,
    });
  }

  /** 清理资源 */
  dispose(): void {
    this.listeners.clear();
    this.events = [];
  }

  // ── Private ──

  private calculateOverallProgress(): number {
    if (this.currentPhase === 'completed') return 1.0;
    if (this.currentPhase === 'error') {
      // 错误时返回出错前的进度
      const lastNonError = this.events.filter(e => e.phase !== 'error').pop();
      if (lastNonError) {
        const weight = PHASE_WEIGHTS[lastNonError.phase];
        return weight ? weight.start + (weight.end - weight.start) * lastNonError.progress : 0;
      }
      return 0;
    }

    const weight = PHASE_WEIGHTS[this.currentPhase];
    if (!weight) return 0;

    const lastEvent = this.events.filter(e => e.phase === this.currentPhase).pop();
    const phaseProgress = lastEvent?.progress ?? 0;

    return weight.start + (weight.end - weight.start) * phaseProgress;
  }

  private getPhaseLabel(phase: ResearchPhase): string {
    const labels: Record<ResearchPhase, string> = {
      planning: '📋 生成研究计划',
      searching: '🔍 执行搜索',
      fetching: '📥 获取来源内容',
      analyzing: '🔬 分析来源可信度',
      synthesizing: '🧠 LLM 综合分析',
      refining: '🔄 迭代精炼',
      finalizing: '📝 生成最终报告',
      completed: '✅ 研究完成',
      error: '❌ 发生错误',
    };
    return labels[phase] || phase;
  }
}

// ─── Utility: Format for Stream Output ───────────────────

/**
 * 将进度事件格式化为可直接嵌入 chatStream 的文本块。
 * 前端可根据 `<!-- research-progress:... -->` 标记解析进度。
 */
export function formatProgressForStream(event: ResearchProgressEvent): string {
  const _pct = Math.round(event.progress * 100);
  const phaseEmoji: Record<string, string> = {
    planning: '📋', searching: '🔍', fetching: '📥', analyzing: '🔬',
    synthesizing: '🧠', refining: '🔄', finalizing: '📝',
    completed: '✅', error: '❌',
  };
  const emoji = phaseEmoji[event.phase] || '⏳';

  return `<!-- research-progress:${JSON.stringify({
    phase: event.phase,
    progress: event.progress,
    sourcesFound: event.sourcesFound,
    coverageScore: event.coverageScore,
    refinementRound: event.refinementRound,
  })} -->\n${emoji} ${event.detail}${event.coverageScore ? ` (覆盖度: ${event.coverageScore}%)` : ''}`;
}
