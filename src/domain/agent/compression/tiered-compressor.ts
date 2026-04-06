/**
 * Tiered Compressor — beeclaw wrapper
 *
 * Class re-exported from bee package. Only singleton management lives here.
 */

import { TieredCompressor } from '@bee/context/compression/tiered-compressor';
import type { CompressionLLMClient } from './types';

export { TieredCompressor };

/**
 * Singleton instance
 */
let tieredInstance: TieredCompressor | null = null;

/**
 * @internal Get tiered compressor instance (used by ProgressiveCompactor).
 */
export function getTieredCompressor(): TieredCompressor {
  if (!tieredInstance) {
    tieredInstance = new TieredCompressor();
  }
  return tieredInstance;
}

/**
 * @internal Reset tiered compressor (for testing).
 */
export function resetTieredCompressor(): void {
  tieredInstance = null;
}

/**
 * Configure tiered compressor with LLM client.
 * Called from app layer during bootstrap.
 */
export function configureTieredCompressor(client: CompressionLLMClient): void {
  getTieredCompressor().setLLMClient(client);
}
