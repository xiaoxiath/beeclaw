/**
 * L2 Extractive Compressor — beeclaw wrapper
 *
 * Class re-exported from bee package. Only singleton management lives here.
 */

import { L2ExtractiveCompressor } from '@bee/context/compression/l2-extractive-compressor';

export { L2ExtractiveCompressor };

let l2Instance: L2ExtractiveCompressor | null = null;

export function getL2Compressor(): L2ExtractiveCompressor {
  if (!l2Instance) {
    l2Instance = new L2ExtractiveCompressor();
  }
  return l2Instance;
}

export function resetL2Compressor(): void {
  l2Instance = null;
}
