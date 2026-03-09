/**
 * P2-#14: 知识文件版本管理
 * 
 * 原始问题：store.ts 中的 saveFact() / saveSkill() 直接覆盖写入，
 * 无冲突检测、无版本追溯、无并发保护。当多个 Agent 实例同时写入
 * 或用户手动编辑时，容易丢失数据。
 * 
 * 优化方案：
 * 1. 引入文件级版本号（基于内容哈希），每次写入自动递增
 * 2. 写入前冲突检测（乐观锁：比较 baseVersion）
 * 3. 变更历史记录（差异摘要 + 时间戳 + 操作者）
 * 4. 版本回滚能力
 * 5. 自动清理旧版本（可配置保留数量）
 * 
 * 使用方式：
 *   import { VersionedKnowledgeStore, VersionConflictError } from './knowledge-versioning';
 *   
 *   const store = new VersionedKnowledgeStore({ basePath: './memory' });
 *   
 *   // 读取带版本信息
 *   const { content, version } = await store.read('facts', 'user-preferences.md');
 *   
 *   // 写入带冲突检测
 *   try {
 *     await store.write('facts', 'user-preferences.md', newContent, { baseVersion: version });
 *   } catch (e) {
 *     if (e instanceof VersionConflictError) {
 *       // 处理冲突：获取最新版本并合并
 *       const latest = await store.read('facts', 'user-preferences.md');
 *       // ... 合并逻辑
 *     }
 *   }
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ─── 类型定义 ─────────────────────────────────────────────

/** 知识文件类型 */
export type KnowledgeCategory = 'facts' | 'skills' | 'conversations' | 'summaries';

/** 版本记录 */
export interface VersionRecord {
  /** 版本号（自增） */
  version: number;
  /** 内容哈希 (SHA-256 前 16 位) */
  contentHash: string;
  /** 时间戳 */
  timestamp: number;
  /** 操作者标识 */
  author: string;
  /** 变更摘要 */
  changeSummary: string;
  /** 内容字节数 */
  contentSize: number;
  /** 前一版本的内容哈希（用于链式校验） */
  previousHash: string | null;
}

/** 版本化文件的读取结果 */
export interface VersionedContent {
  content: string;
  version: number;
  contentHash: string;
  lastModified: number;
  category: KnowledgeCategory;
  fileName: string;
}

/** 版本历史查询结果 */
export interface VersionHistory {
  fileName: string;
  category: KnowledgeCategory;
  currentVersion: number;
  records: VersionRecord[];
}

/** 版本差异 */
export interface VersionDiff {
  fromVersion: number;
  toVersion: number;
  addedLines: number;
  removedLines: number;
  summary: string;
}

/** 版本存储配置 */
export interface VersioningConfig {
  /** 基础路径 */
  basePath: string;
  /** 最大保留版本数（每个文件） */
  maxVersions: number;
  /** 默认操作者 */
  defaultAuthor: string;
  /** 是否启用冲突检测 */
  conflictDetection: boolean;
  /** 是否保留历史内容快照 */
  keepSnapshots: boolean;
  /** 快照最大保留数 */
  maxSnapshots: number;
  /** 文件锁超时（毫秒） */
  lockTimeoutMs: number;
}

// ─── 错误类型 ─────────────────────────────────────────────

/**
 * 版本冲突错误
 */
export class VersionConflictError extends Error {
  constructor(
    public readonly fileName: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number,
    public readonly currentContent: string
  ) {
    super(
      `Version conflict on "${fileName}": ` +
      `expected base version ${expectedVersion}, but current is ${actualVersion}. ` +
      `Please read the latest version and retry.`
    );
    this.name = 'VersionConflictError';
  }
}

/**
 * 文件锁超时错误
 */
export class LockTimeoutError extends Error {
  constructor(
    public readonly fileName: string,
    public readonly timeoutMs: number
  ) {
    super(`Failed to acquire lock on "${fileName}" within ${timeoutMs}ms`);
    this.name = 'LockTimeoutError';
  }
}

// ─── 默认配置 ──────────────────────────────────────────────

const DEFAULT_CONFIG: VersioningConfig = {
  basePath: './memory',
  maxVersions: 50,
  defaultAuthor: 'beeclaw-agent',
  conflictDetection: true,
  keepSnapshots: true,
  maxSnapshots: 10,
  lockTimeoutMs: 5000,
};

