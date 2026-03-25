// @deprecated - Dead code identified in audit (2026-03-25). Not imported by any production module. Scheduled for removal.
/**
 * BeeClaw Resilience Patch — Checkpoint 管理器 (断点恢复)
 * 
 * 解决问题:
 *   - Agent 状态完全在内存中, 进程崩溃后中间步骤全部丢失 (#9)
 *   - Long-horizon 任务中途失败需从头开始, 体验差
 * 
 * 核心能力:
 *   - 步骤级状态快照: 每完成一轮工具调用后自动保存
 *   - 多存储后端: 文件系统 (默认) / 内存 (测试用)
 *   - 断点恢复: resume / replay / restart 三种策略
 *   - TTL 自动清理: 过期 checkpoint 自动删除
 *   - 工具结果缓存: 恢复时跳过已完成的工具调用
 * 
 * 集成方式: 在 chat() 中可选启用, 每轮迭代后 save(), 恢复时 restore()
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface CheckpointConfig {
  /** 是否启用 checkpoint */
  enabled: boolean;
  /** 存储后端: 'filesystem' | 'memory' */
  storageBackend: 'filesystem' | 'memory';
  /** 文件系统存储路径 */
  storagePath: string;
  /** Checkpoint TTL (ms), 超过则自动清理, 默认 24h */
  ttlMs: number;
  /** 自动保存间隔: 每 N 次迭代保存一次 (默认 1, 即每次都保存) */
  saveEveryNIterations: number;
  /** 最大保留 checkpoint 数量 (per turn) */
  maxCheckpointsPerTurn: number;
  /** 是否保存完整消息历史 (大, 但恢复更精确) */
  saveFullMessages: boolean;
  /** 是否压缩存储 */
  compress: boolean;
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

export interface AgentCheckpoint {
  /** Checkpoint ID */
  id: string;
  /** 对话轮次 ID */
  turnId: string;
  /** 迭代序号 */
  iteration: number;
  /** 创建时间 */
  timestamp: number;
  /** 版本号 (用于兼容性检查) */
  version: number;

  // --- 状态快照 ---
  /** 消息历史 (可选保存完整内容) */
  messages: Message[];
  /** 估算的 token 数 */
  estimatedTokens: number;

  // --- 工具结果缓存 ---
  /** 已完成的工具调用及其结果 */
  completedToolCalls: Array<{
    callId: string;
    toolName: string;
    params: Record<string, unknown>;
    result: unknown;
    timestamp: number;
  }>;

  // --- 进度信息 ---
  /** 已完成的逻辑步骤描述 */
  completedSteps: string[];
  /** 最后一次 LLM 响应 (用于恢复上下文) */
  lastAssistantMessage: string | null;

  // --- Budget 快照 ---
  budgetConsumed: {
    inputTokens: number;
    outputTokens: number;
    llmCalls: number;
    toolCalls: number;
    estimatedCostUSD: number;
  };

  // --- 元数据 ---
  /** 原始用户消息 */
  userMessage: string;
  /** 使用的模型 */
  model: string;
  /** 校验和 */
  checksum: string;
}

export type RestoreStrategy = 'resume' | 'replay' | 'restart';

export interface RestoreResult {
  /** 是否成功恢复 */
  success: boolean;
  /** 恢复的 checkpoint */
  checkpoint: AgentCheckpoint | null;
  /** 恢复策略 */
  strategy: RestoreStrategy;
  /** 恢复了多少消息 */
  messagesRestored: number;
  /** 可跳过的工具调用数 */
  cachedToolCalls: number;
  /** 恢复信息 */
  info: string;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_CHECKPOINT_CONFIG: CheckpointConfig = {
  enabled: false,
  storageBackend: 'filesystem',
  storagePath: '.beeclaw-checkpoints',
  ttlMs: 24 * 60 * 60 * 1000,
  saveEveryNIterations: 1,
  maxCheckpointsPerTurn: 10,
  saveFullMessages: true,
  compress: false,
};

const CHECKPOINT_VERSION = 1;

// ============================================================================
// CheckpointStore 接口与实现
// ============================================================================

interface CheckpointStore {
  save(checkpoint: AgentCheckpoint): Promise<void>;
  load(turnId: string, checkpointId?: string): Promise<AgentCheckpoint | null>;
  loadLatest(turnId: string): Promise<AgentCheckpoint | null>;
  list(turnId: string): Promise<string[]>;
  delete(turnId: string, checkpointId: string): Promise<void>;
  deleteAll(turnId: string): Promise<void>;
  cleanup(maxAgeMs: number): Promise<number>;
}

/**
 * 文件系统 Checkpoint 存储
 */
class FileSystemCheckpointStore implements CheckpointStore {
  private readonly basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async save(checkpoint: AgentCheckpoint): Promise<void> {
    const dir = path.join(this.basePath, checkpoint.turnId);
    await fs.promises.mkdir(dir, { recursive: true });

    const filePath = path.join(dir, `${checkpoint.id}.json`);
    const data = JSON.stringify(checkpoint, null, 0); // 紧凑存储
    await fs.promises.writeFile(filePath, data, 'utf-8');
  }

