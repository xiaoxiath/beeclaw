/**
 * P3-#16: 自动化技能发现引擎
 * 
 * 原始问题：技能系统完全由 LLM 工具调用驱动（skill_ensure → skill-creator），
 * 需要用户主动指令才能创建新技能。没有从历史对话中自动挖掘"潜在技能需求"
 * 的能力（如频繁的多步操作、固定指令序列等）。
 * 
 * 优化方案：
 * 1. 序列模式挖掘 — 检测重复出现的工具调用序列
 * 2. 意图聚类 — 将相似的用户请求聚类，识别共性操作
 * 3. 技能候选提议 — 生成可被 skill-creator 执行的技能规格
 * 4. 频率阈值 — 只有超过阈值的模式才会成为候选
 * 5. 用户确认工作流 — 候选技能需用户确认后才正式创建
 */

// ─── 类型定义 ─────────────────────────────────────────────

/** 工具调用序列记录 */
export interface ToolSequence {
  /** 时间戳 */
  timestamp: string;
  /** 用户原始输入 */
  userMessage: string;
  /** 工具调用序列 */
  tools: Array<{
    name: string;
    params: Record<string, unknown>;
    success: boolean;
  }>;
  /** 最终结果描述 */
  outcome?: string;
}

/** 技能候选 */
export interface SkillCandidate {
  /** 候选 ID */
  id: string;
  /** 建议的技能名称 */
  suggestedName: string;
  /** 技能描述 */
  description: string;
  /** 触发条件（关键词/意图） */
  triggers: string[];
  /** 工具调用模板 */
  toolSequence: Array<{ name: string; paramTemplate: Record<string, string> }>;
  /** 发现频率 */
  frequency: number;
  /** 置信度 (0-1) */
  confidence: number;
  /** 预估节省的平均轮次 */
  estimatedSavings: number;
  /** 支撑证据 */
  evidence: Array<{
    timestamp: string;
    userMessage: string;
    tools: string[];
  }>;
  /** 状态 */
  status: 'discovered' | 'proposed' | 'accepted' | 'rejected';
  /** 发现时间 */
  discoveredAt: string;
}

/** 技能发现配置 */
export interface SkillDiscoveryConfig {
  /** 最小序列出现次数 */
  minSequenceFrequency: number;
  /** 最小序列长度（工具调用数） */
  minSequenceLength: number;
  /** 最大序列长度 */
  maxSequenceLength: number;
  /** 意图相似度阈值 */
  intentSimilarityThreshold: number;
  /** 是否自动提议（否则只记录） */
  autoPropose: boolean;
  /** 最大候选数 */
  maxCandidates: number;
}

// ─── 默认配置 ──────────────────────────────────────────────

const DEFAULT_CONFIG: SkillDiscoveryConfig = {
  minSequenceFrequency: 3,
  minSequenceLength: 2,
  maxSequenceLength: 8,
  intentSimilarityThreshold: 0.6,
  autoPropose: true,
  maxCandidates: 20,
};

// ─── 核心实现 ─────────────────────────────────────────────

/**
 * 自动化技能发现引擎
 */
export class SkillDiscoveryEngine {
  private config: SkillDiscoveryConfig;
  private sequences: ToolSequence[] = [];
  private candidates: Map<string, SkillCandidate> = new Map();