// ─── 核心实现 ─────────────────────────────────────────────

/**
 * 版本化知识文件存储
 * 
 * 在原始 MemoryStore 的文件操作之上增加版本管理层。
 * 版本元数据存储在 `.versions/` 子目录中。
 */
export class VersionedKnowledgeStore {
  private config: VersioningConfig;
  private locks: Map<string, { holder: string; acquiredAt: number }> = new Map();

  constructor(config: Partial<VersioningConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── 读取 ──────────────────────────────────────────────

  /**
   * 读取文件并返回版本信息
   */
  async read(
    category: KnowledgeCategory,
    fileName: string
  ): Promise<VersionedContent> {
    const filePath = this.resolveFilePath(category, fileName);

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${category}/${fileName}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const contentHash = this.computeHash(content);
    const stat = fs.statSync(filePath);

    // 读取版本元数据
    const versionFile = this.resolveVersionFile(category, fileName);
    let version = 0;

    if (fs.existsSync(versionFile)) {
      const records = this.loadVersionRecords(versionFile);
      if (records.length > 0) {
        const latest = records[records.length - 1];
        version = latest.version;

        // 检查内容是否被外部修改（哈希不匹配）
        if (latest.contentHash !== contentHash) {
          // 文件被外部修改，自动创建新版本记录
          version = latest.version + 1;
          const newRecord: VersionRecord = {
            version,
            contentHash,
            timestamp: stat.mtimeMs,
            author: 'external',
            changeSummary: 'Detected external modification',
            contentSize: Buffer.byteLength(content, 'utf-8'),
            previousHash: latest.contentHash,
          };
          records.push(newRecord);
          this.saveVersionRecords(versionFile, records);
        }
      }
    }

    return {
      content,
      version,
      contentHash,
      lastModified: stat.mtimeMs,
      category,
      fileName,
    };
  }

  // ─── 写入 ──────────────────────────────────────────────

  /**
   * 写入文件，支持冲突检测
   * 
   * @param category 文件类别
   * @param fileName 文件名
   * @param content 新内容
   * @param options 写入选项
   */
  async write(
    category: KnowledgeCategory,
    fileName: string,
    content: string,
    options: {
      baseVersion?: number;
      author?: string;
      changeSummary?: string;
    } = {}
  ): Promise<VersionRecord> {
    const lockKey = `${category}/${fileName}`;

    // 获取文件锁
    await this.acquireLock(lockKey);

    try {
      return await this.writeInternal(category, fileName, content, options);
    } finally {
      this.releaseLock(lockKey);
    }
  }

  private async writeInternal(
    category: KnowledgeCategory,
    fileName: string,
    content: string,
    options: {
      baseVersion?: number;
      author?: string;
      changeSummary?: string;
    }
  ): Promise<VersionRecord> {
    const filePath = this.resolveFilePath(category, fileName);
    const versionFile = this.resolveVersionFile(category, fileName);

    // 加载现有版本记录
    let records: VersionRecord[] = [];
    let currentVersion = 0;
    let previousHash: string | null = null;
    let previousContent = '';

    if (fs.existsSync(versionFile)) {
      records = this.loadVersionRecords(versionFile);
      if (records.length > 0) {
        const latest = records[records.length - 1];
        currentVersion = latest.version;
        previousHash = latest.contentHash;
      }
    }

    if (fs.existsSync(filePath)) {
      previousContent = fs.readFileSync(filePath, 'utf-8');
    }

    // 冲突检测
    if (
      this.config.conflictDetection &&
      options.baseVersion !== undefined &&
      options.baseVersion !== currentVersion
    ) {
      throw new VersionConflictError(
        fileName,
        options.baseVersion,
        currentVersion,
        previousContent
      );
    }

    // 计算新内容哈希
    const contentHash = this.computeHash(content);

    // 如果内容未变化，跳过写入
    if (contentHash === previousHash) {
      return records[records.length - 1];
    }

    // 保存快照（旧内容）
    if (this.config.keepSnapshots && previousContent) {
      this.saveSnapshot(category, fileName, currentVersion, previousContent);
    }

    // 写入新内容
    this.ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, 'utf-8');

    // 生成变更摘要
    const changeSummary = options.changeSummary ||
      this.generateChangeSummary(previousContent, content);

    // 创建版本记录
    const newVersion = currentVersion + 1;
    const record: VersionRecord = {
      version: newVersion,
      contentHash,
      timestamp: Date.now(),
      author: options.author || this.config.defaultAuthor,
      changeSummary,
      contentSize: Buffer.byteLength(content, 'utf-8'),
      previousHash,
    };

    records.push(record);

    // 清理旧版本
    if (records.length > this.config.maxVersions) {
      records = records.slice(records.length - this.config.maxVersions);
    }

    // 保存版本记录
    this.ensureDir(path.dirname(versionFile));
    this.saveVersionRecords(versionFile, records);

    // 清理旧快照
    this.cleanupSnapshots(category, fileName);

    return record;
  }

