/**
 * P3-#9: 向量存储与语义搜索
 * 
 * 原始问题：indexer.ts 中的 MemoryIndex 仅包含 keywords 关键词索引，
 * searchIndex() 只做关键词匹配。store.ts 中 searchByKeyword() 是唯一
 * 的搜索入口，不支持向量/语义搜索。
 * 
 * 优化方案：
 * 1. EmbeddingProvider 接口 — 可插拔的向量嵌入提供者（OpenAI/BGE/本地等）
 * 2. VectorStore 抽象 — 支持内存索引和外部向量数据库适配
 * 3. 内存向量索引 — 基于余弦相似度的轻量级内存向量搜索
 * 4. 向量索引持久化 — 向量数据序列化/反序列化到本地文件
 * 5. 与现有关键词搜索并行 — 可同时运行关键词+向量搜索，结果融合
 * 
 * 使用方式：
 *   import { VectorMemoryStore, setEmbeddingProvider } from './vector-store';
 *   
 *   // 注入嵌入提供者
 *   setEmbeddingProvider({
 *     embed: async (text) => callOpenAIEmbedding(text),
 *     embedBatch: async (texts) => callOpenAIEmbeddingBatch(texts),
 *     dimensions: 1536,
 *   });
 *   
 *   const store = new VectorMemoryStore({ basePath: './memory' });
 *   await store.addDocument('facts/user-pref.md', content);
 *   const results = await store.search('用户的编程偏好', 5);
 */

// ─── 类型定义 ─────────────────────────────────────────────

/** 向量嵌入提供者（可插拔） */
export interface EmbeddingProvider {
  /** 将文本转为向量 */
  embed(text: string): Promise<number[]>;
  /** 批量嵌入 */
  embedBatch?(texts: string[]): Promise<number[][]>;
  /** 向量维度 */
  dimensions: number;
  /** Provider 名称（用于日志） */
  name?: string;
}

/** 向量文档 */
export interface VectorDocument {
  /** 文档 ID（通常是文件路径） */
  id: string;
  /** 原始文本 */
  text: string;
  /** 嵌入向量 */
  embedding: number[];
  /** 元数据 */
  metadata: {
    category?: string;
    fileName?: string;
    chunkIndex?: number;
    totalChunks?: number;
    createdAt?: number;
    updatedAt?: number;
    [key: string]: unknown;
  };
}

/** 向量搜索结果 */
export interface VectorSearchResult {
  id: string;
  text: string;
  score: number;
  metadata: VectorDocument['metadata'];
}

/** 向量存储配置 */
export interface VectorStoreConfig {
  /** 基础路径 */
  basePath: string;
  /** 向量索引文件名 */
  indexFileName: string;
  /** 文本分块大小（字符数） */
  chunkSize: number;
  /** 分块重叠（字符数） */
  chunkOverlap: number;
  /** 最小分块大小 */
  minChunkSize: number;
  /** 自动持久化 */
  autoPersist: boolean;
  /** 持久化间隔（文档数） */
  persistInterval: number;
}

/** 持久化格式 */
interface PersistedIndex {
  version: number;
  providerName: string;
  dimensions: number;
  documents: Array<{
    id: string;
    text: string;
    embedding: number[];
    metadata: VectorDocument['metadata'];
  }>;
  createdAt: string;
  updatedAt: string;
}

// ─── 默认配置 ──────────────────────────────────────────────

const DEFAULT_CONFIG: VectorStoreConfig = {
  basePath: './memory',
  indexFileName: '.vector-index.json',
  chunkSize: 500,
  chunkOverlap: 50,
  minChunkSize: 50,
  autoPersist: true,
  persistInterval: 10,
};

// ─── Embedding Provider 管理 ──────────────────────────────

let currentProvider: EmbeddingProvider | null = null;

/**
 * 注册向量嵌入提供者
 */
export function setEmbeddingProvider(provider: EmbeddingProvider): void {
  currentProvider = provider;
}

/**
 * 获取当前向量嵌入提供者
 */
export function getEmbeddingProvider(): EmbeddingProvider | null {
  return currentProvider;
}

// ─── 向量数学运算 ──────────────────────────────────────────

/**
 * 余弦相似度
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * 欧氏距离
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * 归一化向量
 */
export function normalizeVector(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  return v.map(x => x / norm);
}

// ─── 文本分块 ──────────────────────────────────────────────

/**
 * 智能文本分块
 * 
 * 优先在段落/句子边界处分割，避免在词中间断开。
 */
