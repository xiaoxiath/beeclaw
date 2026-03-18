/**
 * Context Compression Module
 *
 * Three-tier compression architecture for context management:
 * - L1: Format compression (lossless, <1ms)
 * - L2: Extractive compression (TextRank, ~10ms)
 * - L3: Abstractive compression (LLM, ~1s)
 *
 * Plus progressive compaction for long conversations.
 */

// Types
export type {
  CompressionLevel,
  CompressionPlan,
  CompressionResult,
  CompressionStats,
  CompressionLLMClient,
  AgeZone,
  TimedMessage,
  Compressor,
} from './types';

export { DEFAULT_AGE_ZONES } from './types';

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

// Progressive Compactor
export {
  ProgressiveCompactor,
  getProgressiveCompactor,
  resetProgressiveCompactor,
} from './progressive-compactor';
export type { CompactResult } from './progressive-compactor';

// Agent Integration
export {
  compressMessages,
  shouldCompress,
  getCompressionStats,
  resetCompressionStats,
} from './agent-integration';
