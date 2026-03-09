/**
 * research-artifacts.ts — 研究制品存储与管理
 * 
 * 解决 BeeClaw Deep Research 的制品持久化问题：
 * - 研究过程中的中间结果（搜索结果、抓取内容、综合报告）
 * - 跨轮次的状态保持
 * - 研究会话恢复（断点续研）
 * - 多研究任务的制品隔离
 * 
 * 与 BeeClaw 现有 memory 系统集成：
 * - 使用 memory_record / memory_write 持久化关键制品
 * - 使用 memory_read / memory_grep 检索历史研究
 * 
 * @module research-artifacts
 */

// ============================================================
// 类型定义
// ============================================================

/** 制品类型枚举 */
export type ArtifactType =
  | 'query_plan'        // 查询计划
  | 'search_results'    // 搜索结果集
  | 'fetched_source'    // 抓取的源文档
  | 'synthesis_report'  // 综合报告
  | 'coverage_eval'     // 覆盖率评估
  | 'refinement_state'  // 精炼状态快照
  | 'final_report'      // 最终报告
  | 'research_session'; // 研究会话元数据

/** 制品元数据 */
export interface ArtifactMeta {
  id: string;
  type: ArtifactType;
  sessionId: string;
  topic: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  sizeBytes: number;
  tags: string[];
  parentId?: string;  // 关联的父制品
}

/** 带内容的完整制品 */
export interface Artifact<T = unknown> extends ArtifactMeta {
  data: T;
}

/** 研究会话 */
export interface ResearchSession {
  id: string;
  topic: string;
  depth: 'quick' | 'standard' | 'comprehensive';
  status: 'active' | 'paused' | 'completed' | 'failed';
  createdAt: number;
  updatedAt: number;
  completedPhases: string[];
  currentPhase?: string;
  artifactIds: string[];
  config: Record<string, unknown>;
  resumeCheckpoint?: ResumeCheckpoint;
}

/** 断点续研检查点 */
export interface ResumeCheckpoint {
  phase: string;
  subStep: string;
  queriesCompleted: number;
  sourcesCollected: number;
  synthesisVersion: number;
  refinementRound: number;
  timestamp: number;
}

/** 查询计划制品 */
export interface QueryPlanData {
  queries: Array<{
    query: string;
    strategy: string;
    targetAspect?: string;
    language: string;
    executed: boolean;
    resultCount?: number;
  }>;
  aspects: string[];
  totalGenerated: number;
}

/** 搜索结果制品 */
export interface SearchResultsData {
  query: string;
  provider: string;
  results: Array<{
    title: string;
    url: string;
    snippet: string;
    score?: number;
  }>;
  executedAt: number;
  latencyMs: number;
}

/** 抓取源制品 */
export interface FetchedSourceData {
  url: string;
  title: string;
  content: string;
  contentLength: number;
  truncated: boolean;
  fetchedAt: number;
  latencyMs: number;
  credibilityScore?: number;
}

// ============================================================
// 存储后端接口
// ============================================================

/**
 * 存储后端抽象 —— 可对接不同的持久化方案
 */
export interface ArtifactStorage {
  /** 存储制品 */
  save(artifact: Artifact): Promise<void>;

  /** 读取制品 */
  load<T = unknown>(id: string): Promise<Artifact<T> | null>;

  /** 按条件查询制品列表（只返回元数据） */
  query(filter: ArtifactFilter): Promise<ArtifactMeta[]>;

  /** 删除制品 */
  delete(id: string): Promise<boolean>;

  /** 按会话删除所有制品 */
  deleteBySession(sessionId: string): Promise<number>;
}

export interface ArtifactFilter {
  sessionId?: string;
  type?: ArtifactType | ArtifactType[];
  topic?: string;
  tags?: string[];
  createdAfter?: number;
  createdBefore?: number;
  limit?: number;
  offset?: number;
}

// ============================================================
// 内存存储实现
// ============================================================

/**
 * 基于内存的制品存储 —— 适用于单次研究会话
 */
