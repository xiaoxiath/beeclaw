/**
 * Subagent Registry
 *
 * 参考 OpenClaw 的子代理注册表设计
 * 支持持久化、生命周期管理、深度限制
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

// ============================================================================
// 类型定义
// ============================================================================

export type SubagentRunOutcome = 'ok' | 'error' | 'timeout' | 'killed';
export type SubagentEndedReason = 'complete' | 'error' | 'killed' | 'timeout' | 'reset' | 'deleted';
export type SubagentSpawnMode = 'run' | 'session';
export type SubagentCleanupPolicy = 'delete' | 'keep';

export interface SubagentRunRecord {
  // 基本信息
  runId: string;
  childSessionKey: string;
  requesterSessionKey: string;

  // 任务信息
  task: string;
  label?: string;
  type: string;

  // 模型配置
  model?: string;
  provider?: string;

  // 生命周期
  createdAt: number;
  startedAt?: number;
  endedAt?: number;

  // 状态
  outcome?: SubagentRunOutcome;
  endedReason?: SubagentEndedReason;
  error?: string;

  // 输出
  outputLength?: number;
  tokensUsed?: number;

  // 配置
  spawnMode: SubagentSpawnMode;
  cleanup: SubagentCleanupPolicy;
  expectsCompletionMessage: boolean;

  // 清理状态
  cleanupHandled: boolean;
  cleanupCompletedAt?: number;

  // 来源信息
  requesterOrigin?: {
    channel?: string;
    accountId?: string;
    to?: string;
    threadId?: string | number;
  };

  // 统计
  toolCallsCount?: number;
  duration?: number;
}

export interface SubagentRegistryConfig {
  persistPath: string;
  maxDepth: number;
  archiveAfterMinutes: number;
  cleanupIntervalMinutes: number;
  maxRecords: number;
}

export interface SubagentSpawnOptions {
  runId: string;
  childSessionKey: string;
  requesterSessionKey: string;
  task: string;
  label?: string;
  type?: string;
  model?: string;
  provider?: string;
  spawnMode?: SubagentSpawnMode;
  cleanup?: SubagentCleanupPolicy;
  expectsCompletionMessage?: boolean;
  requesterOrigin?: SubagentRunRecord['requesterOrigin'];
}

export interface SubagentRegistryStats {
  totalRuns: number;
  activeRuns: number;
  completedRuns: number;
  failedRuns: number;
  avgDuration: number;
  totalTokens: number;
}

/** Minimal interface for hook runner injection (decoupled from adapter layer) */
export interface RegistryHookRunner {
  runParallel: (name: string, data: any, ctx: any) => Promise<void>;
}

// ============================================================================
// Subagent Registry
// ============================================================================

export class SubagentRegistry {
  private runs: Map<string, SubagentRunRecord> = new Map();
  private config: SubagentRegistryConfig;
  private persistPath: string;
  private cleanupTimer?: Timer;
  private hookRunner?: RegistryHookRunner;

  constructor(config: Partial<SubagentRegistryConfig> = {}, hookRunner?: RegistryHookRunner) {
    this.config = {
      persistPath: './data/subagent-runs.json',
      maxDepth: 3,
      archiveAfterMinutes: 60,
      cleanupIntervalMinutes: 5,
      maxRecords: 1000,
      ...config,
    };
    this.persistPath = this.config.persistPath;
    this.hookRunner = hookRunner;
    this.ensureDirectory();
    this.restore();
    this.startCleanupTimer();
  }

  // ============================================================================
  // 生命周期管理
  // ============================================================================

  /**
   * 注册新的子代理运行
   */
  async register(options: SubagentSpawnOptions): Promise<SubagentRunRecord> {
    const record: SubagentRunRecord = {
      runId: options.runId,
      childSessionKey: options.childSessionKey,
      requesterSessionKey: options.requesterSessionKey,
      task: options.task,
      label: options.label,
      type: options.type || 'general',
      model: options.model,
      provider: options.provider,
      spawnMode: options.spawnMode || 'run',
      cleanup: options.cleanup || 'delete',
      expectsCompletionMessage: options.expectsCompletionMessage ?? true,
      requesterOrigin: options.requesterOrigin,
      createdAt: Date.now(),
      cleanupHandled: false,
    };

    this.runs.set(options.runId, record);
    this.persist();

    // 触发钩子
    await this.triggerHook('subagent_spawned', record);

    console.log(`[SubagentRegistry] Registered: ${options.runId} (${options.type || 'general'})`);
    return record;
  }

