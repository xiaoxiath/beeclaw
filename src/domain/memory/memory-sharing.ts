/**
 * P3-#17: 记忆共享与导入导出
 * 
 * 原始问题：store.ts 中所有记忆操作都绑定在单个 basePath 本地文件系统上，
 * MemoryConfigLocalSchema 仅支持 type: 'filesystem'。没有导出/导入接口，
 * 也无法在不同项目、不同 Agent 实例间共享记忆。
 * 
 * 优化方案：
 * 1. 标准化导出格式 — 将记忆导出为可移植的 JSON 包
 * 2. 选择性导出 — 按 category、时间范围、关键词过滤导出内容
 * 3. 冲突合并导入 — 导入时处理与现有记忆的冲突
 * 4. 跨项目共享 — 支持将记忆挂载为只读共享源
 * 5. 增量同步 — 基于版本号的增量导出/导入
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ─── 类型定义 ─────────────────────────────────────────────

/** 记忆类别 */
export type MemoryCategory = 'conversations' | 'facts' | 'decisions' | 'skills' | 'summaries' | 'knowledge';

/** 导出的记忆项 */
export interface MemoryItem {
  /** 相对路径 */
  path: string;
  /** 类别 */
  category: MemoryCategory;
  /** 内容 */
  content: string;
  /** 内容哈希 */
  contentHash: string;
  /** 文件大小 */
  size: number;
  /** 创建时间 */
  createdAt: string;
  /** 修改时间 */
  modifiedAt: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/** 导出包 */
export interface MemoryExportPackage {
  /** 格式版本 */
  version: 2;
  /** 导出时间 */
  exportedAt: string;
  /** 来源项目标识 */
  sourceProject: string;
  /** 来源 Agent ID */
  sourceAgent?: string;
  /** 导出过滤条件 */
  filters: ExportFilters;
  /** 记忆项 */
  items: MemoryItem[];
  /** 统计信息 */
  stats: {
    totalItems: number;
    totalSize: number;
    categories: Record<string, number>;
  };
  /** 校验和 */
  checksum: string;
}

/** 导出过滤条件 */
export interface ExportFilters {
  /** 指定类别 */
  categories?: MemoryCategory[];
  /** 时间范围 */
  since?: string;
  until?: string;
  /** 关键词过滤 */
  keywords?: string[];
  /** 文件路径模式 */
  pathPattern?: string;
  /** 最大文件数 */
  maxItems?: number;
}

/** 导入选项 */
export interface ImportOptions {
  /** 冲突处理策略 */
  conflictStrategy: 'skip' | 'overwrite' | 'rename' | 'merge';
  /** 是否保留原始时间戳 */
  preserveTimestamps: boolean;
  /** 只导入指定类别 */
  categories?: MemoryCategory[];
  /** 试运行（不实际写入） */
  dryRun: boolean;
  /** 导入来源标记 */
  sourceTag?: string;
}

/** 导入报告 */
export interface ImportReport {
  timestamp: string;
  sourceProject: string;
  dryRun: boolean;
  imported: number;
  skipped: number;
  overwritten: number;
  renamed: number;
  merged: number;
  errors: number;
  details: Array<{
    path: string;
    action: 'imported' | 'skipped' | 'overwritten' | 'renamed' | 'merged' | 'error';
    reason?: string;
  }>;
}

/** 共享记忆源 */
export interface SharedMemorySource {
  /** 源名称 */
  name: string;
  /** 源路径 */
  basePath: string;
  /** 挂载模式 */
  mode: 'readonly' | 'sync';
  /** 自动同步间隔（毫秒） */
  syncIntervalMs?: number;
  /** 过滤条件 */
  filters?: ExportFilters;
  /** 是否启用 */
  enabled: boolean;
}

/** 共享配置 */
export interface MemorySharingConfig {
  /** 当前项目基础路径 */
  basePath: string;
  /** 项目标识 */
  projectId: string;
  /** Agent 标识 */
  agentId?: string;
  /** 共享记忆源 */
  sharedSources: SharedMemorySource[];
}

// ─── 工具函数 ──────────────────────────────────────────────

function computeHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex').substring(0, 16);
}

