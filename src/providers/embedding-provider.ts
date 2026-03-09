/**
 * Embedding Provider Implementations for P3 Vector Store
 *
 * Provides embedding providers for semantic search and similarity matching.
 */

import type { AIProvider } from '../config/schema';
import type { EmbeddingProvider } from '../memory/vector-store';

/**
 * OpenAI Embedding Provider
 *
 * Uses OpenAI's text-embedding-ada-002 or text-embedding-3-small/large models
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  name: string;
  dimensions: number;
  private provider: AIProvider;
  private model: string;

  constructor(provider: AIProvider, model: string = 'text-embedding-ada-002') {
    this.provider = provider;
    this.model = model;
    this.name = `openai-${model}`;

    // Set dimensions based on model
    if (model.includes('text-embedding-3-large')) {
      this.dimensions = 3072;
    } else if (model.includes('text-embedding-3-small')) {
      this.dimensions = 1536;
    } else {
      this.dimensions = 1536; // ada-002 default
    }
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Dynamic import to avoid circular dependencies
    const { callAI } = await import('../agent/api');

    try {
      // For OpenAI, we need to call the embeddings API directly
      // Note: callAI is for chat completions, we need a different approach
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.provider.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          input: texts,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI Embedding API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.data.map((item: any) => item.embedding);
    } catch (error) {
      console.error('[OpenAIEmbeddingProvider] Embedding failed:', error);
      throw error;
    }
  }
}

/**
 * Zhipu AI Embedding Provider
 *
 * Uses Zhipu's embedding models
 */
export class ZhipuEmbeddingProvider implements EmbeddingProvider {
  name = 'zhipu-embedding';
  dimensions = 1024;
  private provider: AIProvider;

  constructor(provider: AIProvider) {
    this.provider = provider;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    try {
      const response = await fetch('https://open.bigmodel.cn/api/paas/v3/model-api/embedding-2/invoke', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.provider.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'embedding-2',
          input: texts,
        }),
      });

      if (!response.ok) {
        throw new Error(`Zhipu Embedding API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.data.map((item: any) => item.embedding);
    } catch (error) {
      console.error('[ZhipuEmbeddingProvider] Embedding failed:', error);
      throw error;
    }
  }
}

/**
 * Mock Embedding Provider (for testing)
 *
 * Generates random embeddings - DO NOT USE IN PRODUCTION
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  name = 'mock-embedding';
  dimensions = 128;

  async embed(text: string): Promise<number[]> {
    // Simple hash-based pseudo-random embedding for testing
    const hash = this.simpleHash(text);
    const embedding: number[] = [];
    for (let i = 0; i < this.dimensions; i++) {
      embedding.push((Math.sin(hash + i) + 1) / 2);
    }
    return this.normalize(embedding);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(text => this.embed(text)));
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
  }

  private normalize(vec: number[]): number[] {
    const norm = Math.sqrt(vec.reduce((sum, x) => sum + x * x, 0));
    return vec.map(x => x / norm);
  }
}

/**
 * Create an embedding provider based on the AI provider type
 */
export function createEmbeddingProvider(provider: AIProvider): EmbeddingProvider | null {
  const providerType = provider.type.toLowerCase();

  if (providerType === 'openai') {
    return new OpenAIEmbeddingProvider(provider);
  }

  if (providerType === 'zhipu' || providerType === 'zhipuai') {
    return new ZhipuEmbeddingProvider(provider);
  }

  // For other providers, return null (vector search will be disabled)
  console.warn(`[EmbeddingProvider] No embedding provider available for ${providerType}, vector search will be disabled`);
  return null;
}
