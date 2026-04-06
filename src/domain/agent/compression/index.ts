/**
 * Context Compression Module
 *
 * Three-tier compression architecture for context management:
 * - L1: Format compression (lossless, <1ms)
 * - L2: Extractive compression (TextRank, ~10ms)
 * - L3: Abstractive compression (LLM, ~1s)
 *
 * Classes re-exported from bee package. Singletons and beeclaw-specific
 * integration remain here.
 */

// Types — re-exported from bee
export type {
  CompressionLevel,
  CompressionResult,
  CompressionPlan,
  CompressionStats,
  CompressionLLMClient,
  AgeZone,
  Compressor,
} from './types';

export { DEFAULT_AGE_ZONES, createEmptyStats } from './types';

// L1 Format Compressor
export {
  L1FormatCompressor,
  getL1Compressor,
  resetL1Compressor,
} from './l1-format-compressor';

// L2 Extractive Compressor
export {
  L2ExtractiveCompressor,
  getL2Compressor,
  resetL2Compressor,
} from './l2-extractive-compressor';

// L3 Abstractive Compressor
export {
  L3AbstractiveCompressor,
  getL3Compressor,
  resetL3Compressor,
  configureL3Compressor,
} from './l3-abstractive-compressor';

// Tiered Compressor
export {
  TieredCompressor,
  getTieredCompressor,
  resetTieredCompressor,
  configureTieredCompressor,
} from './tiered-compressor';

// Progressive Compactor (beeclaw-specific)
export {
  ProgressiveCompactor,
  getProgressiveCompactor,
  resetProgressiveCompactor,
} from './progressive-compactor';
export type { CompactResult } from './progressive-compactor';

// Agent Integration (beeclaw-specific)
export {
  compressMessages,
  shouldCompress,
  getCompressionStats,
  resetCompressionStats,
} from './agent-integration';

// Legacy compatibility (will be removed in v2.0)
export { hybridCompress, type LegacyCompressionResult } from './legacy-compat';