  constructor(config: Partial<SkillDiscoveryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 记录一次对话中的工具调用序列
   */
  recordSequence(sequence: ToolSequence): void {
    this.sequences.push(sequence);

    // 限制缓存大小
    if (this.sequences.length > 1000) {
      this.sequences = this.sequences.slice(-1000);
    }
  }

  /**
   * 从对话记录批量导入序列
   */
  importFromConversations(
    records: Array<{
      timestamp: string;
      userMessage: string;
      toolsCalled?: Array<{ name: string; params?: Record<string, unknown>; success: boolean }>;
      outcome?: string;
    }>
  ): number {
    let imported = 0;
    for (const record of records) {
      if (record.toolsCalled && record.toolsCalled.length >= this.config.minSequenceLength) {
        this.recordSequence({
          timestamp: record.timestamp,
          userMessage: record.userMessage,
          tools: record.toolsCalled.map(t => ({
            name: t.name,
            params: t.params || {},
            success: t.success,
          })),
          outcome: record.outcome,
        });
        imported++;
      }
    }
    return imported;
  }

  /**
   * 执行技能发现
   */
  discover(): SkillCandidate[] {
    const newCandidates: SkillCandidate[] = [];

    // 1. 工具序列模式挖掘
    const sequencePatterns = this.mineSequencePatterns();
    for (const pattern of sequencePatterns) {
      const candidate = this.patternToCandidate(pattern);
      if (candidate && !this.candidates.has(candidate.id)) {
        newCandidates.push(candidate);
        this.candidates.set(candidate.id, candidate);
      }
    }

    // 2. 意图聚类
    const intentClusters = this.clusterByIntent();
    for (const cluster of intentClusters) {
      const candidate = this.clusterToCandidate(cluster);
      if (candidate && !this.candidates.has(candidate.id)) {
        newCandidates.push(candidate);
        this.candidates.set(candidate.id, candidate);
      }
    }

    // 限制候选数
    if (this.candidates.size > this.config.maxCandidates) {
      const sorted = Array.from(this.candidates.entries())
        .sort((a, b) => b[1].frequency - a[1].frequency);
      this.candidates = new Map(sorted.slice(0, this.config.maxCandidates));
    }

    return newCandidates;
  }

  /**
   * 获取所有候选技能
   */
  getCandidates(filter?: {
    status?: SkillCandidate['status'];
    minFrequency?: number;
    minConfidence?: number;
  }): SkillCandidate[] {
    let results = Array.from(this.candidates.values());

    if (filter?.status) results = results.filter(c => c.status === filter.status);
    if (filter?.minFrequency != null) results = results.filter(c => c.frequency >= filter.minFrequency!);
    if (filter?.minConfidence != null) results = results.filter(c => c.confidence >= filter.minConfidence!);

    return results.sort((a, b) => b.frequency * b.confidence - a.frequency * a.confidence);
  }

  /**
   * 接受候选技能
   */
  acceptCandidate(id: string): SkillCandidate | null {
    const candidate = this.candidates.get(id);
    if (candidate) {
      candidate.status = 'accepted';
      return candidate;
    }
    return null;
  }

  /**
   * 拒绝候选技能
   */
  rejectCandidate(id: string): boolean {
    const candidate = this.candidates.get(id);
    if (candidate) {
      candidate.status = 'rejected';
      return true;
    }
    return false;
  }

  /**
   * 生成技能规格（供 skill-creator 使用）
   */
  generateSkillSpec(candidateId: string): string | null {
    const candidate = this.candidates.get(candidateId);
    if (!candidate) return null;

    return [
      `# ${candidate.suggestedName}`,
      '',
      `## 描述`,
      candidate.description,
      '',
      `## 触发条件`,
      candidate.triggers.map(t => `- ${t}`).join('\n'),
      '',
      `## 工具调用步骤`,
      ...candidate.toolSequence.map((step, i) => {
        const params = Object.entries(step.paramTemplate)
          .map(([k, v]) => `  - ${k}: ${v}`)
          .join('\n');
        return `${i + 1}. 调用 \`${step.name}\`\n${params}`;
      }),
      '',
      `## 统计`,
      `- 出现频率: ${candidate.frequency} 次`,
      `- 置信度: ${(candidate.confidence * 100).toFixed(0)}%`,
      `- 预估节省: ${candidate.estimatedSavings} 轮对话`,
      '',
      `## 证据`,
      ...candidate.evidence.slice(0, 3).map(e =>
        `- [${e.timestamp}] "${e.userMessage}" → ${e.tools.join(' → ')}`
      ),
    ].join('\n');
  }

  /**
   * 获取发现统计
   */
  getStats(): {
    totalSequences: number;
    totalCandidates: number;
    statusDistribution: Record<string, number>;
    avgFrequency: number;
    avgConfidence: number;
  } {
    const candidates = Array.from(this.candidates.values());
    const statusDist: Record<string, number> = {};
    let totalFreq = 0;
    let totalConf = 0;

    for (const c of candidates) {
      statusDist[c.status] = (statusDist[c.status] || 0) + 1;
      totalFreq += c.frequency;
      totalConf += c.confidence;
    }

    return {
      totalSequences: this.sequences.length,
      totalCandidates: candidates.length,
      statusDistribution: statusDist,
      avgFrequency: candidates.length > 0 ? totalFreq / candidates.length : 0,
      avgConfidence: candidates.length > 0 ? totalConf / candidates.length : 0,
    };
  }

  // ─── 序列模式挖掘 ──────────────────────────────────────

  private mineSequencePatterns(): Array<{
    toolNames: string[];
    occurrences: ToolSequence[];
    frequency: number;
  }> {
    const patternMap: Record<string, {
      toolNames: string[];
      occurrences: ToolSequence[];
    }> = {};

    // 提取所有子序列
    for (const seq of this.sequences) {
      if (seq.tools.length < this.config.minSequenceLength) continue;
      // 只考虑成功的工具调用
      const successTools = seq.tools.filter(t => t.success);
      if (successTools.length < this.config.minSequenceLength) continue;

      // 生成不同长度的子序列
      for (let len = this.config.minSequenceLength; len <= Math.min(successTools.length, this.config.maxSequenceLength); len++) {
        for (let start = 0; start <= successTools.length - len; start++) {
          const subSeq = successTools.slice(start, start + len);
          const key = subSeq.map(t => t.name).join(' → ');

          if (!patternMap[key]) {
            patternMap[key] = { toolNames: subSeq.map(t => t.name), occurrences: [] };
          }
          patternMap[key].occurrences.push(seq);
        }
      }
    }

    // 过滤低频模式并去重
    return Object.values(patternMap)
      .filter(p => p.occurrences.length >= this.config.minSequenceFrequency)
      .map(p => ({
        ...p,
        frequency: p.occurrences.length,
        // 去重 occurrences（同一对话可能产生多个子序列）
        occurrences: this.deduplicateByTimestamp(p.occurrences),
      }))
      .filter(p => p.occurrences.length >= this.config.minSequenceFrequency)
      .sort((a, b) => b.frequency - a.frequency);
  }

  private deduplicateByTimestamp(sequences: ToolSequence[]): ToolSequence[] {
    const seen = new Set<string>();
    return sequences.filter(s => {
      if (seen.has(s.timestamp)) return false;
      seen.add(s.timestamp);
      return true;
    });
  }

  // ─── 意图聚类 ──────────────────────────────────────────

  private clusterByIntent(): Array<{
    intent: string;
    sequences: ToolSequence[];
    commonTools: string[];
  }> {
    const clusters: Record<string, ToolSequence[]> = {};

    // 基于用户消息的关键词相似度做简单聚类
    for (const seq of this.sequences) {
      const intent = this.extractIntent(seq.userMessage);
      if (!clusters[intent]) clusters[intent] = [];
      clusters[intent].push(seq);
    }

    return Object.entries(clusters)
      .filter(([_, seqs]) => seqs.length >= this.config.minSequenceFrequency)
      .map(([intent, seqs]) => ({
        intent,
        sequences: seqs,
        commonTools: this.findCommonTools(seqs),
      }))
      .filter(c => c.commonTools.length >= this.config.minSequenceLength);
  }

  private extractIntent(message: string): string {
    // 简单的意图提取：取前 3 个有意义的词
    const words = message
      .replace(/[^\u4e00-\u9fff\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 1 && !this.isStopWord(w))
      .slice(0, 3);
    return words.join('_') || 'general';
  }

  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一',
      '这', '中', '大', '为', '上', '个', '国', '到', '说', '们', '地',
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
      'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'my',
      'please', 'can', 'could', 'would', 'should', 'help',
    ]);
    return stopWords.has(word.toLowerCase());
  }

  private findCommonTools(sequences: ToolSequence[]): string[] {
    if (sequences.length === 0) return [];

    // 统计每个工具在序列中出现的频率
    const toolFreq: Record<string, number> = {};
    for (const seq of sequences) {
      const toolNames = new Set(seq.tools.map(t => t.name));
      for (const name of toolNames) {
        toolFreq[name] = (toolFreq[name] || 0) + 1;
      }
    }

    // 取出现在超过半数序列中的工具
    const threshold = sequences.length * 0.5;
    return Object.entries(toolFreq)
      .filter(([_, freq]) => freq >= threshold)
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
  }

  // ─── 模式 → 候选转换 ──────────────────────────────────

  private patternToCandidate(
    pattern: { toolNames: string[]; occurrences: ToolSequence[]; frequency: number }
  ): SkillCandidate | null {
    const id = `seq_${pattern.toolNames.join('_')}`;

    // 从出现记录中提取信息
    const triggers = this.extractCommonTriggers(pattern.occurrences);
    const paramTemplates = this.extractParamTemplates(pattern.occurrences, pattern.toolNames);

    const suggestedName = this.generateSkillName(pattern.toolNames, triggers);

    return {
      id,
      suggestedName,
      description: `自动执行 ${pattern.toolNames.join(' → ')} 工具链（出现 ${pattern.frequency} 次）`,
      triggers,
      toolSequence: pattern.toolNames.map((name, i) => ({
        name,
        paramTemplate: paramTemplates[i] || {},
      })),
      frequency: pattern.frequency,
      confidence: Math.min(pattern.frequency / 10, 0.95),
      estimatedSavings: pattern.toolNames.length,
      evidence: pattern.occurrences.slice(0, 5).map(o => ({
        timestamp: o.timestamp,
        userMessage: o.userMessage.substring(0, 100),
        tools: o.tools.map(t => t.name),
      })),
      status: this.config.autoPropose ? 'proposed' : 'discovered',
      discoveredAt: new Date().toISOString(),
    };
  }

  private clusterToCandidate(
    cluster: { intent: string; sequences: ToolSequence[]; commonTools: string[] }
  ): SkillCandidate | null {
    const id = `intent_${cluster.intent}`;

    if (this.candidates.has(id)) return null;

    const triggers = this.extractCommonTriggers(cluster.sequences);

    return {
      id,
      suggestedName: `auto_${cluster.intent}`,
      description: `处理「${cluster.intent}」相关请求（${cluster.sequences.length} 次，常用工具：${cluster.commonTools.join('、')}）`,
      triggers,
      toolSequence: cluster.commonTools.map(name => ({ name, paramTemplate: {} })),
      frequency: cluster.sequences.length,
      confidence: Math.min(cluster.sequences.length / 8, 0.9),
      estimatedSavings: cluster.commonTools.length,
      evidence: cluster.sequences.slice(0, 5).map(s => ({
        timestamp: s.timestamp,
        userMessage: s.userMessage.substring(0, 100),
        tools: s.tools.map(t => t.name),
      })),
      status: this.config.autoPropose ? 'proposed' : 'discovered',
      discoveredAt: new Date().toISOString(),
    };
  }

  // ─── 工具函数 ──────────────────────────────────────────

  private extractCommonTriggers(sequences: ToolSequence[]): string[] {
    const wordFreq: Record<string, number> = {};
    for (const seq of sequences) {
      const words = seq.userMessage
        .replace(/[^\u4e00-\u9fff\w\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 1 && !this.isStopWord(w));
      for (const word of new Set(words)) {
        wordFreq[word] = (wordFreq[word] || 0) + 1;
      }
    }

    // 取出现在超过半数对话中的关键词
    const threshold = Math.max(sequences.length * 0.4, 2);
    return Object.entries(wordFreq)
      .filter(([_, freq]) => freq >= threshold)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
  }

  private extractParamTemplates(
    sequences: ToolSequence[],
    toolNames: string[]
  ): Record<string, string>[] {
    return toolNames.map((name, idx) => {
      const allParams: Record<string, Set<string>> = {};

      for (const seq of sequences) {
        const matchingTool = seq.tools.filter(t => t.name === name)[idx];
        if (matchingTool?.params) {
          for (const [key, value] of Object.entries(matchingTool.params)) {
            if (!allParams[key]) allParams[key] = new Set();
            allParams[key].add(String(value));
          }
        }
      }

      // 如果某个参数值都相同，则固定；否则标记为变量
      const template: Record<string, string> = {};
      for (const [key, values] of Object.entries(allParams)) {
        if (values.size === 1) {
          template[key] = Array.from(values)[0];
        } else {
          template[key] = `{{${key}}}`;
        }
      }
      return template;
    });
  }

  private generateSkillName(toolNames: string[], triggers: string[]): string {
    if (triggers.length > 0) {
      return `auto_${triggers.slice(0, 2).join('_')}`;
    }
    return `auto_${toolNames.slice(0, 2).join('_then_')}`;
  }
}

// ─── 便捷工厂 ──────────────────────────────────────────────

let defaultEngine: SkillDiscoveryEngine | null = null;

export function getSkillDiscoveryEngine(config?: Partial<SkillDiscoveryConfig>): SkillDiscoveryEngine {
  if (!defaultEngine || config) {
    defaultEngine = new SkillDiscoveryEngine(config);
  }
  return defaultEngine;
}
