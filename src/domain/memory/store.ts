import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync, renameSync, unlinkSync, appendFileSync } from 'fs';
import { join, dirname, resolve, sep } from 'path';
import type { MemoryConfig, MemoryCategory, ConversationEntry, MemoryToolResult } from './types';
import { buildFullIndex, loadIndex, saveIndex, searchIndex, type MemoryIndex } from './indexer';
import { getShortTermCache } from './short-term-cache';
import { logger } from '../../infra/observability/logger';

/**
 * Simplified file lock — single-layer flock + atomic write.
 *
 * REFACTORED from two-phase locking (in-process queue + cross-process lockfile
 * with PID stale detection). The original implementation was ~120 lines with:
 * - In-process Map-based waiting queue
 * - Cross-process lockfile with JSON { pid, ts }
 * - PID liveness checks via process.kill(pid, 0)
 * - Stale lock detection (10s threshold)
 * - Atomic rename-based lock breaking (TOCTOU race fix)
 * - 50ms polling interval, 30s timeout
 *
 * Rationale for simplification:
 * - Beeclaw is primarily single-user, single-process (CLI / Bot / Web)
 * - Cross-process concurrent writes are rare in practice
 * - The memory storage layer may be replaced by graph-based memory in future
 * - Atomic write (temp + rename) already prevents data corruption
 *
 * What remains:
 * - In-process async serialization (prevents concurrent writes within one process)
 * - Atomic write via temp-file + rename pattern
 */
class FileLock {
  /** In-process queue: serializes async callers within one Node process */
  private inProcessQueue: Map<string, Promise<void>> = new Map();

  async acquire(filePath: string): Promise<() => void> {
    const normalizedPath = resolve(filePath);

    // Wait for any in-flight write to the same file
    while (this.inProcessQueue.has(normalizedPath)) {
      await this.inProcessQueue.get(normalizedPath);
    }

    let queueResolve!: () => void;
    const queuePromise = new Promise<void>((r) => { queueResolve = r; });
    this.inProcessQueue.set(normalizedPath, queuePromise);

    // Return release function
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inProcessQueue.delete(normalizedPath);
      queueResolve();
    };
  }
}

// Global file lock instance
const fileLock = new FileLock();

/**
 * Atomically write content to a file using write-to-temp-then-rename pattern.
 * This prevents partial writes and data corruption.
 */
