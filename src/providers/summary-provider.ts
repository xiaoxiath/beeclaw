/**
 * Summary LLM Provider Implementations for P3 Summary Engine
 *
 * Provides LLM providers for intelligent conversation summarization.
 */

import type { AIProvider } from '../config/schema';
import type { SummaryLLMProvider } from '../memory/summary-engine';

/**
 * Generic LLM Summary Provider
 *
 * Uses the existing agent API to generate summaries
 */
export class GenericSummaryProvider implements SummaryLLMProvider {
  name: string;
  private provider: AIProvider;
  private model: string;

  constructor(provider: AIProvider, model: string) {
    this.provider = provider;
    this.model = model;
    this.name = `${provider.type}-${model}`;
  }

  async generate(prompt: string, options?: {
    maxTokens?: number;
    temperature?: number;
    model?: string;
  }): Promise<string> {
    // Dynamic import to avoid circular dependencies
    const { callAI } = await import('../agent/api');

    const response = await callAI({
      provider: this.provider,
      model: options?.model || this.model,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: options?.maxTokens || 1000,
      temperature: options?.temperature ?? 0.3,
    });

    return response.choices[0]?.message?.content || '';
  }
}

/**
 * Fallback Summary Provider
 *
 * Simple provider that returns a fixed message (for testing or when LLM is unavailable)
 */
export class FallbackSummaryProvider implements SummaryLLMProvider {
  name = 'fallback-summary';

  async generate(prompt: string, options?: {
    maxTokens?: number;
    temperature?: number;
  }): Promise<string> {
    return JSON.stringify({
      summary: 'Summary generation is disabled (fallback provider active)',
      keyFacts: [],
      decisions: [],
      todos: [],
      topics: [],
    });
  }
}

/**
 * Create a summary provider based on the AI provider
 */
export function createSummaryProvider(provider: AIProvider, model?: string): SummaryLLMProvider {
  // Use a fast/cheap model for summarization by default
  const summaryModel = model || getDefaultSummaryModel(provider);

  return new GenericSummaryProvider(provider, summaryModel);
}

/**
 * Get default model for summarization based on provider type
 */
function getDefaultSummaryModel(provider: AIProvider): string {
  const providerType = provider.type.toLowerCase();

  // Prefer fast/cheap models for summarization
  if (providerType === 'openai') {
    return 'gpt-3.5-turbo'; // Fast and cheap
  }

  if (providerType === 'zhipu' || providerType === 'zhipuai') {
    return 'glm-4-flash'; // Zhipu's fast model
  }

  if (providerType === 'minimax') {
    return 'abab5.5-chat'; // MiniMax default
  }

  // Fallback to provider's default model
  return provider.models[0] || 'glm-4-flash';
}