export function chunkText(
  text: string,
  chunkSize: number = 500,
  chunkOverlap: number = 50,
  minChunkSize: number = 50
): string[] {
  if (text.length <= chunkSize) {
    return text.trim().length >= minChunkSize ? [text.trim()] : [];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);

    // 如果不是最后一块，尝试在段落/句子边界处断开
    if (end < text.length) {
      // 优先在段落边界断开
      const paragraphBreak = text.lastIndexOf('\n\n', end);
      if (paragraphBreak > start + chunkSize * 0.5) {
        end = paragraphBreak + 2;
      } else {
        // 其次在句号/问号/感叹号处断开
        const sentenceEnd = Math.max(
          text.lastIndexOf('。', end),
          text.lastIndexOf('？', end),
          text.lastIndexOf('！', end),
          text.lastIndexOf('. ', end),
          text.lastIndexOf('? ', end),
          text.lastIndexOf('! ', end),
        );
        if (sentenceEnd > start + chunkSize * 0.3) {
          end = sentenceEnd + 1;
        } else {
          // 最后在换行处断开
          const lineBreak = text.lastIndexOf('\n', end);
          if (lineBreak > start + chunkSize * 0.3) {
            end = lineBreak + 1;
          }
        }
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length >= minChunkSize) {
      chunks.push(chunk);
    }

    // 带重叠移动
    start = end - chunkOverlap;
    if (start <= (chunks.length > 0 ? end - chunkOverlap : 0)) {
      start = end;
    }
  }

  return chunks;
}

// ─── 核心实现 ─────────────────────────────────────────────

/**
 * 内存向量存储
 * 
 * 提供文档的向量化索引、余弦相似度搜索、持久化功能。
 * 作为 MemoryStore 的语义搜索扩展层。
 */
export class VectorMemoryStore {
  private config: VectorStoreConfig;
  private documents: Map<string, VectorDocument> = new Map();
  private pendingPersist = 0;
  private dirty = false;