  async load(turnId: string, checkpointId?: string): Promise<AgentCheckpoint | null> {
    if (checkpointId) {
      return this.loadFile(path.join(this.basePath, turnId, `${checkpointId}.json`));
    }
    return this.loadLatest(turnId);
  }

  async loadLatest(turnId: string): Promise<AgentCheckpoint | null> {
    const dir = path.join(this.basePath, turnId);
    try {
      const files = await fs.promises.readdir(dir);
      const jsonFiles = files.filter(f => f.endsWith('.json')).sort();
      if (jsonFiles.length === 0) return null;

      // 最后一个文件 (按 ID 排序, ID 包含时间戳)
      return this.loadFile(path.join(dir, jsonFiles[jsonFiles.length - 1]));
    } catch {
      return null;
    }
  }

  async list(turnId: string): Promise<string[]> {
    const dir = path.join(this.basePath, turnId);
    try {
      const files = await fs.promises.readdir(dir);
      return files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')).sort();
    } catch {
      return [];
    }
  }

  async delete(turnId: string, checkpointId: string): Promise<void> {
    const filePath = path.join(this.basePath, turnId, `${checkpointId}.json`);
    try {
      await fs.promises.unlink(filePath);
    } catch {
      // 文件不存在, 忽略
    }
  }

  async deleteAll(turnId: string): Promise<void> {
    const dir = path.join(this.basePath, turnId);
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
    } catch {
      // 目录不存在, 忽略
    }
  }

  async cleanup(maxAgeMs: number): Promise<number> {
    let deleted = 0;
    const cutoff = Date.now() - maxAgeMs;

    try {
      const turnDirs = await fs.promises.readdir(this.basePath);
      for (const turnDir of turnDirs) {
        const dirPath = path.join(this.basePath, turnDir);
        const stat = await fs.promises.stat(dirPath).catch(() => null);
        if (!stat?.isDirectory()) continue;

        if (stat.mtimeMs < cutoff) {
          await fs.promises.rm(dirPath, { recursive: true, force: true });
          deleted++;
        }
      }
    } catch {
      // basePath 不存在, 忽略
    }

    return deleted;
  }

  private async loadFile(filePath: string): Promise<AgentCheckpoint | null> {
    try {
      const data = await fs.promises.readFile(filePath, 'utf-8');
      const checkpoint = JSON.parse(data) as AgentCheckpoint;

      // 版本兼容性检查
      if (checkpoint.version !== CHECKPOINT_VERSION) {
        console.warn(`[Checkpoint] Version mismatch: expected ${CHECKPOINT_VERSION}, got ${checkpoint.version}`);
        return null;
      }

      // 校验和验证
      const expectedChecksum = computeChecksum(checkpoint);
      if (checkpoint.checksum !== expectedChecksum) {
        console.warn(`[Checkpoint] Checksum mismatch for ${filePath}`);
        return null;
      }

      return checkpoint;
    } catch {
      return null;
    }
  }
}

/**
 * 内存 Checkpoint 存储 (测试用)
 */
class InMemoryCheckpointStore implements CheckpointStore {
  private readonly store = new Map<string, Map<string, AgentCheckpoint>>();

  async save(checkpoint: AgentCheckpoint): Promise<void> {
    if (!this.store.has(checkpoint.turnId)) {
      this.store.set(checkpoint.turnId, new Map());
    }
    this.store.get(checkpoint.turnId)!.set(checkpoint.id, checkpoint);
  }

  async load(turnId: string, checkpointId?: string): Promise<AgentCheckpoint | null> {
    if (checkpointId) {
      return this.store.get(turnId)?.get(checkpointId) ?? null;
    }
    return this.loadLatest(turnId);
  }

  async loadLatest(turnId: string): Promise<AgentCheckpoint | null> {
    const turnMap = this.store.get(turnId);
    if (!turnMap || turnMap.size === 0) return null;
    const ids = [...turnMap.keys()].sort();
    return turnMap.get(ids[ids.length - 1]) ?? null;
  }

