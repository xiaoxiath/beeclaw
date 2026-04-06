/**
 * beeclaw → bee Adapter
 *
 * Bridges beeclaw's infrastructure to bee's standalone modules.
 */

import type { ProviderConfig } from '@bee/core/types';
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
 *
 * This adapter lets beeclaw use bee's ToolRegistry for tool management
 * while keeping its existing tool definition format.
 *
 * For new tools, prefer registering directly with ToolRegistry + Zod schema.
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
  logger.debug('[BeeAdapter] Reset');
}