  // ─── 版本历史 ──────────────────────────────────────────

  /**
   * 获取文件版本历史
   */
  async getHistory(
    category: KnowledgeCategory,
    fileName: string,
    limit?: number
  ): Promise<VersionHistory> {
    const versionFile = this.resolveVersionFile(category, fileName);
    let records: VersionRecord[] = [];

    if (fs.existsSync(versionFile)) {
      records = this.loadVersionRecords(versionFile);
    }

    if (limit && limit > 0) {
      records = records.slice(-limit);
    }

    return {
      fileName,
      category,
      currentVersion: records.length > 0 ? records[records.length - 1].version : 0,
      records,
    };
  }

  /**
   * 读取指定版本的内容（从快照）
   */
  async readVersion(
    category: KnowledgeCategory,
    fileName: string,
    version: number
  ): Promise<string | null> {
    // 如果是当前版本，直接读取
    const versionFile = this.resolveVersionFile(category, fileName);
    if (fs.existsSync(versionFile)) {
      const records = this.loadVersionRecords(versionFile);
      const latest = records[records.length - 1];
      if (latest && latest.version === version) {
        const filePath = this.resolveFilePath(category, fileName);
        if (fs.existsSync(filePath)) {
          return fs.readFileSync(filePath, 'utf-8');
        }
      }
    }

    // 否则从快照中读取
    const snapshotPath = this.resolveSnapshotPath(category, fileName, version);
    if (fs.existsSync(snapshotPath)) {
      return fs.readFileSync(snapshotPath, 'utf-8');
    }

    return null;
  }

  /**
   * 回滚到指定版本
   */
  async rollback(
    category: KnowledgeCategory,
    fileName: string,
    targetVersion: number,
    options: { author?: string } = {}
  ): Promise<VersionRecord> {
    const content = await this.readVersion(category, fileName, targetVersion);
    if (content === null) {
      throw new Error(
        `Cannot rollback: version ${targetVersion} snapshot not found for ${category}/${fileName}`
      );
    }

    return this.write(category, fileName, content, {
      author: options.author || this.config.defaultAuthor,
      changeSummary: `Rollback to version ${targetVersion}`,
    });
  }

  // ─── 差异比较 ──────────────────────────────────────────

  /**
   * 比较两个版本的差异
   */
  async diff(
    category: KnowledgeCategory,
    fileName: string,
    fromVersion: number,
    toVersion: number
  ): Promise<VersionDiff> {
    const fromContent = await this.readVersion(category, fileName, fromVersion);
    const toContent = await this.readVersion(category, fileName, toVersion);

    if (fromContent === null) {
      throw new Error(`Version ${fromVersion} not found`);
    }
    if (toContent === null) {
      throw new Error(`Version ${toVersion} not found`);
    }

    return this.computeDiff(fromContent, toContent, fromVersion, toVersion);
  }

  // ─── 批量操作 ──────────────────────────────────────────

  /**
   * 列出某个类别下所有文件的版本信息
   */
  async listFiles(category: KnowledgeCategory): Promise<Array<{
    fileName: string;
    currentVersion: number;
    lastModified: number;
    size: number;
  }>> {
    const dirPath = path.join(this.config.basePath, category);
    if (!fs.existsSync(dirPath)) return [];

    const files = fs.readdirSync(dirPath).filter(f => !f.startsWith('.'));
    const result: Array<{
      fileName: string;
      currentVersion: number;
      lastModified: number;
      size: number;
    }> = [];

    for (const fileName of files) {
      const filePath = path.join(dirPath, fileName);
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;

      let currentVersion = 0;
      const versionFile = this.resolveVersionFile(category, fileName);
      if (fs.existsSync(versionFile)) {
        const records = this.loadVersionRecords(versionFile);
        if (records.length > 0) {
          currentVersion = records[records.length - 1].version;
        }
      }

      result.push({
        fileName,
        currentVersion,
        lastModified: stat.mtimeMs,
        size: stat.size,
      });
    }

    return result;
  }