export class InMemoryArtifactStorage implements ArtifactStorage {
  private artifacts: Map<string, Artifact> = new Map();
  private maxSize: number;
  private currentSizeBytes: number = 0;

  constructor(options?: { maxSizeBytes?: number }) {
    this.maxSize = options?.maxSizeBytes ?? 50 * 1024 * 1024; // 默认 50MB
  }

  async save(artifact: Artifact): Promise<void> {
    const existing = this.artifacts.get(artifact.id);
    if (existing) {
      this.currentSizeBytes -= existing.sizeBytes;
    }

    // LRU 淘汰
    while (this.currentSizeBytes + artifact.sizeBytes > this.maxSize && this.artifacts.size > 0) {
      const oldest = this.findOldestNonEssential();
      if (oldest) {
        this.artifacts.delete(oldest.id);
        this.currentSizeBytes -= oldest.sizeBytes;
      } else {
        break;
      }
    }

    this.artifacts.set(artifact.id, artifact);
    this.currentSizeBytes += artifact.sizeBytes;
  }

  async load<T = unknown>(id: string): Promise<Artifact<T> | null> {
    return (this.artifacts.get(id) as Artifact<T>) ?? null;
  }

  async query(filter: ArtifactFilter): Promise<ArtifactMeta[]> {
    let results = Array.from(this.artifacts.values());

    if (filter.sessionId) {
      results = results.filter(a => a.sessionId === filter.sessionId);
    }
    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type];
      results = results.filter(a => types.includes(a.type));
    }
    if (filter.topic) {
      const topicLower = filter.topic.toLowerCase();
      results = results.filter(a => a.topic.toLowerCase().includes(topicLower));
    }
    if (filter.tags && filter.tags.length > 0) {
      results = results.filter(a =>
        filter.tags!.some(tag => a.tags.includes(tag))
      );
    }
    if (filter.createdAfter) {
      results = results.filter(a => a.createdAt >= filter.createdAfter!);
    }
    if (filter.createdBefore) {
      results = results.filter(a => a.createdAt <= filter.createdBefore!);
    }

    // 按时间倒序
    results.sort((a, b) => b.createdAt - a.createdAt);

    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 100;
    return results.slice(offset, offset + limit).map(a => this.toMeta(a));
  }

  async delete(id: string): Promise<boolean> {
    const artifact = this.artifacts.get(id);
    if (!artifact) return false;
    this.artifacts.delete(id);
    this.currentSizeBytes -= artifact.sizeBytes;
    return true;
  }

  async deleteBySession(sessionId: string): Promise<number> {
    let count = 0;
    for (const [id, artifact] of this.artifacts) {
      if (artifact.sessionId === sessionId) {
        this.artifacts.delete(id);
        this.currentSizeBytes -= artifact.sizeBytes;
        count++;
      }
    }
    return count;
  }

  getStats(): { count: number; sizeBytes: number; maxSize: number } {
    return {
      count: this.artifacts.size,
      sizeBytes: this.currentSizeBytes,
      maxSize: this.maxSize,
    };
  }

  private findOldestNonEssential(): Artifact | null {
    // 保护 final_report 和 research_session，优先淘汰中间制品
    const essentialTypes: ArtifactType[] = ['final_report', 'research_session'];
    let oldest: Artifact | null = null;

    for (const artifact of this.artifacts.values()) {
      if (essentialTypes.includes(artifact.type)) continue;
      if (!oldest || artifact.updatedAt < oldest.updatedAt) {
        oldest = artifact;
      }
    }
    return oldest;
  }

  private toMeta(artifact: Artifact): ArtifactMeta {
    const { data, ...meta } = artifact;
    return meta;
  }
}

// ============================================================
// BeeClaw Memory 适配器
// ============================================================

/**
 * 将制品存储适配到 BeeClaw 的 memory 系统
 * 
 * 利用现有的 memory_record / memory_write / memory_read 工具
 * 将研究制品持久化到 Agent 的记忆空间中。
 * 
 * 存储格式：
 *   path: research/{sessionId}/{artifactType}/{artifactId}.json
 */
