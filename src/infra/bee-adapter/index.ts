/**
 * beeclaw → bee Adapter
 *
 * Bridges beeclaw's infrastructure to bee's standalone modules.
 */

import type { ProviderConfig } from '../../../packages/bee/src/core/types';
import { logger } from '../observability/logger';

// Re-export bee's ProviderConfig for convenience
export type { ProviderConfig } from '../../../packages/bee/src/core/types';

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
// Reset (for testing)
// ============================================================================

/**
 * Reset any shared state (for testing).
 */
export function resetBeeAdapter(): void {
  logger.debug('[BeeAdapter] Reset');
}
