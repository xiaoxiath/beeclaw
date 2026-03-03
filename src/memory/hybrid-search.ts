/**
 * Hybrid Search Manager
 *
 * 参考 OpenClaw 的混合搜索设计
 * 支持向量搜索 + FTS 关键词搜索的混合模式
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import type { EmbeddingProvider } from './embeddings';
import { createEmbeddingProvider, cosineSimilarity, mmr } from './embeddings';
import { searchIndex, type MemoryIndex } from './indexer';

// ============================================================================
// 类型定义
// ============================================================================

export interface HybridSearchConfig {
  basePath: string;
  vector: {
    enabled: boolean;
    provider?: 'openai' | 'zhipu' | 'local' | 'auto';
    model?: string;
    dims?: number;
  };
  fts: {
    enabled: boolean;
  };
  hybrid: {
    vectorWeight: number;
    textWeight: number;
    mmr?: {
      enabled: boolean;
      lambda: number;
    };
    temporalDecay?: {
      enabled: boolean;
      halfLifeDays: number;
    };
  };
  cache: {
    enabled: boolean;
    maxEntries?: number;
  };
}

export interface HybridSearchResult {
  id: string;
  path: string;
  content: string;
  score: number;
  vectorScore?: number;
  textScore?: number;
  matchedKeywords?: string[];
  source: 'facts' | 'knowledge' | 'conversations';
  updatedAt?: string;
}

export interface HybridSearchStatus {
  vector: {
    enabled: boolean;
    available: boolean;
    provider?: string;
    model?: string;
    dims?: number;
  };
  fts: {
    enabled: boolean;
    available: boolean;
  };
  cache: {
    enabled: boolean;
    entries: number;
  };
}

// ============================================================================
// Hybrid Search Manager
// ============================================================================

export class HybridSearchManager {
  private config: HybridSearchConfig;
  private provider: EmbeddingProvider | null = null;
  private vectorIndex: Map<string, { embedding: number[]; path: string; updatedAt: string }> = new Map();
  private embeddingCache: Map<string, number[]> = new Map();
  private initialized: boolean = false;

  constructor(config: HybridSearchConfig) {
    this.config = config;
  }

  /**
   * 初始化搜索管理器
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // 创建嵌入提供者
    if (this.config.vector.enabled) {
      try {
        this.provider = createEmbeddingProvider({
          type: this.config.vector.provider || 'auto',
          model: this.config.vector.model,
          dims: this.config.vector.dims,
        });
        if (this.provider) {
          console.log(`[HybridSearch] Vector search enabled: ${this.provider.id}/${this.provider.model}`);
        }
      } catch (error) {
        console.warn('[HybridSearch] Failed to create embedding provider:', error);
      }
    }

    // 加载向量索引
    await this.loadVectorIndex();

    this.initialized = true;
  }

  /**
   * 执行混合搜索
   */
  async search(
    query: string,
    options?: {
      maxResults?: number;
      minScore?: number;
      sources?: ('facts' | 'knowledge' | 'conversations')[];
      useVector?: boolean;
      useFTS?: boolean;
    },
  ): Promise<HybridSearchResult[]> {
    await this.init();

    const maxResults = options?.maxResults ?? 10;
    const minScore = options?.minScore ?? 0.3;
    const candidates = Math.min(100, maxResults * 5);

    // 模式1: 仅 FTS（无 embedding 时降级）
    if (!this.provider || !this.config.vector.enabled) {
      return this.searchFTSOnly(query, maxResults, minScore);
    }

    // 模式2: 混合搜索
    const [vectorResults, ftsResults] = await Promise.all([
      this.config.vector.enabled && options?.useVector !== false
        ? this.searchVector(query, candidates)
        : Promise.resolve([]),
      this.config.fts.enabled && options?.useFTS !== false
        ? this.searchFTS(query, candidates)
        : Promise.resolve([]),
    ]);

    return Promise.resolve(this.mergeResults(vectorResults, ftsResults, maxResults, minScore));
  }

  /**
   * 仅 FTS 搜索（降级模式）
   */
  private async searchFTSOnly(
    query: string,
    maxResults: number,
    minScore: number,
  ): Promise<HybridSearchResult[]> {
    // 使用关键词提取提高匹配率
    const keywords = this.extractKeywords(query);
    const searchTerms = keywords.length > 0 ? keywords : [query];

    // 搜索每个关键词并合并结果
    const resultSets = await Promise.all(
      searchTerms.map((term) => this.searchFTS(term, maxResults)),
    );

    // 合并去重，保留最高分
    const seen = new Map<string, HybridSearchResult>();
    for (const results of resultSets) {
      for (const result of results) {
        const existing = seen.get(result.id);
        if (!existing || result.score > existing.score) {
          seen.set(result.id, result);
        }
      }
    }

    return [...seen.values()]
      .sort((a, b) => b.score - a.score)
      .filter((r) => r.score >= minScore)
      .slice(0, maxResults);
  }

  /**
   * 向量搜索
   */
  private async searchVector(
    query: string,
    limit: number,
  ): Promise<HybridSearchResult[]> {
    if (!this.provider) return [];

    try {
      const queryEmbedding = await this.embedWithCache(query);
      if (!queryEmbedding.some((v) => v !== 0)) {
        return [];
      }

      // 计算与所有索引向量的相似度
      const scores: Array<{ id: string; score: number }> = [];
      for (const [id, data] of this.vectorIndex.entries()) {
        const score = cosineSimilarity(queryEmbedding, data.embedding);
        scores.push({ id, score });
      }

      // 排序并返回 top 结果
      return scores
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((item) => {
          const data = this.vectorIndex.get(item.id)!;
          return {
            id: item.id,
            path: data.path,
            content: '', // 内容需要单独加载
            score: 0, // 将在合并时计算
            vectorScore: item.score,
            source: this.getSourceFromPath(data.path),
            updatedAt: data.updatedAt,
          };
        });
    } catch (error) {
      console.error('[HybridSearch] Vector search failed:', error);
      return [];
    }
  }

  /**
   * FTS 搜索
   */
  private async searchFTS(
    query: string,
    limit: number,
  ): Promise<HybridSearchResult[]> {
    // 使用现有的关键词索引搜索
    // 这里简化实现，实际应该调用 indexer.searchIndex
    const keywords = this.extractKeywords(query);
    const results: HybridSearchResult[] = [];

    // 搜索每个关键词
    for (const keyword of keywords) {
      const keywordLower = keyword.toLowerCase();

      // 遍历向量索引查找匹配
      for (const [id, data] of this.vectorIndex.entries()) {
        const content = readFileSync(join(this.config.basePath, data.path), 'utf-8').toLowerCase();
        if (content.includes(keywordLower)) {
          // 简单的 BM25 风格评分
          const tf = (content.match(new RegExp(keywordLower, 'g')) || []).length;
          const score = Math.min(1, tf / 10);

          results.push({
            id,
            path: data.path,
            content: '', // 稍后加载
            score: 0,
            textScore: score,
            matchedKeywords: [keyword],
            source: this.getSourceFromPath(data.path),
            updatedAt: data.updatedAt,
          });
        }
      }
    }

    // 合并重复结果
    const merged = new Map<string, HybridSearchResult>();
    for (const result of results) {
      const existing = merged.get(result.id);
      if (existing) {
        existing.textScore = Math.max(existing.textScore || 0, result.textScore || 0);
        if (result.matchedKeywords) {
          existing.matchedKeywords = [
            ...(existing.matchedKeywords || []),
            ...result.matchedKeywords,
          ];
        }
      } else {
        merged.set(result.id, { ...result });
      }
    }

    return [...merged.values()]
      .sort((a, b) => (b.textScore || 0) - (a.textScore || 0))
      .slice(0, limit);
  }

  /**
   * 合并向量和 FTS 结果
   */
  private mergeResults(
    vectorResults: HybridSearchResult[],
    ftsResults: HybridSearchResult[],
    maxResults: number,
    minScore: number,
  ): HybridSearchResult[] {
    const { vectorWeight, textWeight, mmr: mmrConfig, temporalDecay } = this.config.hybrid;
    const merged = new Map<string, HybridSearchResult>();

    // 处理向量结果
    for (const result of vectorResults) {
      const score = (result.vectorScore || 0) * vectorWeight;
      merged.set(result.id, {
        ...result,
        score,
      });
    }

    // 合并 FTS 结果
    for (const result of ftsResults) {
      const existing = merged.get(result.id);
      if (existing) {
        existing.score += (result.textScore || 0) * textWeight;
        existing.textScore = result.textScore;
        existing.matchedKeywords = result.matchedKeywords;
      } else {
        merged.set(result.id, {
          ...result,
          score: (result.textScore || 0) * textWeight,
        });
      }
    }

    // 应用时间衰减
    if (temporalDecay?.enabled) {
      const now = Date.now();
      const halfLifeMs = temporalDecay.halfLifeDays * 24 * 60 * 60 * 1000;

      for (const result of merged.values()) {
        if (result.updatedAt) {
          const age = now - new Date(result.updatedAt).getTime();
          const decay = Math.exp(-Math.log(2) * (age / halfLifeMs));
          result.score *= decay;
        }
      }
    }

    // 排序并返回
    let results = [...merged.values()]
      .sort((a, b) => b.score - a.score)
      .filter((r) => r.score >= minScore);

    // 应用 MMR 多样性
    if (mmrConfig?.enabled && this.provider && results.length > maxResults) {
      // MMR 需要向量，这里简化处理
      // 实际实现应该使用 mmr() 函数
    }

    return results.slice(0, maxResults);
  }

  /**
   * 索引文件
   */
  async indexFile(
    path: string,
    content: string,
    metadata?: { updatedAt?: string },
  ): Promise<void> {
    if (!this.provider || !this.config.vector.enabled) return;

    try {
      const embedding = await this.embedWithCache(content);
      const id = this.pathToId(path);

      this.vectorIndex.set(id, {
        embedding,
        path,
        updatedAt: metadata?.updatedAt || new Date().toISOString(),
      });

      // 保存索引
      await this.saveVectorIndex();
    } catch (error) {
      console.error(`[HybridSearch] Failed to index ${path}:`, error);
    }
  }

  /**
   * 删除文件索引
   */
  async removeFile(path: string): Promise<void> {
    const id = this.pathToId(path);
    this.vectorIndex.delete(id);
    await this.saveVectorIndex();
  }

  /**
   * 重建全部索引
   */
  async rebuildIndex(): Promise<{ indexed: number; errors: string[] }> {
    const result = { indexed: 0, errors: [] as string[] };

    if (!this.provider) {
      result.errors.push('No embedding provider available');
      return result;
    }

    this.vectorIndex.clear();

    const processDir = (dirPath: string) => {
      if (!existsSync(dirPath)) return;

      const entries = readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          processDir(fullPath);
        } else if (entry.name.endsWith('.md')) {
          try {
            const content = readFileSync(fullPath, 'utf-8');
            const relativePath = fullPath.replace(this.config.basePath, '').replace(/^\//, '');
            this.indexFile(relativePath, content);
            result.indexed++;
          } catch (error) {
            result.errors.push(`${fullPath}: ${error}`);
          }
        }
      }
    };

    // 索引 facts 和 knowledge 目录
    processDir(join(this.config.basePath, 'facts'));
    processDir(join(this.config.basePath, 'knowledge'));

    await this.saveVectorIndex();
    return result;
  }

  /**
   * 获取状态
   */
  getStatus(): HybridSearchStatus {
    return {
      vector: {
        enabled: this.config.vector.enabled,
        available: !!this.provider,
        provider: this.provider?.id,
        model: this.provider?.model,
        dims: this.provider?.dims,
      },
      fts: {
        enabled: this.config.fts.enabled,
        available: true,
      },
      cache: {
        enabled: this.config.cache.enabled,
        entries: this.embeddingCache.size,
      },
    };
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  private async embedWithCache(text: string): Promise<number[]> {
    // 截断长文本
    const truncated = text.slice(0, 8000);
    const cacheKey = this.hashText(truncated);

    if (this.config.cache.enabled && this.embeddingCache.has(cacheKey)) {
      return this.embeddingCache.get(cacheKey)!;
    }

    const embedding = await this.provider!.embed(truncated);

    if (this.config.cache.enabled) {
      // 限制缓存大小
      if (this.embeddingCache.size >= (this.config.cache.maxEntries || 1000)) {
        // 删除最旧的条目（简化：删除第一个）
        const firstKey = this.embeddingCache.keys().next().value;
        if (firstKey) {
          this.embeddingCache.delete(firstKey);
        }
      }
      this.embeddingCache.set(cacheKey, embedding);
    }

    return embedding;
  }

  private extractKeywords(text: string): string[] {
    // 简单的关键词提取
    const keywords: string[] = [];

    // 中文关键词（2-4字）
    const chinesePattern = /[\u4e00-\u9fa5]{2,4}/g;
    let match;
    while ((match = chinesePattern.exec(text)) !== null) {
      keywords.push(match[0]);
    }

    // 英文单词（3+字）
    const englishPattern = /\b[a-zA-Z]{3,}\b/g;
    while ((match = englishPattern.exec(text)) !== null) {
      keywords.push(match[0].toLowerCase());
    }

    return [...new Set(keywords)];
  }

  private pathToId(path: string): string {
    return path.replace(/[\/\\]/g, '_').replace(/\.md$/, '');
  }

  private getSourceFromPath(path: string): 'facts' | 'knowledge' | 'conversations' {
    if (path.includes('facts/')) return 'facts';
    if (path.includes('knowledge/')) return 'knowledge';
    return 'conversations';
  }

  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  private async loadVectorIndex(): Promise<void> {
    const indexPath = join(this.config.basePath, 'vector-index.json');
    if (!existsSync(indexPath)) return;

    try {
      const data = JSON.parse(readFileSync(indexPath, 'utf-8'));
      for (const [id, value] of Object.entries(data)) {
        this.vectorIndex.set(id, value as any);
      }
      console.log(`[HybridSearch] Loaded ${this.vectorIndex.size} vector entries`);
    } catch (error) {
      console.warn('[HybridSearch] Failed to load vector index:', error);
    }
  }

  private async saveVectorIndex(): Promise<void> {
    const indexPath = join(this.config.basePath, 'vector-index.json');
    const data = Object.fromEntries(this.vectorIndex.entries());

    try {
      // 确保目录存在
      const dir = dirname(indexPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(indexPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('[HybridSearch] Failed to save vector index:', error);
    }
  }
}

// ============================================================================
// 默认配置
// ============================================================================

export const DEFAULT_HYBRID_SEARCH_CONFIG: HybridSearchConfig = {
  basePath: './data/memory',
  vector: {
    enabled: true,
    provider: 'auto',
  },
  fts: {
    enabled: true,
  },
  hybrid: {
    vectorWeight: 0.7,
    textWeight: 0.3,
    mmr: {
      enabled: false,
      lambda: 0.5,
    },
    temporalDecay: {
      enabled: false,
      halfLifeDays: 30,
    },
  },
  cache: {
    enabled: true,
    maxEntries: 1000,
  },
};

// ============================================================================
// 单例
// ============================================================================

let hybridSearchManager: HybridSearchManager | null = null;

export function getHybridSearchManager(config?: Partial<HybridSearchConfig>): HybridSearchManager {
  if (!hybridSearchManager) {
    hybridSearchManager = new HybridSearchManager({
      ...DEFAULT_HYBRID_SEARCH_CONFIG,
      ...config,
    });
  }
  return hybridSearchManager;
}

export function resetHybridSearchManager(): void {
  hybridSearchManager = null;
}
