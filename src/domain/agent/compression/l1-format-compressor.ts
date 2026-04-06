/**
 * L1 Format Compressor — beeclaw wrapper
 *
 * Class re-exported from bee package. Only singleton management lives here.
 */

import { L1FormatCompressor } from '@bee/context/compression/l1-format-compressor';

export { L1FormatCompressor };

let l1Instance: L1FormatCompressor | null = null;

export function getL1Compressor(): L1FormatCompressor {
  if (!l1Instance) {
    l1Instance = new L1FormatCompressor();
  }
  return l1Instance;
}

export function resetL1Compressor(): void {
  l1Instance = null;
}