  /**
   * 标记子代理开始执行
   */
  async start(runId: string): Promise<void> {
    const record = this.runs.get(runId);
    if (!record) return;

    record.startedAt = Date.now();
    this.persist();
  }

  /**
   * 标记子代理完成
   */
  async complete(
    runId: string,
    outcome: SubagentRunOutcome,
    options?: {
      output?: string;
      tokensUsed?: number;
      toolCallsCount?: number;
      error?: string;
    },
  ): Promise<void> {
    const record = this.runs.get(runId);
    if (!record) return;

    record.endedAt = Date.now();
    record.outcome = outcome;
    record.endedReason = this.outcomeToReason(outcome);
    record.error = options?.error;
    record.outputLength = options?.output?.length;
    record.tokensUsed = options?.tokensUsed;
    record.toolCallsCount = options?.toolCallsCount;
    record.duration = record.endedAt - (record.startedAt || record.createdAt);

    this.persist();

    // 触发结束钩子
    await this.triggerHook('subagent_ended', record);

    console.log(
      `[SubagentRegistry] Completed: ${runId} (${outcome}) in ${record.duration}ms`,
    );

    // 自动清理
    if (record.cleanup === 'delete' && !record.cleanupHandled) {
      await this.cleanup(runId);
    }
  }

  /**
   * 杀死运行中的子代理
   */
  async kill(runId: string, reason?: string): Promise<void> {
    const record = this.runs.get(runId);
    if (!record) return;

    await this.complete(runId, 'killed', { error: reason || 'Killed by user' });
  }

  /**
   * 清理子代理记录
   */
  async cleanup(runId: string): Promise<void> {
    const record = this.runs.get(runId);
    if (!record || record.cleanupHandled) return;

    record.cleanupHandled = true;
    record.cleanupCompletedAt = Date.now();
    this.persist();

    console.log(`[SubagentRegistry] Cleaned up: ${runId}`);
  }

  // ============================================================================
  // 查询方法
  // ============================================================================

  /**
   * 获取运行记录
   */
  get(runId: string): SubagentRunRecord | undefined {
    return this.runs.get(runId);
  }

  /**
   * 根据 session key 获取运行记录
   */
  getBySessionKey(sessionKey: string): SubagentRunRecord | undefined {
    for (const record of this.runs.values()) {
      if (record.childSessionKey === sessionKey) {
        return record;
      }
    }
    return undefined;
  }

  /**
   * 获取请求者的所有活动子代理
   */
  getActiveByRequester(requesterSessionKey: string): SubagentRunRecord[] {
    return Array.from(this.runs.values()).filter(
      (r) =>
        r.requesterSessionKey === requesterSessionKey &&
        !r.endedAt &&
        !r.outcome,
    );
  }

  /**
   * 获取所有活动运行
   */
  getActiveRuns(): SubagentRunRecord[] {
    return Array.from(this.runs.values()).filter(
      (r) => !r.endedAt && !r.outcome,
    );
  }

  /**
   * 检查深度限制
   */
  checkDepth(sessionKey: string): { allowed: boolean; depth: number; maxDepth: number } {
    const depth = this.calculateDepth(sessionKey);
    return {
      allowed: depth < this.config.maxDepth,
      depth,
      maxDepth: this.config.maxDepth,
    };
  }

  /**
   * 计算嵌套深度
   */
  private calculateDepth(sessionKey: string, visited: Set<string> = new Set()): number {
    if (visited.has(sessionKey)) return 0;
    visited.add(sessionKey);

    // 找到这个 session 作为子代理的记录
    const asChild = Array.from(this.runs.values()).find(
      (r) => r.childSessionKey === sessionKey,
    );

    if (!asChild) return 0;

    // 递归计算父级深度
    return 1 + this.calculateDepth(asChild.requesterSessionKey, visited);
  }

  /**
   * 获取统计信息
   */
  getStats(): SubagentRegistryStats {
    const runs = Array.from(this.runs.values());
    const completed = runs.filter((r) => r.outcome === 'ok');
    const failed = runs.filter((r) => r.outcome === 'error' || r.outcome === 'timeout');
    const active = runs.filter((r) => !r.endedAt);

    const totalDuration = completed.reduce((sum, r) => sum + (r.duration || 0), 0);
    const totalTokens = runs.reduce((sum, r) => sum + (r.tokensUsed || 0), 0);

    return {
      totalRuns: runs.length,
      activeRuns: active.length,
      completedRuns: completed.length,
      failedRuns: failed.length,
      avgDuration: completed.length > 0 ? totalDuration / completed.length : 0,
      totalTokens,
    };
  }

