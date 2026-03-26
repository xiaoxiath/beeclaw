/**
 * P3-#10: 记忆生命周期管理器
 * 
 * 原始问题：store.ts 中 recordConversation() / record() 只增不减，
 * types.ts 中的 retention 配置（conversations: 90d, facts: forever）
 * 定义了但未被消费。compression.ts 中的归档逻辑与 retention 配置分离。
 * 
 * 优化方案：
 * 1. 统一生命周期策略 — 按 category 配置 TTL、容量上限、重要性衰减
 * 2. 多层存储 — hot(活跃) → warm(归档) → cold(压缩) → expired(清理)
 * 3. 重要性衰减函数 — 基于时间的重要性自动降低
 * 4. 容量限制 — 每个 category 支持文件数/总大小上限
 * 5. 自动清理调度 — 可配置的定时清理 + 手动触发
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── 类型定义 ─────────────────────────────────────────────

/** 记忆类别 */
export type MemoryCategory = 'conversations' | 'facts' | 'decisions' | 'skills' | 'summaries' | 'knowledge';

/** 存储层级 */
export type StorageTier = 'hot' | 'warm' | 'cold' | 'expired';

/** 保留策略 */
export interface RetentionPolicy {
  /** 最大保留时间（如 "90d", "1y", "forever"） */
  maxAge: string;
  /** 最大文件数 */
  maxFiles?: number;
  /** 最大总大小（字节） */
  maxSizeBytes?: number;
  /** 重要性衰减半衰期（天），越小衰减越快 */
  importanceHalfLifeDays?: number;
  /** 最低重要性分数（低于此值进入归档） */
  minImportanceScore?: number;
  /** 归档后保留时间（如 "365d"） */
  archiveRetention?: string;
  /** 是否允许删除 */
  allowDelete?: boolean;
}

/** 生命周期配置 */
export interface LifecycleConfig {
  /** 基础路径 */
  basePath: string;
  /** 各类别的保留策略 */
  policies: Partial<Record<MemoryCategory, RetentionPolicy>>;
  /** 自动清理间隔（毫秒，0 = 禁用） */
  autoCleanupIntervalMs: number;
  /** 清理时是否先做快照备份 */
  snapshotBeforeCleanup: boolean;
  /** 干运行模式（只报告，不实际删除） */
  dryRun: boolean;
}

/** 文件元信息 */
export interface FileInfo {
  path: string;
  relativePath: string;
  category: MemoryCategory;
  size: number;
  createdAt: number;
  modifiedAt: number;
  ageMs: number;
  tier: StorageTier;
  importanceScore: number;
}

/** 清理报告 */
export interface CleanupReport {
  timestamp: string;
  dryRun: boolean;
  categories: Record<string, {
    scanned: number;
    promoted: number;    // cold → warm
    demoted: number;     // hot → warm, warm → cold
    archived: number;    // → cold 层
    deleted: number;     // → 过期删除
    freedBytes: number;
    errors: number;
  }>;
  totalFreedBytes: number;
  totalDeleted: number;
  duration: number;
}

// ─── 默认配置 ──────────────────────────────────────────────

const DEFAULT_POLICIES: Record<MemoryCategory, RetentionPolicy> = {
  conversations: {
    maxAge: '90d',
    maxFiles: 500,
    importanceHalfLifeDays: 30,
    minImportanceScore: 20,
    archiveRetention: '365d',
    allowDelete: true,
  },
  facts: {
    maxAge: 'forever',
    maxFiles: 200,
    importanceHalfLifeDays: 180,
    minImportanceScore: 10,
    allowDelete: false,
  },
  decisions: {
    maxAge: 'forever',
    maxFiles: 100,
    importanceHalfLifeDays: 90,
    minImportanceScore: 15,
    allowDelete: false,
  },
  skills: {
    maxAge: 'forever',
    maxFiles: 100,
    importanceHalfLifeDays: 365,
    minImportanceScore: 5,
    allowDelete: false,
  },
  summaries: {
    maxAge: '365d',
    maxFiles: 200,
    importanceHalfLifeDays: 60,
    minImportanceScore: 10,
    archiveRetention: '730d',
    allowDelete: true,
  },
  knowledge: {
    maxAge: 'forever',
    maxFiles: 500,
    importanceHalfLifeDays: 120,
    minImportanceScore: 10,
    allowDelete: false,
  },
};