function atomicWriteFileSync(filePath: string, content: string, encoding: BufferEncoding = 'utf-8'): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;

  try {
    writeFileSync(tempPath, content, encoding);
    renameSync(tempPath, filePath);  // Atomic on most file systems
  } catch (error) {
    // Clean up temp file on failure
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

export class MemoryStore {
  private basePath: string;
  private initialized: boolean = false;
  private indexPath: string;
  private index: MemoryIndex | null = null;

  constructor(config: MemoryConfig) {
    this.basePath = resolve(config.path);
    this.indexPath = join(this.basePath, 'index.json');
  }

  // Initialize memory directory structure
  init(): void {
    if (this.initialized) return;

    const categories: MemoryCategory[] = ['conversations', 'facts', 'decisions', 'skills'];

    for (const category of categories) {
      const categoryPath = join(this.basePath, category);
      if (!existsSync(categoryPath)) {
        mkdirSync(categoryPath, { recursive: true });
      }
    }

    // Create default fact files if not exist
    this.ensureDefaultFactFiles();

    // Create core memory files (USER.md, SOUL.md) if not exist
    this.ensureCoreMemoryFiles();

    // Create index.json if not exist
    this.ensureIndexFile();

    // Load or build index
    this.loadOrBuildIndex();

    this.initialized = true;
  }

  private ensureDefaultFactFiles(): void {
    const factsPath = join(this.basePath, 'facts');
    const defaultFiles = ['preferences.md'];

    for (const file of defaultFiles) {
      const filePath = join(factsPath, file);
      if (!existsSync(filePath)) {
        const title = file.replace('.md', '').charAt(0).toUpperCase() + file.replace('.md', '').slice(1);
        atomicWriteFileSync(filePath, `# ${title}\n\n`);
      }
    }
  }

  private ensureCoreMemoryFiles(): void {
    // USER.md and SOUL.md will be created by onboarding wizard — no-op
  }

  private ensureIndexFile(): void {
    const indexPath = join(this.basePath, 'index.json');
    if (!existsSync(indexPath)) {
      atomicWriteFileSync(indexPath, JSON.stringify({
        conversations: {},
        facts: { keywords: {} },
        lastUpdated: new Date().toISOString(),
      }, null, 2));
    }
  }

  // Get base path
  getBasePath(): string {
    return this.basePath;
  }

  /**
   * Resolve a user-provided path relative to memory base.
   *
   * Secure path traversal prevention:
   * Uses path.resolve() + prefix check.
   */
  private resolvePath(inputPath: string): string {
    const stripped = inputPath.replace(/^[/\\]+/, '');
    const resolved = resolve(this.basePath, stripped);

    if (resolved !== this.basePath && !resolved.startsWith(this.basePath + sep)) {
      throw new Error(`Path traversal detected: "${inputPath}" resolves outside memory directory`);
    }

    return resolved;
  }

  // List directory contents
  ls(path: string): MemoryToolResult {
    try {
      const fullPath = this.resolvePath(path);

      if (!existsSync(fullPath)) {
        return { success: false, error: `Path not found: ${path}` };
      }

      const stats = statSync(fullPath);

      if (stats.isDirectory()) {
        const entries = readdirSync(fullPath, { withFileTypes: true });
        const listing = entries.map(e => {
          const prefix = e.isDirectory() ? 'd ' : 'f ';
          return `${prefix} ${e.name}`;
        }).join('\n');
        return { success: true, data: listing || '(empty)' };
      } else {
        return { success: true, data: `f ${path}` };
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Search content using grep-like functionality
  grep(query: string, path?: string): MemoryToolResult {
    try {
      const searchPath = path
        ? this.resolvePath(path)
        : this.basePath;

      if (!existsSync(searchPath)) {
        return { success: false, error: `Path not found: ${path || 'memory'}` };
      }

      const results: string[] = [];
      const stats = statSync(searchPath);

      if (stats.isFile()) {
        this.grepFile(searchPath, query, results);
      } else {
        this.grepRecursive(searchPath, query, results);
      }

      if (results.length === 0) {
        return { success: true, data: '(no matches found)' };
      }

      return { success: true, data: results.join('\n\n---\n\n') };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private grepFile(filePath: string, query: string, results: string[]): void {
    const fileName = filePath.split('/').pop() || '';
    if (!fileName.endsWith('.md') && !fileName.endsWith('.json')) {
      return;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      const matches: string[] = [];
      lines.forEach((line, index) => {
        if (line.toLowerCase().includes(query.toLowerCase())) {
          matches.push(`L${index + 1}: ${line.trim()}`);
        }
      });

      if (matches.length > 0) {
        const relativePath = filePath.replace(this.basePath, '').replace(/^\//, '');
        results.push(`📄 ${relativePath}\n${matches.join('\n')}`);
      }
    } catch {
      // Skip files that can't be read
    }
  }

  private grepRecursive(dirPath: string, query: string, results: string[]): void {
    const entries = readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        this.grepRecursive(fullPath, query, results);
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.json')) {
        try {
          const content = readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');

          const matches: string[] = [];
          lines.forEach((line, index) => {
            if (line.toLowerCase().includes(query.toLowerCase())) {
              matches.push(`L${index + 1}: ${line.trim()}`);
            }
          });

          if (matches.length > 0) {
            const relativePath = fullPath.replace(this.basePath, '').replace(/^\//, '');
            results.push(`📄 ${relativePath}\n${matches.join('\n')}`);
          }
        } catch {
          // Skip files that can't be read
        }
      }
    }
  }

  // Read file content
  read(path: string): MemoryToolResult {
    try {
      const fullPath = this.resolvePath(path);

      if (!existsSync(fullPath)) {
        return { success: false, error: `File not found: ${path}` };
      }

      const content = readFileSync(fullPath, 'utf-8');
      return { success: true, data: content };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Get file metadata
  stat(path: string): { success: true; mtime: Date; size: number } | { success: false; error: string } {
    try {
      const fullPath = this.resolvePath(path);

      if (!existsSync(fullPath)) {
        return { success: false, error: `File not found: ${path}` };
      }

      const stats = statSync(fullPath);
      return {
        success: true,
        mtime: stats.mtime,
        size: stats.size,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Write to file with concurrency safety.
   *
   * Uses in-process lock + atomic write (temp file + rename).
   */
  async write(path: string, content: string, mode: 'append' | 'overwrite' = 'append'): Promise<MemoryToolResult> {
    try {
      const fullPath = this.resolvePath(path);

      const dir = dirname(fullPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const release = await fileLock.acquire(fullPath);

      try {
        if (mode === 'overwrite') {
          atomicWriteFileSync(fullPath, content);
        } else {
          let existingContent = '';
          if (existsSync(fullPath)) {
            existingContent = readFileSync(fullPath, 'utf-8');
          }
          atomicWriteFileSync(fullPath, existingContent + content);
        }
      } finally {
        release();
      }

      return { success: true, data: `Written to ${path}` };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Synchronous write - for backward compatibility with existing sync callers.
   * Uses atomic write for overwrite; appendFileSync for append mode to reduce
   * the race window of read-modify-write.
   *
   * @deprecated Use async write() instead for proper file-lock protection.
   */
  writeSync(path: string, content: string, mode: 'append' | 'overwrite' = 'append'): MemoryToolResult {
    try {
      const fullPath = this.resolvePath(path);

      const dir = dirname(fullPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      if (mode === 'overwrite') {
        atomicWriteFileSync(fullPath, content);
      } else {
        // Fix P0-02: use appendFileSync instead of read+write to reduce race window
        try {
          appendFileSync(fullPath, content, 'utf-8');
        } catch (e: any) {
          if (e.code === 'ENOENT') {
            atomicWriteFileSync(fullPath, content);
          } else {
            throw e;
          }
        }
      }

      return { success: true, data: `Written to ${path}` };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Record a new fact
  async record(category: 'user' | 'preferences' | 'events' | 'investments' | 'lessons', fact: string): Promise<MemoryToolResult> {
    try {
      const fileName = `${category}.md`;
      const filePath = join(this.basePath, 'facts', fileName);

      if (!existsSync(filePath)) {
        const titles: Record<string, string> = {
          user: '用户画像',
          preferences: '偏好设置',
          events: '重要事件',
          investments: '投资持仓',
          lessons: '经验教训',
        };
        const title = titles[category] || category;
        atomicWriteFileSync(filePath, `# ${title}\n\n`);
      }

      const timestamp = new Date().toISOString().split('T')[0];
      const entry = `- ${fact} (added ${timestamp})\n`;

      const release = await fileLock.acquire(filePath);
      try {
        const existing = readFileSync(filePath, 'utf-8');
        atomicWriteFileSync(filePath, existing + entry);
      } finally {
        release();
      }

      return { success: true, data: `Fact recorded in ${category}: ${fact}` };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Record conversation entry with atomic write.
   */
  async recordConversation(entry: ConversationEntry): Promise<MemoryToolResult> {
    try {
      const date = new Date();
      const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const day = String(date.getDate()).padStart(2, '0');

      const dirPath = join(this.basePath, 'conversations', yearMonth);
      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
      }

      const filePath = join(dirPath, `${day}.md`);

      const release = await fileLock.acquire(filePath);

      try {
        let existing = '';
        if (existsSync(filePath)) {
          existing = readFileSync(filePath, 'utf-8');
        } else {
          existing = `# ${yearMonth}-${day}\n\n`;
        }

        const time = entry.timestamp.split('T')[1]?.slice(0, 5) || date.toTimeString().slice(0, 5);
        let content = `## ${time} - ${entry.source}\n\n`;
        content += `**用户**：${entry.user}\n\n`;
        content += `**助手**：${entry.assistant}\n`;

        if (entry.metadata?.decision) {
          content += `\n**关键决策**：${entry.metadata.decision}\n`;
        }
        if (entry.metadata?.relatedFiles?.length) {
          content += `\n**相关文件**：${entry.metadata.relatedFiles.join(', ')}\n`;
        }
        if (entry.metadata?.skillTriggered) {
          content += `\n**技能触发**：${entry.metadata.skillTriggered}\n`;
        }

        content += '\n---\n\n';

        atomicWriteFileSync(filePath, existing + content);
      } finally {
        release();
      }

      // Update short-term cache
      try {
        const cache = getShortTermCache();
        await cache.addConversation(entry.source || 'default', entry);
      } catch (error) {
        logger.error('[MemoryStore] Failed to update short-term cache:', error);
      }

      return { success: true, data: `Conversation recorded: ${yearMonth}/${day}.md` };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get recent conversations with short-term cache.
   */
  async getRecentConversations(
    userId: string = 'default',
    limit: number = 10,
  ): Promise<ConversationEntry[]> {
    // 1. Try cache first
    try {
      const cache = getShortTermCache();
      const cached = await cache.getRecentConversations(userId, limit);
      if (cached) {
        return cached;
      }
    } catch (error) {
      logger.error('[MemoryStore] Failed to get from short-term cache:', error);
    }

    // 2. Cache miss — load from disk
    const conversations: ConversationEntry[] = [];
    const conversationsPath = join(this.basePath, 'conversations');

    if (!existsSync(conversationsPath)) {
      return [];
    }

    const months = readdirSync(conversationsPath)
      .filter(f => {
        const fullPath = join(conversationsPath, f);
        return statSync(fullPath).isDirectory() && /^\d{4}-\d{2}$/.test(f);
      })
      .sort()
      .reverse()
      .slice(0, 3);

    for (const month of months) {
      const monthPath = join(conversationsPath, month);
      const days = readdirSync(monthPath)
        .filter(f => f.endsWith('.md'))
        .sort()
        .reverse();

      for (const dayFile of days) {
        const filePath = join(monthPath, dayFile);
        const content = readFileSync(filePath, 'utf-8');

        const entries = this.parseConversationFile(content, filePath);
        conversations.push(...entries);

        if (conversations.length >= limit * 2) {
          break;
        }
      }

      if (conversations.length >= limit * 2) {
        break;
      }
    }

    const recentConversations = conversations
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);

    // 3. Update cache
    try {
      const cache = getShortTermCache();
      await cache.updateConversations(userId, recentConversations);
    } catch (error) {
      logger.error('[MemoryStore] Failed to update short-term cache:', error);
    }

    return recentConversations;
  }

  /**
   * Parse conversation file to extract entries.
   */
  private parseConversationFile(content: string, filePath: string): ConversationEntry[] {
    const entries: ConversationEntry[] = [];
    const fileStat = statSync(filePath);
    const dateStr = fileStat.mtime.toISOString().split('T')[0];
    const sections = content.split('## ').slice(1);

    for (const section of sections) {
      const lines = section.split('\n');
      const header = lines[0];

      const timeMatch = header.match(/^(\d{1,2}:\d{2})\s*-\s*(.+)$/);
      if (!timeMatch) continue;

      const time = timeMatch[1];
      const source = timeMatch[2].trim();

      let user = '';
      let assistant = '';

      const userMatch = section.match(/\*\*用户\*\*[：:]\s*(.+?)(?=\n\n\*\*助手\*\*|\n\n---)/s);
      const assistantMatch = section.match(/\*\*助手\*\*[：:]\s*(.+?)(?=\n\n---|\n\n##|$)/s);

      if (userMatch) user = userMatch[1].trim();
      if (assistantMatch) assistant = assistantMatch[1].trim();

      if (user || assistant) {
        entries.push({
          timestamp: dateStr + 'T' + time + ':00',
          source,
          user,
          assistant,
        });
      }
    }

    return entries;
  }

  readUser(): MemoryToolResult {
    return this.read('USER.md');
  }

  readSoul(): MemoryToolResult {
    return this.read('SOUL.md');
  }

  writeUser(content: string): MemoryToolResult {
    return this.writeSync('USER.md', content, 'overwrite');
  }

  writeSoul(content: string): MemoryToolResult {
    return this.writeSync('SOUL.md', content, 'overwrite');
  }

  getCoreContext(): { user: string; soul: string; facts: string } {
    const userResult = this.readUser();
    const soulResult = this.readSoul();

    let factsContent = '';
    const factsPath = join(this.basePath, 'facts');
    if (existsSync(factsPath)) {
      const factFiles = readdirSync(factsPath).filter(f => f.endsWith('.md'));
      for (const file of factFiles) {
        const filePath = join(factsPath, file);
        const content = readFileSync(filePath, 'utf-8').trim();
        if (content && content.length > 10) {
          const title = file.replace('.md', '');
          factsContent += `\n\n### ${title}\n${content}`;
        }
      }
    }

    return {
      user: userResult.success ? String(userResult.data || '') : '',
      soul: soulResult.success ? String(soulResult.data || '') : '',
      facts: factsContent.trim(),
    };
  }

  private loadOrBuildIndex(): void {
    this.index = loadIndex(this.indexPath);
    if (!this.index) {
      this.rebuildIndex();
    }
  }

  rebuildIndex(): MemoryToolResult {
    try {
      this.index = buildFullIndex(this.basePath);
      saveIndex(this.indexPath, this.index);
      return {
        success: true,
        data: `Index rebuilt: ${Object.keys(this.index.facts.keywords).length + Object.keys(this.index.knowledge.keywords).length} keywords indexed`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to rebuild index',
      };
    }
  }

  searchByKeyword(query: string, scope?: 'facts' | 'knowledge' | 'all'): MemoryToolResult {
    try {
      if (!this.index) {
        this.loadOrBuildIndex();
      }

      if (!this.index) {
        return { success: false, error: 'Index not available' };
      }

      const results = searchIndex(this.index, query, { scope });

      if (results.length === 0) {
        return { success: true, data: '(no matches in index)' };
      }

      const output = results.map(r =>
        `📄 ${r.path}\n   Matched: ${r.matchedKeywords.join(', ')}`,
      ).join('\n\n');

      return { success: true, data: output };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Search failed' };
    }
  }

  getIndexStats(): { factsKeywords: number; knowledgeKeywords: number; lastUpdated: string } | null {
    if (!this.index) return null;
    return {
      factsKeywords: Object.keys(this.index.facts.keywords).length,
      knowledgeKeywords: Object.keys(this.index.knowledge.keywords).length,
      lastUpdated: this.index.lastFullIndex,
    };
  }
}

// Singleton instance
let memoryStore: MemoryStore | null = null;

export function getMemoryStore(config?: MemoryConfig): MemoryStore {
  if (!memoryStore && config) {
    memoryStore = new MemoryStore(config);
    memoryStore.init();
  }
  if (!memoryStore) {
    throw new Error('MemoryStore not initialized. Call getMemoryStore with config first.');
  }
  return memoryStore;
}

export function resetMemoryStore(): void {
  memoryStore = null;
}