  /**
   * 清理所有过期的快照和版本记录
   */
  async cleanup(): Promise<{ cleanedFiles: number; freedBytes: number }> {
    let cleanedFiles = 0;
    let freedBytes = 0;

    const categories: KnowledgeCategory[] = ['facts', 'skills', 'conversations', 'summaries'];

    for (const category of categories) {
      const versionsDir = path.join(this.config.basePath, category, '.versions');
      const snapshotsDir = path.join(this.config.basePath, category, '.snapshots');

      // 清理过期快照
      if (fs.existsSync(snapshotsDir)) {
        const entries = fs.readdirSync(snapshotsDir);
        for (const entry of entries) {
          const fullPath = path.join(snapshotsDir, entry);
          const stat = fs.statSync(fullPath);
          if (stat.isFile()) {
            // 如果快照数量超过限制，按时间排序删除旧的
            // （这里简化处理，实际应按文件分组）
            const ageMs = Date.now() - stat.mtimeMs;
            const maxAgeMs = 30 * 24 * 60 * 60 * 1000; // 30 天
            if (ageMs > maxAgeMs) {
              freedBytes += stat.size;
              fs.unlinkSync(fullPath);
              cleanedFiles++;
            }
          }
        }
      }

      // 清理版本记录中的超量条目
      if (fs.existsSync(versionsDir)) {
        const entries = fs.readdirSync(versionsDir).filter(f => f.endsWith('.json'));
        for (const entry of entries) {
          const versionFile = path.join(versionsDir, entry);
          let records = this.loadVersionRecords(versionFile);
          if (records.length > this.config.maxVersions) {
            const removed = records.length - this.config.maxVersions;
            records = records.slice(-this.config.maxVersions);
            this.saveVersionRecords(versionFile, records);
            cleanedFiles += removed;
          }
        }
      }
    }

    return { cleanedFiles, freedBytes };
  }

  // ─── 内部方法 ──────────────────────────────────────────

  private resolveFilePath(category: KnowledgeCategory, fileName: string): string {
    return path.join(this.config.basePath, category, fileName);
  }

  private resolveVersionFile(category: KnowledgeCategory, fileName: string): string {
    const safeName = fileName.replace(/[/\\]/g, '_');
    return path.join(this.config.basePath, category, '.versions', `${safeName}.json`);
  }

  private resolveSnapshotPath(
    category: KnowledgeCategory,
    fileName: string,
    version: number
  ): string {
    const safeName = fileName.replace(/[/\\]/g, '_');
    return path.join(
      this.config.basePath,
      category,
      '.snapshots',
      `${safeName}.v${version}`
    );
  }

  private computeHash(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf-8').digest('hex').substring(0, 16);
  }

  private loadVersionRecords(filePath: string): VersionRecord[] {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  private saveVersionRecords(filePath: string, records: VersionRecord[]): void {
    this.ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(records, null, 2), 'utf-8');
  }

  private saveSnapshot(
    category: KnowledgeCategory,
    fileName: string,
    version: number,
    content: string
  ): void {
    const snapshotPath = this.resolveSnapshotPath(category, fileName, version);
    this.ensureDir(path.dirname(snapshotPath));
    fs.writeFileSync(snapshotPath, content, 'utf-8');
  }

  private cleanupSnapshots(category: KnowledgeCategory, fileName: string): void {
    const snapshotsDir = path.join(this.config.basePath, category, '.snapshots');
    if (!fs.existsSync(snapshotsDir)) return;

    const safeName = fileName.replace(/[/\\]/g, '_');
    const prefix = `${safeName}.v`;

    const snapshots = fs.readdirSync(snapshotsDir)
      .filter(f => f.startsWith(prefix))
      .map(f => ({
        name: f,
        version: parseInt(f.substring(prefix.length), 10),
        path: path.join(snapshotsDir, f),
      }))
      .sort((a, b) => a.version - b.version);

    // 删除超出限制的旧快照
    while (snapshots.length > this.config.maxSnapshots) {
      const oldest = snapshots.shift()!;
      try {
        fs.unlinkSync(oldest.path);
      } catch {
        // ignore cleanup errors
      }
    }
  }