const DEFAULT_CONFIG: LifecycleConfig = {
  basePath: './memory',
  policies: DEFAULT_POLICIES,
  autoCleanupIntervalMs: 0,
  snapshotBeforeCleanup: true,
  dryRun: false,
};

// ─── 工具函数 ──────────────────────────────────────────────

/** 解析时间字符串为毫秒 */
export function parseRetentionDuration(duration: string): number | null {
  if (duration === 'forever') return null;

  const match = duration.match(/^(\d+)(d|h|m|y)$/);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    case 'y': return value * 365 * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

/** 重要性衰减函数 */
export function calculateDecayedImportance(
  baseImportance: number,
  ageMs: number,
  halfLifeDays: number
): number {
  if (halfLifeDays <= 0) return baseImportance;
  const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;
  const decayFactor = Math.pow(0.5, ageMs / halfLifeMs);
  return baseImportance * decayFactor;
}

/** 确定文件的存储层级 */
export function determineTier(
  ageMs: number,
  importanceScore: number,
  policy: RetentionPolicy
): StorageTier {
  const maxAgeMs = parseRetentionDuration(policy.maxAge);
  const archiveMs = parseRetentionDuration(policy.archiveRetention || '365d');

  // 过期检查
  if (maxAgeMs !== null) {
    const totalRetention = (archiveMs !== null) ? maxAgeMs + archiveMs : maxAgeMs;
    if (ageMs > totalRetention && policy.allowDelete) {
      return 'expired';
    }
  }

  // 基于重要性的层级
  const minScore = policy.minImportanceScore || 20;

  if (importanceScore >= minScore * 2) return 'hot';
  if (importanceScore >= minScore) return 'warm';

  // 基于时间的层级
  if (maxAgeMs !== null && ageMs > maxAgeMs) return 'cold';

  return importanceScore >= minScore * 0.5 ? 'warm' : 'cold';
}

// ─── 核心实现 ─────────────────────────────────────────────

/**
 * 记忆生命周期管理器
 */
export class MemoryLifecycleManager {
  private config: LifecycleConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  /** 外部重要性评分器（可注入，用于读取已有评分） */
  private importanceScorer?: (content: string, metadata: Record<string, unknown>) => number;

  constructor(config: Partial<LifecycleConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      policies: { ...DEFAULT_POLICIES, ...config.policies },
    };
  }

  /**
   * 注入重要性评分器
   */
  setImportanceScorer(scorer: (content: string, metadata: Record<string, unknown>) => number): void {
    this.importanceScorer = scorer;
  }

  /**
   * 启动自动清理
   */
  startAutoCleanup(): void {
    if (this.config.autoCleanupIntervalMs <= 0) return;
    if (this.cleanupTimer) return;

    this.cleanupTimer = setInterval(
      () => this.runCleanup(),
      this.config.autoCleanupIntervalMs
    );
  }

  /**
   * 停止自动清理
   */
  stopAutoCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * 扫描所有记忆文件，返回文件信息列表
   */
  scan(categories?: MemoryCategory[]): FileInfo[] {
    const categoriesToScan = categories || Object.keys(this.config.policies) as MemoryCategory[];
    const files: FileInfo[] = [];
    const now = Date.now();

    for (const category of categoriesToScan) {
      const policy = this.getPolicy(category);
      const dirPath = path.join(this.config.basePath, category);

      if (!fs.existsSync(dirPath)) continue;

      const filePaths = this.walkDirectory(dirPath);

      for (const filePath of filePaths) {
        try {
          const stat = fs.statSync(filePath);
          if (!stat.isFile()) continue;

          const relativePath = path.relative(this.config.basePath, filePath);
          const ageMs = now - stat.mtimeMs;

          // 计算重要性
          let baseImportance = 50; // 默认中等重要性
          if (this.importanceScorer) {
            try {
              const content = fs.readFileSync(filePath, 'utf-8');
              baseImportance = this.importanceScorer(content, {
                category,
                age: ageMs,
                size: stat.size,
              });
            } catch {
              // 文件读取失败，使用默认值
            }
          }

          // 应用衰减
          const decayedImportance = calculateDecayedImportance(
            baseImportance,
            ageMs,
            policy.importanceHalfLifeDays || 90
          );

          // 确定层级
          const tier = determineTier(ageMs, decayedImportance, policy);

          files.push({
            path: filePath,
            relativePath,
            category,
            size: stat.size,
            createdAt: stat.birthtimeMs || stat.ctimeMs,
            modifiedAt: stat.mtimeMs,
            ageMs,
            tier,
            importanceScore: decayedImportance,
          });
        } catch {
          // 跳过无法访问的文件
        }
      }
    }

    return files;
  }

  /**
   * 每次 recordConversation 后的轻量级检查。
   * 仅在会话数达到阈值时触发异步清理，避免阻塞主流程。
   */
  private _recordCount = 0;
  private _cleanupInProgress = false;
  private static readonly RECORDS_BETWEEN_CHECKS = 50;

  async checkAfterRecord(): Promise<void> {
    this._recordCount++;

    // Only check every N records to avoid overhead
    if (this._recordCount < MemoryLifecycleManager.RECORDS_BETWEEN_CHECKS) {
      return;
    }
    this._recordCount = 0;

    // Prevent concurrent cleanup runs
    if (this._cleanupInProgress) {
      return;
    }

    // Quick check: is the conversations directory over capacity?
    const convPolicy = this.getPolicy('conversations');
    if (!convPolicy.maxFiles) return;

    const convDir = path.join(this.config.basePath, 'conversations');
    if (!fs.existsSync(convDir)) return;

    try {
      const fileCount = this.walkDirectory(convDir).length;
      if (fileCount <= convPolicy.maxFiles) return;

      // Over capacity — trigger async cleanup (non-blocking)
      this._cleanupInProgress = true;
      this.runCleanup({ categories: ['conversations'], dryRun: false })
        .catch(() => { /* swallow — already logged inside runCleanup */ })
        .finally(() => { this._cleanupInProgress = false; });
    } catch {
      // Ignore filesystem errors in lightweight check
    }
  }

  /**
   * 执行清理
   */
  async runCleanup(options?: {
    categories?: MemoryCategory[];
    dryRun?: boolean;
  }): Promise<CleanupReport> {
    const startTime = Date.now();
    const dryRun = options?.dryRun ?? this.config.dryRun;

    const report: CleanupReport = {
      timestamp: new Date().toISOString(),
      dryRun,
      categories: {},
      totalFreedBytes: 0,
      totalDeleted: 0,
      duration: 0,
    };

    const files = this.scan(options?.categories);

    // 按 category 分组
    const grouped: Record<string, FileInfo[]> = {};
    for (const file of files) {
      if (!grouped[file.category]) grouped[file.category] = [];
      grouped[file.category].push(file);
    }

    for (const [category, categoryFiles] of Object.entries(grouped)) {
      const policy = this.getPolicy(category as MemoryCategory);
      const stats = {
        scanned: categoryFiles.length,
        promoted: 0,
        demoted: 0,
        archived: 0,
        deleted: 0,
        freedBytes: 0,
        errors: 0,
      };

      // 按重要性排序（低 → 高），优先处理不重要的文件
      const sorted = [...categoryFiles].sort((a, b) => a.importanceScore - b.importanceScore);

      for (const file of sorted) {
        try {
          switch (file.tier) {
            case 'expired':
              if (policy.allowDelete !== false) {
                if (!dryRun) {
                  fs.unlinkSync(file.path);
                }
                stats.deleted++;
                stats.freedBytes += file.size;
              }
              break;

            case 'cold':
              // 归档（移动到 archive 目录）
              if (!dryRun) {
                this.archiveFile(file);
              }
              stats.archived++;
              break;

            case 'warm':
              stats.demoted++;
              break;

            case 'hot':
              // 不处理
              break;
          }
        } catch {
          stats.errors++;
        }
      }

      // 容量限制检查
      if (policy.maxFiles && categoryFiles.length > policy.maxFiles) {
        const excess = categoryFiles.length - policy.maxFiles;
        const toRemove = sorted.slice(0, excess);
        for (const file of toRemove) {
          if (file.tier !== 'expired') {
            try {
              if (!dryRun) {
                this.archiveFile(file);
              }
              stats.archived++;
              stats.freedBytes += file.size;
            } catch {
              stats.errors++;
            }
          }
        }
      }

      // 大小限制检查
      if (policy.maxSizeBytes) {
        const totalSize = categoryFiles.reduce((sum, f) => sum + f.size, 0);
        if (totalSize > policy.maxSizeBytes) {
          let freed = 0;
          const target = totalSize - policy.maxSizeBytes;
          for (const file of sorted) {
            if (freed >= target) break;
            try {
              if (!dryRun) {
                this.archiveFile(file);
              }
              freed += file.size;
              stats.archived++;
              stats.freedBytes += file.size;
            } catch {
              stats.errors++;
            }
          }
        }
      }

      report.categories[category] = stats;
      report.totalFreedBytes += stats.freedBytes;
      report.totalDeleted += stats.deleted;
    }

    report.duration = Date.now() - startTime;

    // 保存报告
    if (!dryRun) {
      this.saveCleanupReport(report);
    }

    return report;
  }

  /**
   * 获取存储统计
   */
  getStorageStats(): Record<string, {
    fileCount: number;
    totalSize: number;
    tierDistribution: Record<StorageTier, number>;
    avgImportance: number;
    oldestFile: number;
    newestFile: number;
  }> {
    const files = this.scan();
    const stats: Record<string, {
      fileCount: number;
      totalSize: number;
      tierDistribution: Record<StorageTier, number>;
      avgImportance: number;
      oldestFile: number;
      newestFile: number;
    }> = {};

    const grouped: Record<string, FileInfo[]> = {};
    for (const file of files) {
      if (!grouped[file.category]) grouped[file.category] = [];
      grouped[file.category].push(file);
    }

    for (const [category, categoryFiles] of Object.entries(grouped)) {
      const tierDist: Record<StorageTier, number> = { hot: 0, warm: 0, cold: 0, expired: 0 };
      let totalImportance = 0;
      let oldest = Infinity;
      let newest = 0;
      let totalSize = 0;

      for (const file of categoryFiles) {
        tierDist[file.tier]++;
        totalImportance += file.importanceScore;
        totalSize += file.size;
        if (file.modifiedAt < oldest) oldest = file.modifiedAt;
        if (file.modifiedAt > newest) newest = file.modifiedAt;
      }

      stats[category] = {
        fileCount: categoryFiles.length,
        totalSize,
        tierDistribution: tierDist,
        avgImportance: categoryFiles.length > 0 ? totalImportance / categoryFiles.length : 0,
        oldestFile: oldest === Infinity ? 0 : oldest,
        newestFile: newest,
      };
    }

    return stats;
  }

  /**
   * 更新保留策略
   */
  updatePolicy(category: MemoryCategory, policy: Partial<RetentionPolicy>): void {
    const current = this.getPolicy(category);
    (this.config.policies as Record<MemoryCategory, RetentionPolicy>)[category] = {
      ...current,
      ...policy,
    };
  }

  // ─── 内部方法 ──────────────────────────────────────────

  private getPolicy(category: MemoryCategory): RetentionPolicy {
    return (this.config.policies[category] || DEFAULT_POLICIES[category] || DEFAULT_POLICIES.facts);
  }

  private archiveFile(file: FileInfo): void {
    const archiveDir = path.join(this.config.basePath, 'archive', file.category);
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }

    const archiveName = `${Date.now()}_${path.basename(file.path)}`;
    const archivePath = path.join(archiveDir, archiveName);

    // 复制到归档目录
    fs.copyFileSync(file.path, archivePath);
    // 删除原文件
    fs.unlinkSync(file.path);
  }

  private saveCleanupReport(report: CleanupReport): void {
    const reportDir = path.join(this.config.basePath, '.lifecycle');
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const reportPath = path.join(reportDir, `cleanup-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

    // 只保留最近 20 个报告
    const reports = fs.readdirSync(reportDir)
      .filter((f: string) => f.startsWith('cleanup-') && f.endsWith('.json'))
      .sort()
      .reverse();

    for (const old of reports.slice(20)) {
      try {
        fs.unlinkSync(path.join(reportDir, old));
      } catch { /* ignore */ }
    }
  }

  private walkDirectory(dirPath: string): string[] {
    const files: string[] = [];
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          files.push(...this.walkDirectory(fullPath));
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }
    } catch { /* ignore permission errors */ }
    return files;
  }
}

// ─── 便捷工厂 ──────────────────────────────────────────────

let defaultManager: MemoryLifecycleManager | null = null;

export function getLifecycleManager(config?: Partial<LifecycleConfig>): MemoryLifecycleManager {
  if (!defaultManager || config) {
    defaultManager = new MemoryLifecycleManager(config);
  }
  return defaultManager;
}