export class MemoryArtifactStorage implements ArtifactStorage {
  private memoryWrite: (path: string, content: string) => Promise<void>;
  private memoryRead: (path: string) => Promise<string | null>;
  private memoryList: (path: string) => Promise<string[]>;
  private memoryDelete: (path: string) => Promise<boolean>;
  private basePath: string;

  constructor(options: {
    memoryWrite: (path: string, content: string) => Promise<void>;
    memoryRead: (path: string) => Promise<string | null>;
    memoryList: (path: string) => Promise<string[]>;
    memoryDelete: (path: string) => Promise<boolean>;
    basePath?: string;
  }) {
    this.memoryWrite = options.memoryWrite;
    this.memoryRead = options.memoryRead;
    this.memoryList = options.memoryList;
    this.memoryDelete = options.memoryDelete;
    this.basePath = options.basePath ?? 'research';
  }

  async save(artifact: Artifact): Promise<void> {
    const path = this.artifactPath(artifact.sessionId, artifact.type, artifact.id);
    const content = JSON.stringify(artifact);
    await this.memoryWrite(path, content);
  }

  async load<T = unknown>(id: string): Promise<Artifact<T> | null> {
    // 需要遍历查找，因为不知道 sessionId 和 type
    // 先检查索引
    const indexContent = await this.memoryRead(`${this.basePath}/_index/${id}.json`);
    if (!indexContent) return null;

    try {
      const index: { sessionId: string; type: ArtifactType } = JSON.parse(indexContent);
      const path = this.artifactPath(index.sessionId, index.type, id);
      const content = await this.memoryRead(path);
      if (!content) return null;
      return JSON.parse(content) as Artifact<T>;
    } catch {
      return null;
    }
  }

  async query(filter: ArtifactFilter): Promise<ArtifactMeta[]> {
    const baseLookup = filter.sessionId
      ? `${this.basePath}/${filter.sessionId}`
      : this.basePath;

    const files = await this.memoryList(baseLookup);
    const results: ArtifactMeta[] = [];

    for (const file of files) {
      if (!file.endsWith('.json') || file.includes('_index')) continue;

      try {
        const content = await this.memoryRead(file);
        if (!content) continue;
        const artifact: Artifact = JSON.parse(content);

        // 应用过滤
        if (filter.type) {
          const types = Array.isArray(filter.type) ? filter.type : [filter.type];
          if (!types.includes(artifact.type)) continue;
        }
        if (filter.topic && !artifact.topic.toLowerCase().includes(filter.topic.toLowerCase())) continue;
        if (filter.createdAfter && artifact.createdAt < filter.createdAfter) continue;
        if (filter.createdBefore && artifact.createdAt > filter.createdBefore) continue;

        const { data, ...meta } = artifact;
        results.push(meta);
      } catch {
        // 解析失败，跳过
      }
    }

    results.sort((a, b) => b.createdAt - a.createdAt);
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 100;
    return results.slice(offset, offset + limit);
  }

  async delete(id: string): Promise<boolean> {
    const artifact = await this.load(id);
    if (!artifact) return false;
    const path = this.artifactPath(artifact.sessionId, artifact.type, id);
    return this.memoryDelete(path);
  }

  async deleteBySession(sessionId: string): Promise<number> {
    const files = await this.memoryList(`${this.basePath}/${sessionId}`);
    let count = 0;
    for (const file of files) {
      if (await this.memoryDelete(file)) count++;
    }
    return count;
  }

  private artifactPath(sessionId: string, type: ArtifactType, id: string): string {
    return `${this.basePath}/${sessionId}/${type}/${id}.json`;
  }
}

// ============================================================
// 研究制品管理器
// ============================================================

/**
 * 高层制品管理 API
 * 
 * 提供面向研究流程的语义化操作，而非底层 CRUD。
 */
export class ResearchArtifactManager {
  private storage: ArtifactStorage;
  private sessionId: string;
  private topic: string;
  private artifactCounter: number = 0;