  private generateChangeSummary(oldContent: string, newContent: string): string {
    if (!oldContent) return 'Initial creation';

    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const diff = this.computeSimpleDiff(oldLines, newLines);

    const parts: string[] = [];
    if (diff.added > 0) parts.push(`+${diff.added} lines`);
    if (diff.removed > 0) parts.push(`-${diff.removed} lines`);
    if (diff.modified > 0) parts.push(`~${diff.modified} lines modified`);

    const sizeDelta = Buffer.byteLength(newContent, 'utf-8') - Buffer.byteLength(oldContent, 'utf-8');
    const sizeStr = sizeDelta >= 0 ? `+${sizeDelta}` : `${sizeDelta}`;
    parts.push(`(${sizeStr} bytes)`);

    return parts.join(', ') || 'No significant changes';
  }

  private computeSimpleDiff(
    oldLines: string[],
    newLines: string[]
  ): { added: number; removed: number; modified: number } {
    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);

    let added = 0, removed = 0;
    for (const line of newLines) {
      if (!oldSet.has(line)) added++;
    }
    for (const line of oldLines) {
      if (!newSet.has(line)) removed++;
    }

    // 粗略估计"修改"行数
    const modified = Math.min(added, removed);
    return {
      added: added - modified,
      removed: removed - modified,
      modified,
    };
  }

  private computeDiff(
    fromContent: string,
    toContent: string,
    fromVersion: number,
    toVersion: number
  ): VersionDiff {
    const fromLines = fromContent.split('\n');
    const toLines = toContent.split('\n');
    const diff = this.computeSimpleDiff(fromLines, toLines);

    return {
      fromVersion,
      toVersion,
      addedLines: diff.added,
      removedLines: diff.removed,
      summary: this.generateChangeSummary(fromContent, toContent),
    };
  }

  private async acquireLock(key: string): Promise<void> {
    const deadline = Date.now() + this.config.lockTimeoutMs;
    const checkInterval = 50; // ms

    while (Date.now() < deadline) {
      const existing = this.locks.get(key);

      if (!existing) {
        this.locks.set(key, { holder: 'current', acquiredAt: Date.now() });
        return;
      }

      // 检查是否为过期锁
      if (Date.now() - existing.acquiredAt > this.config.lockTimeoutMs * 2) {
        this.locks.delete(key);
        continue;
      }

      // 等待
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    throw new LockTimeoutError(key, this.config.lockTimeoutMs);
  }

  private releaseLock(key: string): void {
    this.locks.delete(key);
  }

  private ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
}

// ─── 便捷工厂函数 ──────────────────────────────────────────

let defaultStore: VersionedKnowledgeStore | null = null;

/**
 * 获取或创建默认的版本化知识存储实例
 */
export function getVersionedStore(
  config?: Partial<VersioningConfig>
): VersionedKnowledgeStore {
  if (!defaultStore || config) {
    defaultStore = new VersionedKnowledgeStore(config);
  }
  return defaultStore;
}

/**
 * 包装原始 store 的写入操作，增加版本管理
 * 
 * 在 store.ts 的 saveFact / saveSkill 中使用：
 * 
 *   import { versionedWrite } from './knowledge-versioning';
 *   
 *   // 原始写入：fs.writeFileSync(filePath, content);
 *   // 替换为：
 *   await versionedWrite('facts', fileName, content, { author: 'agent' });
 */
export async function versionedWrite(
  category: KnowledgeCategory,
  fileName: string,
  content: string,
  options?: {
    baseVersion?: number;
    author?: string;
    changeSummary?: string;
    basePath?: string;
  }
): Promise<VersionRecord> {
  const store = getVersionedStore(
    options?.basePath ? { basePath: options.basePath } : undefined
  );
  return store.write(category, fileName, content, {
    baseVersion: options?.baseVersion,
    author: options?.author,
    changeSummary: options?.changeSummary,
  });
}

/**
 * 包装原始 store 的读取操作，返回版本信息
 */
export async function versionedRead(
  category: KnowledgeCategory,
  fileName: string,
  basePath?: string
): Promise<VersionedContent> {
  const store = getVersionedStore(basePath ? { basePath } : undefined);
  return store.read(category, fileName);
}