function computePackageChecksum(items: MemoryItem[]): string {
  const combined = items.map(i => i.contentHash).sort().join('');
  return crypto.createHash('sha256').update(combined).digest('hex').substring(0, 32);
}

function walkDirectory(dirPath: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dirPath)) return files;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDirectory(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ─── 导出引擎 ──────────────────────────────────────────────

/**
 * 记忆导出器
 */
export class MemoryExporter {
  private basePath: string;
  private projectId: string;
  private agentId?: string;

  constructor(config: { basePath: string; projectId: string; agentId?: string }) {
    this.basePath = config.basePath;
    this.projectId = config.projectId;
    this.agentId = config.agentId;
  }

  /**
   * 导出记忆到 JSON 包
   */
  async export(filters: ExportFilters = {}): Promise<MemoryExportPackage> {
    const categories = filters.categories || ['conversations', 'facts', 'decisions', 'skills', 'summaries', 'knowledge'] as MemoryCategory[];
    const items: MemoryItem[] = [];
    const categoryCount: Record<string, number> = {};
    let totalSize = 0;

    for (const category of categories) {
      const dirPath = path.join(this.basePath, category);
      if (!fs.existsSync(dirPath)) continue;

      const files = walkDirectory(dirPath);

      for (const filePath of files) {
        try {
          const stat = fs.statSync(filePath);
          const relativePath = path.relative(this.basePath, filePath);

          // 时间过滤
          if (filters.since) {
            const sinceMs = new Date(filters.since).getTime();
            if (stat.mtimeMs < sinceMs) continue;
          }
          if (filters.until) {
            const untilMs = new Date(filters.until).getTime();
            if (stat.mtimeMs > untilMs) continue;
          }

          // 路径模式过滤
          if (filters.pathPattern) {
            const regex = new RegExp(filters.pathPattern);
            if (!regex.test(relativePath)) continue;
          }

          const content = fs.readFileSync(filePath, 'utf-8');

          // 关键词过滤
          if (filters.keywords && filters.keywords.length > 0) {
            const hasKeyword = filters.keywords.some(kw =>
              content.toLowerCase().includes(kw.toLowerCase())
            );
            if (!hasKeyword) continue;
          }

          items.push({
            path: relativePath,
            category,
            content,
            contentHash: computeHash(content),
            size: stat.size,
            createdAt: new Date(stat.birthtimeMs || stat.ctimeMs).toISOString(),
            modifiedAt: new Date(stat.mtimeMs).toISOString(),
          });

          categoryCount[category] = (categoryCount[category] || 0) + 1;
          totalSize += stat.size;

          // 数量限制
          if (filters.maxItems && items.length >= filters.maxItems) break;
        } catch {
          // 跳过无法读取的文件
        }
      }

      if (filters.maxItems && items.length >= filters.maxItems) break;
    }

    const pkg: MemoryExportPackage = {
      version: 2,
      exportedAt: new Date().toISOString(),
      sourceProject: this.projectId,
      sourceAgent: this.agentId,
      filters,
      items,
      stats: {
        totalItems: items.length,
        totalSize,
        categories: categoryCount,
      },
      checksum: computePackageChecksum(items),
    };

    return pkg;
  }

  /**
   * 导出到文件
   */
  async exportToFile(
    outputPath: string,
    filters: ExportFilters = {}
  ): Promise<{ path: string; size: number; itemCount: number }> {
    const pkg = await this.export(filters);
    const json = JSON.stringify(pkg, null, 2);

    ensureDir(path.dirname(outputPath));
    fs.writeFileSync(outputPath, json, 'utf-8');

    return {
      path: outputPath,
      size: Buffer.byteLength(json, 'utf-8'),
      itemCount: pkg.items.length,
    };
  }

  /**
   * 增量导出（自上次导出后变更的文件）
   */
  async exportIncremental(
    sinceTimestamp: string,
    filters: ExportFilters = {}
  ): Promise<MemoryExportPackage> {
    return this.export({ ...filters, since: sinceTimestamp });
  }
}

// ─── 导入引擎 ──────────────────────────────────────────────

/**
 * 记忆导入器
 */
export class MemoryImporter {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  /**
   * 从 JSON 包导入记忆
   */
  async import(
    pkg: MemoryExportPackage,
    options: Partial<ImportOptions> = {}
  ): Promise<ImportReport> {
    const opts: ImportOptions = {
      conflictStrategy: 'skip',
      preserveTimestamps: false,
      dryRun: false,
      ...options,
    };

    // 校验包完整性
    const expectedChecksum = computePackageChecksum(pkg.items);
    if (pkg.checksum !== expectedChecksum) {
      throw new Error(`Package checksum mismatch: expected ${pkg.checksum}, got ${expectedChecksum}`);
    }

    const report: ImportReport = {
      timestamp: new Date().toISOString(),
      sourceProject: pkg.sourceProject,
      dryRun: opts.dryRun,
      imported: 0,
      skipped: 0,
      overwritten: 0,
      renamed: 0,
      merged: 0,
      errors: 0,
      details: [],
    };

    for (const item of pkg.items) {
      // 类别过滤
      if (opts.categories && !opts.categories.includes(item.category)) {
        report.skipped++;
        report.details.push({ path: item.path, action: 'skipped', reason: 'category filtered' });
        continue;
      }

      try {
        const targetPath = path.join(this.basePath, item.path);
        const exists = fs.existsSync(targetPath);

        if (exists) {
          // 冲突处理
          const existingContent = fs.readFileSync(targetPath, 'utf-8');
          const existingHash = computeHash(existingContent);

          if (existingHash === item.contentHash) {
            // 内容完全相同，跳过
            report.skipped++;
            report.details.push({ path: item.path, action: 'skipped', reason: 'identical content' });
            continue;
          }

          switch (opts.conflictStrategy) {
            case 'skip':
              report.skipped++;
              report.details.push({ path: item.path, action: 'skipped', reason: 'conflict' });
              continue;

            case 'overwrite':
              if (!opts.dryRun) {
                fs.writeFileSync(targetPath, item.content, 'utf-8');
              }
              report.overwritten++;
              report.details.push({ path: item.path, action: 'overwritten' });
              break;

            case 'rename':
              const ext = path.extname(item.path);
              const base = item.path.slice(0, -ext.length);
              const newPath = `${base}_imported_${Date.now()}${ext}`;
              const newTarget = path.join(this.basePath, newPath);
              if (!opts.dryRun) {
                ensureDir(path.dirname(newTarget));
                fs.writeFileSync(newTarget, item.content, 'utf-8');
              }
              report.renamed++;
              report.details.push({ path: item.path, action: 'renamed', reason: `→ ${newPath}` });
              break;

            case 'merge':
              const merged = this.mergeContent(existingContent, item.content, item.category);
              if (!opts.dryRun) {
                fs.writeFileSync(targetPath, merged, 'utf-8');
              }
              report.merged++;
              report.details.push({ path: item.path, action: 'merged' });
              break;
          }
        } else {
          // 新文件，直接写入
          if (!opts.dryRun) {
            ensureDir(path.dirname(targetPath));
            fs.writeFileSync(targetPath, item.content, 'utf-8');
          }
          report.imported++;
          report.details.push({ path: item.path, action: 'imported' });
        }

        // 添加来源标记
        if (!opts.dryRun && opts.sourceTag) {
          this.addSourceTag(path.join(this.basePath, item.path), opts.sourceTag, pkg.sourceProject);
        }
      } catch (error) {
        report.errors++;
        report.details.push({
          path: item.path,
          action: 'error',
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 保存导入报告
    if (!opts.dryRun) {
      this.saveImportReport(report);
    }

    return report;
  }

  /**
   * 从文件导入
   */
  async importFromFile(
    filePath: string,
    options: Partial<ImportOptions> = {}
  ): Promise<ImportReport> {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const pkg: MemoryExportPackage = JSON.parse(raw);
    return this.import(pkg, options);
  }

  // ─── 内部方法 ──────────────────────────────────────────

  private mergeContent(existing: string, incoming: string, category: MemoryCategory): string {
    // Markdown 文件的合并策略
    if (category === 'conversations') {
      // 对话记录追加
      return existing.trimEnd() + '\n\n---\n\n' + incoming.trim();
    }

    if (category === 'facts' || category === 'decisions') {
      // 事实/决策：逐条合并，去除重复行
      const existingLines = new Set(existing.split('\n').map(l => l.trim()).filter(Boolean));
      const newLines = incoming.split('\n').map(l => l.trim()).filter(Boolean);
      const unique = newLines.filter(l => !existingLines.has(l));

      if (unique.length === 0) return existing;
      return existing.trimEnd() + '\n\n' + unique.join('\n');
    }

    // 默认：追加（带分隔符）
    return existing.trimEnd() + '\n\n---\n\n' + incoming.trim();
  }

  private addSourceTag(filePath: string, tag: string, sourceProject: string): void {
    const metaDir = path.join(this.basePath, '.import-meta');
    ensureDir(metaDir);

    const metaFile = path.join(metaDir, 'sources.json');
    let sources: Record<string, { tag: string; source: string; importedAt: string }> = {};

    if (fs.existsSync(metaFile)) {
      try {
        sources = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
      } catch { /* ignore */ }
    }

    const relativePath = path.relative(this.basePath, filePath);
    sources[relativePath] = {
      tag,
      source: sourceProject,
      importedAt: new Date().toISOString(),
    };

    fs.writeFileSync(metaFile, JSON.stringify(sources, null, 2), 'utf-8');
  }

  private saveImportReport(report: ImportReport): void {
    const reportDir = path.join(this.basePath, '.import-meta');
    ensureDir(reportDir);
    const reportPath = path.join(reportDir, `import-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  }
}

// ─── 共享记忆管理器 ──────────────────────────────────────────

/**
 * 共享记忆管理器
 * 
 * 支持挂载多个外部记忆源，在搜索时跨源查找
 */
export class SharedMemoryManager {
  private config: MemorySharingConfig;
  private syncTimers: Map<string, ReturnType<typeof setInterval>> = new Map();

  constructor(config: MemorySharingConfig) {
    this.config = config;
  }

  /**
   * 添加共享记忆源
   */
  addSource(source: SharedMemorySource): void {
    this.config.sharedSources.push(source);
  }

  /**
   * 移除共享记忆源
   */
  removeSource(name: string): boolean {
    const idx = this.config.sharedSources.findIndex(s => s.name === name);
    if (idx >= 0) {
      this.config.sharedSources.splice(idx, 1);
      this.stopSync(name);
      return true;
    }
    return false;
  }

  /**
   * 跨所有源搜索文件
   */
  searchAcrossSources(
    query: string,
    options?: { categories?: MemoryCategory[]; maxResults?: number }
  ): Array<{ source: string; path: string; excerpt: string; score: number }> {
    const results: Array<{ source: string; path: string; excerpt: string; score: number }> = [];
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 1);

    // 搜索主记忆
    results.push(...this.searchInPath(this.config.basePath, 'local', queryTerms, options?.categories));

    // 搜索共享源
    for (const source of this.config.sharedSources) {
      if (!source.enabled) continue;
      if (!fs.existsSync(source.basePath)) continue;

      results.push(...this.searchInPath(source.basePath, source.name, queryTerms, options?.categories));
    }

    // 排序并限制结果
    results.sort((a, b) => b.score - a.score);
    const maxResults = options?.maxResults || 20;
    return results.slice(0, maxResults);
  }

  /**
   * 从共享源同步到本地
   */
  async syncFromSource(
    sourceName: string,
    options?: Partial<ImportOptions>
  ): Promise<ImportReport> {
    const source = this.config.sharedSources.find(s => s.name === sourceName);
    if (!source) throw new Error(`Shared source "${sourceName}" not found`);
    if (!fs.existsSync(source.basePath)) throw new Error(`Source path "${source.basePath}" does not exist`);

    const exporter = new MemoryExporter({
      basePath: source.basePath,
      projectId: sourceName,
    });
    const pkg = await exporter.export(source.filters || {});

    const importer = new MemoryImporter(this.config.basePath);
    return importer.import(pkg, {
      conflictStrategy: source.mode === 'readonly' ? 'skip' : 'merge',
      sourceTag: sourceName,
      ...options,
    });
  }

  /**
   * 启动自动同步
   */
  startAutoSync(): void {
    for (const source of this.config.sharedSources) {
      if (source.syncIntervalMs && source.syncIntervalMs > 0 && source.enabled) {
        const timer = setInterval(
          () => this.syncFromSource(source.name).catch(console.error),
          source.syncIntervalMs
        );
        this.syncTimers.set(source.name, timer);
      }
    }
  }

  /**
   * 停止指定源的同步
   */
  stopSync(name: string): void {
    const timer = this.syncTimers.get(name);
    if (timer) {
      clearInterval(timer);
      this.syncTimers.delete(name);
    }
  }

  /**
   * 停止所有同步
   */
  stopAllSync(): void {
    for (const [name] of this.syncTimers) {
      this.stopSync(name);
    }
  }

  /**
   * 列出所有共享源及其状态
   */
  listSources(): Array<SharedMemorySource & { available: boolean; fileCount: number }> {
    return this.config.sharedSources.map(source => {
      let fileCount = 0;
      const available = fs.existsSync(source.basePath);
      if (available) {
        fileCount = walkDirectory(source.basePath).length;
      }
      return { ...source, available, fileCount };
    });
  }

  // ─── 内部方法 ──────────────────────────────────────────

  private searchInPath(
    basePath: string,
    sourceName: string,
    queryTerms: string[],
    categories?: MemoryCategory[]
  ): Array<{ source: string; path: string; excerpt: string; score: number }> {
    const results: Array<{ source: string; path: string; excerpt: string; score: number }> = [];
    const searchCategories = categories || ['facts', 'knowledge', 'decisions', 'skills'] as MemoryCategory[];

    for (const category of searchCategories) {
      const dirPath = path.join(basePath, category);
      if (!fs.existsSync(dirPath)) continue;

      const files = walkDirectory(dirPath);
      for (const filePath of files) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const contentLower = content.toLowerCase();

          // 计算匹配分数
          let score = 0;
          for (const term of queryTerms) {
            const matches = contentLower.split(term).length - 1;
            score += matches;
          }

          if (score > 0) {
            // 提取包含查询词的上下文片段
            const excerpt = this.extractExcerpt(content, queryTerms[0] || '', 100);
            results.push({
              source: sourceName,
              path: path.relative(basePath, filePath),
              excerpt,
              score,
            });
          }
        } catch { /* ignore */ }
      }
    }

    return results;
  }

  private extractExcerpt(content: string, query: string, maxLength: number): string {
    const idx = content.toLowerCase().indexOf(query.toLowerCase());
    if (idx < 0) return content.substring(0, maxLength);

    const start = Math.max(0, idx - 30);
    const end = Math.min(content.length, idx + maxLength - 30);
    let excerpt = content.substring(start, end);

    if (start > 0) excerpt = '...' + excerpt;
    if (end < content.length) excerpt += '...';

    return excerpt;
  }
}