  constructor(options: {
    storage: ArtifactStorage;
    sessionId: string;
    topic: string;
  }) {
    this.storage = options.storage;
    this.sessionId = options.sessionId;
    this.topic = options.topic;
  }

  // ── 会话管理 ──

  async initSession(depth: string, config: Record<string, unknown>): Promise<ResearchSession> {
    const session: ResearchSession = {
      id: this.sessionId,
      topic: this.topic,
      depth: depth as any,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedPhases: [],
      artifactIds: [],
      config,
    };

    await this.saveArtifact('research_session', session, ['session']);
    return session;
  }

  async updateSessionPhase(phase: string, status: 'active' | 'paused' | 'completed' | 'failed'): Promise<void> {
    const sessionArtifacts = await this.storage.query({
      sessionId: this.sessionId,
      type: 'research_session',
      limit: 1,
    });

    if (sessionArtifacts.length === 0) return;

    const artifact = await this.storage.load<ResearchSession>(sessionArtifacts[0].id);
    if (!artifact) return;

    const session = artifact.data;
    session.currentPhase = phase;
    session.status = status;
    session.updatedAt = Date.now();

    if (status === 'completed' && !session.completedPhases.includes(phase)) {
      session.completedPhases.push(phase);
    }

    await this.storage.save({
      ...artifact,
      data: session,
      updatedAt: Date.now(),
    });
  }

  // ── 查询计划 ──

  async saveQueryPlan(plan: QueryPlanData): Promise<string> {
    return this.saveArtifact('query_plan', plan, ['queries', `count:${plan.totalGenerated}`]);
  }

  // ── 搜索结果 ──

  async saveSearchResults(data: SearchResultsData): Promise<string> {
    return this.saveArtifact('search_results', data, [
      'search',
      data.provider,
      `results:${data.results.length}`,
    ]);
  }

  // ── 抓取源 ──

  async saveFetchedSource(data: FetchedSourceData): Promise<string> {
    return this.saveArtifact('fetched_source', data, [
      'source',
      new URL(data.url).hostname,
    ]);
  }

  // ── 综合报告 ──

  async saveSynthesisReport(report: unknown, round: number = 0): Promise<string> {
    return this.saveArtifact('synthesis_report', report, [
      'synthesis',
      `round:${round}`,
    ]);
  }

  // ── 覆盖率评估 ──

  async saveCoverageEvaluation(evaluation: unknown, round: number): Promise<string> {
    return this.saveArtifact('coverage_eval', evaluation, [
      'coverage',
      `round:${round}`,
    ]);
  }

  // ── 精炼状态 ──

  async saveRefinementState(state: unknown, round: number): Promise<string> {
    return this.saveArtifact('refinement_state', state, [
      'refinement',
      `round:${round}`,
    ]);
  }

  // ── 最终报告 ──

  async saveFinalReport(report: string, metadata: Record<string, unknown>): Promise<string> {
    return this.saveArtifact('final_report', { report, metadata }, [
      'final',
      'complete',
    ]);
  }

  // ── 断点续研 ──

  async saveCheckpoint(checkpoint: ResumeCheckpoint): Promise<void> {
    const sessionArtifacts = await this.storage.query({
      sessionId: this.sessionId,
      type: 'research_session',
      limit: 1,
    });

    if (sessionArtifacts.length === 0) return;

    const artifact = await this.storage.load<ResearchSession>(sessionArtifacts[0].id);
    if (!artifact) return;

    artifact.data.resumeCheckpoint = checkpoint;
    artifact.data.updatedAt = Date.now();
    await this.storage.save(artifact);
  }

  async getCheckpoint(): Promise<ResumeCheckpoint | null> {
    const sessionArtifacts = await this.storage.query({
      sessionId: this.sessionId,
      type: 'research_session',
      limit: 1,
    });

    if (sessionArtifacts.length === 0) return null;

    const artifact = await this.storage.load<ResearchSession>(sessionArtifacts[0].id);
    return artifact?.data.resumeCheckpoint ?? null;
  }

