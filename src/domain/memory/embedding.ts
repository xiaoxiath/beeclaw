/**
 * @see ./embeddings.ts for EmbeddingProvider interface (MiniMax, Local, OpenAI providers)
 * @see ../../infra/utils for shared cosineSimilarity
 *
 * Embedding Service
 *
 * Provides text embeddings for semantic search.
 * Supports multiple providers: ollama (local), zhipu (remote)
 */

import type { AIProvider } from '../../infra/config/schema';
export { cosineSimilarity } from '../../infra/utils';

// Embedding result
export interface EmbeddingResult {
  embedding: number[];
  tokens: number;
}

// Embedding config
export interface EmbeddingConfig {
  provider: 'ollama' | 'zhipu' | 'openai';
  model: string;
  baseUrl?: string;
  apiKey?: string;
}

// Default config
export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  provider: 'ollama',
  model: 'nomic-embed-text',
  baseUrl: 'http://localhost:11434',
};

// Embedding service interface
export interface EmbeddingService {
  embed(text: string): Promise<EmbeddingResult>;
  embedBatch(texts: string[]): Promise<EmbeddingResult[]>;
  getDimension(): number;
}

/**
 * Ollama embedding service (local)
 */
export class OllamaEmbedding implements EmbeddingService {
  private baseUrl: string;
  private model: string;
  private dimension: number = 768; // nomic-embed-text dimension

  constructor(config: { model?: string; baseUrl?: string }) {
    this.model = config.model || 'nomic-embed-text';
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embedding failed: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      embedding: data.embedding,
      tokens: Math.ceil(text.length / 4), // Estimate
    };
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    // Ollama doesn't have batch API, so we process sequentially
    const results: EmbeddingResult[] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  getDimension(): number {
    return this.dimension;
  }
}

/**
 * Zhipu embedding service (remote)
 */
export class ZhipuEmbedding implements EmbeddingService {
  private apiKey: string;
  private model: string;
  private dimension: number = 1024; // embedding-3 dimension

  constructor(config: { apiKey: string; model?: string }) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'embedding-3';
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Zhipu embedding failed: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      embedding: data.data[0].embedding,
      tokens: data.usage?.total_tokens || 0,
    };
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    // Zhipu supports batch embedding
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
      throw new Error(`Zhipu embedding failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.data.map((item: any, index: number) => ({
      embedding: item.embedding,
      tokens: Math.ceil(texts[index].length / 4),
    }));
  }

  getDimension(): number {
    return this.dimension;
  }
}

/**
 * Create embedding service based on config
 */
export function createEmbeddingService(config: EmbeddingConfig, provider?: AIProvider): EmbeddingService {
  switch (config.provider) {
    case 'ollama':
      return new OllamaEmbedding({
        model: config.model,
        baseUrl: config.baseUrl,
      });

    case 'zhipu':
      return new ZhipuEmbedding({
        apiKey: config.apiKey || provider?.apiKey || process.env.ZHIPU_API_KEY || '',
        model: config.model,
      });

    case 'openai':
      // Fallback to ollama for now
      console.warn('[Embedding] OpenAI not implemented, falling back to ollama');
      return new OllamaEmbedding({
        model: 'nomic-embed-text',
      });

    default:
      return new OllamaEmbedding({
        model: 'nomic-embed-text',
      });
  }
}

// Singleton instance
let embeddingService: EmbeddingService | null = null;

export function initEmbeddingService(config: EmbeddingConfig, provider?: AIProvider): void {
  embeddingService = createEmbeddingService(config, provider);
}

export function getEmbeddingService(): EmbeddingService | null {
  return embeddingService;
}
/**
 * Chunk text for embedding (max 512 tokens per chunk)
 */
export function chunkText(text: string, maxTokens: number = 512): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split('\n\n');

  let currentChunk = '';

  for (const paragraph of paragraphs) {
    const estimatedTokens = (currentChunk + paragraph).length / 4;

    if (estimatedTokens > maxTokens && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = paragraph;
    } else {
      currentChunk += '\n\n' + paragraph;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter(c => c.length > 10); // Filter out very short chunks
}