  async list(turnId: string): Promise<string[]> {
    const turnMap = this.store.get(turnId);
    return turnMap ? [...turnMap.keys()].sort() : [];
  }

  async delete(turnId: string, checkpointId: string): Promise<void> {
    this.store.get(turnId)?.delete(checkpointId);
  }

  async deleteAll(turnId: string): Promise<void> {
    this.store.delete(turnId);
  }

  async cleanup(maxAgeMs: number): Promise<number> {
    let deleted = 0;
    const cutoff = Date.now() - maxAgeMs;
    for (const [turnId, turnMap] of this.store) {
      for (const [id, cp] of turnMap) {
        if (cp.timestamp < cutoff) {
          turnMap.delete(id);
          deleted++;
        }
      }
      if (turnMap.size === 0) this.store.delete(turnId);
    }
    return deleted;
  }
}

// ============================================================================
// CheckpointManager
// ============================================================================

export class CheckpointManager {
  private readonly config: CheckpointConfig;
  private readonly store: CheckpointStore;
  private saveCounter = 0;

  constructor(config: Partial<CheckpointConfig> = {}) {
    this.config = { ...DEFAULT_CHECKPOINT_CONFIG, ...config };
    this.store = this.config.storageBackend === 'memory'
      ? new InMemoryCheckpointStore()
      : new FileSystemCheckpointStore(this.config.storagePath);
  }

  /**
   * 保存 checkpoint
   * 
   * @param state - 当前 Agent 状态
   * @returns checkpoint ID
   */
  async save(state: {
    turnId: string;
    iteration: number;
    messages: Message[];
    estimatedTokens: number;
    completedToolCalls?: AgentCheckpoint['completedToolCalls'];
    completedSteps?: string[];
    lastAssistantMessage?: string | null;
    budgetConsumed?: AgentCheckpoint['budgetConsumed'];
    userMessage: string;
    model: string;
  }): Promise<string | null> {
    if (!this.config.enabled) return null;

    // 检查保存间隔
    this.saveCounter++;
    if (this.saveCounter % this.config.saveEveryNIterations !== 0) {
      return null;
    }

    const id = generateCheckpointId(state.turnId, state.iteration);

    const checkpoint: AgentCheckpoint = {
      id,
      turnId: state.turnId,
      iteration: state.iteration,
      timestamp: Date.now(),
      version: CHECKPOINT_VERSION,

      messages: this.config.saveFullMessages
        ? state.messages
        : this.compactMessages(state.messages),
      estimatedTokens: state.estimatedTokens,

      completedToolCalls: state.completedToolCalls ?? [],
      completedSteps: state.completedSteps ?? [],
      lastAssistantMessage: state.lastAssistantMessage ?? null,

      budgetConsumed: state.budgetConsumed ?? {
        inputTokens: 0,
        outputTokens: 0,
        llmCalls: 0,
        toolCalls: 0,
        estimatedCostUSD: 0,
      },

      userMessage: state.userMessage,
      model: state.model,
      checksum: '', // 先置空, 计算后填入
    };

    checkpoint.checksum = computeChecksum(checkpoint);

    await this.store.save(checkpoint);

    // 清理多余的 checkpoint
    await this.pruneCheckpoints(state.turnId);

    return id;
  }

  /**
   * 恢复 checkpoint
   * 
   * @param turnId - 对话轮次 ID
   * @param strategy - 恢复策略
   * @returns 恢复结果
   */
  async restore(turnId: string, strategy: RestoreStrategy = 'resume'): Promise<RestoreResult> {
    if (!this.config.enabled) {
      return {
        success: false,
        checkpoint: null,
        strategy,
        messagesRestored: 0,
        cachedToolCalls: 0,
        info: 'Checkpoint is disabled',
      };
    }

    const checkpoint = await this.store.loadLatest(turnId);
    if (!checkpoint) {
      return {
        success: false,
        checkpoint: null,
        strategy,
        messagesRestored: 0,
        cachedToolCalls: 0,
        info: `No checkpoint found for turn ${turnId}`,
      };
    }

    // TTL 检查
    if (Date.now() - checkpoint.timestamp > this.config.ttlMs) {
      await this.store.deleteAll(turnId);
      return {
        success: false,
        checkpoint: null,
        strategy,
        messagesRestored: 0,
        cachedToolCalls: 0,
        info: `Checkpoint for turn ${turnId} has expired`,
      };
    }

    switch (strategy) {
      case 'resume':
        return {
          success: true,
          checkpoint,
          strategy,
          messagesRestored: checkpoint.messages.length,
          cachedToolCalls: checkpoint.completedToolCalls.length,
          info: `Resumed from iteration ${checkpoint.iteration} with ${checkpoint.messages.length} messages`,
        };

      case 'replay':
        // replay 模式: 使用缓存的工具结果, 但重新走 LLM
        return {
          success: true,
          checkpoint: {
            ...checkpoint,
            messages: checkpoint.messages.slice(0, 2), // 只保留 system + user
          },
          strategy,
          messagesRestored: 2,
          cachedToolCalls: checkpoint.completedToolCalls.length,
          info: `Replay from start with ${checkpoint.completedToolCalls.length} cached tool results`,
        };

      case 'restart':
        await this.store.deleteAll(turnId);
        return {
          success: false,
          checkpoint: null,
          strategy,
          messagesRestored: 0,
          cachedToolCalls: 0,
          info: `Checkpoints for turn ${turnId} cleared, starting fresh`,
        };

      default:
        return {
          success: false,
          checkpoint: null,
          strategy,
          messagesRestored: 0,
          cachedToolCalls: 0,
          info: `Unknown strategy: ${strategy}`,
        };
    }
  }