  // ── 查询接口 ──

  async getSessionArtifacts(type?: ArtifactType): Promise<ArtifactMeta[]> {
    return this.storage.query({
      sessionId: this.sessionId,
      type,
    });
  }

  async getLatestSynthesis(): Promise<Artifact | null> {
    const metas = await this.storage.query({
      sessionId: this.sessionId,
      type: 'synthesis_report',
      limit: 1,
    });
    if (metas.length === 0) return null;
    return this.storage.load(metas[0].id);
  }

  async getFetchedSources(): Promise<Artifact<FetchedSourceData>[]> {
    const metas = await this.storage.query({
      sessionId: this.sessionId,
      type: 'fetched_source',
    });

    const sources: Artifact<FetchedSourceData>[] = [];
    for (const meta of metas) {
      const artifact = await this.storage.load<FetchedSourceData>(meta.id);
      if (artifact) sources.push(artifact);
    }
    return sources;
  }

  // ── 历史研究检索 ──

  async findRelatedResearch(topic: string, maxResults: number = 5): Promise<ArtifactMeta[]> {
    return this.storage.query({
      type: 'final_report',
      topic,
      limit: maxResults,
    });
  }

  // ── 清理 ──

  async cleanup(): Promise<number> {
    return this.storage.deleteBySession(this.sessionId);
  }

  // ── 内部方法 ──

  private async saveArtifact(type: ArtifactType, data: unknown, tags: string[]): Promise<string> {
    const id = this.generateId(type);
    const serialized = JSON.stringify(data);

    const artifact: Artifact = {
      id,
      type,
      sessionId: this.sessionId,
      topic: this.topic,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
      sizeBytes: new TextEncoder().encode(serialized).byteLength,
      tags,
      data,
    };

    await this.storage.save(artifact);
    return id;
  }

  private generateId(type: ArtifactType): string {
    this.artifactCounter++;
    const timestamp = Date.now().toString(36);
    const counter = this.artifactCounter.toString().padStart(4, '0');
    return `${type}_${timestamp}_${counter}`;
  }
}

// ============================================================
// 工厂函数
// ============================================================

/**
 * 创建研究制品管理器
 * 
 * @example
 * ```ts
 * // 基于内存存储（单次研究）
 * const manager = createArtifactManager({
 *   topic: 'AI Agent 架构',
 *   storage: 'memory',
 * });
 * 
 * // 基于 BeeClaw memory 系统（持久化）
 * const manager = createArtifactManager({
 *   topic: 'AI Agent 架构',
 *   storage: 'beeclaw-memory',
 *   memoryTools: {
 *     write: agent.tools.memory_write,
 *     read: agent.tools.memory_read,
 *     list: agent.tools.memory_ls,
 *     delete: agent.tools.memory_delete,
 *   },
 * });
 * ```
 */
export function createArtifactManager(options: {
  topic: string;
  sessionId?: string;
  storage?: 'memory' | 'beeclaw-memory';
  memoryTools?: {
    write: (path: string, content: string) => Promise<void>;
    read: (path: string) => Promise<string | null>;
    list: (path: string) => Promise<string[]>;
    delete: (path: string) => Promise<boolean>;
  };
  maxSizeBytes?: number;
}): ResearchArtifactManager {
  const sessionId = options.sessionId ?? `rs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  let storage: ArtifactStorage;

  if (options.storage === 'beeclaw-memory' && options.memoryTools) {
    storage = new MemoryArtifactStorage({
      memoryWrite: options.memoryTools.write,
      memoryRead: options.memoryTools.read,
      memoryList: options.memoryTools.list,
      memoryDelete: options.memoryTools.delete,
    });
  } else {
    storage = new InMemoryArtifactStorage({
      maxSizeBytes: options.maxSizeBytes,
    });
  }

  return new ResearchArtifactManager({
    storage,
    sessionId,
    topic: options.topic,
  });
}
