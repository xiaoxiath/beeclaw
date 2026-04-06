/**
 * beeclaw → bee Adapter
 *
 * Bridges beeclaw's infrastructure to bee's standalone modules.
 */

import type { ProviderConfig } from '@bee/core/types';
import { AIClient } from '@bee/provider/call-ai';
import { ToolRegistry } from '@bee/tool/registry';
import { logger } from '../observability/logger';

// Re-export bee's ProviderConfig for convenience
export type { ProviderConfig } from '@bee/core/types';

// ============================================================================
// Provider conversion
// ============================================================================

interface BeeclawProvider {
  type: string;
  apiKey: string;
  baseUrl?: string;
  options?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Convert beeclaw's AIProvider to bee's ProviderConfig.
 */
export function toProviderConfig(provider: BeeclawProvider): ProviderConfig {
  return {
    type: provider.type,
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    headers: provider.options?.headers as Record<string, string> | undefined,
    options: provider.options,
  };
}

// ============================================================================
// AIClient factory (for new code)
// ============================================================================

let _aiClient: AIClient | null = null;

/**
 * Get a bee AIClient wired to beeclaw's retry + concurrency singletons.
 *
 * For new code, prefer using this over beeclaw's callAI() directly:
 *   const client = getBeeAIClient();
 *   const response = await client.callAI({ provider, model, messages });
 *
 * beeclaw's existing api.ts (callAI/streamAI) continues to work unchanged
 * for backward compatibility.
 */
export function getBeeAIClient(): AIClient {
  if (!_aiClient) {
    // Lazy-import to avoid circular deps at module load.
    // beeclaw's singletons are structurally compatible with bee's interfaces
    // (bee was extracted from beeclaw, same method signatures).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getRetryEngine } = require('../../infra/resilience/unified-retry') as typeof import('../../infra/resilience/unified-retry');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getLLMConcurrencyLimiter } = require('../../infra/ai/concurrency-limiter') as typeof import('../../infra/ai/concurrency-limiter');

    _aiClient = new AIClient({
      retryEngine: getRetryEngine() as any, // structurally compatible
      concurrencyLimiter: getLLMConcurrencyLimiter() as any,
    });
  }
  return _aiClient;
}

// ============================================================================
// Tool registry bridge
// ============================================================================

interface OpenAIToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Create a bee ToolRegistry from beeclaw's existing OpenAI-format tools.
 */
export function createToolRegistryFromOpenAI(
  tools: OpenAIToolDef[],
  executor: (name: string, params: Record<string, unknown>) => Promise<unknown>,
): ToolRegistry {
  const registry = new ToolRegistry();

  for (const tool of tools) {
    registry.register({
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters as any,
      execute: (params) => executor(tool.function.name, params as Record<string, unknown>),
    });
  }

  return registry;
}

// ============================================================================
// Reset (for testing)
// ============================================================================

/**
 * Reset any shared state (for testing).
 */
export function resetBeeAdapter(): void {
  _aiClient = null;
  logger.debug('[BeeAdapter] Reset');
}
