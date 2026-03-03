/**
 * Embedding Providers
 *
 * 支持多种 embedding 后端，参考 OpenClaw 的设计
 */

import type { AIProvider } from '../config/schema';

// ============================================================================
// 类型定义
// ============================================================================

export interface EmbeddingProvider {
  id: string;
  model: string;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dims: number;
}

export interface EmbeddingProviderConfig {
  type: 'openai' | 'zhipu' | 'minimax' | 'local' | 'auto';
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  dims?: number;
}

export interface EmbeddingResult {
  provider: string;
  model: string;
  embeddings: number[][];
  usage?: {
    totalTokens: number;
  };
}

// ============================================================================
// OpenAI Embedding Provider
// ============================================================================

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  id = 'openai';
  model: string;
  dims: number;
  private apiKey: string;
  private baseUrl: string;

  constructor(config: { apiKey: string; model?: string; baseUrl?: string; dims?: number }) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'text-embedding-3-small';
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    this.dims = config.dims || 1536;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI embedding failed: ${error}`);
    }

    const data = await response.json();
    return data.data
      .sort((a: any, b: any) => a.index - b.index)
      .map((item: any) => item.embedding);
  }
}

// ============================================================================
// 智谱 Embedding Provider
// ============================================================================

export class ZhipuEmbeddingProvider implements EmbeddingProvider {
  id = 'zhipu';
  model: string;
  dims: number;
  private apiKey: string;

  constructor(config: { apiKey: string; model?: string; dims?: number }) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'embedding-3';
    this.dims = config.dims || 2048;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Zhipu embedding failed: ${error}`);
    }

    const data = await response.json();
    return data.data
      .sort((a: any, b: any) => a.index - b.index)
      .map((item: any) => item.embedding);
  }
}

// ============================================================================
// MiniMax Embedding Provider
// ============================================================================

export class MiniMaxEmbeddingProvider implements EmbeddingProvider {
  id = 'minimax';
  model: string;
  dims: number;
  private apiKey: string;
  private groupId: string;

  constructor(config: { apiKey: string; groupId: string; model?: string; dims?: number }) {
    this.apiKey = config.apiKey;
    this.groupId = config.groupId;
    this.model = config.model || 'embo-01';
    this.dims = config.dims || 1536;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(
      `https://api.minimax.chat/v1/embeddings?GroupId=${this.groupId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: texts,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`MiniMax embedding failed: ${error}`);
    }

    const data = await response.json();
    return data.data
      .sort((a: any, b: any) => a.index - b.index)
      .map((item: any) => item.embedding);
  }
}

// ============================================================================
// 本地 Embedding Provider (模拟)
// ============================================================================

/**
 * 本地 embedding provider
 * 使用简单的 TF-IDF 风格的向量，不依赖外部 API
 * 适用于没有网络或 API 配额的情况
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  id = 'local';
  model = 'local-tfidf';
  dims = 256; // 简化的维度

  async embed(text: string): Promise<number[]> {
    // 使用简单的哈希向量作为本地 embedding
    // 这是一个占位实现，实际使用时应该用更好的本地模型
    const words = this.tokenize(text);
    const vector = new Array(this.dims).fill(0);

    for (const word of words) {
      const hash = this.hashWord(word);
      vector[hash % this.dims] += 1;
    }

    // 归一化
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= norm;
      }
    }

    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }

  private tokenize(text: string): string[] {
    // 简单的分词：中文字符 + 英文单词
    const chinese = text.match(/[\u4e00-\u9fa5]+/g) || [];
    const english = text.toLowerCase().match(/[a-z]+/g) || [];
    return [...chinese, ...english];
  }

  private hashWord(word: string): number {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      const char = word.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }
}

// ============================================================================
// Provider 工厂
// ============================================================================

export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider | null {
  switch (config.type) {
    case 'openai':
      if (!config.apiKey) return null;
      return new OpenAIEmbeddingProvider({
        apiKey: config.apiKey,
        model: config.model,
        baseUrl: config.baseUrl,
        dims: config.dims,
      });

    case 'zhipu':
      if (!config.apiKey) return null;
      return new ZhipuEmbeddingProvider({
        apiKey: config.apiKey,
        model: config.model,
        dims: config.dims,
      });

    case 'minimax':
      if (!config.apiKey) return null;
      return new MiniMaxEmbeddingProvider({
        apiKey: config.apiKey,
        groupId: '', // 需要额外配置
        model: config.model,
        dims: config.dims,
      });

    case 'local':
      return new LocalEmbeddingProvider();

    case 'auto':
    default:
      // 尝试从环境变量自动检测
      const openaiKey = process.env.OPENAI_API_KEY;
      const zhipuKey = process.env.ZHIPU_API_KEY;

      if (openaiKey) {
        return new OpenAIEmbeddingProvider({ apiKey: openaiKey });
      }
      if (zhipuKey) {
        return new ZhipuEmbeddingProvider({ apiKey: zhipuKey });
      }

      // 回退到本地
      console.log('[Embeddings] No API key found, using local embedding');
      return new LocalEmbeddingProvider();
  }
}

// ============================================================================
// 向量工具函数
// ============================================================================

/**
 * 计算余弦相似度
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

/**
 * 计算 MMR (Maximal Marginal Relevance)
 * 用于在搜索结果中增加多样性
 */
export function mmr(
  queryEmbedding: number[],
  candidates: Array<{ id: string; embedding: number[]; score: number }>,
  lambda: number = 0.5,
  topK: number = 10,
): string[] {
  const selected: string[] = [];
  const remaining = [...candidates];

  while (selected.length < topK && remaining.length > 0) {
    let bestScore = -Infinity;
    let bestIdx = -1;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const querySim = cosineSimilarity(queryEmbedding, candidate.embedding);

      // 计算与已选择的最大相似度
      let maxSelectedSim = 0;
      for (const selectedId of selected) {
        const selectedCandidate = candidates.find((c) => c.id === selectedId);
        if (selectedCandidate) {
          const sim = cosineSimilarity(candidate.embedding, selectedCandidate.embedding);
          maxSelectedSim = Math.max(maxSelectedSim, sim);
        }
      }

      // MMR 分数
      const mmrScore = lambda * querySim - (1 - lambda) * maxSelectedSim;

      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      selected.push(remaining[bestIdx].id);
      remaining.splice(bestIdx, 1);
    } else {
      break;
    }
  }

  return selected;
}