  /**
   * 查找缓存的工具结果 (用于 replay 模式)
   */
  findCachedToolResult(
    checkpoint: AgentCheckpoint,
    toolName: string,
    params: Record<string, unknown>
  ): unknown | null {
    const paramsStr = JSON.stringify(this.sortObject(params));

    for (const cached of checkpoint.completedToolCalls) {
      if (
        cached.toolName === toolName &&
        JSON.stringify(this.sortObject(cached.params)) === paramsStr
      ) {
        return cached.result;
      }
    }
    return null;
  }

  /**
   * 列出指定 turn 的所有 checkpoint
   */
  async listCheckpoints(turnId: string): Promise<string[]> {
    return this.store.list(turnId);
  }

  /**
   * 删除所有过期 checkpoint
   */
  async cleanup(): Promise<number> {
    return this.store.cleanup(this.config.ttlMs);
  }

  /**
   * 删除指定 turn 的所有 checkpoint
   */
  async clear(turnId: string): Promise<void> {
    await this.store.deleteAll(turnId);
  }

  // --- 内部方法 ---

  private compactMessages(messages: Message[]): Message[] {
    // 保留 system + user + 最后几条 assistant/tool 消息
    const compacted: Message[] = [];
    const systemAndUser = messages.filter(m => m.role === 'system' || m.role === 'user');
    const recent = messages.slice(-6); // 最后 6 条

    compacted.push(...systemAndUser);
    for (const msg of recent) {
      if (!compacted.includes(msg)) {
        compacted.push(msg);
      }
    }

    return compacted;
  }

  private async pruneCheckpoints(turnId: string): Promise<void> {
    const ids = await this.store.list(turnId);
    if (ids.length <= this.config.maxCheckpointsPerTurn) return;

    // 删除最旧的 checkpoint
    const toDelete = ids.slice(0, ids.length - this.config.maxCheckpointsPerTurn);
    for (const id of toDelete) {
      await this.store.delete(turnId, id);
    }
  }

  private sortObject(obj: Record<string, unknown>): Record<string, unknown> {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = obj[key];
    }
    return sorted;
  }
}

// ============================================================================
// 工具函数
// ============================================================================

function generateCheckpointId(_turnId: string, iteration: number): string {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(4).toString('hex');
  return `cp-${ts}-i${iteration}-${rand}`;
}

function computeChecksum(checkpoint: AgentCheckpoint): string {
  const { checksum: _, ...data } = checkpoint;
  const str = JSON.stringify(data);
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

// ============================================================================
// 便捷工厂函数
// ============================================================================

/**
 * 创建 CheckpointManager 实例
 * 
 * 用法:
 *   const cpManager = createCheckpointManager({
 *     enabled: true,
 *     storagePath: '.beeclaw-checkpoints',
 *   });
 *   
 *   // 保存 (在每轮迭代后)
 *   await cpManager.save({
 *     turnId: 'turn-abc123',
 *     iteration: 5,
 *     messages: this.messages,
 *     estimatedTokens: this.estimatedTokens,
 *     completedToolCalls: [...],
 *     userMessage: originalUserMessage,
 *     model: this.options.model,
 *   });
 *   
 *   // 恢复 (在 chat() 开始时检查)
 *   const restored = await cpManager.restore('turn-abc123', 'resume');
 *   if (restored.success) {
 *     this.messages = restored.checkpoint.messages;
 *     // 从 restored.checkpoint.iteration 继续...
 *   }
 */
export function createCheckpointManager(
  config?: Partial<CheckpointConfig>
): CheckpointManager {
  return new CheckpointManager(config);
}