  constructor(config: Partial<VectorStoreConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 加载持久化索引
   */
  async load(): Promise<boolean> {
    const fs = require('fs');
    const path = require('path');
    const indexPath = path.join(this.config.basePath, this.config.indexFileName);

    if (!fs.existsSync(indexPath)) return false;

    try {
      const raw = fs.readFileSync(indexPath, 'utf-8');
      const persisted: PersistedIndex = JSON.parse(raw);

      // 检查维度兼容性
      if (currentProvider && persisted.dimensions !== currentProvider.dimensions) {
        console.warn(
          `[VectorStore] Dimension mismatch: index has ${persisted.dimensions}, ` +
          `provider has ${currentProvider.dimensions}. Rebuilding required.`
        );
        return false;
      }

      for (const doc of persisted.documents) {
        this.documents.set(doc.id, {
          id: doc.id,
          text: doc.text,
          embedding: doc.embedding,
          metadata: doc.metadata,
        });
      }

      return true;
    } catch (error) {
      console.warn('[VectorStore] Failed to load index:', error);
      return false;
    }
  }

  /**
   * 持久化索引到磁盘
   */
  async save(): Promise<void> {
    const fs = require('fs');
    const path = require('path');
    const indexPath = path.join(this.config.basePath, this.config.indexFileName);

    const dirPath = path.dirname(indexPath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    const persisted: PersistedIndex = {
      version: 1,
      providerName: currentProvider?.name || 'unknown',
      dimensions: currentProvider?.dimensions || 0,
      documents: Array.from(this.documents.values()),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(indexPath, JSON.stringify(persisted), 'utf-8');
    this.dirty = false;
    this.pendingPersist = 0;
  }

  /**
   * 添加文档（自动分块和向量化）
   */
  async addDocument(
    id: string,
    text: string,
    metadata: VectorDocument['metadata'] = {}
  ): Promise<number> {
    if (!currentProvider) {
      throw new Error('[VectorStore] No embedding provider configured. Call setEmbeddingProvider() first.');
    }

    // 分块
    const chunks = chunkText(
      text,
      this.config.chunkSize,
      this.config.chunkOverlap,
      this.config.minChunkSize
    );

    if (chunks.length === 0) return 0;

    // 删除旧的分块
    this.removeDocument(id);

    // 批量嵌入
    let embeddings: number[][];
    if (currentProvider.embedBatch && chunks.length > 1) {
      embeddings = await currentProvider.embedBatch(chunks);
    } else {
      embeddings = [];
      for (const chunk of chunks) {
        embeddings.push(await currentProvider.embed(chunk));
      }
    }

    // 存储
    for (let i = 0; i < chunks.length; i++) {
      const docId = chunks.length === 1 ? id : `${id}#chunk${i}`;
      this.documents.set(docId, {
        id: docId,
        text: chunks[i],
        embedding: embeddings[i],
        metadata: {
          ...metadata,
          chunkIndex: i,
          totalChunks: chunks.length,
          createdAt: Date.now(),
        },
      });
    }

    this.dirty = true;
    this.pendingPersist += chunks.length;

    // 自动持久化
    if (this.config.autoPersist && this.pendingPersist >= this.config.persistInterval) {
      await this.save();
    }

    return chunks.length;
  }

  /**
   * 删除文档（包括所有分块）
   */
  removeDocument(id: string): number {
    let removed = 0;
    const keysToDelete: string[] = [];

    for (const key of this.documents.keys()) {
      if (key === id || key.startsWith(`${id}#chunk`)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.documents.delete(key);
      removed++;
    }

    if (removed > 0) this.dirty = true;
    return removed;
  }

  /**
   * 语义搜索
   */
  async search(
    query: string,
    topK: number = 5,
    options?: {
      /** 最低相似度阈值 */
      minScore?: number;
      /** 按 category 过滤 */
      category?: string;
      /** 按时间范围过滤 */
      since?: number;
    }
  ): Promise<VectorSearchResult[]> {
    if (!currentProvider) {
      throw new Error('[VectorStore] No embedding provider configured.');
    }

    if (this.documents.size === 0) return [];

    // 嵌入查询
    const queryEmbedding = await currentProvider.embed(query);

    // 计算相似度
    const scored: Array<{ doc: VectorDocument; score: number }> = [];

    for (const doc of this.documents.values()) {
      // 过滤
      if (options?.category && doc.metadata.category !== options.category) continue;
      if (options?.since && doc.metadata.createdAt && doc.metadata.createdAt < options.since) continue;

      const score = cosineSimilarity(queryEmbedding, doc.embedding);
      if (options?.minScore && score < options.minScore) continue;

      scored.push({ doc, score });
    }

    // 排序并取 topK
    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, topK);

    // 去重（同一文档的多个 chunk，保留最高分的）
    const seen = new Map<string, VectorSearchResult>();
    for (const { doc, score } of results) {
      const baseId = doc.id.replace(/#chunk\d+$/, '');
      if (!seen.has(baseId) || score > seen.get(baseId)!.score) {
        seen.set(baseId, {
          id: baseId,
          text: doc.text,
          score,
          metadata: doc.metadata,
        });
      }
    }

    return Array.from(seen.values()).sort((a, b) => b.score - a.score);
  }

  /**
   * 获取文档数量
   */
  getStats(): {
    totalDocuments: number;
    totalChunks: number;
    dimensions: number;
    dirty: boolean;
  } {
    const baseIds = new Set<string>();
    for (const key of this.documents.keys()) {
      baseIds.add(key.replace(/#chunk\d+$/, ''));
    }

    return {
      totalDocuments: baseIds.size,
      totalChunks: this.documents.size,
      dimensions: currentProvider?.dimensions || 0,
      dirty: this.dirty,
    };
  }

  /**
   * 从现有 MemoryStore 的文件系统批量构建向量索引
   */
  async buildFromFileSystem(
    categories: string[] = ['facts', 'knowledge'],
    options?: { fileFilter?: (fileName: string) => boolean }
  ): Promise<{ indexed: number; chunks: number; errors: number }> {
    const fs = require('fs');
    const path = require('path');

    let indexed = 0;
    let totalChunks = 0;
    let errors = 0;

    for (const category of categories) {
      const dirPath = path.join(this.config.basePath, category);
      if (!fs.existsSync(dirPath)) continue;

      const files = this.walkDirectory(dirPath);

      for (const filePath of files) {
        const relativePath = path.relative(this.config.basePath, filePath);
        const fileName = path.basename(filePath);

        // 过滤隐藏文件和非文本文件
        if (fileName.startsWith('.')) continue;
        if (options?.fileFilter && !options.fileFilter(fileName)) continue;

        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          if (content.trim().length < this.config.minChunkSize) continue;

          const chunks = await this.addDocument(relativePath, content, {
            category,
            fileName,
          });
          indexed++;
          totalChunks += chunks;
        } catch (error) {
          console.warn(`[VectorStore] Failed to index ${relativePath}:`, error);
          errors++;
        }
      }
    }

    // 最终持久化
    if (this.dirty) {
      await this.save();
    }

    return { indexed, chunks: totalChunks, errors };
  }

  /**
   * 清空索引
   */
  clear(): void {
    this.documents.clear();
    this.dirty = true;
    this.pendingPersist = 0;
  }

  // ─── 内部方法 ──────────────────────────────────────────

  private walkDirectory(dirPath: string): string[] {
    const fs = require('fs');
    const path = require('path');
    const files: string[] = [];

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.')) {
          files.push(...this.walkDirectory(fullPath));
        }
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }

    return files;
  }
}

// ─── 便捷工厂 ──────────────────────────────────────────────

let defaultVectorStore: VectorMemoryStore | null = null;

/**
 * 获取或创建默认向量存储实例
 */
export function getVectorStore(config?: Partial<VectorStoreConfig>): VectorMemoryStore {
  if (!defaultVectorStore || config) {
    defaultVectorStore = new VectorMemoryStore(config);
  }
  return defaultVectorStore;
}
