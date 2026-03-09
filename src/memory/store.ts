import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, appendFileSync, readFileSync, renameSync, unlinkSync } from 'fs';
import { join, dirname, resolve, sep } from 'path';
import type { MemoryConfig, MemoryCategory, ConversationEntry, MemoryToolResult } from './types';
import { buildFullIndex, loadIndex, saveIndex, searchIndex, type MemoryIndex } from './indexer';

/**
 * Simple file-level lock implementation using lock files.
 * For production environments, consider using `proper-lockfile` npm package.
 */
class FileLock {
  private locks: Map<string, { promise: Promise<void>; resolve: () => void }> = new Map();

  async acquire(filePath: string): Promise<() => void> {
    const normalizedPath = resolve(filePath);

    // Wait for existing lock to be released
    while (this.locks.has(normalizedPath)) {
      await this.locks.get(normalizedPath)!.promise;
    }

    // Create new lock
    let lockResolve: () => void;
    const lockPromise = new Promise<void>((r) => {
      lockResolve = r;
    });

    this.locks.set(normalizedPath, {
      promise: lockPromise,
      resolve: lockResolve!,
    });

    // Return release function
    return () => {
      const lock = this.locks.get(normalizedPath);
      if (lock) {
        this.locks.delete(normalizedPath);
        lock.resolve();
      }
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
    // Only create preferences.md by default - other files are created on demand
    const defaultFiles = ['preferences.md'];

    for (const file of defaultFiles) {
      const filePath = join(factsPath, file);
      if (!existsSync(filePath)) {
        const title = file.replace('.md', '').charAt(0).toUpperCase() + file.replace('.md', '').slice(1);
        writeFileSync(filePath, `# ${title}\n\n`, 'utf-8');
      }
    }
  }

  private ensureCoreMemoryFiles(): void {
    // USER.md and SOUL.md will be created by onboarding wizard
    // This method is now a no-op, kept for compatibility
    // The onboarding system will handle creation of these files
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
   * [P0 FIX] Secure path traversal prevention:
   * Uses path.resolve() + prefix check instead of naive string replacement.
   * This prevents all known path traversal attacks including:
   *   - Simple: ../../../etc/passwd
   *   - Encoded: ....// (which becomes ../ after naive replace)
   *   - Null byte: path%00.md (handled by resolve normalization)
   *   - Absolute paths: /etc/passwd
   */
  private resolvePath(inputPath: string): string {
    // Strip leading slashes to prevent absolute path injection
    const stripped = inputPath.replace(/^[/\\]+/, '');

    // Resolve to absolute path under basePath
    const resolved = resolve(this.basePath, stripped);

    // Verify the resolved path is still under basePath
    // Must start with basePath + separator, OR be exactly basePath
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
        // Search in a single file
        this.grepFile(searchPath, query, results);
      } else {
        // Search recursively in directory
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

  /**
   * Write to file with concurrency safety.
   *
   * [P0 FIX] Atomic write + in-process lock:
   * 1. Acquires a per-file lock to prevent concurrent writes
   * 2. Uses atomic write (temp file + rename) to prevent partial writes
   * 3. Ensures data integrity even under concurrent session access
   */
  async write(path: string, content: string, mode: 'append' | 'overwrite' = 'append'): Promise<MemoryToolResult> {
    try {
      const fullPath = this.resolvePath(path);

      // Ensure directory exists
      const dir = dirname(fullPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Acquire file lock for concurrent access safety
      const release = await fileLock.acquire(fullPath);

      try {
        if (mode === 'overwrite') {
          atomicWriteFileSync(fullPath, content);
        } else {
          // For append mode: read current content, append, then atomic write
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
   * Uses atomic write but without lock (suitable for single-threaded init paths).
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
        let existingContent = '';
        if (existsSync(fullPath)) {
          existingContent = readFileSync(fullPath, 'utf-8');
        }
        atomicWriteFileSync(fullPath, existingContent + content);
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

      // Ensure file exists with header
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

      // Append fact with timestamp (using locked write)
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
   *
   * [P0 FIX] Uses file lock + atomic write for concurrent safety.
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

      // Acquire lock for this conversation file
      const release = await fileLock.acquire(filePath);

      try {
        // Create file with header if not exists
        let existing = '';
        if (existsSync(filePath)) {
          existing = readFileSync(filePath, 'utf-8');
        } else {
          existing = `# ${yearMonth}-${day}\n\n`;
        }

        // Format conversation entry
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

        // Atomic write: existing content + new entry
        atomicWriteFileSync(filePath, existing + content);
      } finally {
        release();
      }

      return { success: true, data: `Conversation recorded: ${yearMonth}/${day}.md` };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Read USER.md (用户信息)
  readUser(): MemoryToolResult {
    return this.read('USER.md');
  }

  // Read SOUL.md (AI人格定义)
  readSoul(): MemoryToolResult {
    return this.read('SOUL.md');
  }

  // Write USER.md
  writeUser(content: string): MemoryToolResult {
    return this.writeSync('USER.md', content, 'overwrite');
  }

  // Write SOUL.md
  writeSoul(content: string): MemoryToolResult {
    return this.writeSync('SOUL.md', content, 'overwrite');
  }

  // Get core memory context for AI (USER.md + SOUL.md + facts/)
  getCoreContext(): { user: string; soul: string; facts: string } {
    const userResult = this.readUser();
    const soulResult = this.readSoul();

    // Also read all files from facts/ directory
    let factsContent = '';
    const factsPath = join(this.basePath, 'facts');
    if (existsSync(factsPath)) {
      const factFiles = readdirSync(factsPath).filter(f => f.endsWith('.md'));
      for (const file of factFiles) {
        const filePath = join(factsPath, file);
        const content = readFileSync(filePath, 'utf-8').trim();
        if (content && content.length > 10) { // Skip empty/placeholder files
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

  // Load or build index
  private loadOrBuildIndex(): void {
    this.index = loadIndex(this.indexPath);
    if (!this.index) {
      this.rebuildIndex();
    }
  }

  // Rebuild full index
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

  // Search using index
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
        `📄 ${r.path}\n   Matched: ${r.matchedKeywords.join(', ')}`
      ).join('\n\n');

      return { success: true, data: output };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Search failed' };
    }
  }

  // Get index stats
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
