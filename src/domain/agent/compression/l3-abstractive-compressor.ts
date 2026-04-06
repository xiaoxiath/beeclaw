/**
 * L3 Abstractive Compressor — beeclaw wrapper
 *
 * Class re-exported from bee package. Only singleton management lives here.
 */

import { L3AbstractiveCompressor } from '@bee/context/compression/l3-abstractive-compressor';
import type { CompressionLLMClient } from './types';

export { L3AbstractiveCompressor };

let l3Instance: L3AbstractiveCompressor | null = null;

export function getL3Compressor(): L3AbstractiveCompressor {
  if (!l3Instance) {
    l3Instance = new L3AbstractiveCompressor();
  }
  return l3Instance;
}

export function resetL3Compressor(): void {
  l3Instance = null;
}

export function configureL3Compressor(client: CompressionLLMClient): void {
  getL3Compressor().setLLMClient(client);
}