  /**
   * 获取最近的运行记录
   */
  getRecent(limit: number = 20): SubagentRunRecord[] {
    return Array.from(this.runs.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  // ============================================================================
  // 持久化
  // ============================================================================

  /**
   * 持久化到文件
   */
  private persist(): void {
    try {
      const data = Object.fromEntries(this.runs.entries());
      writeFileSync(this.persistPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('[SubagentRegistry] Failed to persist:', error);
    }
  }

  /**
   * 从文件恢复
   */
  private restore(): void {
    if (!existsSync(this.persistPath)) return;

    try {
      const data = JSON.parse(readFileSync(this.persistPath, 'utf-8'));
      for (const [id, record] of Object.entries(data)) {
        this.runs.set(id, record as SubagentRunRecord);
      }
      console.log(`[SubagentRegistry] Restored ${this.runs.size} records`);
    } catch (error) {
      console.warn('[SubagentRegistry] Failed to restore:', error);
    }
  }

  /**
   * 确保目录存在
   */
  private ensureDirectory(): void {
    const dir = dirname(this.persistPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // ============================================================================
  // 清理
  // ============================================================================

  /**
   * 启动定时清理
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(
      () => this.runCleanup(),
      this.config.cleanupIntervalMinutes * 60 * 1000,
    );
  }

  /**
   * 执行清理
   */
  private runCleanup(): void {
    const now = Date.now();
    const archiveThreshold = now - this.config.archiveAfterMinutes * 60 * 1000;
    const toDelete: string[] = [];

    for (const [id, record] of this.runs.entries()) {
      // 删除过期的已完成记录
      if (
        record.endedAt &&
        record.endedAt < archiveThreshold &&
        record.cleanup === 'delete'
      ) {
        toDelete.push(id);
      }
    }

    // 限制最大记录数
    if (this.runs.size > this.config.maxRecords) {
      const sorted = Array.from(this.runs.entries())
        .sort((a, b) => a[1].createdAt - b[1].createdAt);

      const excess = this.runs.size - this.config.maxRecords;
      for (let i = 0; i < excess && i < sorted.length; i++) {
        if (!toDelete.includes(sorted[i][0])) {
          toDelete.push(sorted[i][0]);
        }
      }
    }

    // 执行删除
    for (const id of toDelete) {
      this.runs.delete(id);
    }

    if (toDelete.length > 0) {
      this.persist();
      console.log(`[SubagentRegistry] Cleaned up ${toDelete.length} old records`);
    }
  }

  /**
   * 停止清理定时器
   */
  stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  // ============================================================================
  // 辅助方法
  // ============================================================================

  private outcomeToReason(outcome: SubagentRunOutcome): SubagentEndedReason {
    switch (outcome) {
      case 'ok':
        return 'complete';
      case 'error':
        return 'error';
      case 'timeout':
        return 'timeout';
      case 'killed':
        return 'killed';
      default:
        return 'error';
    }
  }

  private async triggerHook(hookName: string, record: SubagentRunRecord): Promise<void> {
    if (!this.hookRunner) return;
    try {
      await this.hookRunner.runParallel(hookName as any, record, {
        sessionKey: record.childSessionKey,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.warn(`[SubagentRegistry] Hook ${hookName} failed:`, error);
    }
  }

  /**
   * 清除所有记录
   */
  clear(): void {
    this.runs.clear();
    this.persist();
  }

  /**
   * 销毁注册表
   */
  destroy(): void {
    this.stopCleanupTimer();
    this.persist();
  }
}

// ============================================================================
// 单例
// ============================================================================

let registry: SubagentRegistry | null = null;

export function getSubagentRegistry(config?: Partial<SubagentRegistryConfig>, hookRunner?: RegistryHookRunner): SubagentRegistry {
  if (!registry) {
    registry = new SubagentRegistry(config, hookRunner);
  }
  return registry;
}

export function resetSubagentRegistry(): void {
  if (registry) {
    registry.destroy();
  }
  registry = null;
}
